// 每日摘要：08:10 从已入账结果生成研究报告，挂在任务详情里。只汇总上次报告之后的新台账版本；
// 没有新内容就不写报告（不产生“今天没变化”的噪声，除非确实有 failed/partial 需要说）。
import { z } from "zod";
import { chatJson } from "@aihot/backend/providers/llm";
import { BudgetExceededError, ModelUnavailableError } from "@aihot/backend/providers/receipts";
import type { LedgerListEntry, ResearchTask } from "../contracts.ts";
import { listLedgerView } from "../ledger.ts";
import { appendTaskReport, listTaskReports } from "../reports.ts";
import { listTasks } from "../tasks.ts";

const SUMMARY_SCHEMA = z.object({ summary: z.string().min(1).max(4000) });

const SYSTEM = "你是长期研究工作台的摘要作者。根据研究目标和这段时间新入账的台账，写一份给任务负责人看的中文研究摘要：先给结论，再列变化（新增、修正、撤回）、冲突和仍待核实的地方；不要编造，不要引用没有证据的事实。只输出 JSON：{\"summary\": \"...\"}。";

/** 没有模型时的确定性摘要：按台账版本逐个列，不编造解释。 */
export function fallbackSummary(task: ResearchTask, entries: readonly LedgerListEntry[]): string {
  if (!entries.length) return "";
  const lines = entries.slice(0, 30).map((entry) => `- [${entry.status}] ${entry.title}（v${entry.version}，引用 ${entry.evidence.length} 条）`);
  return `任务「${task.title}」自上次报告以来的变化：\n${lines.join("\n")}${entries.length > 30 ? `\n（另有 ${entries.length - 30} 条未列出）` : ""}`;
}

async function summaryText(task: ResearchTask, entries: readonly LedgerListEntry[], previous: string): Promise<{ body: string; modelCalls: number }> {
  const digest = entries.map((entry) => `- [${entry.kind}/${entry.status}] ${entry.title}：${entry.body.slice(0, 300)}`).join("\n");
  try {
    const result = await chatJson({
      model: "default",
      purpose: "research.summary",
      subject: task.id,
      promptVersion: "research.summary.1",
      system: SYSTEM,
      user: `研究目标：${task.goal}\n\n这次要汇总的新台账：\n${digest}\n\n上一次报告的结尾（避免重复）：\n${previous || "（无）"}`,
      schema: SUMMARY_SCHEMA,
      temperature: 0.3,
      maxTokens: 1200,
      timeoutMs: 120_000,
    });
    return { body: result.data.summary.trim(), modelCalls: 1 };
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    if (error instanceof ModelUnavailableError) return { body: fallbackSummary(task, entries), modelCalls: 0 };
    return { body: `${fallbackSummary(task, entries)}\n\n（模型摘要失败：${error instanceof Error ? error.message : String(error)}；以上是确定性列表）`, modelCalls: 0 };
  }
}

/**
 * 给每个有新增台账的任务追加一份研究报告。模型不可用时用确定性列表，并注明。
 * 返回写了多少份、调用了几次模型。预算被拦时停止（不写成“今天没有新内容”）。
 */
export async function summarizeDue(now: Date = new Date()): Promise<{ reports: number; modelCalls: number }> {
  let reports = 0;
  let modelCalls = 0;
  for (const task of (await listTasks()).filter((item) => item.status === "active")) {
    const [entries, previousReports] = await Promise.all([listLedgerView({ taskId: task.id, limit: 500 }), listTaskReports(task.id, undefined, 1)]);
    const since = previousReports[0] ? new Date(previousReports[0].createdAt) : new Date(now.getTime() - 24 * 3600_000);
    const fresh = entries.filter((entry) => new Date(entry.createdAt) > since);
    if (!fresh.length) continue;
    try {
      const { body, modelCalls: used } = await summaryText(task, fresh, previousReports[0]?.body.slice(-600) ?? "");
      if (!body) continue;
      await appendTaskReport({ taskId: task.id, kind: "summary", body });
      reports += 1;
      modelCalls += used;
    } catch (error) {
      if (error instanceof BudgetExceededError) break;
      throw error;
    }
  }
  return { reports, modelCalls };
}
