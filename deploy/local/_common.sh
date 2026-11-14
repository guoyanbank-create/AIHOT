#!/bin/bash
# 本机运行（不用 Docker 跑应用，只把 PostgreSQL 放在 Docker 里）的共用设置。
# 所有路径都在仓库内：配置读 .env，进程号和日志放 .run/，不写仓库外面。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${ROOT}/.env"
RUN_DIR="${ROOT}/.run"
LOG_DIR="${RUN_DIR}/logs"
PID_DIR="${RUN_DIR}/pids"
DB_CONTAINER="${DB_CONTAINER:-aihot-db}"
DB_VOLUME="${DB_VOLUME:-aihot-db-data}"
PORT="${PORT:-3000}"
API_PORT="${API_PORT:-3001}"

say() { printf '%s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
warn() { printf '! %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

env_value() {
  [ -f "${ENV_FILE}" ] || return 1
  grep -E "^$1=" "${ENV_FILE}" | tail -1 | cut -d= -f2-
}

need_env() {
  local name="$1"
  local value
  value="$(env_value "${name}" || true)"
  [ -n "${value:-}" ] || fail "缺少 ${name}：先运行 node scripts/init-env.ts --llm-key <模型 Key>，或按 .env.example 填写"
  printf '%s' "${value}"
}

have() { command -v "$1" >/dev/null 2>&1; }

node_version_ok() {
  have node || return 1
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "${major}" -ge 24 ]
}

pid_alive() {
  local pid="$1"
  [ -n "${pid:-}" ] && kill -0 "${pid}" 2>/dev/null
}

read_pid() {
  local name="$1"
  [ -f "${PID_DIR}/${name}.pid" ] && cat "${PID_DIR}/${name}.pid" || true
}

port_pid() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true
}

kill_port() {
  local port="$1"
  local pid
  pid="$(port_pid "${port}")"
  [ -n "${pid}" ] && kill "${pid}" 2>/dev/null || true
}

wait_http() {
  local url="$1"
  local tries="${2:-40}"
  for _ in $(seq 1 "${tries}"); do
    curl -fsS -o /dev/null --max-time 2 "${url}" 2>/dev/null && return 0
    sleep 0.5
  done
  return 1
}

ensure_db() {
  have docker || fail "需要 Docker（只用来跑 PostgreSQL；应用本身在本机 Node 里跑）"
  docker info >/dev/null 2>&1 || fail "Docker 没在运行：先打开 Docker Desktop 或 colima start"
  local password
  password="$(need_env POSTGRES_PASSWORD)"
  if ! docker ps -a --format '{{.Names}}' | grep -qx "${DB_CONTAINER}"; then
    say "== 创建 PostgreSQL 容器 ${DB_CONTAINER}（数据卷 ${DB_VOLUME}） =="
    docker run -d --name "${DB_CONTAINER}" \
      -e POSTGRES_USER=aihot -e POSTGRES_PASSWORD="${password}" -e POSTGRES_DB=aihot \
      -p 127.0.0.1:5432:5432 -v "${DB_VOLUME}:/var/lib/postgresql/data" \
      postgres:17-alpine >/dev/null
  elif [ "$(docker inspect -f '{{.State.Running}}' "${DB_CONTAINER}" 2>/dev/null)" != "true" ]; then
    docker start "${DB_CONTAINER}" >/dev/null
  fi
  for _ in $(seq 1 40); do
    docker exec "${DB_CONTAINER}" pg_isready -U aihot >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  fail "PostgreSQL 没起来：docker logs ${DB_CONTAINER}"
}
