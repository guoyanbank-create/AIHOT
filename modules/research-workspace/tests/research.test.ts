// 主动研究流程：用注入的本地搜索/抓取/抽取（不连任何付费服务）验证上限、证据校验、历史比较、
// 人工锁定不被覆盖、失败不伪装成没有变化、覆盖缺口和 outbox。
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { BudgetExceededError } from "@aihot/backend/providers/receipts";
import { createTask, getTask } from "../tasks.ts";
import { appendLedgerEntry, getLedgerEntry, listLedgerView, setLedgerLocked } from "../ledger.ts";
import { latestRun } from "../runs.ts";
import { pendingOutbox } from "../outbox.ts";
import { fallbackSummary } from "../research/summary.ts";
import { nextDue, latestDue } from "../research/due.ts";
import { runTaskResearch, type ResearchDeps } from "../research/run.ts";
import type { Candidate } from "../research/extract.ts";
import type { FetchedPage } from "../providers/page.ts";

after(closeDb);

const NOW = new Date("2026-11-14T06:00:00.000Z");
const PAGE: FetchedPage = {
  url: "https://fixtures.local/demo/pricing",
  title: "[fixture] 示例科技 API 定价页更新",
  text: "[fixture] 这是本地演示数据。新一代模型每百万输入 token 1.5 美元，2026 年 11 月 20 日生效。",
  publishedAt: "2026-11-13",
  via: "fixture",
  channel: "fixture:search",
  fixture: true,
};

const fact: Candidate = {
  entryKey: "demo/pricing", kind: "fact", status: "disclosed", title: "示例科技调整 API 定价",
  body: "定价页确认新一代模型每百万输入 token 1.5 美元，2026 年 11 月 20 日生效。",
  author: null, quote: "每百万输入 token 1.5 美元", evidenceUrls: [PAGE.url],
};

function deps(overrides: Partial<ResearchDeps> = {}): Partial<ResearchDeps> {
  return {
    plan: async () => ({ queries: ["示例科技 定价"], modelCalls: 1 }),
    search: async () => ({
      provider: "fixtures",
      fixture: true,
      receiptId: null,
      results: [{ title: PAGE.title, url: PAGE.url, snippet: PAGE.text.slice(0, 80), publishedAt: PAGE.publishedAt }],
    }),
    fetchPage: async () => PAGE,
    extract: async () => ({ candidates: [fact], modelCalls: 1, model: "test-model" }),
    now: () => NOW,
    ...overrides,
  };
}

async function task() {
  return createTask({
    title: "示例科技公告跟踪",
    goal: "盯住示例科技官方公告与定价页面里与发布、定价有关的变化。",
    cadence: { kind: "daily", at: "05:30" },
    outputTemplate: "先给结论。",
    sources: [{ kind: "search", locator: "示例科技 官方公告" }],
  });
}

test("一次研究：搜索→读原文→抽取→证据校验→写台账版本与 outbox，并记覆盖", async () => {
  const created = await task();
  const result = await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "manual" }, deps());
  assert.equal(result.status, "succeeded");
  const run = await latestRun(created.id);
  assert.equal(run?.status, "succeeded");
  assert.equal(run?.searchCalls, 1);
  assert.equal(run?.modelCalls, 2);
  assert.equal(run?.coverage?.queries, 1);
  assert.equal(run?.coverage?.fetched, 1);
  assert.equal(run?.coverage?.fixture, true);

  const entries = await listLedgerView({ taskId: created.id });
  assert.equal(entries.length, 1);
  const entry = entries[0]!;
  assert.equal(entry.title, fact.title);
  assert.equal(entry.kind, "fact");
  assert.equal(entry.evidence.length, 1);
  assert.equal(entry.evidence[0]!.channel, "fixture:search");
  assert.equal(entry.evidence[0]!.url, PAGE.url);
  assert.ok(entry.evidence[0]!.bodyHash);
  assert.equal(entry.runId, run!.id);

  const events = (await pendingOutbox(undefined, 50)).filter((event) => event.eventType === "ledger.version");
  assert.ok(events.some((event) => (event.payload as { entryId?: string }).entryId === entry.id));
});

