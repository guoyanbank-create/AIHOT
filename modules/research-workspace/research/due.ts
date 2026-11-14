// 调度：按任务节奏算“最近一次该跑的时间”，到点（或 Mac 睡醒后补跑一次）把研究任务排进队列。
// 不需要每个任务一条 cron：一个每 5 分钟的扫描按北京时间算，漏掉的时段补一次并记录覆盖缺口。
import { sql } from "@aihot/backend/db";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { addDays, beijingAt, beijingDate } from "@aihot/contracts/time";
import type { ResearchTask, TaskCadence } from "../contracts.ts";
import { listTasks } from "../tasks.ts";
import { RESEARCH_RUN_QUEUE, type ResearchRunJob } from "../jobs.ts";

/** 北京时间里最近一个已经到点的计划时刻；手动节奏返回 null。 */
export function latestDue(cadence: TaskCadence, now: Date): Date | null {
  if (cadence.kind === "manual") return null;
  const today = beijingDate(now);
  if (cadence.kind === "daily") {
    const at = beijingAt(today, cadence.at);
    return at.getTime() <= now.getTime() ? at : beijingAt(addDays(today, -1), cadence.at);
  }
  const days = new Set(cadence.weekdays);
  for (let offset = 0; offset <= 7; offset++) {
    const date = addDays(today, -offset);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (!days.has(weekday)) continue;
    const at = beijingAt(date, cadence.at);
    if (at.getTime() <= now.getTime()) return at;
  }
  return null;
}

const GAP_MINUTES = 30;

/**
 * 到点的任务排进研究队列；同一个任务同一个计划时间只排一次（research_runs 有唯一索引兜底）。
 * 超过 30 分钟的记为 catch-up，运行记录里会带上覆盖缺口，页面上如实显示。
 */
export async function dispatchDueRuns(now: Date = new Date()): Promise<{ enqueued: number; due: number }> {
  const tasks = (await listTasks()).filter((task) => task.status === "active");
  let enqueued = 0;
  let due = 0;
  for (const task of tasks) {
    const at = latestDue(task.cadence, now);
    if (!at) continue;
    due += 1;
    if (task.lastRunAt && new Date(task.lastRunAt).getTime() >= at.getTime()) continue;
    const [existing] = await sql<{ id: string }[]>`SELECT id FROM research_runs WHERE task_id = ${task.id} AND scheduled_for = ${at} LIMIT 1`;
    if (existing) continue;
    const gapMinutes = (now.getTime() - at.getTime()) / 60_000;
    const job: ResearchRunJob = { taskId: task.id, scheduledFor: at.toISOString(), trigger: gapMinutes > GAP_MINUTES ? "catch-up" : "schedule" };
    await enqueueOn(RESEARCH_RUN_QUEUE, job);
    enqueued += 1;
  }
  return { enqueued, due };
}

/** 一个任务按节奏下一次要跑的时间（页面上显示）。 */
export function nextDue(task: Pick<ResearchTask, "cadence" | "status">, now: Date = new Date()): Date | null {
  if (task.status !== "active") return null;
  const { cadence } = task;
  if (cadence.kind === "manual") return null;
  const today = beijingDate(now);
  if (cadence.kind === "daily") {
    const at = beijingAt(today, cadence.at);
    return at.getTime() > now.getTime() ? at : beijingAt(addDays(today, 1), cadence.at);
  }
  const days = new Set(cadence.weekdays);
  for (let offset = 0; offset <= 8; offset++) {
    const date = addDays(today, offset);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (!days.has(weekday)) continue;
    const at = beijingAt(date, cadence.at);
    if (at.getTime() > now.getTime()) return at;
  }
  return null;
}
