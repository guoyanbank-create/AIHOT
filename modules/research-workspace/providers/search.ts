// 搜索提供商：默认 Tavily，结果和费用都进回执与预算；没有凭证时退回清楚标识的本地 fixtures，
// 不假装已经联网。搜索只提供线索，正文必须由 providers/page.ts 读原文；读不到就标待核实。
import { credential } from "@aihot/backend/config";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { assertAccepted, paidRequest, BudgetExceededError, ProviderRejectedError } from "@aihot/backend/providers/receipts";
import { sql } from "@aihot/backend/db";
import { fixtureSearch } from "./fixtures.ts";

export interface SearchResult {
  title: string;
  url: string;
  /** 搜索摘要：只是线索，不能当原文证据。 */
  snippet: string;
  publishedAt: string | null;
}

export interface SearchOutcome {
  provider: "tavily" | "fixtures";
  /** 结果是本地 fixtures（未联网）。 */
  fixture: boolean;
  results: SearchResult[];
  receiptId: number | null;
}

export interface SearchOptions {
  maxResults: number;
  purpose: string;
  subject: string;
}

let budgetEnsured = false;

/** Tavily 的预算行：和引擎的付费服务一样进 budgets（管理页可改，0 停用）。 */
async function ensureSearchBudget(): Promise<void> {
  if (budgetEnsured) return;
  await sql`INSERT INTO budgets (service, per_minute, per_hour, per_day, note)
    VALUES ('tavily', 10, 100, 500, '搜索提供商（默认 Tavily，按请求计费）')
    ON CONFLICT (service) DO NOTHING`;
  budgetEnsured = true;
}

/** 搜索有没有凭证；设置页和运行记录都如实显示它。 */
export function searchConfigured(): boolean {
  return Boolean(credential("collectors", "TAVILY_API_KEY"));
}

/**
 * 一次搜索。没有凭证时返回 fixture（调用方必须在运行记录里写明未联网）；有凭证时按每次请求计费，
 * 走回执和预算，结果复用同一 logical key，重试不重复花钱。
 */
export async function searchWeb(query: string, options: SearchOptions): Promise<SearchOutcome> {
  const key = credential("collectors", "TAVILY_API_KEY");
  const maxResults = Math.min(Math.max(options.maxResults, 1), 10);
  if (!key) {
    const pages = fixtureSearch(query, maxResults);
    return {
      provider: "fixtures",
      fixture: true,
      results: pages.map((page) => ({ title: page.title, url: page.url, snippet: page.text.slice(0, 300), publishedAt: page.publishedAt })),
      receiptId: null,
    };
  }
  await ensureSearchBudget();
  const base = (credential("collectors", "TAVILY_BASE_URL") ?? "https://api.tavily.com").replace(/\/$/, "");
  const costPerCall = Number(process.env.TAVILY_COST_USD_PER_CALL ?? "0.008");
  const receipt = await paidRequest(
    {
      service: "tavily",
      purpose: options.purpose,
      subject: options.subject,
      identity: { query, maxResults, day: new Date().toISOString().slice(0, 10) },
      requestSummary: { query, maxResults },
    },
    async () => {
      const res = await guardedFetch(`${base}/search`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic", include_answer: false, include_raw_content: false, topic: "general" }),
        timeoutMs: 30_000,
        maxBytes: 2 * 1024 * 1024,
      });
      const text = res.text();
      assertAccepted("tavily", res.status, text);
      let data: { results?: Array<{ title?: string; url?: string; content?: string; published_date?: string | null }> };
      try {
        data = JSON.parse(text) as typeof data;
      } catch {
        throw new ProviderRejectedError("Tavily returned a non-JSON answer", res.status, true);
      }
      const results = (data.results ?? [])
        .filter((item) => item.url)
        .map((item) => ({
          title: (item.title ?? item.url ?? "").slice(0, 300),
          url: item.url!,
          content: (item.content ?? "").slice(0, 2000),
          published_date: item.published_date ?? null,
        }));
      return {
        response: { results },
        requestId: res.headers.get("x-request-id"),
        usage: { results: results.length },
        cost: Number.isFinite(costPerCall) && costPerCall > 0
          ? { amount: costPerCall, currency: "USD", basis: "estimated" as const }
          : null,
      };
    },
  );
  const raw = (receipt.response as { results?: Array<{ title?: string; url?: string; content?: string; published_date?: string | null }> })?.results ?? [];
  return {
    provider: "tavily",
    fixture: false,
    receiptId: receipt.receiptId,
    results: raw.map((item) => ({
      title: (item.title ?? item.url ?? "").slice(0, 300),
      url: item.url!,
      snippet: (item.content ?? "").slice(0, 500),
      publishedAt: item.published_date ?? null,
    })),
  };
}

export { BudgetExceededError, ProviderRejectedError };