test("同样的结论再跑一次不产生新版本（no_change），覆盖缺口从上次结束时间算", async () => {
  const created = await task();
  const first = await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "manual" }, deps());
  assert.equal(first.status, "succeeded");
  const firstRun = await latestRun(created.id);
  const second = await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "manual" }, deps());
  assert.equal(second.status, "no_change");
  assert.equal((await listLedgerView({ taskId: created.id })).length, 1);
  const secondRun = await latestRun(created.id);
  assert.equal(secondRun?.coverage?.from, firstRun?.finishedAt);
  assert.equal(secondRun?.summary?.includes("fixtures"), true);
});

test("搜索失败、读不到原文、预算被拦都没有伪装成没有变化", async () => {
  const created = await task();
  const searchFailed = await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "manual" }, deps({ search: async () => { throw new Error("connect ECONNREFUSED"); } }));
  assert.equal(searchFailed.status, "failed");
  assert.equal((await latestRun(created.id))?.status, "failed");

  const unreadable = await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "manual" }, deps({ fetchPage: async () => null }));
  assert.equal(unreadable.status, "failed");
  assert.match((await latestRun(created.id))?.error ?? "", /原文/);

  const budget = await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "manual" }, deps({ extract: async () => { throw new BudgetExceededError("llm", "day", 3600); } }));
  assert.equal(budget.status, "budget_exceeded");
  assert.equal((await latestRun(created.id))?.status, "budget_exceeded");
  assert.equal((await listLedgerView({ taskId: created.id })).length, 0);
});

test("证据不合格的抽取被拒绝；AI 不能写人工结论；来源观点必须有作者", async () => {
  const created = await task();
  const noEvidence: Candidate = { ...fact, entryKey: "demo/no-evidence", title: "没有引用的说法", evidenceUrls: [] };
  const human: Candidate = { ...fact, entryKey: "demo/human", kind: "human_conclusion", title: "AI 写的人工结论" };
  const viewNoAuthor: Candidate = { ...fact, entryKey: "demo/view", kind: "source_view", title: "没有作者的来源观点", author: null };
  const goodView: Candidate = { ...fact, entryKey: "demo/view-ok", kind: "source_view", title: "有作者的来源观点", author: "示例记者" };
  const result = await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "manual" }, deps({
    extract: async () => ({ candidates: [noEvidence, human, viewNoAuthor, goodView], modelCalls: 1, model: "test-model" }),
  }));
  assert.equal(result.status, "succeeded");
  const entries = await listLedgerView({ taskId: created.id });
  assert.deepEqual(entries.map((entry) => entry.title).sort(), ["有作者的来源观点"].sort());
  const run = await latestRun(created.id);
  assert.equal(run?.coverage?.rejected, 3);
});

test("人工锁定的条目不会被 AI 覆盖", async () => {
  const created = await task();
  await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "manual" }, deps());
  const [entry] = await listLedgerView({ taskId: created.id });
  assert.equal(await setLedgerLocked(entry!.id, true), true);
  const changedFirst: Candidate = { ...fact, title: "示例科技调整 API 定价（AI 想改的版本）" };
  const result = await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "manual" }, deps({ extract: async () => ({ candidates: [changedFirst], modelCalls: 1, model: "test-model" }) }));
  assert.equal(result.status, "no_change");
  assert.equal((await listLedgerView({ taskId: created.id }))[0]!.title, fact.title);
  assert.equal((await getLedgerEntry(entry!.id))?.humanLocked, true);
  assert.equal((await latestRun(created.id))?.coverage?.rejected, 1);
});

test("手动运行会跑暂停的任务；计划运行跳过暂停任务", async () => {
  const created = await task();
  await sql`UPDATE research_tasks SET status = 'paused' WHERE id = ${created.id}`;
  assert.equal((await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "schedule" }, deps())).status, "skipped");
  assert.equal((await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "manual" }, deps())).status, "succeeded");
});

