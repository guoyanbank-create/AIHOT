# 信源与材料怎么接进工作台

三类东西不要混：

| 产物 | 谁产生 | 用在哪 |
|---|---|---|
| 新闻信源（`sources` 表） | 引擎采集器（RSS/网页/JSON/X/公众号/外部推送） | 网站精选、日报、热度；**不是**调研任务的信源 |
| 任务信源（`research_task_sources`） | 工作台“信源”页或任务四步创建 | 研究任务：`rss`/`web` 由程序读，`search` 交给 SearchProvider |
| 材料版本事件（`research_outbox.material.version`） | `content/materials.ts` 的 `upsertMaterial`，在写入事务里发 | 让任务支路看到**所有**入库材料，包括没热度、没进新闻精选的官方公告 |

## 为什么需要材料版本事件

上游只有 `articleChanged`，它跟的是新闻精选的公开投影：没被选中、没热度的材料不会触发。任务支路要覆盖这些材料，所以引擎新增了 `materialCommitted` 钩子（`packages/backend/src/modules.ts`），在材料入库/改版时、同一个事务里发出；工作台把它写进事务 outbox。派发目前只做审计与去重（`jobs.ts` 的 `dispatchOutboxOnce`），后续可以把“任务信源与材料的匹配”接在这里，而不必再抓一遍。

## 不重复采集

- 引擎信源由采集器按各自间隔抓；调研任务的 `rss`/`web` 信源是研究时按需读的线索入口：运行时会读每个 RSS 最近 3 条、把网页信源直接当一条线索，再按“每次最多 12 页正文”的上限抓原文；它们不加入引擎采集计划。
- 海外信源抓不到时，在 `.env` 设 `EGRESS_PROXY_URL`（例如本机的代理 `http://127.0.0.1:7890`）；`.cn`、`.local` 和私有地址仍直连。
- 没有 `TAVILY_API_KEY` 时，如果任务配了真实的 RSS/网页信源，研究只读这些信源、**不会**混入 fixtures；只有任务没有真实信源时才用 fixtures 演示搜索。
- 同一个任务里相同信源只留一条；多个任务引用同一 RSS 时，研究运行时按 URL 去重，不重复读同一篇原文。
- 搜索只拿线索，正文由 `providers/page.ts` 用引擎已有的 `extractFromUrl`（SSRF 检查、重定向检查、HTML 净化）读取；读不到就标待核实，不把搜索摘要当证据。
- 没有 `TAVILY_API_KEY` 时使用 `providers/fixtures.ts` 的本地 fixtures（页面地址是 `fixtures.local`，运行记录标 `fixture: true`、页面写“本地演示数据，未联网”）。

## 官方材料与新闻精选的分工

- “今日/任务/台账”里的正式事实来自研究运行写出的台账版本，每条必须绑原文引用。
- 新闻精选（网站原来那套精选/日报）照旧由引擎跑；它的公开出口在全站私有下只给登录后的本人，不再承担对外发布。
