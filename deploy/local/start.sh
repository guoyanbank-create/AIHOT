#!/bin/bash
# 本机一键启动：PostgreSQL 容器 + 迁移 + api/worker/web（生产模式）。
#   ./start.sh [--build] [--no-verify] [--no-migrate]
# 进程号和日志在仓库 .run/ 下；停止用 ./stop.sh。
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

build=0; verify=1; migrate=1
for arg in "$@"; do
  case "${arg}" in
    --build) build=1 ;;
    --no-verify) verify=0 ;;
    --no-migrate) migrate=0 ;;
    *) fail "未知参数：${arg}（支持 --build、--no-verify、--no-migrate）" ;;
  esac
done

node_version_ok || fail "需要 Node.js 24+（当前版本：$(node -v 2>/dev/null || echo "未安装")）"
[ -d "${ROOT}/node_modules" ] || fail "依赖没装：在 ${ROOT} 执行 npm ci"
[ -f "${ENV_FILE}" ] || fail "没有 .env：先执行 node scripts/init-env.ts --llm-key <模型 Key>（或按 .env.example 填写）"
mkdir -p "${LOG_DIR}" "${PID_DIR}"

ensure_db
ok "PostgreSQL 就绪（${DB_CONTAINER}）"

if [ "${build}" = "1" ] || [ ! -f "${ROOT}/apps/web/build/server/index.js" ]; then
  say "== 构建网页 =="
  ( cd "${ROOT}" && npm run build -w @aihot/web >/dev/null ) || fail "网页构建失败"
  ok "网页构建完成"
fi

if [ "${migrate}" = "1" ]; then
  say "== 应用迁移 =="
  ( cd "${ROOT}" && node --env-file=.env scripts/migrate.ts ) || fail "迁移失败（数据库没动，修好再重试）"
fi

start_one() {
  local name="$1"; shift
  local old; old="$(read_pid "${name}")"
  if pid_alive "${old}"; then ok "${name} 已在运行（pid ${old}）"; return 0; fi
  nohup "$@" > "${LOG_DIR}/${name}.log" 2>&1 &
  echo $! > "${PID_DIR}/${name}.pid"
  say "启动 ${name}（pid $!）"
}

start_one api env NODE_ENV=production node --env-file=.env apps/api/src/main.ts
start_one worker env NODE_ENV=production node --env-file=.env apps/worker/src/main.ts
( cd "${ROOT}/apps/web" && nohup env NODE_ENV=production node --env-file=../../.env server.ts > "${LOG_DIR}/web.log" 2>&1 & echo $! > "${PID_DIR}/web.pid" )
say "启动 web（pid $(cat "${PID_DIR}/web.pid")）"

if ! wait_http "http://127.0.0.1:${API_PORT}/api/health" 60; then
  tail -20 "${LOG_DIR}/api.log" >&2 || true
  fail "api 没在 30 秒内健康：看 .run/logs/api.log（进程保留，可用 ./stop.sh 停）"
fi
ok "api 健康：http://127.0.0.1:${API_PORT}/api/health"
wait_http "http://127.0.0.1:${PORT}/admin/login" 40 || fail "web 没起来：看 .run/logs/web.log"

if [ "${verify}" = "1" ]; then
  say "== 私有边界检查 =="
  bash "${ROOT}/deploy/mac/verify-private.sh" || fail "私有边界检查没通过（先不要对外，按上面 ✗ 修）"
fi

say ""
ok "工作台已启动：http://127.0.0.1:${PORT}    登录：http://127.0.0.1:${PORT}/admin/login"
say "  状态：./status.sh    日志：./logs.sh    停止：./stop.sh"
