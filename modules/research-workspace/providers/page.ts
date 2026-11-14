// 读研究线索的原文：SSRF、重定向和正文清洗走引擎已有的提取路径（content/extract.ts），不自己重写。
// 读不到原文时返回 null，调用方把线索标成待核实，不拿搜索摘要当证据。fixtures 模式下读本地 fixture 页。
import { extractFromUrl } from "@aihot/backend/content/extract";
import { fixturePage } from "./fixtures.ts";

export interface FetchedPage {
  /** 搜索给出的地址（入库与引用都用它，和最终跳转地址分开记）。 */
  url: string;
  title: string;
  text: string;
  publishedAt: string | null;
  via: "readability" | "jina" | "text" | "fixture";
  /** 这条原文来自哪个渠道：search:tavily、rss:<host>、web:<host>、fixture:search。 */
  channel: string;
  /** 本地 fixtures（未联网）。 */
  fixture: boolean;
}

const MAX_TEXT = 24_000;

/** 一条线索的原文；unreadable 时返回 null。fixture 为 true 时只读本地 fixture。 */
export async function fetchResearchPage(url: string, options: { subject: string; fixture: boolean; channel?: string }): Promise<FetchedPage | null> {
  if (options.fixture) {
    const page = fixturePage(url);
    if (!page) return null;
    return { url, title: page.title, text: page.text.slice(0, MAX_TEXT), publishedAt: page.publishedAt, via: "fixture", channel: options.channel ?? "fixture:search", fixture: true };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  // 引擎的提取会先做 SSRF 检查和 HTML 清洗；不付 Jina 的钱（research 阶段不假设网关能联网浏览）。
  const body = await extractFromUrl(url, options.subject, {}, { paidFallback: false }).catch(() => null);
  if (!body) return null;
  const text = body.text.slice(0, MAX_TEXT);
  if (!text.trim()) return null;
  return {
    url,
    title: text.split("\n")[0]!.slice(0, 300),
    text,
    publishedAt: body.publishedAt ? body.publishedAt.toISOString().slice(0, 10) : body.publicationTime ?? null,
    via: body.via,
    channel: options.channel ?? `web:${parsed.hostname}`,
    fixture: false,
  };
}
