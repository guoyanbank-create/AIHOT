// 长期研究任务：四步创建（目标→信源→节奏→输出）合在一次提交里，任务和它的信源一起成功或一起
// 失败。读取按创建时间从新到旧；信源顺序保持添加顺序。
import { randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import type { NewTaskInput, ResearchTask, ResearchTaskStatus, TaskCadence, TaskSource } from "./contracts.ts";

interface TaskRow {
  id: string;
  title: string;
  goal: string;
  status: ResearchTaskStatus;
  cadence: TaskCadence;
  output_template: string;
  last_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface SourceRow {
  id: string;
  task_id: string;
  kind: TaskSource["kind"];
  locator: string;
  position: number;
  enabled: boolean;
  created_at: Date;
}

/** 传进来的如果不是事务，就自己开一个，让多条写入一起提交。 */
function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return "begin" in db ? (db as typeof sql).begin(fn) as Promise<T> : fn(db);
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

function toSource(row: SourceRow): TaskSource {
  return {
    id: row.id, taskId: row.task_id, kind: row.kind, locator: row.locator, position: row.position,
    enabled: row.enabled, createdAt: row.created_at.toISOString(),
  };
}

function toTask(row: TaskRow, sources: TaskSource[]): ResearchTask {
  return {
    id: row.id, title: row.title, goal: row.goal, status: row.status, cadence: row.cadence,
    outputTemplate: row.output_template, lastRunAt: iso(row.last_run_at),
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), sources,
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 节奏要能被排程直接读：北京时间 HH:mm，周几是 0（周日）到 6。 */
function validateCadence(cadence: TaskCadence): void {
  if (cadence.kind === "manual") return;
  if (!HHMM.test(cadence.at)) throw new Error("cadence.at 要写成北京时间 HH:mm");
  if (cadence.kind === "weekly" && (!cadence.weekdays.length || cadence.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) {
    throw new Error("cadence.weekdays 要写 0（周日）到 6，至少一天");
  }
}

/** 创建任务；同一任务里完全相同的信源只留一条。 */
export function createTask(input: NewTaskInput, db: Db = sql): Promise<ResearchTask> {
  const title = input.title.trim();
  const goal = input.goal.trim();
  if (!title) throw new Error("任务标题不能为空");
  if (!goal) throw new Error("研究目标不能为空");
  validateCadence(input.cadence);
  const sources = [...new Map(input.sources
    .map((source) => ({ kind: source.kind, locator: source.locator.trim() }))
    .filter((source) => source.locator)
    .map((source) => [`${source.kind}\u0000${source.locator}`, source])).values()];

  return inTransaction(db, async (tx) => {
    const id = randomUUID();
    const [row] = await tx<TaskRow[]>`
      INSERT INTO research_tasks (id, title, goal, cadence, output_template)
      VALUES (${id}, ${title}, ${goal}, ${tx.json(input.cadence as never)}, ${input.outputTemplate})
      RETURNING id, title, goal, status, cadence, output_template, last_run_at, created_at, updated_at`;
    const inserted: SourceRow[] = [];
    for (const [position, source] of sources.entries()) {
      const [sourceRow] = await tx<SourceRow[]>`
        INSERT INTO research_task_sources (id, task_id, kind, locator, position)
        VALUES (${randomUUID()}, ${id}, ${source.kind}, ${source.locator}, ${position})
        ON CONFLICT (task_id, kind, locator) DO NOTHING
        RETURNING id, task_id, kind, locator, position, enabled, created_at`;
      if (sourceRow) inserted.push(sourceRow);
    }
    return toTask(row!, inserted.map(toSource));
  });
}

/** 全部任务，新的在前；每个任务带上它的信源。 */
export async function listTasks(db: Db = sql): Promise<ResearchTask[]> {
  const tasks = await db<TaskRow[]>`
    SELECT id, title, goal, status, cadence, output_template, last_run_at, created_at, updated_at
    FROM research_tasks ORDER BY created_at DESC, id DESC`;
  if (!tasks.length) return [];
  const sources = await db<SourceRow[]>`
    SELECT id, task_id, kind, locator, position, enabled, created_at FROM research_task_sources
    WHERE task_id IN ${sql(tasks.map((task) => task.id))} ORDER BY position, id`;
  const byTask = new Map<string, TaskSource[]>();
  for (const source of sources) {
    const list = byTask.get(source.task_id) ?? [];
    list.push(toSource(source));
    byTask.set(source.task_id, list);
  }
  return tasks.map((task) => toTask(task, byTask.get(task.id) ?? []));
}

/** 一个任务，不存在时返回 null。 */
export async function getTask(id: string, db: Db = sql): Promise<ResearchTask | null> {
  const [task] = await db<TaskRow[]>`
    SELECT id, title, goal, status, cadence, output_template, last_run_at, created_at, updated_at
    FROM research_tasks WHERE id = ${id}`;
  if (!task) return null;
  const sources = await db<SourceRow[]>`
    SELECT id, task_id, kind, locator, position, enabled, created_at FROM research_task_sources
    WHERE task_id = ${id} ORDER BY position, id`;
  return toTask(task, sources.map(toSource));
}

/** 暂停、恢复或归档任务。 */
export async function setTaskStatus(id: string, status: ResearchTaskStatus, db: Db = sql): Promise<ResearchTask | null> {
  const [row] = await db<TaskRow[]>`
    UPDATE research_tasks SET status = ${status}, updated_at = now() WHERE id = ${id}
    RETURNING id, title, goal, status, cadence, output_template, last_run_at, created_at, updated_at`;
  if (!row) return null;
  const sources = await db<SourceRow[]>`
    SELECT id, task_id, kind, locator, position, enabled, created_at FROM research_task_sources
    WHERE task_id = ${id} ORDER BY position, id`;
  return toTask(row, sources.map(toSource));
}
