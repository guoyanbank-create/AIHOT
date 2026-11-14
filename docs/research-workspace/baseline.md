# 长期调研工作台：基线与 T01～T04 记录

需求与阶段总纲见 `guoyanbank-create/AIHOT` Issue #1（《实现长期调研与动态台账工作台（AIHOT Fork）》）。本文件记录开工前核实过的事实、T01～T04 的落点和这一阶段的真实执行结果；后续阶段继续在这里补记录。

## 1. 开工前核实的事实（T01）

以下都是在仓库里实际读到的，不是从文档摘要里猜的。

### 仓库与运行环境

| 项 | 核实结果 |
|---|---|
| 起点 | 分支 `agent/research-workspace-c858da60102e`，`git rev-parse HEAD` = `11da55cca2ee7b21d37ed432efe9362cce3b7b05`（与 `origin/main` 相同），工作树干净 |
| 上游 | `guoyanbank-create/AIHOT` 是 `KKKKhazix/AIHOT` 的 fork（`isFork: true`）；`main` 带着上游“同步引擎”的提交，同步时直接合并，所以框架代码尽量少改 |
| Node | `package.json` 的 engines 要求 `>=24.22.1`；Dockerfile 用 `node:24-trixie-slim`，CI 用 `node-version: 24` |
| 本机 Node | 机器上原来只有 `node v24.21.0`（且没有 npm）；验证时下载了官方 Node v24.22.1（自带 npm 11.19.1）到 `~/.local/node-v24.22.1-darwin-arm64/`，没有改仓库或系统 Node |
| PostgreSQL | Docker Compose 用 `postgres:17-alpine`；本机验证用同镜像起了一个测试库（`aihot_test`），测试会按 `_test` 后缀建自己的副本 |
| Docker | 可用（colima）；本机没有直接装 PostgreSQL |

### 数据库迁移约定

- 引擎迁移在 `database/migrations/`，模块自己的表放模块的 `migrations/`（本仓库现有 75 个文件，到 `0127_…`）。两处合起来按**完整文件名**排序执行并记账（`scripts/migrate.ts`）。
- 从 `0055` 起每个文件只允许**一条**语句；允许的语句种类由 `scripts/migration-safety.ts` 的在线迁移词表决定：新建表、常量默认值的加列、`NOT VALID` 约束后单独验证、`CREATE INDEX CONCURRENTLY IF NOT EXISTS`、列 MCV 统计和指定列 `ANALYZE`、`DROP TABLE/COLUMN/CONSTRAINT IF EXISTS`；数据回填不进发布迁移。
- PR 会跑 `scripts/check-migrations.ts --base <base>` 检查新增迁移没有改写已发布的文件、没有整表重写或阻塞索引。

### 模块插口（`docs/architecture.md#模块` 与代码一致）

- 一个模块 = `modules/<名字>/` 一个 npm 包（`@aihot/<名字>`），带 `module.ts`（地址：页面、跳转、`apiPaths`）、`server.ts`（后端插口）、`web.tsx`（网页插口）、`migrations/`、`tests/`。
- 注册要动五处：`site/modules/index.ts`、`site/modules/server.ts`、`site/modules/web.ts`、`site/package.json` 的 `dependencies`、Dockerfile 的 `COPY modules/<名字>/package.json`（让 `npm ci` 认出 workspace）。根 `package.json` 的 workspaces 已包含 `modules/*`。
- 模块迁移会被 `scripts/migrate.ts` 自动发现；`npm test` 的 glob 含 `modules/*/tests/*.test.ts`；`npm run typecheck` 里有 `tsc -p modules`。
- 后端插口由 `packages/backend/src/modules.ts` 的 `installModules()` 安装（`apps/api`、`apps/worker` 启动时装 `site/modules/server.ts`）；现有钩子里和材料有关的是 `articleChanged`。
- 网页页面从 `MODULES` 生成路由；`ModulePage.gray` + `grayGet` + `GRAY_HEADERS` 是“未公开页面只给登录管理员”的既有做法。
- `tests/architecture.test.ts` 检查模块边界（模块之间不互相 import、公开路由只经 `publication/`、表归各自模块写、迁移列都被代码用到等），新增模块会一起被检查。

### 材料入库与事件（审计结论）

