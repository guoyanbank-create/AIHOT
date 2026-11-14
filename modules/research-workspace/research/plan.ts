// 有界的查询计划：先让模型给出不超过 6 条查询（只给研究目标、信源和历史结论，不给整库），
// 模型不可用（开关关、没配置、预算用完）时退回由任务自己派生的确定性查询。计划永远不超过上限。
import { z } from "zod";
import { chatJson } from "@aihot/backend/providers/llm";
import type { ResearchTask } from "../contracts.ts";

export const MAX_QUERIES = 6;

const PLAN_SCHEMA = z.object({ queries: z.array(z.string().min(1).max(200)).min(1).max(MAX_QUERIES) });

const SYSTEM = "你是一个长期研究任务的研究计划助手。只输出 JSON：{\"queries\": [\"查询1\", ...]}。查询要具体、可被搜索引擎执行，覆盖任务目标里的事实、变化和官方来源；最多 6 条，不要解释。";

function planUser(input: { task: ResearchTask; history: string }): string {
  const sources = input.task.sources.filter((source) => source.enabled).map((source) => `- ${source.kind}: ${source.locator}`).join("\n") || "- （任务还没有信源）";
  return `研究目标：${input.task.goal}\n\n任务标题：${input.task.title}\n\n信源：\n${sources}\n\n已有的最新台账/结论（避免重复问已经确认的事）：\n${input.history || "（还没有历史结论）"}\n\n请给出这次要搜索的查询（最多 6 条），以 JSON 输出。`;
}

/** 模型的计划；抛错时由调用方退回 fallbackPlan。 */
export async function planWithModel(input: { task: ResearchTask; history: string }): Promise<{ queries: string[]; modelCalls: number }> {
  const result = await chatJson({
    model: "default",
    purpose: "research.plan",
    subject: input.task.id,
    promptVersion: "research.plan.1",
    system: SYSTEM,
    user: planUser(input),
    schema: PLAN_SCHEMA,
    temperature: 0.2,
    maxTokens: 600,
    timeoutMs: 60_000,
  });
  const queries = [...new Set(result.data.queries.map((query) => query.trim()).filter(Boolean))].slice(0, MAX_QUERIES);
  return { queries: queries.length ? queries : fallbackPlan(input.task), modelCalls: 1 };
}

/**
 * 确定性计划：任务里手写的搜索查询优先，再拼标题和研究目标里的一句。
 * 它让“模型不可用”时的运行仍然有工具可用，而不是假装没有变化。
 */
export function fallbackPlan(task: ResearchTask): string[] {
  const queries: string[] = [];
  for (const source of task.sources) if (source.enabled && source.kind === "search") queries.push(source.locator);
  const goalFirst = task.goal.split(/[。；;\n]/).map((part) => part.trim()).find(Boolean);
  if (goalFirst) queries.push(goalFirst.slice(0, 120));
  queries.push(`${task.title} 官方公告`);
  return [...new Set(queries.filter(Boolean))].slice(0, MAX_QUERIES);
}
