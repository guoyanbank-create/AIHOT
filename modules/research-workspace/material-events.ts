// 材料版本提交事件：任务支路要看到所有进入库里的材料（包括没有热度、没进新闻精选的官方公告），
// 所以不靠 articleChanged（它跟的是公开投影）。每个版本在写入的同一个事务里写一条待发事件，
// 之后由 worker 从这里派生研究线索；重复发现同一内容不写。
import type { Db } from "@aihot/backend/db";
import type { MaterialCommit } from "@aihot/backend/modules";
import { recordOutbox } from "./outbox.ts";

/** 注册在 server.ts 的 on.materialCommitted 上。 */
export async function recordMaterialVersion(change: MaterialCommit, tx: Db): Promise<void> {
  await recordOutbox(tx, "material.version", {
    articleId: change.articleId,
    sourceId: change.sourceId,
    revision: change.revision,
    created: change.created,
    title: change.title,
    url: change.url,
    publishedAt: change.publishedAt?.toISOString() ?? null,
    discoveredAt: change.discoveredAt.toISOString(),
    contentHash: change.contentHash,
  });
}