test("到点时间按北京时间算：每天 05:30、每周一 10:00；下一次也对", () => {
  const daily = { kind: "daily" as const, at: "05:30" };
  assert.equal(latestDue(daily, new Date("2026-11-14T06:00:00+08:00"))?.toISOString(), "2026-11-13T21:30:00.000Z");
  // 05:00 还没到今天的 05:30，最近一次是昨天 05:30。
  assert.equal(latestDue(daily, new Date("2026-11-14T05:00:00+08:00"))?.toISOString(), "2026-11-12T21:30:00.000Z");
  assert.equal(nextDue({ cadence: daily, status: "active" }, new Date("2026-11-14T06:00:00+08:00"))?.toISOString(), "2026-11-14T21:30:00.000Z");
  const weekly = { kind: "weekly" as const, at: "10:00", weekdays: [1] };
  // 2026-11-14 是周六；最近一次周一 10:00 是 11 月 9 日。
  assert.equal(latestDue(weekly, new Date("2026-11-14T06:00:00+08:00"))?.toISOString(), "2026-11-09T02:00:00.000Z");
  assert.equal(latestDue({ kind: "manual" as const }, new Date()) === null, true);
});

test("没有模型时的摘要退化成确定性列表，不编造", async () => {
  const created = await task();
  const entry = await appendLedgerEntry({ taskId: created.id, entryKey: "demo/a", kind: "fact", title: "一条事实", body: "正文", evidence: [{ url: "https://example.com/a", channel: "rss:x" }] });
  const taskDetail = await getTask(created.id);
  const text = fallbackSummary(taskDetail!, [{ ...entry, readState: null }]);
  assert.ok(text.includes("一条事实"));
  assert.ok(text.includes("引用 1 条"));
});

test("任务里的 RSS/网页信源会被读取；没有搜索提供商时不再混入 fixtures", async () => {
  const created = await createTask({
    title: "主流媒体监测（测试）",
    goal: "盯住主流媒体最近报道里与科技、AI 有关的头条。",
    cadence: { kind: "manual" },
    outputTemplate: "先给结论。",
    sources: [
      { kind: "rss", locator: "https://feeds.bbci.co.uk/news/world/rss.xml" },
      { kind: "web", locator: "https://www.theguardian.com/world" },
    ],
  });
  let searchCalled = false;
  let planned = false;
  const makePage = (url: string, channel?: string): FetchedPage => ({ url, title: "主流媒体报道", text: "正文", publishedAt: "2026-11-14", via: "readability", channel: channel ?? "web:unknown", fixture: false });
  const result = await runTaskResearch({ taskId: created.id, scheduledFor: null, trigger: "manual" }, {
    plan: async () => { planned = true; throw new Error("没有搜索时不该计划查询"); },
    search: async () => { searchCalled = true; throw new Error("不该调用搜索"); },
    fetchFeed: async () => [
      { title: "BBC：某国通过新的科技法案", url: "https://www.bbc.com/news/tech-test", publishedAt: "2026-11-14T00:00:00.000Z" },
    ],
    fetchPage: async (url, options) => makePage(url, options.channel),
    extract: async ({ pages }) => ({
      candidates: [{ entryKey: "world/tech-bill", kind: "fact", status: "disclosed", title: "BBC 报道：某国通过新的科技法案", body: "正文", author: null, quote: null, evidenceUrls: [pages[0]!.url] }],
      modelCalls: 1,
      model: "test-model",
    }),
  });
  assert.equal(result.status, "succeeded");
  assert.equal(searchCalled, false);
  assert.equal(planned, false);
  const run = await latestRun(created.id);
  assert.equal(run?.coverage?.feeds, 1);
  assert.equal(run?.coverage?.web, 1);
  assert.equal(run?.coverage?.queries, 0);
  const entries = await listLedgerView({ taskId: created.id });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.evidence[0]!.channel, "rss:feeds.bbci.co.uk");
  assert.equal(entries[0]!.evidence[0]!.url, "https://www.bbc.com/news/tech-test");
});
