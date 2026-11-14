// 任务详情里的研究报告与提醒（不是独立项目管理产品：报告和待办都挂在任务上）。
import { randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import type { TaskReport, TaskReportKind } from "./contracts.ts";

interface ReportRow {
  id: string;
  task_id: string;
  run_id: string | null;
  kind: TaskReportKind;
  body: string;
  created_at: Date;
}

const iso = (value: Date): string => value.toISOString();

/** 追加一份报告（研究摘要或提醒）。 */
export async function appendTaskReport(report: {
  taskId: string;
  runId?: string | null;
  kind: TaskReportKind;
  body: string;
}, db: Db = sql): Promise<TaskReport> {
  if (!report.body.trim()) throw new Error("报告内容不能为空");
  const [row] = await db<ReportRow[]>`
    INSERT INTO research_task_reports (id, task_id, run_id, kind, body)
    VALUES (${randomUUID()}, ${report.taskId}, ${report.runId ?? null}, ${report.kind}, ${report.body})
    RETURNING id, task_id, run_id, kind, body, created_at`;
  return { id: row!.id, taskId: row!.task_id, runId: row!.run_id, kind: row!.kind, body: row!.body, createdAt: iso(row!.created_at) };
}

/** 一个任务的报告，新的在前。 */
export async function listTaskReports(taskId: string, db: Db = sql, limit = 20): Promise<TaskReport[]> {
  const rows = await db<ReportRow[]>`
    SELECT id, task_id, run_id, kind, body, created_at FROM research_task_reports
    WHERE task_id = ${taskId} ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
  return rows.map((row) => ({ id: row.id, taskId: row.task_id, runId: row.run_id, kind: row.kind, body: row.body, createdAt: iso(row.created_at) }));
}
