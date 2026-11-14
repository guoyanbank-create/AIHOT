#!/bin/bash
# 停止服务，保留容器与数据卷（重启快、数据不丢）。要连容器一起删用 --down；数据卷始终保留。
#   bash deploy/mac/stop.sh [--down]
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
mode="stop"
case "${1:-}" in
  "") ;;
  --down) mode="down" ;;
  *) fail "未知参数：$1（支持 --down）" ;;
esac
if [ "${mode}" = "down" ]; then
  say "停止并删除容器（数据卷保留）…"
  compose down
else
  say "停止 api / worker / web（db 和 setup 不动）…"
  compose stop api worker web
fi
ok "已停止；数据卷没有删除。重新启动：bash deploy/mac/start-mac.sh"
