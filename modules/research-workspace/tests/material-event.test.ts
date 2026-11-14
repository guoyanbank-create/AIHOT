// 材料版本提交事件：任务支路要覆盖所有入库材料（包括没有热度、没进新闻精选的官方公告），
// 所以事件和材料写入在同一个事务里写进 outbox；重复发现同一内容不写；事务回滚时事件一起回滚。
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { installModules } from "@aihot/backend/modules";
import researchWorkspace from "../server.ts";
import { pendingOutbox } from "../outbox.ts";

const SOURCE = `test-research-materials-${process.pid}`;
const url = (name: string) => `https://example.com/research/${name}-${process.pid}`;

before(async () => {
  installModules([researchWorkspace]);
  await sql`DELETE FROM research_outbox`;
  await sql`INSERT INTO sources (id, name, kind, next_fetch_at) VALUES (${SOURCE}, 'Research fixtures', 'rss', '2100-01-01')`;
});
after(async () => {
  installModules([]);
  await closeDb();
});

test("新入库的材料写一条 material.version；重复发现不写", async () => {
  // 低热度的官方公告也从这里进来：事件不看精选结果，只看材料是否入库。
  const first = await upsertMaterial({ sourceId: SOURCE, url: url("new"), title: "官方公告：新模型发布", via: "fetch" });
  const events = await pendingOutbox();
  assert.equal(events.length, 1);
  assert.equal(events[0]!.eventType, "material.version");
  const payload = events[0]!.payload as Record<string, unknown>;
  assert.equal(payload.articleId, first.articleId);
  assert.equal(payload.sourceId, SOURCE);
  assert.equal(payload.revision, 1);
  assert.equal(payload.created, true);
  assert.equal(payload.title, "官方公告：新模型发布");
  assert.equal(payload.url, url("new"));

  // 同一个 URL 再发现一次（内容没变）不是新材料，也不再写事件。
  await upsertMaterial({ sourceId: SOURCE, url: url("new"), title: "官方公告：新模型发布", via: "fetch" });
  assert.equal((await pendingOutbox()).length, 1);
});

test("材料改版写一条新的 material.version（revision 递增）", async () => {
  await sql`DELETE FROM research_outbox`;
  const created = await upsertMaterial({ sourceId: SOURCE, url: url("revised"), title: "第一版", bodyText: "第一版正文", bodyStatus: "ok", via: "fetch" });
  assert.equal((await pendingOutbox()).length, 1);

  const revised = await upsertMaterial({ sourceId: SOURCE, url: url("revised"), title: "第二版", bodyText: "第二版正文", bodyStatus: "ok", via: "fetch" });
  assert.equal(revised.revised, true);
  const events = await pendingOutbox();
  assert.equal(events.length, 2);
  const payload = events[1]!.payload as Record<string, unknown>;
  assert.equal(payload.articleId, created.articleId);
  assert.equal(payload.revision, 2);
  assert.equal(payload.created, false);
  assert.equal(payload.title, "第二版");
});

test("事务回滚时材料事件一起回滚：outbox 和写入同生共死", async () => {
  await sql`DELETE FROM research_outbox`;
  await assert.rejects(() => sql.begin(async (tx) => {
    await upsertMaterial({ sourceId: SOURCE, url: url("rolled-back"), title: "会被回滚的公告", via: "fetch" }, tx);
    throw new Error("rollback on purpose");
  }), /rollback on purpose/);
  assert.deepEqual(await pendingOutbox(), [], "业务事务回滚后不能留下待发事件");
  const articles = await sql`SELECT 1 FROM articles WHERE url = ${url("rolled-back")}`;
  assert.equal(articles.length, 0);
});
