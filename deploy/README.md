# 部署方式怎么选

| 场景 | 用什么 | 说明 |
|---|---|---|
| 这台 Mac 上日常运行 / 试用 | `./start.sh`（`./status.sh`、`./logs.sh`、`./stop.sh`） | 应用跑在本机 Node 24，PostgreSQL 用 Docker 容器 `aihot-db` + 数据卷 `aihot-db-data`；配置读 `.env`，进程号和日志在 `.run/` |
| 开发改代码 | `./dev.sh` | 本地 PostgreSQL + 迁移，然后 api/worker/web 的 dev 模式（改代码自动重启）；Ctrl-C 退出 |
| 长期常驻 / 换机器 | `bash deploy/mac/start-mac.sh` | Docker Compose 全容器（web/api/worker/db），备份恢复脚本见 `deploy/mac/` 和 [Mac 运行手册](../docs/research-workspace/mac.md) |
| 只做检查，不启动 | `npm run typecheck`、`npm test`、`npm run test:web`、`node scripts/check-migrations.ts --base origin/main` | 见 [项目说明](../docs/research-workspace/README.md) |

三种方式都读同一份 `.env`、同一个 PostgreSQL 数据（Docker 部署用自己的容器和卷；本机模式用 `aihot-db` 容器）。不要同时用 `./start.sh` 和 `deploy/mac/start-mac.sh` 占同一个 3000 端口。

第一台机器第一次用：

```bash
npm ci
node scripts/init-env.ts --llm-key <模型 Key>   # 生成 .env（随机密钥/管理员密码，密码只打印一次）
./start.sh                                      # 需要本机有 Docker（只跑数据库）
```

备份/恢复、隔离恢复、Mac 睡眠期间不运行的限制：见 [docs/research-workspace/mac.md](../docs/research-workspace/mac.md) 和 `deploy/mac/{backup,restore}.sh`。
