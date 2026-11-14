#!/bin/bash
# Mac 部署脚本共用的设置：项目根目录、默认端口和取 .env 里配置的函数。
# 不删除任何数据卷；出错时保留现场并退出非零。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${ROOT}/.env"
BACKUP_DIR="${BACKUP_DIR:-${ROOT}/backups}"
PORT="${PORT:-3000}"

say() { printf '%s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
warn() { printf '! %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

env_value() {
  [ -f "${ENV_FILE}" ] || return 1
  grep -E "^$1=" "${ENV_FILE}" | tail -1 | cut -d= -f2-
}

require_env() {
  local name="$1"
  local value
  value="$(env_value "${name}" || true)"
  [ -n "${value:-}" ] || fail ".env 里没有 ${name}：先运行 node scripts/init-env.ts --llm-key <key> 或参考 .env.example 填写"
  printf '%s' "${value}"
}

compose() { ( cd "${ROOT}" && docker compose "$@" ); }

wait_for_api() {
  local tries="${1:-90}"
  for _ in $(seq 1 "${tries}"); do
    if compose exec -T api node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

http() { curl -fsS --max-time 10 "$@"; }
