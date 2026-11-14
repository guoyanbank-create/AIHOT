// 站点检查的共用部分：全站私有和公开站两种行为。scripts/verify-private.ts（部署检查）和
// scripts/smoke.ts（整站检查，私有站时走这里，公开站时走原来的匿名检查）都用它。
// 不依赖后端包：脚本在部署机上跑，只读环境变量。
import { SITE } from "@aihot/site";

/** 会话 cookie 的名字（packages/backend/src/admin/auth.ts 的 SESSION_COOKIE）。 */
const SESSION_COOKIE = "aihot_admin";

/** 登录后应当能打开的页面（/admin 打开后跳到信源页，和其它页一样算可用）。 */
const PAGES = ["/", "/all", "/hot", "/daily", "/daily/archive", "/topics", "/starred", "/agent", "/about", "/changelog", "/feedback", "/terms", "/privacy", "/more", "/admin"];
/** 机器出口：匿名时 401，登录后 200 且类型对。 */
const EXITS: Array<[path: string, type: RegExp]> = [
  ["/api/v1/items", /json/],
  ["/api/v1/hot-topics", /json/],
  ["/feed.xml", /xml/],
  ["/feed/all.xml", /xml/],
  ["/llms.txt", /text\/plain/],
  ["/robots.txt", /text\/plain/],
  ["/sitemap.xml", /xml/],
  ["/openapi-v1.json", /json/],
  ["/og/site.png", /image\/png/],
];

/** 打一行检查结果；返回这次失败的 1 或通过的 0。 */
export function check(ok: boolean, what: string, detail = ""): number {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? `  ${detail}` : ""}`);
  return ok ? 0 : 1;
}

const get = (base: string, path: string, cookie?: string): Promise<Response> =>
  fetch(base + path, { redirect: "manual", headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(30_000) });

/** 站点是不是全站私有：匿名打开首页会被送到登录页。 */
export async function probePrivate(base: string): Promise<boolean> {
  const res = await get(base, "/");
  const location = res.headers.get("location") ?? "";
  await res.text();
  return res.status === 302 && location.startsWith("/api/auth/login?");
}

/**
 * 没有会话的人不应该拿到任何东西：页面去登录，RSS/MCP/llms/站点地图/分享图/导出和接口一律 401；
 * 登录页和它要用的图标仍然可开。返回失败数。
 */
export async function anonymousChecks(base: string): Promise<number> {
  let failed = 0;
  for (const path of ["/", "/all", "/daily", "/topics", "/items/whatever", "/admin", "/_.data?_routes=root"]) {
    const res = await get(base, path);
    const location = res.headers.get("location") ?? "";
    const wanted = path.includes(".data?");
    failed += check(wanted ? res.status === 401 : res.status === 302 && location.startsWith("/api/auth/login?"), `匿名 ${path}`, `${res.status} ${location}`.trim());
    await res.text();
  }
  for (const path of ["/api/health", "/api/v1/items", "/api/mcp", "/feed.xml", "/llms.txt", "/sitemap.xml", "/og/site.png", "/items/whatever/markdown"]) {
    const res = await get(base, path);
    failed += check(res.status === 401, `匿名 ${path}`, String(res.status));
    await res.text();
  }
  const loginPage = await get(base, "/admin/login");
  failed += check(loginPage.status === 200, "匿名 /admin/login", String(loginPage.status));
  await loginPage.text();
  const favicon = await get(base, "/favicon.ico");
  failed += check(favicon.status === 200, "匿名 /favicon.ico（登录页要用）", String(favicon.status));
  await favicon.arrayBuffer();
  return failed;
}

/** 用管理员密码登录，拿到会话 cookie；失败返回 null。 */
export async function signIn(base: string, password: string): Promise<string | null> {
  const login = await fetch(`${base}/api/auth/password`, {
    method: "POST",
    redirect: "manual",
    body: new URLSearchParams({ password, return: "/" }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(30_000),
  });
  const session = login.headers.getSetCookie().map((c) => c.split(";")[0]!).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  await login.text();
  return login.status === 303 && session ? session : null;
}

/** 登录后的页面、机器出口和 MCP 握手都要能用，而且响应不共享缓存。返回失败数。 */
export async function authenticatedChecks(base: string, cookie: string): Promise<number> {
  let failed = 0;
  for (const path of PAGES) {
    const res = await get(base, path, cookie);
    const opened = path === "/admin"
      ? res.status === 302 && res.headers.get("location") === "/admin/sources"
      : res.status === 200;
    failed += check(opened, `已登录 ${path}`, `${res.status} ${res.headers.get("location") ?? ""}`.trim());
    failed += check((res.headers.get("cache-control") ?? "").includes("private"), `已登录 ${path} 不共享缓存`, res.headers.get("cache-control") ?? "(none)");
    await res.text();
  }
  for (const [path, type] of EXITS) {
    const res = await get(base, path, cookie);
    failed += check(res.status === 200 && type.test(res.headers.get("content-type") ?? ""), `已登录 ${path}`, `${res.status} ${res.headers.get("content-type") ?? ""}`);
    await (res.headers.get("content-type")?.startsWith("image/") ? res.arrayBuffer() : res.text());
  }
  const markdown = await get(base, "/items/whatever/markdown", cookie);
  failed += check(markdown.status === 404, "已登录 /items/whatever/markdown（不存在的条目答 404，不是 401）", String(markdown.status));
  await markdown.text();
  const missing = await get(base, "/api/site/no-such-endpoint", cookie);
  failed += check(missing.status === 404, "已登录不存在的接口答 404，不是 401", String(missing.status));
  await missing.text();

  const mcp = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", cookie },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "site-check", version: "1" } } }),
    signal: AbortSignal.timeout(30_000),
  });
  const mcpText = await mcp.text().catch(() => "");
  failed += check(mcp.status === 200 && mcpText.includes(`"name":"${SITE.mcpPrefix}"`), "已登录 /api/mcp initialize", `${mcp.status} ${mcpText.slice(0, 120)}`);
  return failed;
}
