// 工作台的数据层：任务（含信源）、运行、台账（含引用和阅读状态）、报告和事务 outbox 的读写。
// 跑在 tests/databases.ts 给的独立测试库上，迁移（含模块 migrations/）由 npm test 的全局设置在之前跑完。
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { addTaskSource, createTask, getTask, listTasks, removeTaskSource, setTaskSourceEnabled, setTaskStatus } from "../tasks.ts";
import { appendLedgerEntry, getLedgerEntry, getReadState, ledgerCounts, ledgerVersions, listLedgerEntries, listLedgerView, markAllRead, setLedgerLocked, setReadState } from "../ledger.ts";
import { finishRun, latestRun, listRuns, startRun } from "../runs.ts";
import { appendTaskReport, listTaskReports } from "../reports.ts";
import { markOutboxDispatched, markOutboxFailed, pendingOutbox, recordOutbox } from "../outbox.ts";

after(closeDb);

async function task(title = "AI 官方公告跟踪") {
  return createTask({
    title,
    goal: "盯住几家 AI 公司官方公告里与模型发布、定价和合规有关的变化。",
    cadence: { kind: "daily", at: "05:30" },
    outputTemplate: "先给结论，再列证据。",
    sources: [
      { kind: "rss", locator: "https://example.com/feed.xml" },
      { kind: "search", locator: "AI 官方公告 新模型" },
      { kind: "rss", locator: "https://example.com/feed.xml" },
    ],
  });
}

test("任务和它的信源一起落库；重复信源只留一条", async () => {
  const created = await task();
  assert.equal(created.status, "active");
  assert.deepEqual(created.cadence, { kind: "daily", at: "05:30" });
  assert.equal(created.outputTemplate, "先给结论，再列证据。");
  assert.equal(created.sources.length, 2);
  assert.deepEqual(created.sources.map((source) => `${source.kind} ${source.locator}`), ["rss https://example.com/feed.xml", "search AI 官方公告 新模型"]);

  const read = await getTask(created.id);
  assert.deepEqual(read, created);
  assert.equal((await getTask("no-such-task"))?.id, undefined);

  const listed = await listTasks();
  assert.ok(listed.some((row) => row.id === created.id));

  const paused = await setTaskStatus(created.id, "paused");
  assert.equal(paused?.status, "paused");
  assert.equal((await setTaskStatus("no-such-task", "paused")), null);
});

test("任务输入先校验：空标题、空目标、坏节奏都不落库", () => {
  // 输入校验在开事务之前同步做完，所以是直接抛错，不是异步拒绝。
  assert.throws(() => createTask({ title: " ", goal: "g", cadence: { kind: "manual" }, outputTemplate: "", sources: [] }), /标题/);
  assert.throws(() => createTask({ title: "t", goal: " ", cadence: { kind: "manual" }, outputTemplate: "", sources: [] }), /目标/);
  assert.throws(() => createTask({ title: "t", goal: "g", cadence: { kind: "daily", at: "5:30" }, outputTemplate: "", sources: [] }), /HH:mm/);
  assert.throws(() => createTask({ title: "t", goal: "g", cadence: { kind: "weekly", at: "05:30", weekdays: [] }, outputTemplate: "", sources: [] }), /weekdays/);
});

