# M4 Mac 运行手册

首发部署在 Apple M4 Mac（arm64），用 Docker Compose。页面默认只绑 `127.0.0.1`，全站私有；api、数据库不发布端口。

## 第一次启动

```bash
git clone https://github.com/guoyanbank-create/AIHOT.git
cd AIHOT
bash deploy/mac/doctor-mac.sh                 # 架构 / Docker / 磁盘 / 端口 / 配置体检；只读
node scripts/init-env.ts --llm-key <模型 API Key>   # 生成 .env（随机密钥和管理员密码，密码只打印一次）
bash deploy/mac/start-mac.sh                  # 构建、迁移、启动、私有边界检查
```

打开 `http://127.0.0.1:3000/admin/login` 用管理员密码登录；主界面是五个菜单（今日 / 任务 / 台账 / 信源 / 设置）。
第一次构建要拉镜像和 npm 依赖，通常几分钟到十几分钟。构建或启动失败时脚本会保留容器和数据卷并打印日志，不会删数据。

可选：在 `.env` 里填 `TAVILY_API_KEY` 后主动研究才会联网搜索；不填时用明确标识的本地 fixtures（设置页显示“未配置”）。
模型网关用 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`。

## 日常

```bash
bash deploy/mac/verify-private.sh     # 匿名拿不到任何页面/出口；登录后页面、RSS、MCP 等可用
bash deploy/mac/backup.sh             # PostgreSQL + data 卷 + 配置版本，写到 backups/<时间戳>/
bash deploy/mac/stop.sh               # 停止，保留数据卷；--down 连容器一起删（卷仍保留）
bash deploy/mac/start-mac.sh --skip-doctor
```

备份目录里含 `.env`（有密钥），脚本会把目录设成 700，不要提交或外传。

## 隔离恢复

```bash
bash deploy/mac/restore.sh --dump backups/20261114-233000/db.dump [--data backups/20261114-233000/data.tgz] --name aihot_restore_20261114
```

恢复只写到一个新的 `aihot_restore_*` 数据库和一个新的 `<name>_data` 数据卷，不动正在用的库和卷；脚本会打印核对行数，核对完再由你决定是否切换（切换属于人工操作，脚本不做）。

## Mac 睡眠 / 关机期间

- 定时研究（每天按任务节奏）和 08:10 摘要依赖 worker 常驻；**Mac 睡眠或关机期间不会运行**。醒来后下一次扫描（每 5 分钟）会把漏掉的最近一个时段补跑一次，运行记录里带覆盖区间和缺口（读不到原文、被拒绝的条目等），页面上如实显示。这个模型无法承诺“绝不漏数”。
- 想让研究按时跑，需要 Mac 不休眠（例如接电源并允许“唤醒以供网络访问”），或把同一套 Docker Compose 部署到常开的服务器。
- 备份不会自动删除旧目录；磁盘紧张时自己清理 `backups/`。

## 安全边界

- 页面端口默认 `127.0.0.1`；确实要从别的机器访问时设 `BIND_ADDR=0.0.0.0`（登录检查照旧生效）。api、worker、db 不发布端口。
- 从别的机器访问且要 HTTPS 时用 `docker compose --profile https`（Caddy），见 `docs/deploy.md`。
- 系统里出现“私有边界检查不通过”（`verify-private.sh` 的 ✗）时先不要对外，按提示修。
