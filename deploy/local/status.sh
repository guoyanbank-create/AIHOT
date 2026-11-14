#!/bin/bash
# 一眼看本机运行状态：数据库容器、三个进程、端口、健康检查。
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
say "== 目录 =="
say "  仓库：${ROOT}"
say "  配置：${ENV_FILE}"
say "  日志：${LOG_DIR}"
say ""
say "== 数据库 =="
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "${DB_CONTAINER}"; then
  ok "容器 ${DB_CONTAINER} 在运行（卷 ${DB_VOLUME}）"
else
  warn "容器 ${DB_CONTAINER} 没在运行（docker start ${DB_CONTAINER}）"
fi
say ""
say "== 进程与端口 =="
for pair in "api:${API_PORT}" "web:${PORT}" "worker:"; do
  name="${pair%%:*}"
  port="${pair##*:}"
  pid="$(read_pid "${name}")"
  if pid_alive "${pid}"; then
    if [ -n "${port}" ]; then ok "${name} 在运行（pid ${pid}，端口 ${port}）"; else ok "${name} 在运行（pid ${pid}）"; fi
  else
    warn "${name} 没在运行"
  fi
done
say ""
say "== 健康检查 =="
if curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/api/health" 2>/dev/null; then say ""; ok "api 健康"; else warn "api 不可用"; fi
code="$(curl -s --max-time 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/admin/login" 2>/dev/null || true)"
[ "${code}" = "200" ] && ok "web 可访问：http://127.0.0.1:${PORT}" || warn "web 不可访问（HTTP ${code:-?}）"
say ""
say "  ./start.sh 启动    ./stop.sh 停止    ./logs.sh 看日志"
