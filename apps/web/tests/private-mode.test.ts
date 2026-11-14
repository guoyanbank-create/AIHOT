// 全站私有：没有会话的人拿不到页面、公开 API、RSS、MCP、llms、站点地图、分享图和导出；登录页本身和
// 登录要用的静态资源仍可访问。网关在 apps/web/server.ts（生产）和 vite 的 dev 网关里，见 app/lib/private.server.ts。
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { privateAllowed } from "../app/lib/private.server.ts";
import { fakeApi, startWebServer, type WebServer } from "./web-server.ts";

const SESSION = "aihot_admin=fixture";
const api = fakeApi((url, res, req) => {
  if (url.pathname === "/api/admin/me") {
    if (req.headers.cookie?.includes(SESSION)) return { name: "Fixture admin", csrf: "fixture", dev: false };
    res.statusCode = 401;
    return { code: "unauthorized" };
  }
});
let web: WebServer;
async function server(): Promise<WebServer> {
  web ??= await startWebServer(api, { PRIVATE_SITE: "true" });
  return web;
}
after(async () => {
  await web?.stop();
});

test("登录页、登录本身、图标和构建产物不用登录", () => {
  for (const path of ["/admin/login", "/admin/login.data", "/api/auth/password", "/api/auth/options", "/favicon.ico", "/icon.png", "/icon-192.png", "/apple-icon.png", "/logo.svg", "/manifest.webmanifest", "/assets/index-abc123.js"]) {
    assert.equal(privateAllowed(path), true, path);
  }
  for (const path of ["/", "/all", "/feed.xml", "/llms.txt", "/sitemap.xml", "/api/v1/items", "/api/mcp", "/og/site.png", "/items/abc/markdown", "/api/health", "/admin", "/.well-known/security.txt", "/_.data"]) {
    assert.equal(privateAllowed(path), false, path);
  }
});

test("没有会话：页面去登录，接口与数据请求答 401", async () => {
  const { origin } = await server();

  const page = await fetch(origin + "/all?category=ai-models", { redirect: "manual" });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/api/auth/login?return=%2Fall%3Fcategory%3Dai-models");
  assert.equal(page.headers.get("cache-control"), "private, no-store");
  await page.text();

  for (const [path, method] of [["/api/v1/items", "GET"], ["/feed.xml", "GET"], ["/llms.txt", "GET"], ["/sitemap.xml", "GET"], ["/og/site.png", "GET"], ["/items/abc/markdown", "GET"], ["/api/health", "GET"], ["/api/mcp", "POST"], ["/_.data", "GET"]] as const) {
    const res = await fetch(origin + path, { method, redirect: "manual" });
    assert.equal(res.status, 401, path);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/, path);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/, path);
    assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/, path);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "unauthorized", path);
  }
});

test("没有会话也能打开登录页：它要用的接口和静态资源还通", async () => {
  const { origin } = await server();
  const login = await fetch(origin + "/admin/login");
  assert.equal(login.status, 200);
  assert.match(await login.text(), /管理员密码/);
});

test("登录后接口只进本机缓存，页面不再被搜索引擎留存", async () => {
  const { origin } = await server();
  const meta = await fetch(origin + "/api/site/meta", { headers: { cookie: SESSION } });
  assert.equal(meta.status, 200);
  assert.equal(meta.headers.get("cache-control"), "private, no-store");
  assert.equal(meta.headers.get("x-accel-expires"), "0");
  assert.match(meta.headers.get("x-robots-tag") ?? "", /noindex/);
  await meta.text();

  // 已有会话时登录页把人送回后台（它的 loader 先问 /api/admin/me）。
  const back = await fetch(origin + "/admin/login", { headers: { cookie: SESSION }, redirect: "manual" });
  assert.equal(back.status, 302);
  assert.equal(back.headers.get("location"), "/admin");
  await back.text();
});
