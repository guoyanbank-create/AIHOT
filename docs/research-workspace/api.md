# 工作台的接口、数据与事件

只给登录后的本人：所有接口都要求后台会话；写操作还要求 `x-csrf-token`（取自 `/api/admin/me` 的 `csrf`）。网页进程只通过 HTTP 读 api，浏览器拿不到数据库和模型密钥。

## 接口（`/api/admin/research/*`）

| 方法 | 地址 | 作用 |
|---|---|---|
| GET | `/today` | 今日：未读变化、待核实/收藏、任务概览（含下次运行）、最近运行 |
| GET | `/tasks` | 任务列表：任务、最近运行、未读数、报告数、下次运行 |
| POST | `/tasks` | 建任务（四步一次提交）：`{title, goal, cadence, outputTemplate, sources[]}` |
| GET | `/tasks/:id` | 任务详情：任务、运行历史（含覆盖）、报告、最近台账、下次运行 |
| PATCH | `/tasks/:id` | 改状态：`{status: active|paused|archived}` |
| POST | `/tasks/:id/run` | 立即排一次手动研究（走 worker 队列） |
| GET | `/ledger?filter=all\|unread\|starred\|needsCheck&task=<id>` | 台账列表 + 四个计数 + 任务下拉 |
| GET | `/ledger/:id` | 一条台账：条目、同一主题键的版本历史、阅读状态 |
| PATCH | `/ledger/:id/state` | 已读/收藏/待核实/人工备注：`{read?, starred?, needsCheck?, note?}` |
| POST | `/ledger/read-all` | 全部标为已读（可限定 `taskId`） |
| GET | `/sources` | 按任务分组的任务信源 |
| POST | `/sources` | 加信源：`{taskId, kind: rss|web|search, locator}` |
| PATCH | `/sources/:id` | 启用/停用：`{enabled}` |
| DELETE | `/sources/:id` | 删除一条任务信源 |
| GET | `/settings` | 时区、硬上限、搜索提供商状态、数据量、原后台入口 |

错误：`401` 未登录、`403` 缺 CSRF、`400` 参数不合法、`404` 不存在、`500` 内部错误。响应一律 `Cache-Control: no-store`。

## 数据表（模块迁移 `0900`～`0913`）

- `research_tasks`：任务（目标、状态、节奏 JSON、输出模板、最近运行时间）。
- `research_task_sources`：任务信源（rss/web/search，按 position 保留添加顺序，同任务同信源唯一）。
- `research_runs`：一次运行（计划时间、状态、搜索/模型次数、摘要、错误、覆盖 `coverage`）；`(task_id, scheduled_for)` 唯一，防止重复派发。
- `research_ledger_entries`：台账版本（主题键 + version，supersedes 指回上一版，human_locked）。
- `research_evidence`：引用（URL、发布方、渠道、各阶段时间、正文 hash、引用定位、许可）。
- `research_read_state`：单人阅读状态（已读/收藏/待核实/备注）。
- `research_outbox`：事务 outbox（材料版本、台账版本事件）。
- `research_task_reports`：任务报告（研究摘要、提醒）。

## 事件

| 事件 | 什么时候写 | 载荷 |
|---|---|---|
| `material.version` | 任何材料入库/改版（与材料写入同事务） | articleId、sourceId、revision、created、title、url、publishedAt、discoveredAt、contentHash |
| `ledger.version` | 追加台账版本（与版本写入同事务） | entryId、taskId、entryKey、version、kind、status、title、runId |

`research.outbox` 每分钟把待发事件标成已派发；目前事件用于审计和后续匹配，不在派发时重新抓取或调用模型。

## 运行上限

每次研究硬上限：查询 6 条、线索 30 条、正文 12 页、模型调用 12 次、单次 15 分钟（见 `research/run.ts` 的 `LIMITS`）。
搜索每次请求进回执并计估算费用（`TAVILY_COST_USD_PER_CALL`），预算在后台“设置 → 付费请求上限”里改（0 停用）。
运行状态：`succeeded` / `no_change` / `partial` / `failed` / `cancelled` / `budget_exceeded`；失败不写成没有变化。
