#!/bin/bash
# 开发模式：PostgreSQL 容器 + 迁移，然后同时跑 api/worker/web 的 dev（改代码自动重启）。
#   ./dev.sh            # 前台运行，Ctrl-C 停
# 生产/日常运行用 ./start.sh，不要用这个。
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

node_version_ok || fail "需要 Node.js 24+"
[ -d "${ROOT}/node_modules" ] || fail "依赖没装：在 ${ROOT} 执行 npm ci"
[ -f "${ENV_FILE}" ] || fail "没有 .env：先执行 node scripts/init-env.ts --llm-key <模型 Key>"
ensure_db >/dev/null
ok "PostgreSQL 就绪（${DB_CONTAINER}）"
( cd "${ROOT}" && node --env-file=.env scripts/migrate.ts >/dev/null ) || fail "迁移失败"
ok "迁移完成"

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

pids=()
cleanup() {
  say ""
  say "停止 dev 进程…"
  for pid in "${pids[@]}"; do kill "${pid}" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

( cd "${ROOT}" && npm run dev:api ) & pids+=($!)
( cd "${ROOT}" && npm run dev:worker ) & pids+=($!)
( cd "${ROOT}" && npm run dev:web ) & pids+=($!)
say "开发模式：web http://127.0.0.1:${PORT}（api ${API_PORT}）；Ctrl-C 退出"
wait
