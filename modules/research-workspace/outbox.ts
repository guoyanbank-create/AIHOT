// 事务 outbox：模块要派发的事件和产生它的写入在同一个事务里提交，进程重启、任务重试都不会丢也不会
// 重复执行；worker 从待发事件里取，派发成功才写 dispatched_at。见 migrations/0906_research_outbox.sql。
import { sql, type Db } from "@aihot/backend/db";
import type { OutboxEvent, OutboxEventType } from "./contracts.ts";

interface Row {
  id: number;
  event_type: OutboxEventType;
  payload: Record<string, unknown>;
  created_at: Date;
  dispatched_at: Date | null;
  attempts: number;
  last_error: string | null;
}

function toEvent(row: Row): OutboxEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
    dispatchedAt: row.dispatched_at?.toISOString() ?? null,
    attempts: row.attempts,
    lastError: row.last_error,
  };
}

/** 在一个已经在跑的事务里记一条待发事件；调用方负责让这个写入和业务写入一起提交。 */
export async function recordOutbox(db: Db, eventType: OutboxEventType, payload: Record<string, unknown>): Promise<number> {
  const [row] = await db<{ id: number }[]>`
    INSERT INTO research_outbox (event_type, payload) VALUES (${eventType}, ${db.json(payload as never)}) RETURNING id`;
  return row!.id;
}

/** 还没派发的事件，按写入顺序；worker 一次取一批处理。 */
export async function pendingOutbox(db: Db = sql, limit = 50): Promise<OutboxEvent[]> {
  const rows = await db<Row[]>`
    SELECT id, event_type, payload, created_at, dispatched_at, attempts, last_error
    FROM research_outbox WHERE dispatched_at IS NULL ORDER BY id LIMIT ${limit}`;
  return rows.map(toEvent);
}

/** 派发成功：只改还没派发的那一行，重复派发不会把时间改掉。 */
export async function markOutboxDispatched(db: Db, id: number): Promise<void> {
  await db`UPDATE research_outbox SET dispatched_at = now() WHERE id = ${id} AND dispatched_at IS NULL`;
}

/** 派发失败：记次数和错误，留在待发队列里重试。 */
export async function markOutboxFailed(db: Db, id: number, error: string): Promise<void> {
  await db`UPDATE research_outbox
    SET attempts = attempts + 1, last_error = ${error.slice(0, 1000)} WHERE id = ${id} AND dispatched_at IS NULL`;
}
