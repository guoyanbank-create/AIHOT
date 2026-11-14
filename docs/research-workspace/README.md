# 长期调研工作台：项目说明（入口）

单人、私有的长期调研工作台：把“要盯什么”做成长期任务，研究运行时读任务信源（RSS/网页/搜索）、读原文、抽结构化结论，写进带证据和版本的台账；界面只有五个菜单（今日 / 任务 / 台账 / 信源 / 设置），全站私有。

- 需求与阶段：GitHub Issue #1（T01～T18 已完成；T19～T20 是 P1，不阻塞首版）
- 当前进度、测试证据、已知限制和未确认项：[baseline.md](baseline.md)
- 待评审 PR：`agent/research-workspace-c858da60102e`

## 快速开始

```bash
npm ci
node scripts/init-env.ts --llm-key <模型 Key>   # 生成 .env（随机管理员密码/会话密钥/数据库密码）
./start.sh                                       # 本机 Node + PostgreSQL 容器，生产模式
```

打开 http://127.0.0.1:3000/admin/login ，管理员密码在 `.env` 的 `ADMIN_PASSWORD`。
日常：`./status.sh` 看状态、`./logs.sh api|worker|web` 看日志、`./stop.sh` 停（数据保留）。
开发：`./dev.sh`（改代码自动重启）；Docker 常驻部署：`bash deploy/mac/start-mac.sh`。三种方式对比见 [deploy/README.md](../../deploy/README.md)。

## 目录速查

| 位置 | 是什么 |
|---|---|
| `site/` | 本站的站点配置：站名文案、导航、模型预设、品牌、固定页、更新日志 |
| `industry/` | 行业知识与示范信源（当前还是上游的 AI 行业示例，待用户确认/替换） |
| `modules/research-workspace/` | 工作台模块：接口、数据层、研究流程、网页、迁移、测试（`contracts.ts` 是契约入口） |
| `apps/api`、`apps/worker`、`apps/web` | 后端接口、后台任务、SSR 网页 |
| `packages/backend`、`packages/contracts` | 引擎（采集/精选/模型/回执/预算/公开读取层）与共享契约 |
| `deploy/local/` | 本机启动/停止/状态/日志/开发脚本（根目录的 `start.sh` 等是薄包装） |
| `deploy/mac/` | M4 Mac 的 Docker 部署、体检、备份、隔离恢复、私有检查脚本 |
| `docs/research-workspace/` | 本项目的运行手册、接口与数据表、信源映射、进度与证据 |
| `database/migrations/`、`modules/*/migrations/` | 引擎迁移与模块迁移（按完整文件名排序执行） |

## 配置（`.env`）

脚本和进程都只从仓库根的 `.env` 读配置；不要提交它。关键项：

| 变量 | 作用 |
|---|---|
| `ADMIN_PASSWORD` | 唯一管理员密码（至少 12 位） |
| `SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET` | 生产模式必填，缺失会拒绝启动；`init-env.ts` 会生成 |
| `POSTGRES_PASSWORD`、`DATABASE_URL` | 本机模式用；`DATABASE_URL` 要与容器密码一致 |
| `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` | 模型网关；没有 key 时模型调用会失败/降级 |
| `TAVILY_API_KEY` | 搜索提供商；没有它时任务有真实 RSS/网页信源就只读信源，没有信源才用 fixtures 演示 |
| `EGRESS_PROXY_URL` | 海外 RSS/网页抓不到时的出口代理（`.cn`/`.local`/私有地址仍直连） |
| `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` | 引擎采集与模型调用的总开关；`MODEL_CALLS_ENABLED` 同时决定工作台定时研究是否启用 |
| `PRIVATE_SITE`、`BIND_ADDR`、`PORT` | 全站私有默认开；网页绑定地址与端口（默认 127.0.0.1:3000） |

## 运维

- 状态/日志/停止：`./status.sh`、`./logs.sh`、`./stop.sh`（`--with-db` 连数据库容器一起停）。
- 私有边界：`bash deploy/mac/verify-private.sh`（匿名必须全部被挡，登录后页面/出口/MCP 才可用）。
- 备份：`bash deploy/mac/backup.sh`（PostgreSQL + data 卷 + 配置版本）；隔离恢复：`bash deploy/mac/restore.sh --dump …`。
- 升级：`git pull` → `npm ci` → `./start.sh`（自动应用新迁移）；Docker 部署用 `bash deploy/mac/start-mac.sh`。
- Mac 睡眠/关机期间定时研究不会跑；醒来后下一轮扫描补跑一次并记录覆盖缺口。详见 [mac.md](mac.md)。

## 开发

```bash
npm run typecheck
DATABASE_URL=postgres://aihot:<POSTGRES_PASSWORD>@127.0.0.1:5432/aihot_test npm test
npm run build -w @aihot/web && npm run test:web
node scripts/check-migrations.ts --base origin/main
```

- 后端没有构建步骤：Node 24 直接跑 TypeScript。
- 模块的入口：`modules/research-workspace/{contracts,module,server,web}.ts`；页面在 `web/`，研究流程在 `research/`，外部能力在 `providers/`。
- 迁移规则见 `AGENTS.md` 和 `docs/architecture.md#数据库迁移`：从 `0055` 起一个文件一条在线语句，索引用 `CONCURRENTLY IF NOT EXISTS`，不改历史文件。
- 改站点配置看 `site/`；改行业知识/信源看 `industry/`。

## 文档索引

- 进度、测试证据、已知限制：[baseline.md](baseline.md)
- Mac 运行手册（Docker、备份恢复、睡眠限制）：[mac.md](mac.md)
- 接口、数据表与事件：[api.md](api.md)
- 信源与材料怎么接进来：[sources.md](sources.md)
- 部署方式对比：[../../deploy/README.md](../../deploy/README.md)
- 引擎架构、模块、迁移约定：[../architecture.md](../architecture.md)
- 本 fork 与上游的关系：[../../README.md](../../README.md)

## 还没确认 / 已知限制

- 站名“长期调研工作台”是工作标题；`industry/` 里的行业文案还是上游 AI 示例，等用户确认后再换。
- 没有 Tavily 凭证时搜索不联网；真实研究只靠任务的 RSS/网页信源，或 fixtures 演示数据。
- 外部通知（飞书等）没接；材料版本事件到任务的匹配策略仍待定；人工锁定是整条锁定（没有字段级）。
- 本机模式依赖 Docker 只跑 PostgreSQL；重启机器后要手动 `./start.sh`（开机自启没配）。
