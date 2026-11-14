// 本地 fixtures：没有搜索凭证、或测试时用。内容明确标成 fixture，不假装已经联网；凭证和真实调用
// 都由 providers/search.ts 负责。这里的页面地址用保留的 fixtures.local 域，不会与真实站点混淆。
export interface FixturePage {
  url: string;
  title: string;
  publishedAt: string;
  text: string;
}

export const FIXTURE_PAGES: readonly FixturePage[] = [
  {
    url: "https://fixtures.local/demo/announcement-model",
    title: "[fixture] 示例科技发布新一代模型（本地演示数据，未联网）",
    publishedAt: "2026-11-13",
    text: "[fixture] 这是本地演示数据，不是联网结果。示例科技在官方公告中宣布，新一代模型从 2026 年 11 月 20 日起向所有付费用户开放，输入长度上限提高到二十万 token；公告未提到价格变化。",
  },
  {
    url: "https://fixtures.local/demo/pricing",
    title: "[fixture] 示例科技 API 定价页更新（本地演示数据，未联网）",
    publishedAt: "2026-11-13",
    text: "[fixture] 这是本地演示数据，不是联网结果。定价页显示，新一代模型的调用价格为每百万输入 token 1.5 美元、每百万输出 token 6 美元，2026 年 11 月 20 日 00:00 UTC 生效；旧模型价格不变。",
  },
  {
    url: "https://fixtures.local/demo/compliance",
    title: "[fixture] 示例科技公布合规说明（本地演示数据，未联网）",
    publishedAt: "2026-11-12",
    text: "[fixture] 这是本地演示数据，不是联网结果。示例科技更新了企业版的数据保留与审计说明：默认保留期从 30 天改为 14 天，已有客户可以在控制台调整。",
  },
  {
    url: "https://fixtures.local/demo/interview",
    title: "[fixture] 一篇采访：示例科技的企业定价思路（本地演示数据，未联网）",
    publishedAt: "2026-11-12",
    text: "[fixture] 这是本地演示数据，不是联网结果。受访者称示例科技正在考虑按席位计费的企业档位，但公司没有正式确认。这是来源观点，不是官方事实。",
  },
];

/** 一条 fixture 搜索：query 只用于保持结果稳定，按关键词挑几条页面。 */
export function fixtureSearch(query: string, maxResults: number): FixturePage[] {
  const q = query.toLowerCase();
  const ranked = FIXTURE_PAGES.filter((page) => {
    if (q.includes("定价") || q.includes("pricing") || q.includes("价格")) return page.url.includes("pricing") || page.url.includes("announcement");
    if (q.includes("合规") || q.includes("compliance") || q.includes("许可")) return page.url.includes("compliance");
    return true;
  });
  return (ranked.length ? ranked : FIXTURE_PAGES).slice(0, Math.max(1, maxResults));
}

export function fixturePage(url: string): FixturePage | null {
  return FIXTURE_PAGES.find((page) => page.url === url) ?? null;
}
