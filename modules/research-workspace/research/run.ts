// 主动研究：读任务与历史结论 → 有界查询计划 → 搜索 → 读原文 → 结构化抽取 → 证据校验 → 比较历史 →
// 写台账版本与 outbox → 记运行结果。所有上限都是硬上限：查询 6、正文 12 页、抽取 1 次、模型调用 12 次、
// 单次 15 分钟。搜索/模型失败如实记成 failed/partial/budget_exceeded，不伪装成没有变化。
import { shutdownSignal } from "@aihot/backend/lib/shutdown";
import { BudgetExceededError, ModelUnavailableError } from "@aihot/backend/providers/receipts";
import type { ResearchRunStatus, ResearchTask, RunCoverage } from "../contracts.ts";
import { appendLedgerEntry, listLedgerView } from "../ledger.ts";
import { listTaskReports } from "../reports.ts";
import { ensureRun, finishRun, latestRun, startRun } from "../runs.ts";
import { getTask } from "../tasks.ts";
import { fetchResearchPage, type FetchedPage } from "../providers/page.ts";
import { searchWeb, type SearchOutcome } from "../providers/search.ts";
import { fallbackPlan, planWithModel, MAX_QUERIES } from "./plan.ts";
import { extractWithModel, verifyCandidates } from "./extract.ts";

export const LIMITS = {
  queries: MAX_QUERIES,
  results: 30,
  pages: 12,
  modelCalls: 12,
  minutes: 15,
} as const;

export interface ResearchJobInput {
  taskId: string;
  scheduledFor: string | null;
  trigger: "schedule" | "manual" | "catch-up";
}

export interface ResearchDeps {
  search: (query: string, options: { maxResults: number; purpose: string; subject: string }) => Promise<SearchOutcome>;
  fetchPage: (url: string, options: { subject: string; fixture: boolean }) => Promise<FetchedPage | null>;
  plan: (input: { task: ResearchTask; history: string }) => Promise<{ queries: string[]; modelCalls: number }>;
  extract: (input: { task: ResearchTask; pages: readonly FetchedPage[]; history: string }) => Promise<{ candidates: Parameters<typeof verifyCandidates>[0]; modelCalls: number; model: string }>;
  now: () => Date;
}

const defaults: ResearchDeps = {
  search: searchWeb,
  fetchPage: fetchResearchPage,
  plan: planWithModel,
  extract: extractWithModel,
  now: () => new Date(),
};

class Cancelled extends Error {}

/** 历史结论摘要：告诉抽取器哪些已经写过，避免重复版本。 */
async function historyOf(taskId: string): Promise<string> {
  const [entries, reports] = await Promise.all([listLedgerView({ taskId, limit: 20 }), listTaskReports(taskId, undefined, 3).catch(() => [])]);
  const lines = entries.map((entry) => `- [${entry.kind}/${entry.status}] ${entry.title}：${entry.body.slice(0, 160)}`);
  const lastReport = reports[0] ? `\n上一次报告：${reports[0].body.slice(0, 400)}` : "";
  return `${lines.join("\n") || "（还没有台账）"}${lastReport}`;
}

function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}