- 所有渠道的材料都从 `packages/backend/src/content/materials.ts` 的 `upsertMaterial()` 进入（调用方：`sources/collect.ts`、`sources/mp.ts`、`ingest/items.ts`）；它负责身份、版本（`article_revisions`）、时间线和“公共投影”更新，是唯一的入库口。
- **`articleChanged` 不够用**：它只在公开投影变化时发（`publication/publish.ts`、`admin/content.ts`、`content/provenance.ts`、`content/materials.ts` 的修订路径等），没有进入新闻精选的材料（没热度、没被选中的官方公告）不会触发它。任务支路不能靠它。
- 核实结果：最初 **没有** 材料版本提交事件，也没有事务 outbox。按 Issue #1 第二节“最小增加材料版本提交事件和事务 outbox”处理：新增引擎钩子 `materialCommitted`（`packages/backend/src/modules.ts`），在 `content/materials.ts` 的新材料入库和新修订两处、于写入的同一个事务里发出；模块在 `on.materialCommitted` 里写自己的 `research_outbox`（见 `modules/research-workspace/`）。

### 鉴权与现有的对外出口

- 后台登录：管理员密码（`ADMIN_PASSWORD`）或飞书 OAuth；会话是不透明 token，cookie 名 `aihot_admin`；所有 `/api/admin/*` 走 `adminHandler()`（未登录 401，写操作还要 CSRF）。
- **开工前没有全站鉴权**：`/`、`/all`、`/daily` 等页面、`/api/site/*`、`/api/v1/*`、RSS、MCP、`/llms.txt`、站点地图、分享图、图片代理和导出都是匿名可读；网页进程 SSR 直接读 api，api 默认只监听 `127.0.0.1`（Docker 里监听容器网络、不发布端口）。
- 因此 Issue #1 的 P0“全站私有”不是改一个开关，而是在网页进程入口加一道会话网关（T02，见下）。

### 付费与外部服务

- 模型、X、公众号、Jina 的调用都走 `providers/` 的回执（`receipts.ts`）和预算熔断；本阶段没有调用任何模型或付费服务。
- **没有搜索提供商**：`packages/backend/src/providers/` 里没有 Tavily 或任何 SearchProvider。主动研究阶段要新增 `SearchProvider`（默认 Tavily）和它的费用记账；本阶段只留了位置和未完成项，没有伪造联网结果。

## 2. T01～T04 的落点

Issue #1 第七节只写了分组顺序（“基线与私有边界→模块/契约/迁移→任务/信源/台账闭环→主动研究→定时与费用→M4 部署及恢复”），仓库里没有 T01～T18 的逐条清单。按这个顺序，本阶段把 T01～T04 定为：

| 任务 | 内容 | 落在哪 |
|---|---|---|
| T01 | 基线审计：环境、迁移与模块约定、材料入库接口、现有测试状态、未确认项 | 本文件第 1 节；测试结果见第 3 节 |
| T02 | P0 私有边界：全站默认私有、只映射 `127.0.0.1`、共享缓存与搜索引擎不留存、私有 smoke 检查，原有的整站检查在私有站上自动改查私有边界 | `site/site.ts` 的 `PRIVATE_SITE`、`apps/web/app/lib/private.server.ts`、`apps/web/server.ts`、`apps/web/vite.config.ts`、`docker-compose.yml`、`scripts/{site-check,verify-private,smoke,mcp-check}.ts`、`.env.example`、`docs/deploy.md` |
| T03 | 模块骨架：`modules/research-workspace/` 建起来并在三份清单、依赖和 Dockerfile 里注册 | `modules/research-workspace/{package.json,module.ts,server.ts,web.tsx}`、`site/modules/*`、`site/package.json`、`Dockerfile` |
| T04 | 契约与迁移：任务/信源/运行/台账/证据/阅读状态/outbox/任务报告八张表、数据层、材料版本提交事件与事务 outbox、测试 | `modules/research-workspace/{contracts.ts,tasks.ts,runs.ts,ledger.ts,reports.ts,outbox.ts,material-events.ts,migrations/,tests/}`、`packages/backend/src/modules.ts`、`packages/backend/src/content/materials.ts` |

T01～T04 之外、本阶段**没有做**的部分（留给后续阶段，见第 4 节）：五个主菜单和任务四步创建界面、SearchProvider 与主动研究、定时与费用、Mac 部署脚本（`doctor-mac.sh` 等）。

## 3. 实际执行的检查与结果

命令都在仓库根目录、本机 Node v24.22.1 + 本地 `postgres:17-alpine` 上实际跑过。测试库名以 `_test` 结尾，不碰任何部署库。

