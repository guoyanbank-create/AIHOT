// 工作台的后台任务：研究运行队列、到点扫描、每日摘要、outbox 派发，和它们的时间表。
// 时间表在北京时间；missed: "once" 让 Mac 睡醒后补跑一次，运行记录里带覆盖缺口。
import { config } from "@aihot/backend/config";
import { sql } from "@aihot/backend/db";
import { defineQueue, type Scheduled } from "@aihot/backend/modules";
import { markOutboxDispatched, markOutboxFailed, pendingOutbox } from "./outbox.ts";
import { dispatchDueRuns } from "./research/due.ts";
import { runTaskResearch } from "./research/run.ts";
import { summarizeDue } from "./research/summary.ts";

export interface ResearchRunJob {
  taskId: string;
  scheduledFor: string | null;
  trigger: "schedule" | "manual" | "catch-up";
}

/** 一个任务一次研究。一次只跑一个（同一条队列的其余任务排队），单次最长 15 分钟，失败重试一次。 */
export const RESEARCH_RUN_QUEUE = defineQueue<ResearchRunJob>({
  name: "research.run",
  options: { policy: "short", retryLimit: 1, retryDelay: 120, expireInSeconds: 20 * 60 },
  worker: { batchSize: 1, pollingIntervalSeconds: 10 },
  run: async (jobs) => {
    const results = [];
    for (const job of jobs) results.push(await runTaskResearch(job));
    return results;
  },
});

/**
 * 派发事务 outbox：材料版本和台账版本在各自事务里已经提交，这里把待发事件取出来、标记派发。
 * 现在的事件只用于审计与后续匹配（任务信源匹配、通知在后续阶段接），不在这里重新抓取或调用模型。
 */
export async function dispatchOutboxOnce(): Promise<{ dispatched: number; failed: number }> {
  const events = await pendingOutbox(sql, 50);
  let dispatched = 0;
  let failed = 0;
  for (const event of events) {
    try {
      await markOutboxDispatched(sql, event.id);
      dispatched += 1;
    } catch (error) {
      await markOutboxFailed(sql, event.id, error instanceof Error ? error.message : String(error)).catch(() => {});
      failed += 1;
    }
  }
  return { dispatched, failed };
}

/** 模块的时间表：到点扫描、08:10 摘要、每分钟 outbox 派发。 */
export const RESEARCH_SCHEDULES: Scheduled[] = [
  {
    name: "research.due",
    cron: "*/5 * * * *",
    missed: "once",
    // 没有模型调用时也扫：到点的研究会被记成 failed（模型关闭），不如等打开后再跑。
    when: () => config.modelCallsEnabled,
    run: () => dispatchDueRuns(),
  },
  {
    name: "research.summary",
    cron: "10 8 * * *",
    missed: "once",
    run: () => summarizeDue(),
  },
  {
    name: "research.outbox",
    cron: "* * * * *",
    run: () => dispatchOutboxOnce(),
  },
];
