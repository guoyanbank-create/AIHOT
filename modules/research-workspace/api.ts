// 工作台的后台接口（/api/admin/research/*）：只给登录后的本人，写操作还要后台会话的 CSRF。
// 网页进程只通过 HTTP 读这里；数据库和模型调用都在后端（见 docs/architecture.md 的模块约定）。
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sessionPrincipal, type AdminPrincipal } from "@aihot/backend/admin/auth";
import { sql } from "@aihot/backend/db";
import {
  RESEARCH_LIMITS,
  type LedgerEntryDetail,
  type LedgerFilter,
  type LedgerView,
  type SettingsView,
  type SourcesView,
  type TaskDetail,
  type TaskOverview,
  type TodayOverview,
} from "./contracts.ts";
import { addTaskSource, createTask, getTask, listTasks, removeTaskSource, setTaskSourceEnabled, setTaskStatus } from "./tasks.ts";
import { ledgerCounts, ledgerVersions, listLedgerView, markAllRead, setReadState } from "./ledger.ts";
import { latestRun, listRuns, recentRuns } from "./runs.ts";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { RESEARCH_RUN_QUEUE, type ResearchRunJob } from "./jobs.ts";
import { nextDue } from "./research/due.ts";
import { searchConfigured } from "./providers/search.ts";
import { listTaskReports } from "./reports.ts";

type Handler = (req: FastifyRequest, reply: FastifyReply, admin: AdminPrincipal) => Promise<unknown>;

/** 只给登录后的本人生效；写操作还要 CSRF（和 /api/admin/* 一样的规矩）。 */
function guarded(fn: Handler) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    const admin = await sessionPrincipal(req.headers.cookie);
    if (!admin) return reply.code(401).send({ code: "unauthorized", detail: "Sign in to the admin first." });
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-csrf-token"] !== admin.csrf) {
      return reply.code(403).send({ code: "forbidden", detail: "Missing or stale CSRF token." });
    }
    try {
      return await fn(req, reply, admin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      req.log.error({ err: error, path: req.url.split("?")[0] }, "research api error");
      return reply.code(500).send({ code: "internal_error", detail: message.slice(0, 300) });
    }
  };
}

const bad = (reply: FastifyReply, detail: string) => reply.code(400).send({ code: "invalid_request", detail });
const missing = (reply: FastifyReply, what: string) => reply.code(404).send({ code: "not_found", detail: `${what} not found` });

function text(value: unknown, max = 2000): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function body(req: FastifyRequest): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

function param(req: FastifyRequest, name: string): string {
  return String((req.params as Record<string, unknown>)[name] ?? "");
}

function query(req: FastifyRequest, name: string): string | null {
  const value = (req.query as Record<string, unknown>)[name];
  return typeof value === "string" && value ? value : null;
}

function ledgerFilter(value: string | null): LedgerFilter {
  return value === "unread" || value === "starred" || value === "needsCheck" ? value : "all";
}

/** 列表/今日里一行的任务概览。 */
async function taskOverview(taskId?: string): Promise<TaskOverview[]> {
  const tasks = (await listTasks()).filter((task) => !taskId || task.id === taskId);
  const out: TaskOverview[] = [];
  for (const task of tasks) {
    const [run, counts, reports] = await Promise.all([latestRun(task.id), ledgerCounts(task.id), listTaskReports(task.id, sql, 500)]);
    out.push({ task, latestRun: run, unreadCount: counts.unread, reportCount: reports.length, nextRunAt: nextDue(task)?.toISOString() ?? null });
  }
  return out;
}

async function today(): Promise<TodayOverview> {
  const [unread, starred, needsCheck, counts, tasks, runs] = await Promise.all([
    listLedgerView({ filter: "unread", limit: 20 }),
    listLedgerView({ filter: "starred", limit: 10 }),
    listLedgerView({ filter: "needsCheck", limit: 10 }),
    ledgerCounts(null),
    taskOverview(),
    recentRuns(sql, 10),
  ]);
  return { unread, starred, needsCheck, counts, tasks, recentRuns: runs, timezone: RESEARCH_LIMITS.timezone };
}