test("台账按主题键留版本；事实必须绑引用；阅读状态与人工锁", async () => {
  const created = await task("台账");
  const first = await appendLedgerEntry({
    taskId: created.id,
    entryKey: "openai/gpt-release",
    kind: "fact",
    status: "disclosed",
    title: "OpenAI 发布新模型",
    body: "官方公告称新模型已向付费用户开放。",
    evidence: [{ url: "https://example.com/announcement", channel: "rss:openai", publisher: "Example", quote: "available today", license: "all-rights-reserved" }],
  });
  assert.equal(first.version, 1);
  assert.equal(first.supersedesId, null);
  assert.equal(first.evidence.length, 1);
  assert.equal(first.evidence[0]!.url, "https://example.com/announcement");

  const second = await appendLedgerEntry({
    taskId: created.id,
    entryKey: "openai/gpt-release",
    kind: "fact",
    status: "cross_verified",
    title: "OpenAI 发布新模型（已交叉核验）",
    body: "官方公告与定价页都确认了这次发布。",
    humanLocked: true,
    evidence: [{ url: "https://example.com/pricing", channel: "web:openai" }],
  });
  assert.equal(second.version, 2);
  assert.equal(second.supersedesId, first.id);
  assert.equal(second.humanLocked, true);

  assert.throws(() => appendLedgerEntry({ taskId: created.id, entryKey: "no/evidence", kind: "fact", title: "没有引用的事实" }), /引用/);
  assert.throws(() => appendLedgerEntry({ taskId: created.id, entryKey: "bad/url", kind: "fact", title: "坏引用", evidence: [{ url: "file:///etc/passwd", channel: "web" }] }), /http/);

  const listed = await listLedgerEntries(created.id);
  assert.deepEqual(listed.map((entry) => entry.version).sort(), [1, 2]);
  const loaded = await getLedgerEntry(second.id);
  assert.equal(loaded?.title, "OpenAI 发布新模型（已交叉核验）");
  assert.equal(loaded?.evidence[0]!.bodyHash, null);

  assert.equal(await setLedgerLocked(second.id, true), true);
  assert.equal(await setLedgerLocked("no-such-entry", true), false);

  const read = await setReadState(second.id, { readAt: new Date("2026-11-14T13:00:00.000Z"), starred: true });
  assert.equal(read.starred, true);
  assert.equal(read.readAt, "2026-11-14T13:00:00.000Z");
  const patched = await setReadState(second.id, { needsCheck: true, note: "等官方 PDF" });
  assert.equal(patched.starred, true, "没传的字段保持原样");
  assert.equal(patched.needsCheck, true);
  assert.equal(patched.note, "等官方 PDF");
  assert.equal((await getReadState(second.id))?.starred, true);
});

test("运行记录区分成功、无变化、失败、取消和预算拦截；结束过的不能再结束", async () => {
  const created = await task("运行");
  const run = await startRun(created.id, new Date("2026-11-14T05:30:00.000Z"));
  assert.equal(run.status, "running");
  assert.equal(run.scheduledFor, "2026-11-14T05:30:00.000Z");
  const done = await finishRun(run.id, { status: "partial", searchCalls: 6, modelCalls: 12, summary: "两页抓不到正文" });
  assert.equal(done?.status, "partial");
  assert.equal(done?.searchCalls, 6);
  assert.equal(done?.modelCalls, 12);
  assert.ok(done?.finishedAt);
  assert.equal(await finishRun(run.id, { status: "succeeded" }), null, "结束过的运行不再改状态");

  const refused = await startRun(created.id, null);
  assert.equal((await finishRun(refused.id, { status: "budget_exceeded", error: "今日搜索预算用完" }))?.status, "budget_exceeded");
  assert.equal((await latestRun(created.id))?.status, "budget_exceeded");
  assert.equal((await listRuns(created.id)).length, 2);
});

test("任务报告挂在任务上，新的在前", async () => {
  const created = await task("报告");
  const run = await startRun(created.id, null);
  const report = await appendTaskReport({ taskId: created.id, runId: run.id, kind: "summary", body: "今天没有需要处理的变化。" });
  assert.equal(report.runId, run.id);
  await assert.rejects(() => appendTaskReport({ taskId: created.id, kind: "summary", body: " " }), /不能为空/);
  const listed = await listTaskReports(created.id);
  assert.equal(listed[0]!.id, report.id);
});

