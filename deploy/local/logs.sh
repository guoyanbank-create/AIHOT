#!/bin/bash
# 跟踪日志：./logs.sh [api|worker|web]，默认 api。
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
name="${1:-api}"
case "${name}" in api|worker|web) ;; *) fail "只看 api / worker / web 的日志" ;; esac
file="${LOG_DIR}/${name}.log"
[ -f "${file}" ] || fail "还没有 ${file}（先 ./start.sh）"
tail -n 100 -f "${file}"
