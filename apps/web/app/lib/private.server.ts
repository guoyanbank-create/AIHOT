// 全站私有：单人工作台除登录和必要静态资源外，不把页面、API、RSS、MCP、llms.txt、站点地图、分享图和
// 导出交给未登录的人。网关在网页进程（apps/web/server.ts；开发时 apps/web/vite.config.ts 的 dev 网关）
// 先问 api 有没有后台会话，没有就跳去登录（页面）或返回 401（接口和 .data）。api 端口不对外发布，见
// docker-compose.yml 与 docs/deploy.md。
import type { IncomingMessage, ServerResponse } from "node:http";
import { PRIVATE_SITE } from "@aihot/site";
import { isApiOwned } from "@aihot/contracts/http-policy";
import { API_BASE_URL } from "./api.server.ts";

/**
 * 是否按全站私有处理。站点默认私有（site/site.ts 的 PRIVATE_SITE）；引擎公开页面的测试用
 * PRIVATE_SITE=false 关掉，私有部署不要设置它。
 */
export function privateMode(): boolean {
  return PRIVATE_SITE && process.env.PRIVATE_SITE !== "false";
}

/** 登录页、登录本身要用的地址，以及登录页会引用的站点图标和 manifest；其余都只给登录后的本人。 */
export function privateAllowed(pathname: string): boolean {
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login.")) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  return /^\/(?:favicon\.ico|icon\.png|icon-192\.png|apple-icon\.png|logo\.svg|manifest\.webmanifest)$/.test(pathname)
    || pathname.startsWith("/assets/");
}

/** 这个请求带着的 cookie 是不是一个活着的后台会话；问不到 api 就当没有（失败也关着）。 */
async function signedIn(cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/admin/me`, {
      headers: { accept: "application/json", cookie },
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function deny(req: IncomingMessage, res: ServerResponse, pathname: string, search: string): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  // 接口、机器出口（RSS、MCP、llms、站点地图、分享图、导出）、页面的数据请求和写操作都返回 401；
  // 页面才带着回程地址去登录。
  if (pathname.startsWith("/api/") || pathname.endsWith(".data") || isApiOwned(pathname) || (req.method !== "GET" && req.method !== "HEAD")) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ code: "unauthorized", detail: "Sign in first." }));
    return;
  }
  res.statusCode = 302;
  res.setHeader("Location", `/api/auth/login?${new URLSearchParams({ return: pathname + search })}`);
  res.end();
}

/** 未登录就拦住这个请求；返回 true 表示已经答完。 */
export async function privateGate(req: IncomingMessage, res: ServerResponse, pathname: string, search: string): Promise<boolean> {
  if (!privateMode() || privateAllowed(pathname)) return false;
  if (await signedIn(req.headers.cookie)) return false;
  deny(req, res, pathname, search);
  return true;
}

/**
 * 私有模式下，已登录的响应也不许共享缓存或搜索引擎留存：网页、代理回来的 api 数据和导出都只属于本人。
 * 构建产物在网关前就按公开静态文件发完了，不经过这里。
 */
export function privateNoStore(res: ServerResponse): void {
  if (!privateMode()) return;
  const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
  res.writeHead = ((status: number, messageOrHeaders?: unknown, headers?: unknown) => {
    const existing = typeof messageOrHeaders === "string" ? headers : messageOrHeaders;
    const merged = { ...((existing ?? {}) as Record<string, unknown>) };
    merged["Cache-Control"] = "private, no-store";
    merged["X-Accel-Expires"] = "0";
    merged["X-Robots-Tag"] = "noindex, nofollow";
    delete merged["Expires"];
    return typeof messageOrHeaders === "string" ? writeHead(status, messageOrHeaders, merged) : writeHead(status, merged);
  }) as typeof res.writeHead;
}