```bash
npm run typecheck
DATABASE_URL=postgres://postgres:test@127.0.0.1:5432/aihot_test npm test
npm run build -w @aihot/web && npm run test:web
node scripts/verify-private.ts --base http://127.0.0.1:3000 --password '<ADMIN_PASSWORD>'   # 起好 api+web 后
```

基线（改动前，HEAD `11da55c`，另一个 git worktree 里跑）与改动后各跑一遍：

| 检查 | 基线 `11da55c` | 改动后 |
|---|---|---|
| `npm run typecheck` | 通过 | 通过 |
| 后端测试 `npm test` | 1141 个：1128 通过，13 个失败 | 1150 个（多 9 个模块测试）：1137 通过，13 个失败 |
| `npm run build -w @aihot/web` | 通过 | 通过 |
| `npm run test:web` | 本机装不上 Playwright 浏览器，未跑完（CI 跑） | 65 个全部通过（含新的私有网关测试） |
| `scripts/check-migrations.ts --base origin/main` | — | 通过（新增模块迁移符合在线迁移约定） |
| CI 原有的 `scripts/smoke.ts` / `scripts/mcp-check.ts`（公开站检查） | — | 私有站自动切到匿名边界检查（匿名 smoke 不再要求 200），MCP 匿名被 401 挡下算通过；公开模式下两者行为不变 |
| `scripts/verify-private.ts` | — | 全部通过：匿名 17 项全部被挡（页面 302 到登录、机器出口和接口 401），登录后 15 个页面、9 个出口、MCP initialize 全部可用且响应为 `private, no-store` |
| `docker compose build && up -d` + 容器内验证 | — | 见阶段末报告 |

13 个失败全部在 `tests/backup.test.ts`：备份测试要真实的 `pg_dump`（和 GNU `tar`），本机没有装 PostgreSQL 客户端。CI 会先装 `postgresql-client-17` 再跑这组测试，这两个环境之间没有其它差异。

改动前后的界面证据（同一视口 1366×768、浅色主题）在 `evidence/`：基线匿名打开首页（公开站）、改动后匿名被送到登录页、改动后登录后首页照常可用。基线是 `11da55c`，改动后的提交哈希见 PR。

另外单独验证过：新增的模块测试 9 个（迁移后的表、任务与信源、台账版本与引用、运行、报告、outbox、材料事件和事务回滚）全部通过；`scripts/verify-private.ts` 在起好的 api+web 上全部通过。

## 4. 未确认项与已知限制

1. **T01～T18 的逐条定义不在仓库里**。本阶段按 Issue #1 第七节的分组顺序解释 T01～T04（第 2 节的表）。如果用户的方案里 T04 是别的内容，告诉我调整，不要把这里的解释当成需求变更。
2. **站名是工作标题**：“长期调研工作台”来自 Issue #1，等使用者确认；`site/site.ts` 里其它示范行业文案（description、tagline、主题页标题等）还是上游 AI 行业的，等主界面阶段换。
3. **SearchProvider 还没有**：主动研究阶段要接 Tavily（或使用者指定的提供商），并把搜索费用接进回执和预算；没有凭证时用清楚标识的本地 fixtures，不假装联网。
4. **本阶段没有调用任何付费 API**。仓库里没有可用的搜索凭证；模型网关凭证由编排方另行提供，按 Issue #1 第七节“需要真实联调时先列明调用数量和预算，获准后测试”，这一阶段不做真实调用。
5. **MCP、RSS、公开 API 现在是“登录后可读”**，不是给外部 Agent 的正式入口；Issue #1 允许“鉴权或关闭”，后续阶段再决定给 Agent 的授权方式（例如单独的访问令牌），不复用这些公开出口。
6. **公开 OpenAPI 里的 `links.aihot` 字段名**是引擎的公开契约，不随品牌改名；这些出口现在只给登录后的本人，后续若删除公开 API 再一起处理。
7. **Mac 部署脚本**（`doctor-mac.sh`、`start-mac.sh`、`stop.sh`、`backup.sh`、`restore.sh`、`verify-private.sh`）属于部署阶段；本阶段先提供了 `scripts/verify-private.ts`（部署后就能跑），`.sh` 包装和体检、备份恢复在部署阶段补。
8. **Mac 休眠/关机期间不运行**：定时研究依赖 worker 常驻；这一阶段没有做补偿调度。实际行为要在部署阶段用“合并补跑 + 显示覆盖缺口”的方式说明，不承诺绝不漏数。
