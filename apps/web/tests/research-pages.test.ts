// 长期调研工作台的主界面：五个主菜单和它们的页面能打开，任务/台账的固定数据按真实形状渲染。
// 这里用合成 api（不连数据库），页面和导航是构建后的真实产出。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { LedgerListEntry, LedgerView, SettingsView, SourcesView, TaskDetail, TaskOverview, TodayOverview } from "../../../modules/research-workspace/contracts.ts";
import { fakeApi, startWebServer, type WebServer } from "./web-server.ts";

const NOW = "2026-11-14T05:30:00.000Z";
const readState = { ledgerId: "l1", readAt: null, starred: false, needsCheck: true, note: "等官方 PDF", updatedAt: NOW };
const ledgerEntry: LedgerListEntry = {
  id: "l1", taskId: "t1", entryKey: "topic/a", version: 2, kind: "fact", status: "cross_verified",
  title: "官方公告确认新模型发布", body: "公告与定价页都确认了这次发布。", author: null, model: null, modelVersion: null,
  runId: null, supersedesId: "l0", humanLocked: false, createdAt: NOW,
  evidence: [{ id: "e1", ledgerId: "l1", url: "https://example.com/a", publisher: "Example", channel: "rss:openai", publishedAt: NOW, discoveredAt: NOW, fetchedAt: NOW, analyzedAt: NOW, bodyHash: "abc", quoteLocator: "p1", quote: "available today", license: "all-rights-reserved", createdAt: NOW }],
  readState,
};
const task = { id: "t1", title: "官方公告跟踪", goal: "盯住官方公告里与发布和定价有关的变化。", status: "active" as const, cadence: { kind: "daily" as const, at: "05:30" }, outputTemplate: "先给结论。", lastRunAt: NOW, createdAt: NOW, updatedAt: NOW, sources: [{ id: "s1", taskId: "t1", kind: "rss" as const, locator: "https://example.com/feed.xml", position: 0, enabled: true, createdAt: NOW }] };
const run = { id: "r1", taskId: "t1", scheduledFor: NOW, startedAt: NOW, finishedAt: NOW, status: "no_change" as const, searchCalls: 4, modelCalls: 6, summary: "没有新变化。", error: null, coverage: { from: NOW, to: NOW, queries: 4, results: 8, fetched: 6, unreadable: 1, rejected: 0, fixture: false } };
const overview: TaskOverview = { task, latestRun: run, unreadCount: 1, reportCount: 1, nextRunAt: NOW };
const today: TodayOverview = { unread: [ledgerEntry], starred: [], needsCheck: [ledgerEntry], counts: { all: 1, unread: 1, starred: 0, needsCheck: 1 }, tasks: [overview], recentRuns: [{ ...run, taskTitle: task.title }], timezone: "Asia/Shanghai" };
const ledger: LedgerView = { entries: [ledgerEntry], tasks: [{ id: "t1", title: task.title }], counts: { all: 1, unread: 1, starred: 0, needsCheck: 1 } };
const detail: TaskDetail = { task, runs: [run], nextRunAt: NOW, reports: [{ id: "rep1", taskId: "t1", runId: "r1", kind: "summary", body: "今天没有需要处理的变化。", createdAt: NOW }], ledger: [ledgerEntry] };
const sources: SourcesView = { tasks: [{ id: "t1", title: task.title, status: "active", sources: task.sources }], kinds: ["rss", "web", "search"] };
const settings: SettingsView = { timezone: "Asia/Shanghai", limits: { queriesPerRun: 6, pagesPerRun: 12, roundsPerRun: 2, modelCallsPerRun: 12, minutesPerRun: 15, timezone: "Asia/Shanghai" }, search: { provider: "tavily", configured: false }, counts: { tasks: 1, sources: 1, entries: 1, runs: 1 }, engine: { adminUrl: "/admin/settings" } };

const api = fakeApi((url) => {
  const path = url.pathname;
  if (path === "/api/admin/research/today") return today;
  if (path === "/api/admin/research/tasks") return [overview];
  if (path === "/api/admin/research/tasks/t1") return detail;
  if (path === "/api/admin/research/ledger") return ledger;
  if (path === "/api/admin/research/ledger/l1") return { entry: ledgerEntry, versions: [ledgerEntry], readState };
  if (path === "/api/admin/research/sources") return sources;
  if (path === "/api/admin/research/settings") return settings;
  if (path === "/api/admin/me") return { name: "Fixture admin", csrf: "fixture", dev: false };
});
let web: WebServer;
before(async () => { web = await startWebServer(api); });
after(() => web.stop());

const page = async (path: string): Promise<string> => {
  const res = await fetch(web.origin + path);
  assert.equal(res.status, 200, path);
  return res.text();
};

test("五个主菜单取代了引擎的公开导航", async () => {
  const html = await page("/today");
  for (const label of ["今日", "任务", "台账", "信源", "设置"]) assert.ok(html.includes(label), `navigation has ${label}`);
  // 引擎的公开菜单全部隐藏（首页、热点榜、日报、主题……）。
  for (const label of ["热点榜", "AI 日报", "Agent 接入"]) assert.ok(!html.includes(label), `engine navigation entry ${label} is hidden`);
  assert.ok(html.includes("自上次阅读以来的变化"));
  assert.ok(html.includes("官方公告确认新模型发布"));
  assert.ok(html.includes("全部标为已读"));
  assert.ok(html.includes("未读变化"));
});

test("任务页有四步创建入口和任务列表", async () => {
  const html = await page("/tasks");
  assert.ok(html.includes("新建任务"));
  assert.ok(html.includes("官方公告跟踪"));
  assert.ok(html.includes("每天 05:30"));
  assert.ok(html.includes("条未读变化"));
});

test("任务详情有目标、运行历史、报告和台账", async () => {
  const html = await page("/tasks/t1");
  assert.ok(html.includes("研究目标"));
  assert.ok(html.includes("运行历史"));
  assert.ok(html.includes("今天没有需要处理的变化。"));
  assert.ok(html.includes("最近的台账"));
  assert.ok(html.includes("暂停"));
});

test("台账页有筛选、导出和条目；详情有证据、版本与备注", async () => {
  const html = await page("/ledger");
  for (const label of ["全部", "未读", "收藏", "待核实", "导出 CSV", "导出 Markdown"]) assert.ok(html.includes(label), label);
  assert.ok(html.includes("官方公告确认新模型发布"));
  const opened = await page("/ledger?entry=l1");
  assert.ok(opened.includes("引用与证据"));
  assert.ok(opened.includes("https://example.com/a"));
  assert.ok(opened.includes("版本差异"));
  assert.ok(opened.includes("人工备注"));
  assert.ok(opened.includes("等官方 PDF"));
});

test("信源页按任务分组，能加信源", async () => {
  const html = await page("/sources");
  assert.ok(html.includes("加一条信源"));
  assert.ok(html.includes("官方公告跟踪"));
  assert.ok(html.includes("https://example.com/feed.xml"));
});

test("设置页显示时区、硬上限和搜索提供商状态", async () => {
  const html = await page("/settings");
  assert.ok(html.includes("研究节奏与上限"));
  assert.ok(html.includes("Asia/Shanghai"));
  assert.ok(html.includes("6 次"));
  assert.ok(html.includes("未配置"));
  assert.ok(html.includes("打开后台设置"));
});
