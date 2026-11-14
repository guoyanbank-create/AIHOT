// 研究运行：每次研究一条记录，状态区分 succeeded/no_change/partial/failed/cancelled/budget_exceeded；
// 搜索失败、被预算拦下都不写成 no_change。
import { randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import type { ResearchRun, ResearchRunStatus } from "./contracts.ts";

interface RunRow {
  id: string;
  task_id: string;
  scheduled_for: Date | null;
  started_at: Date;
  finished_at: Date | null;
  status: ResearchRunStatus;
  search_calls: number;
  model_calls: number;
  summary: string | null;
  error: string | null;
}

function toRun(row: RunRow): ResearchRun {
  return {
    id: row.id, taskId: row.task_id, scheduledFor: row.scheduled_for?.toISOString() ?? null,
    startedAt: row.started_at.toISOString(), finishedAt: row.finished_at?.toISOString() ?? null,
    status: row.status, searchCalls: row.search_calls, modelCalls: row.model_calls,
    summary: row.summary, error: row.error,
  };
}

const COLUMNS = sql`id, task_id, scheduled_for, started_at, finished_at, status, search_calls, model_calls, summary, error`;

/** 记一次开始（running）。 */
export async function startRun(taskId: string, scheduledFor: Date | null, db: Db = sql): Promise<ResearchRun> {
  const [row] = await db<RunRow[]>`
    INSERT INTO research_runs (id, task_id, scheduled_for) VALUES (${randomUUID()}, ${taskId}, ${scheduledFor})
    RETURNING ${COLUMNS}`;
  return toRun(row!);
}

/** 记一次结束；计数和摘要一起写，状态不许回到 running。 */
export async function finishRun(id: string, result: {
  status: Exclude<ResearchRunStatus, "running">;
  searchCalls?: number;
  modelCalls?: number;
  summary?: string | null;
  error?: string | null;
}, db: Db = sql): Promise<ResearchRun | null> {
  const [row] = await db<RunRow[]>`
    UPDATE research_runs SET status = ${result.status}, finished_at = now(),
      search_calls = coalesce(${result.searchCalls ?? null}, search_calls),
      model_calls = coalesce(${result.modelCalls ?? null}, model_calls),
      summary = ${result.summary ?? null}, error = ${result.error ?? null}
    WHERE id = ${id} AND status = 'running'
    RETURNING ${COLUMNS}`;
  return row ? toRun(row) : null;
}

/** 任务最近一次运行，用于“上次运行”和恢复现场。 */
export async function latestRun(taskId: string, db: Db = sql): Promise<ResearchRun | null> {
  const [row] = await db<RunRow[]>`
    SELECT ${COLUMNS} FROM research_runs WHERE task_id = ${taskId} ORDER BY started_at DESC, id DESC LIMIT 1`;
  return row ? toRun(row) : null;
}

/** 一个任务的运行历史，新的在前。 */
export async function listRuns(taskId: string, db: Db = sql, limit = 20): Promise<ResearchRun[]> {
  const rows = await db<RunRow[]>`
    SELECT ${COLUMNS} FROM research_runs WHERE task_id = ${taskId} ORDER BY started_at DESC, id DESC LIMIT ${limit}`;
  return rows.map(toRun);
}

/** 最近的研究运行（跨任务），带任务标题；今日页用。 */
export async function recentRuns(db: Db = sql, limit = 10): Promise<Array<ResearchRun & { taskTitle: string }>> {
  const rows = await db<(RunRow & { task_title: string })[]>`
    SELECT r.id, r.task_id, r.scheduled_for, r.started_at, r.finished_at, r.status, r.search_calls, r.model_calls,
      r.summary, r.error, t.title AS task_title
    FROM research_runs r JOIN research_tasks t ON t.id = r.task_id
    ORDER BY r.started_at DESC, r.id DESC LIMIT ${limit}`;
  return rows.map((row) => ({ ...toRun(row), taskTitle: row.task_title }));
}