test("事务 outbox：待发、失败重试和已派发", async () => {
  await sql`DELETE FROM research_outbox`;
  const id = await recordOutbox(sql, "run.finished", { taskId: "t1", status: "succeeded" });
  const pending = await pendingOutbox();
  assert.deepEqual(pending.map((event) => event.id), [id]);
  assert.equal(pending[0]!.eventType, "run.finished");
  assert.deepEqual(pending[0]!.payload, { taskId: "t1", status: "succeeded" });

  await markOutboxFailed(sql, id, "worker 不在");
  const [failed] = await sql<{ attempts: number; last_error: string }[]>`SELECT attempts, last_error FROM research_outbox WHERE id = ${id}`;
  assert.equal(failed!.attempts, 1);
  assert.equal(failed!.last_error, "worker 不在");

  await markOutboxDispatched(sql, id);
  assert.deepEqual(await pendingOutbox(), []);
  await markOutboxDispatched(sql, id);
  const [row] = await sql<{ dispatched_at: Date }[]>`SELECT dispatched_at FROM research_outbox WHERE id = ${id}`;
  assert.ok(row!.dispatched_at, "已派发的时间不会被重复派发改掉");
});

test("任务信源可以增删、启停；相同信源不重复", async () => {
  const created = await task("信源管理");
  const added = await addTaskSource(created.id, "search", "  新模型 定价  ");
  assert.equal(added?.kind, "search");
  assert.equal(added?.locator, "新模型 定价");
  assert.equal((await addTaskSource(created.id, "search", "新模型 定价"))?.id, added!.id, "相同信源返回已有的那条");
  const read = await getTask(created.id);
  assert.equal(read?.sources.filter((source) => source.locator === "新模型 定价").length, 1);
  assert.equal((await setTaskSourceEnabled(added!.id, false))?.enabled, false);
  assert.equal((await setTaskSourceEnabled(added!.id, true))?.enabled, true);
  assert.equal(await removeTaskSource(added!.id), true);
  assert.equal(await removeTaskSource(added!.id), false);
  assert.equal(await addTaskSource("no-such-task", "rss", "https://example.com/x"), null);
});

test("台账列表按未读/收藏/待核实筛，计数和版本历史可用，全部已读只改没读过的", async () => {
  const created = await task("台账视图");
  const evidence = [{ url: "https://example.com/evidence", channel: "rss:example" }];
  const first = await appendLedgerEntry({ taskId: created.id, entryKey: "topic/a", kind: "fact", title: "第一版", body: "a", evidence });
  const second = await appendLedgerEntry({ taskId: created.id, entryKey: "topic/a", kind: "fact", title: "第二版", body: "b", evidence });
  const other = await appendLedgerEntry({ taskId: created.id, entryKey: "topic/b", kind: "human_conclusion", title: "人工结论", evidence });

  assert.equal((await ledgerCounts(created.id)).all, 3);
  assert.equal((await ledgerCounts(created.id)).unread, 3);
  assert.deepEqual((await listLedgerView({ taskId: created.id, filter: "unread" })).map((row) => row.id).sort(), [first.id, other.id, second.id].sort());

  await setReadState(second.id, { readAt: new Date(), starred: true, needsCheck: true });
  const starred = await listLedgerView({ taskId: created.id, filter: "starred" });
  assert.deepEqual(starred.map((row) => row.id), [second.id]);
  assert.equal(starred[0]!.readState?.starred, true);
  assert.deepEqual((await listLedgerView({ taskId: created.id, filter: "needsCheck" })).map((row) => row.id), [second.id]);
  assert.equal((await ledgerCounts(created.id)).unread, 2);
  assert.equal((await ledgerCounts(created.id)).starred, 1);

  const versions = await ledgerVersions(created.id, "topic/a");
  assert.deepEqual(versions.map((entry) => entry.version), [1, 2]);
  assert.equal(versions[1]!.supersedesId, versions[0]!.id);

  const marked = await markAllRead(created.id);
  assert.equal(marked, 3);
  assert.equal((await ledgerCounts(created.id)).unread, 0);
  const [kept] = await sql`SELECT read_at, starred FROM research_read_state WHERE ledger_id = ${second.id}`;
  assert.ok(kept!.read_at);
  assert.equal(kept!.starred, true);
});
