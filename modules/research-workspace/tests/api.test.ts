// 工作台接口的鉴权边界：没有后台会话一律 401，写操作还要 CSRF；登录后任务能建、能读。
// 环境在 import 前设好（config 在导入时读环境变量），所以后端模块都动态导入。
import assert from "node:assert/strict";
import { test } from "node:test";

test("工作台接口：匿名 401、写操作要 CSRF，登录后可用", async () => {
  process.env.ADMIN_PASSWORD ??= "test-research-admin-password";
  const Fastify = (await import("fastify")).default;
  const { registerResearchApi } = await import("../api.ts");
  const auth = await import("@aihot/backend/admin/auth");
  const { closeDb, sql } = await import("@aihot/backend/db");
  // 测试库是模板的副本：先清掉模板里可能有的工作台数据，让断言只看到本文件造的行。
  for (const table of ["research_read_state", "research_evidence", "research_ledger_entries", "research_runs", "research_task_reports", "research_task_sources", "research_tasks", "research_outbox"]) {
    await sql.unsafe(`DELETE FROM ${table}`);
  }
  const app = Fastify({ logger: false });
  registerResearchApi(app);
  await app.ready();
  try {
    const anonymous = await app.inject({ method: "GET", url: "/api/admin/research/today" });
    assert.equal(anonymous.statusCode, 401);

    const login = await auth.passwordLogin("test-research-admin-password", "/today", "test");
    const cookie = `${auth.SESSION_COOKIE}=${login.token}`;
    const principal = await auth.sessionPrincipal(cookie);
    assert.ok(principal);

    const today = await app.inject({ method: "GET", url: "/api/admin/research/today", headers: { cookie } });
    assert.equal(today.statusCode, 200);
    const overview = today.json() as { counts: { unread: number }; tasks: unknown[] };
    assert.equal(overview.counts.unread, 0);
    assert.deepEqual(overview.tasks, []);

    const noCsrf = await app.inject({ method: "POST", url: "/api/admin/research/tasks", headers: { cookie }, payload: { title: "x", goal: "y", cadence: { kind: "manual" } } });
    assert.equal(noCsrf.statusCode, 403);

    const invalid = await app.inject({
      method: "POST", url: "/api/admin/research/tasks",
      headers: { cookie, "x-csrf-token": principal!.csrf },
      payload: { title: " ", goal: "盯公告", cadence: { kind: "manual" } },
    });
    assert.equal(invalid.statusCode, 400);

    const created = await app.inject({
      method: "POST", url: "/api/admin/research/tasks",
      headers: { cookie, "x-csrf-token": principal!.csrf },
      payload: {
        title: "接口测试任务", goal: "盯住官方公告的发布和定价变化。", outputTemplate: "先给结论。",
        cadence: { kind: "daily", at: "05:30" },
        sources: [{ kind: "rss", locator: "https://example.com/feed.xml" }, { kind: "search", locator: "模型发布 定价" }],
      },
    });
    assert.equal(created.statusCode, 201);
    const task = created.json() as { id: string; sources: unknown[] };
    assert.equal(task.sources.length, 2);

    const detail = await app.inject({ method: "GET", url: `/api/admin/research/tasks/${task.id}`, headers: { cookie } });
    assert.equal(detail.statusCode, 200);
    assert.equal((detail.json() as { task: { title: string } }).task.title, "接口测试任务");

    const paused = await app.inject({ method: "PATCH", url: `/api/admin/research/tasks/${task.id}`, headers: { cookie, "x-csrf-token": principal!.csrf }, payload: { status: "paused" } });
    assert.equal(paused.statusCode, 200);
    assert.equal((paused.json() as { status: string }).status, "paused");

    const sources = await app.inject({ method: "GET", url: "/api/admin/research/sources", headers: { cookie } });
    assert.equal(sources.statusCode, 200);
    const view = sources.json() as { tasks: Array<{ sources: unknown[] }> };
    assert.equal(view.tasks.find((item) => (item as { id?: string }).id === task.id)?.sources.length, 2);

    const settings = await app.inject({ method: "GET", url: "/api/admin/research/settings", headers: { cookie } });
    assert.equal(settings.statusCode, 200);
    assert.equal((settings.json() as { limits: { queriesPerRun: number } }).limits.queriesPerRun, 6);

    const ledger = await app.inject({ method: "GET", url: "/api/admin/research/ledger", headers: { cookie } });
    assert.equal(ledger.statusCode, 200);
    assert.equal((ledger.json() as { entries: unknown[] }).entries.length, 0);
  } finally {
    await app.close();
    await closeDb();
  }
});
