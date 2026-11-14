// 任务信源里的 RSS/Atom：研究运行时读最近几条，把标题和链接作为线索，再按页数上限去读原文。
// 解析只做 RSS 2.0 / RDF / Atom 的必要字段，不执行任何脚本；抓取走引擎的 guardedFetch（SSRF、重定向）。
import { XMLParser } from "fast-xml-parser";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
}

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, parseTagValue: false });

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value) return String((value as Record<string, unknown>)["#text"] ?? "");
  return "";
}

function dateOf(value: unknown): string | null {
  const raw = textOf(value).trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function resolveUrl(href: unknown, base: string): string | null {
  const raw = typeof href === "string" ? href : textOf(href);
  if (!raw) return null;
  try {
    const url = new URL(raw.trim(), base);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** 解析一份 RSS 2.0 / RDF / Atom 文档，按出现顺序去重、取前 limit 条。纯函数，测试不需要联网。 */
export function parseFeed(xml: string, feedUrl: string, limit = 3): FeedItem[] {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const items: FeedItem[] = [];
  const push = (title: unknown, href: unknown, published: unknown) => {
    const url = resolveUrl(href, feedUrl);
    if (!url) return;
    const cleanTitle = textOf(title).replace(/\s+/g, " ").trim().slice(0, 300) || url;
    if (items.some((item) => item.url === url)) return;
    items.push({ title: cleanTitle, url, publishedAt: dateOf(published) });
  };
  const root = doc as Record<string, unknown> | undefined;
  const rssChannel = (root?.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
  const rdf = root?.["rdf:RDF"] as Record<string, unknown> | undefined;
  const candidate = rssChannel ?? rdf;
  const rawItems = candidate?.item ?? root?.item;
  for (const item of Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []) {
    const row = item as Record<string, unknown>;
    push(row.title, row.link, row.pubDate ?? row["dc:date"]);
  }
  const feed = root?.feed as Record<string, unknown> | undefined;
  const rawEntries = feed?.entry;
  for (const entry of Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : []) {
    const row = entry as Record<string, unknown>;
    const links = Array.isArray(row.link) ? row.link : row.link ? [row.link] : [];
    const link = links.find((candidateLink) => {
      const rel = (candidateLink as Record<string, unknown>)?.["@_rel"];
      return !rel || rel === "alternate";
    }) ?? links[0];
    push(row.title, (link as Record<string, unknown> | undefined)?.["@_href"] ?? link, row.published ?? row.updated);
  }
  return items.slice(0, Math.max(1, limit));
}

/** 读一份订阅源最近 limit 条线索；失败返回空数组，由调用方记进运行问题里。 */
export async function fetchFeed(feedUrl: string, options: { limit?: number } = {}): Promise<FeedItem[]> {
  const res = await guardedFetch(feedUrl, {
    headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    timeoutMs: 20_000,
    maxBytes: 4 * 1024 * 1024,
  });
  if (res.status !== 200) return [];
  return parseFeed(res.text(), res.url, options.limit ?? 3);
}