async function ledgerView(req: FastifyRequest): Promise<LedgerView> {
  const taskId = query(req, "task");
  const filter = ledgerFilter(query(req, "filter"));
  const [entries, counts, tasks] = await Promise.all([
    listLedgerView({ taskId, filter, limit: 200 }),
    ledgerCounts(taskId),
    listTasks(),
  ]);
  return { entries, counts, tasks: tasks.map((task) => ({ id: task.id, title: task.title })) };
}

async function ledgerDetail(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const id = param(req, "id");
  const row = await sql<{ task_id: string; entry_key: string }[]>`SELECT task_id, entry_key FROM research_ledger_entries WHERE id = ${id}`;
  if (!row.length) return missing(reply, "ledger entry");
  const versions = await ledgerVersions(row[0]!.task_id, row[0]!.entry_key);
  const entry = versions.find((item) => item.id === id);
  if (!entry) return missing(reply, "ledger entry");
  const [readState] = await sql<{ ledger_id: string; read_at: Date | null; starred: boolean; needs_check: boolean; note: string | null; updated_at: Date }[]>`
    SELECT ledger_id, read_at, starred, needs_check, note, updated_at FROM research_read_state WHERE ledger_id = ${id}`;
  const detail: LedgerEntryDetail = {
    entry,
    versions,
    readState: readState
      ? { ledgerId: readState.ledger_id, readAt: readState.read_at?.toISOString() ?? null, starred: readState.starred, needsCheck: readState.needs_check, note: readState.note, updatedAt: readState.updated_at.toISOString() }
      : null,
  };
  return detail;
}

async function sourcesView(): Promise<SourcesView> {
  const tasks = await listTasks();
  return {
    tasks: tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, sources: task.sources })),
    kinds: ["rss", "web", "search"],
  };
}

async function settingsView(): Promise<SettingsView> {
  const [counts] = await sql<{ tasks: number; sources: number; entries: number; runs: number }[]>`
    SELECT (SELECT count(*)::int FROM research_tasks) AS tasks,
      (SELECT count(*)::int FROM research_task_sources) AS sources,
      (SELECT count(*)::int FROM research_ledger_entries) AS entries,
      (SELECT count(*)::int FROM research_runs) AS runs`;
  return {
    timezone: RESEARCH_LIMITS.timezone,
    limits: RESEARCH_LIMITS,
    search: { provider: "tavily", configured: searchConfigured() },
    counts: counts!,
    engine: { adminUrl: "/admin/settings" },
  };
}

