// 从读到的原文里抽取结构化条目，并在写台账之前校验证据：事实必须绑到这次真正读过的原文，
// 来源观点必须标作者，AI 不能写“人工结论”；校验不过的条目记 rejected，不静默丢掉。
import { z } from "zod";
import { chatJson } from "@aihot/backend/providers/llm";
import { sha256 } from "@aihot/backend/lib/ids";
import type { LedgerKind, LedgerStatus, ResearchTask } from "../contracts.ts";
import type { NewEvidence } from "../ledger.ts";
import type { FetchedPage } from "../providers/page.ts";

const ENTRY = z.object({
  entryKey: z.string().min(1).max(120),
  kind: z.enum(["fact", "source_view", "ai_assessment", "human_conclusion"]),
  status: z.enum(["disclosed", "cross_verified", "conflict", "unverified", "withdrawn"]).optional(),
  title: z.string().min(1).max(300),
  body: z.string().max(4000),
  evidenceUrls: z.array(z.string()).max(6),
  author: z.string().max(200).optional(),
  quote: z.string().max(500).optional(),
});

const EXTRACT_SCHEMA = z.object({ entries: z.array(ENTRY).max(8) });

export interface Candidate {
  entryKey: string;
  kind: LedgerKind;
  status: LedgerStatus;
  title: string;
  body: string;
  author: string | null;
  quote: string | null;
  evidenceUrls: string[];
}

export interface VerifiedEntry {
  candidate: Candidate;
  evidence: NewEvidence[];
}

const SYSTEM = `你是长期研究工作台的抽取器。根据“研究目标”和“本次读到的原文”，只输出 JSON：{"entries":[...]}。
每条：
- entryKey：稳定的主题键（同一件事/同一条事实的后续版本用同一个键，用英文小写、斜杠分隔，例如 openai/api-pricing）。
- kind：fact（官方/原文披露的事实）、source_view（某来源的观点或报道，必须给 author）、ai_assessment（你的研判，不是原文事实）。
- status：disclosed（源披露）、cross_verified（本次多篇原文互相印证）、conflict（原文互相矛盾）、unverified（证据不足）、withdrawn（原文明确撤回）。拿不准就用 unverified。
- title：中文，一句话说清发生了什么。
- body：中文，只写原文支持和推断出来的结论；不要把搜索摘要当原文。
- evidenceUrls：必须从“本次读到的原文”的地址里选（至少一条；事实必须能落到原文）。
- quote：原文里的关键句（可省略）。
不要输出 human_conclusion（人工结论只能由人写）。没有新信息就输出 {"entries":[]}。最多 8 条。`;

function pageBlock(pages: readonly FetchedPage[]): string {
  return pages.map((page, index) => `[${index + 1}] ${page.url}\n标题：${page.title}\n发布时间：${page.publishedAt ?? "未知"}\n正文：\n${page.text.slice(0, 6000)}`).join("\n\n---\n\n");
}

export async function extractWithModel(input: {
  task: ResearchTask;
  pages: readonly FetchedPage[];
  history: string;
}): Promise<{ candidates: Candidate[]; modelCalls: number; model: string }> {
  const result = await chatJson({
    model: "default",
    purpose: "research.extract",
    subject: input.task.id,
    promptVersion: "research.extract.1",
    system: SYSTEM,
    user: `研究目标：${input.task.goal}\n\n已有的最新台账（避免重复）：\n${input.history || "（无）"}\n\n本次读到的原文：\n${pageBlock(input.pages)}`,
    schema: EXTRACT_SCHEMA,
    temperature: 0.1,
    maxTokens: 2400,
    timeoutMs: 180_000,
  });
  const candidates = result.data.entries.map((entry) => ({
    entryKey: entry.entryKey.trim(),
    kind: entry.kind,
    status: entry.status ?? (entry.kind === "ai_assessment" ? "unverified" : "disclosed"),
    title: entry.title.trim(),
    body: entry.body.trim(),
    author: entry.author?.trim() || null,
    quote: entry.quote?.trim() || null,
    evidenceUrls: entry.evidenceUrls,
  }));
  return { candidates, modelCalls: 1, model: result.model };
}

/**
 * 证据校验：只接受本次真正读到的原文地址；类型与上限在这里兜底，模型输出再离谱也不会写出
 * 没有引用的事实。返回 accepted/rejected 计数，rejected 进运行记录。
 */
export function verifyCandidates(candidates: readonly Candidate[], pages: readonly FetchedPage[], model: string): { accepted: VerifiedEntry[]; rejected: number } {
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const accepted: VerifiedEntry[] = [];
  let rejected = 0;
  for (const candidate of candidates) {
    // 人工结论只能由人写；AI 写的一律拒绝。
    if (candidate.kind === "human_conclusion") { rejected += 1; continue; }
    // 来源观点必须标作者。
    if (candidate.kind === "source_view" && !candidate.author) { rejected += 1; continue; }
    const urls = [...new Set(candidate.evidenceUrls)].filter((url) => byUrl.has(url));
    if (!urls.length) { rejected += 1; continue; }
    const evidence: NewEvidence[] = urls.map((url) => {
      const page = byUrl.get(url)!;
      return {
        url,
        publisher: safeHost(url),
        channel: page.channel,
        publishedAt: page.publishedAt ? new Date(page.publishedAt) : null,
        fetchedAt: new Date(),
        analyzedAt: new Date(),
        bodyHash: sha256(page.text),
        quoteLocator: candidate.quote ? "model-selected sentence" : "opening",
        quote: candidate.quote ?? page.text.slice(0, 160),
        license: null,
      };
    });
    accepted.push({
      candidate: {
        ...candidate,
        status: candidate.status,
        author: candidate.kind === "source_view" ? candidate.author : candidate.author,
      },
      evidence,
    });
  }
  // AI 研判的 model/modelVersion 由写入方补上；这里只做形状检查。
  void model;
  return { accepted, rejected };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