/** 一次研究。deps 可注入（测试用本地 stub，不连付费服务）。 */
export async function runTaskResearch(input: ResearchJobInput, overrides: Partial<ResearchDeps> = {}): Promise<{ runId: string | null; status: ResearchRunStatus | "skipped" }> {
  const deps: ResearchDeps = { ...defaults, ...overrides };
  const task = await getTask(input.taskId);
  if (!task) return { runId: null, status: "skipped" };
  if (task.status !== "active" && input.trigger !== "manual") return { runId: null, status: "skipped" };

  const previous = await latestRun(task.id);
  const coverageFrom = previous?.finishedAt ?? previous?.startedAt ?? null;
  // 计划运行按 (task_id, scheduled_for) 去重：重复派发不会再开一次。
  const ensured = input.scheduledFor ? await ensureRun(task.id, new Date(input.scheduledFor)) : null;
  if (ensured && !ensured.created) return { runId: ensured.run.id, status: "skipped" };
  const run = ensured?.run ?? (await startRun(task.id, null));
  const startedAt = deps.now();
  const deadline = startedAt.getTime() + LIMITS.minutes * 60_000;
  const coverage: RunCoverage = { from: coverageFrom, to: startedAt.toISOString(), queries: 0, results: 0, fetched: 0, unreadable: 0, rejected: 0, fixture: false };
  let searchCalls = 0;
  let modelCalls = 0;
  let fixtureRun = false;
  const problems: string[] = [];
  const cancelled = () => shutdownSignal.signal.aborted;
  const overDeadline = () => deps.now().getTime() > deadline;

  const finish = async (status: Exclude<ResearchRunStatus, "running">, error: string | null): Promise<{ runId: string; status: Exclude<ResearchRunStatus, "running"> }> => {
    coverage.fixture = fixtureRun;
    await finishRun(run.id, { status, searchCalls, modelCalls, summary: runSummary(status, coverage, problems), error, coverage });
    return { runId: run.id, status };
  };

  try {
    if (cancelled()) throw new Cancelled("worker 正在停止");
    const history = await historyOf(task.id);

    // 1. 计划（有界）：模型不可用或预算用完时退回确定性查询。
    let queries: string[];
    try {
      const planned = await deps.plan({ task, history });
      modelCalls += planned.modelCalls;
      queries = planned.queries.slice(0, LIMITS.queries);
    } catch (error) {
      if (cancelled()) throw new Cancelled("worker 正在停止");
      if (error instanceof BudgetExceededError) throw error;
      problems.push(`查询计划用了确定性回退（${error instanceof ModelUnavailableError ? "模型调用关闭或未配置" : error instanceof Error ? error.message : String(error)}）`);
      queries = fallbackPlan(task).slice(0, LIMITS.queries);
    }
    coverage.queries = queries.length;

    // 2. 搜索：线索而已；搜索失败不写成没有变化。
    const leads = new Map<string, { title: string; url: string; snippet: string; publishedAt: string | null }>();
    let searchFailures = 0;
    for (const query of queries) {
      if (cancelled()) throw new Cancelled("worker 正在停止");
      if (overDeadline()) throw new Error(`单次研究超过 ${LIMITS.minutes} 分钟，停止在搜索阶段`);
      try {
        const outcome = await deps.search(query, { maxResults: 5, purpose: "research.search", subject: run.id });
        searchCalls += 1;
        if (outcome.fixture) fixtureRun = true;
        for (const result of outcome.results) {
          if (leads.size >= LIMITS.results) break;
          if (!/^https?:\/\//i.test(result.url)) continue;
          if (!leads.has(result.url)) leads.set(result.url, { title: result.title, url: result.url, snippet: result.snippet, publishedAt: result.publishedAt });
        }
      } catch (error) {
        if (cancelled()) throw new Cancelled("worker 正在停止");
        if (error instanceof BudgetExceededError) throw error;
        searchFailures += 1;
        problems.push(`搜索失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    coverage.results = leads.size;
    if (!leads.size) {
      const error = searchFailures >= queries.length ? "搜索全部失败，不能当作没有新变化" : "搜索没有返回可读的线索";
      return await finish("failed", error);
    }

    // 3. 读原文：最多 12 页；读不到的线索记 unreadable，不拿搜索摘要当证据。
    const pages: FetchedPage[] = [];
    for (const lead of leads.values()) {
      if (cancelled()) throw new Cancelled("worker 正在停止");
      if (overDeadline()) throw new Error(`单次研究超过 ${LIMITS.minutes} 分钟，停止在读原文阶段`);
      if (pages.length >= LIMITS.pages) break;
      const page = await deps.fetchPage(lead.url, { subject: task.id, fixture: fixtureRun });
      if (page) {
        if (page.fixture) fixtureRun = true;
        pages.push(page);
      } else {
        coverage.unreadable += 1;
      }
    }
    coverage.fetched = pages.length;
    if (!pages.length) return await finish("failed", "线索的原文全部读不到（SSRF/登录墙/抓取失败），不拿摘要当证据");

    // 4. 抽取（一次模型调用）与证据校验。
    if (cancelled()) throw new Cancelled("worker 正在停止");
    if (overDeadline()) throw new Error(`单次研究超过 ${LIMITS.minutes} 分钟，停止在抽取前`);
    let extracted: Awaited<ReturnType<ResearchDeps["extract"]>>;
    try {
      extracted = await deps.extract({ task, pages, history });
      modelCalls += extracted.modelCalls;
    } catch (error) {
      if (cancelled()) throw new Cancelled("worker 正在停止");
      if (error instanceof BudgetExceededError) return await finish("budget_exceeded", error.message);
      const message = error instanceof ModelUnavailableError ? "模型调用关闭或未配置，本次没有抽取到任何台账（不伪装成没有变化）" : `抽取失败：${error instanceof Error ? error.message : String(error)}`;
      problems.push(message);
      return await finish("failed", message);
    }
    modelCalls = Math.min(modelCalls, LIMITS.modelCalls);

    const verified = verifyCandidates(extracted.candidates, pages, extracted.model);
    coverage.rejected += verified.rejected;

    // 5. 比较历史并写台账版本（append 里写 ledger.version outbox，和版本一起提交）。
    const latest = new Map((await listLedgerView({ taskId: task.id, limit: 500 })).map((entry) => [entry.entryKey, entry]));
    let changed = 0;
    for (const { candidate, evidence } of verified.accepted) {
      if (cancelled()) throw new Cancelled("worker 正在停止");
      const previousEntry = latest.get(candidate.entryKey);
      if (previousEntry?.humanLocked) { coverage.rejected += 1; continue; }
      if (previousEntry && sameText(previousEntry.title, candidate.title) && sameText(previousEntry.body, candidate.body) && previousEntry.status === candidate.status) continue;
      await appendLedgerEntry({
        taskId: task.id,
        entryKey: candidate.entryKey,
        kind: candidate.kind,
        status: candidate.status,
        title: candidate.title,
        body: candidate.body,
        author: candidate.author,
        model: candidate.kind === "ai_assessment" ? extracted.model : null,
        modelVersion: null,
        runId: run.id,
        evidence,
      });
      latest.set(candidate.entryKey, {
        id: "", taskId: task.id, entryKey: candidate.entryKey, version: (previousEntry?.version ?? 0) + 1,
        kind: candidate.kind, status: candidate.status, title: candidate.title, body: candidate.body,
        author: candidate.author, model: candidate.kind === "ai_assessment" ? extracted.model : null,
        modelVersion: null, runId: run.id, supersedesId: previousEntry?.id ?? null, humanLocked: false,
        createdAt: deps.now().toISOString(), evidence: [], readState: null,
      });
      changed += 1;
    }

    // 6. 结论：有问题但没有全失败时如实标 partial。
    if (changed === 0 && problems.length) return await finish("partial", problems.slice(0, 3).join("；"));
    if (changed === 0 && fixtureRun) return await finish("no_change", "本地 fixtures（未联网）没有产生新的台账；配好搜索凭证后才会读真实原文");
    if (changed === 0) return await finish("no_change", null);
    return await finish(problems.length ? "partial" : "succeeded", problems.length ? problems.slice(0, 3).join("；") : null);
  } catch (error) {
    if (error instanceof Cancelled) return await finish("cancelled", error.message);
    if (error instanceof BudgetExceededError) return await finish("budget_exceeded", error.message);
    return await finish("failed", error instanceof Error ? error.message : String(error));
  }
}

function runSummary(status: Exclude<ResearchRunStatus, "running">, coverage: RunCoverage, problems: readonly string[]): string {
  const parts = [
    `查询 ${coverage.queries} 条、拿到 ${coverage.results} 条线索、读到 ${coverage.fetched} 篇原文`,
    coverage.unreadable ? `读不到原文 ${coverage.unreadable} 条` : null,
    coverage.rejected ? `拒绝 ${coverage.rejected} 条不合格条目` : null,
    coverage.fixture ? "来源：本地 fixtures（未联网）" : "来源：搜索（Tavily）",
  ].filter(Boolean);
  if (problems.length) parts.push(`问题：${problems.slice(0, 2).join("；")}`);
  void status;
  return parts.join("；");
}
