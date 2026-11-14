#!/bin/bash
# 停止本机启的 api/worker/web；默认不停 PostgreSQL 容器（数据卷不动）。--with-db 连数据库容器一起停。
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
with_db=0
[ "${1:-}" = "--with-db" ] && with_db=1
[ -n "${1:-}" ] && [ "${1:-}" != "--with-db" ] && fail "未知参数：$1（支持 --with-db）"

for name in web api worker; do
  pid="$(read_pid "${name}")"
  if pid_alive "${pid}"; then
    kill "${pid}" 2>/dev/null || true
    say "停止 ${name}（pid ${pid}）"
  fi
  rm -f "${PID_DIR}/${name}.pid"
done
# pid 文件可能过期：按端口兜底。
kill_port "${PORT}"
kill_port "${API_PORT}"
if [ "${with_db}" = "1" ] && docker ps -q --filter "name=^${DB_CONTAINER}$" >/dev/null 2>&1; then
  docker stop "${DB_CONTAINER}" >/dev/null 2>&1 || true
  ok "已停止 ${DB_CONTAINER}（数据卷 ${DB_VOLUME} 保留）"
fi
ok "已停止；数据在 PostgreSQL 容器 ${DB_CONTAINER} 和数据卷 ${DB_VOLUME} 里，没有删除"
