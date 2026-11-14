#!/bin/bash
# 全站私有边界检查的包装：优先用本机 node 跑 scripts/verify-private.ts；没有 node 就用 compose 的 setup 容器。
#   bash deploy/mac/verify-private.sh [--base http://127.0.0.1:3000]
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

base="http://127.0.0.1:${PORT}"
if [ "${1:-}" = "--base" ] && [ -n "${2:-}" ]; then base="$2"; fi
password="$(env_value ADMIN_PASSWORD || true)"
[ -n "${password:-}" ] || fail ".env 里没有 ADMIN_PASSWORD"

if command -v node >/dev/null 2>&1; then
  ( cd "${ROOT}" && node scripts/verify-private.ts --base "${base}" --password "${password}" )
else
  warn "本机没有 node，改用 compose 的 setup 容器（base=http://web:3000）"
  compose run --rm --no-deps --entrypoint node setup scripts/verify-private.ts --base http://web:3000
fi
