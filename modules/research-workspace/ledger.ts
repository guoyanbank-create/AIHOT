// 台账：按时间演进的条目，每个主题键有版本历史；每条正式事实必须绑引用（证据），来源观点标作者，
// AI 研判标模型和版本。人工锁定的条目和字段不由 AI 覆盖——AI 侧写入这里之前要检查 humanLocked。
import { randomUUID } from "node:crypto";
import { sql, type Db } from "@aihot/backend/db";
import type { Evidence, LedgerEntry, LedgerKind, LedgerReadState, LedgerStatus } from "./contracts.ts";
import { recordOutbox } from "./outbox.ts";

interface LedgerRow {
  id: string;
  task_id: string;
  entry_key: string;
  version: number;
  kind: LedgerKind;
  status: LedgerStatus;
  title: string;
  body: string;
  author: string | null;
  model: string | null;
  model_version: string | null;
  run_id: string | null;
  supersedes_id: string | null;
  human_locked: boolean;
  created_at: Date;
}

interface EvidenceRow {
  id: string;
  ledger_id: string;
  url: string;
  publisher: string | null;
  channel: string;
  published_at: Date | null;
  discovered_at: Date | null;
  fetched_at: Date | null;
  analyzed_at: Date | null;
  body_hash: string | null;
  quote_locator: string | null;
  quote: string | null;
  license: string | null;
  created_at: Date;
}

interface ReadRow {
  ledger_id: string;
  read_at: Date | null;
  starred: boolean;
  needs_check: boolean;
  note: string | null;
  updated_at: Date;
}

function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return "begin" in db ? (db as typeof sql).begin(fn) as Promise<T> : fn(db);
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

function toEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id, ledgerId: row.ledger_id, url: row.url, publisher: row.publisher, channel: row.channel,
    publishedAt: iso(row.published_at), discoveredAt: iso(row.discovered_at), fetchedAt: iso(row.fetched_at),
    analyzedAt: iso(row.analyzed_at), bodyHash: row.body_hash, quoteLocator: row.quote_locator,
    quote: row.quote, license: row.license, createdAt: row.created_at.toISOString(),
  };
}

function toEntry(row: LedgerRow, evidence: Evidence[]): LedgerEntry {
  return {
    id: row.id, taskId: row.task_id, entryKey: row.entry_key, version: row.version, kind: row.kind,
    status: row.status, title: row.title, body: row.body, author: row.author, model: row.model,
    modelVersion: row.model_version, runId: row.run_id, supersedesId: row.supersedes_id,
    humanLocked: row.human_locked, createdAt: row.created_at.toISOString(), evidence,
  };
}

function toRead(row: ReadRow): LedgerReadState {
  return {
    ledgerId: row.ledger_id, readAt: iso(row.read_at), starred: row.starred,
    needsCheck: row.needs_check, note: row.note, updatedAt: row.updated_at.toISOString(),
  };
}

const ENTRY_COLUMNS = sql`id, task_id, entry_key, version, kind, status, title, body, author, model, model_version,
  run_id, supersedes_id, human_locked, created_at`;
const EVIDENCE_COLUMNS = sql`id, ledger_id, url, publisher, channel, published_at, discovered_at, fetched_at,
  analyzed_at, body_hash, quote_locator, quote, license, created_at`;

/** 新证据：来源地址和采集时的事实，报告和台账都要能回到它。 */
export interface NewEvidence {
  url: string;
  publisher?: string | null;
  channel: string;
  publishedAt?: Date | null;
  discoveredAt?: Date | null;
  fetchedAt?: Date | null;
  analyzedAt?: Date | null;
  bodyHash?: string | null;
  quoteLocator?: string | null;
  quote?: string | null;
  license?: string | null;
}

/** 追加一版台账条目：同一主题键的下一版是 version+1，supersedesId 自动指回上一版。 */
export interface NewLedgerEntry {
  taskId: string;
  entryKey: string;
  kind: LedgerKind;
  status?: LedgerStatus;
  title: string;
  body?: string;
  author?: string | null;
  model?: string | null;
  modelVersion?: string | null;
  runId?: string | null;
  humanLocked?: boolean;
  evidence?: NewEvidence[];
}