export function registerResearchApi(app: FastifyInstance): void {
  app.get("/api/admin/research/today", guarded(async () => today()));

  app.get("/api/admin/research/tasks", guarded(async () => taskOverview()));

  app.post("/api/admin/research/tasks", guarded(async (req, reply) => {
    const input = body(req);
    const title = text(input.title, 200);
    const goal = text(input.goal, 2000);
    if (!title) return bad(reply, "任务标题不能为空");
    if (!goal) return bad(reply, "研究目标不能为空");
    const cadence = input.cadence as { kind?: string } | undefined;
    if (!cadence || (cadence.kind !== "daily" && cadence.kind !== "weekly" && cadence.kind !== "manual")) return bad(reply, "节奏要选每天、每周或手动");
    const sources = Array.isArray(input.sources) ? input.sources : [];
    try {
      const task = await createTask({
        title,
        goal,
        cadence: cadence as never,
        outputTemplate: typeof input.outputTemplate === "string" ? input.outputTemplate.slice(0, 8000) : "",
        sources: sources.flatMap((source) => {
          const item = source as { kind?: string; locator?: string };
          if (!item || typeof item.locator !== "string") return [];
          return [{ kind: (item.kind === "web" || item.kind === "search" ? item.kind : "rss") as "rss" | "web" | "search", locator: item.locator }];
        }),
      });
      return reply.code(201).send(task);
    } catch (error) {
      return bad(reply, error instanceof Error ? error.message : String(error));
    }
  }));

  app.get("/api/admin/research/tasks/:id", guarded(async (req, reply) => {
    const task = await getTask(param(req, "id"));
    if (!task) return missing(reply, "task");
    const [runs, reports, ledger] = await Promise.all([listRuns(task.id, sql, 20), listTaskReports(task.id, sql, 20), listLedgerView({ taskId: task.id, limit: 10 })]);
    const detail: TaskDetail = { task, runs, reports, ledger, nextRunAt: nextDue(task)?.toISOString() ?? null };
    return detail;
  }));

  app.patch("/api/admin/research/tasks/:id", guarded(async (req, reply) => {
    const status = body(req).status;
    if (status !== "active" && status !== "paused" && status !== "archived") return bad(reply, "状态只能是 active、paused 或 archived");
    const task = await setTaskStatus(param(req, "id"), status);
    return task ?? missing(reply, "task");
  }));

  app.post("/api/admin/research/tasks/:id/run", guarded(async (req, reply) => {
    const task = await getTask(param(req, "id"));
    if (!task) return missing(reply, "task");
    const job: ResearchRunJob = { taskId: task.id, scheduledFor: null, trigger: "manual" };
    await enqueueOn(RESEARCH_RUN_QUEUE, job);
    return { queued: true };
  }));

  app.get("/api/admin/research/ledger", guarded(async (req) => ledgerView(req)));

  app.get("/api/admin/research/ledger/:id", guarded(async (req, reply) => ledgerDetail(req, reply)));

  app.patch("/api/admin/research/ledger/:id/state", guarded(async (req, reply) => {
    const input = body(req);
    const patch: { readAt?: Date | null; starred?: boolean; needsCheck?: boolean; note?: string | null } = {};
    if (input.read === true) patch.readAt = new Date();
    if (typeof input.starred === "boolean") patch.starred = input.starred;
    if (typeof input.needsCheck === "boolean") patch.needsCheck = input.needsCheck;
    if (input.note === null || typeof input.note === "string") patch.note = input.note === null ? null : input.note.slice(0, 4000);
    const state = await setReadState(param(req, "id"), patch);
    return state;
  }));

  app.post("/api/admin/research/ledger/read-all", guarded(async (req) => {
    const taskId = text(body(req).taskId, 200);
    const marked = await markAllRead(taskId ?? null);
    return { marked };
  }));

  app.get("/api/admin/research/sources", guarded(async () => sourcesView()));

  app.post("/api/admin/research/sources", guarded(async (req, reply) => {
    const input = body(req);
    const taskId = text(input.taskId, 200);
    const locator = text(input.locator, 2000);
    if (!taskId) return bad(reply, "要指定任务");
    if (!locator) return bad(reply, "信源地址或查询不能为空");
    const kind = input.kind === "web" || input.kind === "search" ? input.kind : "rss";
    const source = await addTaskSource(taskId, kind, locator);
    return source ? reply.code(201).send(source) : missing(reply, "task");
  }));

  app.patch("/api/admin/research/sources/:id", guarded(async (req, reply) => {
    const enabled = body(req).enabled;
    if (typeof enabled !== "boolean") return bad(reply, "要指定启用或停用");
    const source = await setTaskSourceEnabled(param(req, "id"), enabled);
    return source ?? missing(reply, "source");
  }));

  app.delete("/api/admin/research/sources/:id", guarded(async (req, reply) => {
    const removed = await removeTaskSource(param(req, "id"));
    return removed ? { ok: true } : missing(reply, "source");
  }));

  app.get("/api/admin/research/settings", guarded(async () => settingsView()));
}
