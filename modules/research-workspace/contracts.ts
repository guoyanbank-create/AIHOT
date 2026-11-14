// 长期调研工作台的共享契约：任务、信源、运行、台账、证据、已读状态、待发事件与任务报告。
// 网页和后端共用这些类型；时间在契约里是 ISO 字符串（和 @aihot/contracts/admin 一样），仓储层把
// timestamptz 转成它。字段的数据库形状见 migrations/，两边一起改。

/** 任务状态：active 在跑，paused 暂停（不排研究），archived 归档（只读）。 */
export type ResearchTaskStatus = "active" | "paused" | "archived";

/** 研究节奏。每天/每周什么时间跑；时间写北京时间 HH:mm，时区固定 Asia/Shanghai。 */
export type TaskCadence =
  | { kind: "daily"; at: string }
  | { kind: "weekly"; at: string; weekdays: number[] }
  | { kind: "manual" };

/** 任务信源：订阅地址、要抓的网页，或一条搜索查询（由 SearchProvider 执行，不在采集器里）。 */
export type TaskSourceKind = "rss" | "web" | "search";

export interface TaskSource {
  id: string;
  taskId: string;
  kind: TaskSourceKind;
  /** 订阅/网页地址，或搜索查询原文。 */
  locator: string;
  /** 创建时的顺序，从 0 开始；列表按它排。 */
  position: number;
  enabled: boolean;
  createdAt: string;
}

/** 一个长期研究任务：目标、信源、节奏和输出模板。 */
export interface ResearchTask {
  id: string;
  title: string;
  goal: string;
  status: ResearchTaskStatus;
  cadence: TaskCadence;
  outputTemplate: string;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  sources: TaskSource[];
}

/** 一次研究运行的结果。failed/cancelled/budget_exceeded 都不伪装成 no_change。 */
export type ResearchRunStatus = "running" | "succeeded" | "no_change" | "partial" | "failed" | "cancelled" | "budget_exceeded";

export interface ResearchRun {
  id: string;
  taskId: string;
  scheduledFor: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: ResearchRunStatus;
  searchCalls: number;
  modelCalls: number;
  summary: string | null;
  error: string | null;
}

/** 台账条目的种类：源披露的事实、来源观点、AI 研判、人工结论。 */
export type LedgerKind = "fact" | "source_view" | "ai_assessment" | "human_conclusion";

/** 事实状态：源披露、已交叉核验、冲突、未核实、撤回。撤回也留版本，不删除。 */
export type LedgerStatus = "disclosed" | "cross_verified" | "conflict" | "unverified" | "withdrawn";

/** 一条引用：原文地址与采集时看到的事实，报告和台账都要能回到它。 */
export interface Evidence {
  id: string;
  ledgerId: string;
  url: string;
  publisher: string | null;
  /** 采集渠道：信源 id、网页、搜索线索等。 */
  channel: string;
  publishedAt: string | null;
  discoveredAt: string | null;
  fetchedAt: string | null;
  analyzedAt: string | null;
  bodyHash: string | null;
  /** 引用在正文里的定位（章节、段落、选择器或字符偏移）。 */
  quoteLocator: string | null;
  quote: string | null;
  license: string | null;
  createdAt: string;
}

/** 台账里的一版条目。同一 entryKey 的下一版用 version+1，supersedesId 指回上一版。 */
export interface LedgerEntry {
  id: string;
  taskId: string;
  /** 稳定的主题键：同一件事、同一条事实的每个版本共用它。 */
  entryKey: string;
  version: number;
  kind: LedgerKind;
  status: LedgerStatus;
  title: string;
  body: string;
  /** 来源观点的作者；AI 研判写模型与版本，不写成原文。 */
  author: string | null;
  model: string | null;
  modelVersion: string | null;
  runId: string | null;
  supersedesId: string | null;
  /** 人工锁定的条目和字段，AI 不得覆盖。 */
  humanLocked: boolean;
  createdAt: string;
  evidence: Evidence[];
}

/** 阅读状态（单人）：已读时间、收藏、待核实和人工备注。 */
export interface LedgerReadState {
  ledgerId: string;
  readAt: string | null;
  starred: boolean;
  needsCheck: boolean;
  note: string | null;
  updatedAt: string;
}

/** 待发事件的种类：材料版本提交、台账版本提交、运行结束。 */
export type OutboxEventType = "material.version" | "ledger.version" | "run.finished";

/** 事务 outbox 里的一行：和产生它的写入在同一个事务里提交，由 worker 之后再派发。 */
export interface OutboxEvent {
  id: number;
  eventType: OutboxEventType;
  payload: Record<string, unknown>;
  createdAt: string;
  dispatchedAt: string | null;
  attempts: number;
  lastError: string | null;
}

export type TaskReportKind = "summary" | "alert";

/** 任务详情里的一份研究报告或提醒。 */
export interface TaskReport {
  id: string;
  taskId: string;
  runId: string | null;
  kind: TaskReportKind;
  body: string;
  createdAt: string;
}

/** 新建任务时的输入：前四步创建（目标→信源→节奏→输出）合在一次提交里。 */
export interface NewTaskInput {
  title: string;
  goal: string;
  cadence: TaskCadence;
  outputTemplate: string;
  sources: Array<{ kind: TaskSourceKind; locator: string }>;
}