/** 正式事实必须绑有效引用：事实和人工结论至少要一条证据，来源观点/研判也要能落到原文。 */
function validateEntry(entry: NewLedgerEntry): void {
  if (!entry.entryKey.trim()) throw new Error("台账条目的主题键不能为空");
  if (!entry.title.trim()) throw new Error("台账条目标题不能为空");
  if ((entry.kind === "fact" || entry.kind === "human_conclusion") && !(entry.evidence?.length)) {
    throw new Error("事实和人工结论必须至少绑定一条引用");
  }
  for (const item of entry.evidence ?? []) {
    if (!/^https?:\/\//i.test(item.url)) throw new Error(`引用地址不是 http(s)：${item.url}`);
    if (!item.channel.trim()) throw new Error("引用要记下采集渠道");
  }
}

/** 追加一版台账条目和它的引用，一起提交（人工锁定的上一版由调用方检查后决定是否覆盖）。 */
export function appendLedgerEntry(entry: NewLedgerEntry, db: Db = sql): Promise<LedgerEntry> {
  validateEntry(entry);
  return inTransaction(db, async (tx) => {
    const [previous] = await tx<{ version: number; id: string }[]>`
      SELECT version, id FROM research_ledger_entries
      WHERE task_id = ${entry.taskId} AND entry_key = ${entry.entryKey}
      ORDER BY version DESC LIMIT 1 FOR UPDATE`;
    const version = (previous?.version ?? 0) + 1;
    const id = randomUUID();
    const [row] = await tx<LedgerRow[]>`
      INSERT INTO research_ledger_entries (id, task_id, entry_key, version, kind, status, title, body, author,
        model, model_version, run_id, supersedes_id, human_locked)
      VALUES (${id}, ${entry.taskId}, ${entry.entryKey}, ${version}, ${entry.kind}, ${entry.status ?? "unverified"},
        ${entry.title}, ${entry.body ?? ""}, ${entry.author ?? null}, ${entry.model ?? null}, ${entry.modelVersion ?? null},
        ${entry.runId ?? null}, ${previous?.id ?? null}, ${entry.humanLocked ?? false})
      RETURNING ${ENTRY_COLUMNS}`;
    const evidence: EvidenceRow[] = [];
    for (const item of entry.evidence ?? []) {
      const [evidenceRow] = await tx<EvidenceRow[]>`
        INSERT INTO research_evidence (id, ledger_id, url, publisher, channel, published_at, discovered_at,
          fetched_at, analyzed_at, body_hash, quote_locator, quote, license)
        VALUES (${randomUUID()}, ${id}, ${item.url}, ${item.publisher ?? null}, ${item.channel},
          ${item.publishedAt ?? null}, ${item.discoveredAt ?? null}, ${item.fetchedAt ?? null}, ${item.analyzedAt ?? null},
          ${item.bodyHash ?? null}, ${item.quoteLocator ?? null}, ${item.quote ?? null}, ${item.license ?? null})
        RETURNING ${EVIDENCE_COLUMNS}`;
      evidence.push(evidenceRow!);
    }
    // 台账版本和待发事件在同一个事务里提交：worker 之后从这里派生通知/匹配，不靠轮询。
    await recordOutbox(tx, "ledger.version", {
      entryId: id, taskId: entry.taskId, entryKey: entry.entryKey, version, kind: entry.kind,
      status: entry.status ?? "unverified", title: entry.title, runId: entry.runId ?? null,
    });
    return toEntry(row!, evidence.map(toEvidence));
  });
}

/** 一个任务最近一版台账，新的在前。 */
export async function listLedgerEntries(taskId: string, db: Db = sql, limit = 100): Promise<LedgerEntry[]> {
  const entries = await db<LedgerRow[]>`
    SELECT ${ENTRY_COLUMNS} FROM research_ledger_entries
    WHERE task_id = ${taskId} ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
  if (!entries.length) return [];
  const evidence = await db<EvidenceRow[]>`
    SELECT ${EVIDENCE_COLUMNS} FROM research_evidence
    WHERE ledger_id IN ${sql(entries.map((entry) => entry.id))} ORDER BY created_at, id`;
  const byLedger = new Map<string, Evidence[]>();
  for (const row of evidence) {
    const list = byLedger.get(row.ledger_id) ?? [];
    list.push(toEvidence(row));
    byLedger.set(row.ledger_id, list);
  }
  return entries.map((entry) => toEntry(entry, byLedger.get(entry.id) ?? []));
}

/** 一条台账（含引用），不存在时返回 null。 */
export async function getLedgerEntry(id: string, db: Db = sql): Promise<LedgerEntry | null> {
  const [entry] = await db<LedgerRow[]>`SELECT ${ENTRY_COLUMNS} FROM research_ledger_entries WHERE id = ${id}`;
  if (!entry) return null;
  const evidence = await db<EvidenceRow[]>`
    SELECT ${EVIDENCE_COLUMNS} FROM research_evidence WHERE ledger_id = ${id} ORDER BY created_at, id`;
  return toEntry(entry, evidence.map(toEvidence));
}

/** 人工锁定/解锁一条台账：锁上以后 AI 的修订不能覆盖它。 */
export async function setLedgerLocked(id: string, locked: boolean, db: Db = sql): Promise<boolean> {
  const rows = await db`UPDATE research_ledger_entries SET human_locked = ${locked} WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/** 阅读状态：已读、收藏、待核实和人工备注。只给一条台账记；没传的字段保持原样。 */
export interface ReadStatePatch {
  readAt?: Date | null;
  starred?: boolean;
  needsCheck?: boolean;
  note?: string | null;
}

export async function setReadState(ledgerId: string, patch: ReadStatePatch, db: Db = sql): Promise<LedgerReadState> {
  return inTransaction(db, async (tx) => {
    const [current] = await tx<ReadRow[]>`SELECT ledger_id, read_at, starred, needs_check, note, updated_at FROM research_read_state WHERE ledger_id = ${ledgerId} FOR UPDATE`;
    const next = {
      readAt: patch.readAt !== undefined ? patch.readAt : current?.read_at ?? null,
      starred: patch.starred ?? current?.starred ?? false,
      needsCheck: patch.needsCheck ?? current?.needs_check ?? false,
      note: patch.note !== undefined ? patch.note : current?.note ?? null,
    };
    const [row] = await tx<ReadRow[]>`
      INSERT INTO research_read_state (ledger_id, read_at, starred, needs_check, note)
      VALUES (${ledgerId}, ${next.readAt}, ${next.starred}, ${next.needsCheck}, ${next.note})
      ON CONFLICT (ledger_id) DO UPDATE SET
        read_at = excluded.read_at, starred = excluded.starred, needs_check = excluded.needs_check,
        note = excluded.note, updated_at = now()
      RETURNING ledger_id, read_at, starred, needs_check, note, updated_at`;
    return toRead(row!);
  });
}

export async function getReadState(ledgerId: string, db: Db = sql): Promise<LedgerReadState | null> {
  const [row] = await db<ReadRow[]>`SELECT ledger_id, read_at, starred, needs_check, note, updated_at FROM research_read_state WHERE ledger_id = ${ledgerId}`;
  return row ? toRead(row) : null;
}

/** 台账列表的一行：条目本身的字段加阅读状态。 */
export type LedgerListRow = LedgerEntry & { readState: LedgerReadState | null };

interface JoinedRow extends LedgerRow {
  read_at: Date | null;
  read_starred: boolean | null;
  read_needs_check: boolean | null;
  read_note: string | null;
  read_updated_at: Date | null;
}

function toReadStateFromJoin(row: JoinedRow): LedgerReadState | null {
  if (row.read_at === null && row.read_starred === null) return null;
  return {
    ledgerId: row.id,
    readAt: iso(row.read_at),
    starred: row.read_starred ?? false,
    needsCheck: row.read_needs_check ?? false,
    note: row.read_note,
    updatedAt: (row.read_updated_at ?? row.created_at).toISOString(),
  };
}

const LEDGER_FILTERS = {
  unread: sql`r.read_at IS NULL`,
  starred: sql`r.starred`,
  needsCheck: sql`r.needs_check`,
  all: sql`true`,
} as const;

export type LedgerFilter = keyof typeof LEDGER_FILTERS;

/** 台账列表：可按任务和阅读状态筛，新的在前，带阅读状态和引用。 */
export async function listLedgerView(options: { taskId?: string | null; filter?: LedgerFilter; limit?: number } = {}, db: Db = sql): Promise<LedgerListRow[]> {
  const filter = LEDGER_FILTERS[options.filter ?? "all"] ?? LEDGER_FILTERS.all;
  const task = options.taskId ? sql`AND e.task_id = ${options.taskId}` : sql``;
  const rows = await db<JoinedRow[]>`
    SELECT e.id, e.task_id, e.entry_key, e.version, e.kind, e.status, e.title, e.body, e.author, e.model,
      e.model_version, e.run_id, e.supersedes_id, e.human_locked, e.created_at,
      r.read_at, r.starred AS read_starred, r.needs_check AS read_needs_check, r.note AS read_note, r.updated_at AS read_updated_at
    FROM research_ledger_entries e LEFT JOIN research_read_state r ON r.ledger_id = e.id
    WHERE true ${task} AND ${filter}
    ORDER BY e.created_at DESC, e.id DESC LIMIT ${Math.min(Math.max(options.limit ?? 100, 1), 500)}`;
  if (!rows.length) return [];
  const evidence = await db<EvidenceRow[]>`
    SELECT ${EVIDENCE_COLUMNS} FROM research_evidence WHERE ledger_id IN ${sql(rows.map((row) => row.id))} ORDER BY created_at, id`;
  const byLedger = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const list = byLedger.get(item.ledger_id) ?? [];
    list.push(toEvidence(item));
    byLedger.set(item.ledger_id, list);
  }
  return rows.map((row) => ({ ...toEntry(row, byLedger.get(row.id) ?? []), readState: toReadStateFromJoin(row) }));
}

/** 台账的四个计数。 */
export async function ledgerCounts(taskId: string | null, db: Db = sql): Promise<{ all: number; unread: number; starred: number; needsCheck: number }> {
  const task = taskId ? sql`WHERE e.task_id = ${taskId}` : sql``;
  const [row] = await db<{ all: number; unread: number; starred: number; needs_check: number }[]>`
    SELECT count(*)::int AS all,
      count(*) FILTER (WHERE r.read_at IS NULL)::int AS unread,
      count(*) FILTER (WHERE r.starred)::int AS starred,
      count(*) FILTER (WHERE r.needs_check)::int AS needs_check
    FROM research_ledger_entries e LEFT JOIN research_read_state r ON r.ledger_id = e.id ${task}`;
  return { all: row!.all, unread: row!.unread, starred: row!.starred, needsCheck: row!.needs_check };
}

/** 同一主题键的全部版本，旧的在前（给版本差异用）。 */
export async function ledgerVersions(taskId: string, entryKey: string, db: Db = sql): Promise<LedgerEntry[]> {
  const rows = await db<LedgerRow[]>`
    SELECT ${ENTRY_COLUMNS} FROM research_ledger_entries
    WHERE task_id = ${taskId} AND entry_key = ${entryKey} ORDER BY version`;
  if (!rows.length) return [];
  const evidence = await db<EvidenceRow[]>`
    SELECT ${EVIDENCE_COLUMNS} FROM research_evidence WHERE ledger_id IN ${sql(rows.map((row) => row.id))} ORDER BY created_at, id`;
  const byLedger = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const list = byLedger.get(item.ledger_id) ?? [];
    list.push(toEvidence(item));
    byLedger.set(item.ledger_id, list);
  }
  return rows.map((row) => toEntry(row, byLedger.get(row.id) ?? []));
}

/** 把没读过（或指定任务里没读过）的台账标成已读；已经读过的保持原来的时间。 */
export async function markAllRead(taskId: string | null, db: Db = sql): Promise<number> {
  const task = taskId ? sql`AND task_id = ${taskId}` : sql``;
  const rows = await db`
    INSERT INTO research_read_state (ledger_id, read_at)
    SELECT id, now() FROM research_ledger_entries WHERE true ${task}
    ON CONFLICT (ledger_id) DO UPDATE SET read_at = coalesce(research_read_state.read_at, excluded.read_at), updated_at = now()
    RETURNING ledger_id`;
  return rows.length;
}
