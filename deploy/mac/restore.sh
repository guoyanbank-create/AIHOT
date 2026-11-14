#!/bin/bash
# 隔离恢复：把备份恢复到一个新的数据库和新数据卷，不碰正在用的库和卷；核对行数后再决定是否切换。
#   bash deploy/mac/restore.sh --dump backups/20261114-233000/db.dump [--data backups/…/data.tgz] [--name aihot_restore_20261114]
# 恢复出来的库名必须以 aihot_restore_ 开头（防止误连生产库）；不删除任何现有数据。
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

dump=""; data=""; name=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dump) dump="${2:-}"; shift 2 ;;
    --data) data="${2:-}"; shift 2 ;;
    --name) name="${2:-}"; shift 2 ;;
    *) fail "未知参数：$1" ;;
  esac
done
[ -n "${dump}" ] || fail "要指定 --dump <备份的 db.dump>"
[ -f "${dump}" ] || fail "找不到备份文件：${dump}"
name="${name:-aihot_restore_$(date +%Y%m%d-%H%M%S)}"
case "${name}" in
  aihot_restore_*) ;;
  *) fail "恢复库名必须以 aihot_restore_ 开头（当前：${name}）" ;;
esac
[[ "${name}" =~ ^[a-z0-9_]+$ ]] || fail "恢复库名只能用小写字母、数字和下划线"

say "== 恢复到隔离库 ${name}（生产库不动） =="
compose exec -T db psql -U aihot -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${name}" >/dev/null \
  || fail "创建隔离库失败（可能已存在）：${name}"
compose exec -T db pg_restore -U aihot -d "${name}" --no-owner --exit-on-error < "${dump}" \
  || fail "pg_restore 失败：隔离库 ${name} 保留着，可删掉重试（DROP DATABASE ${name}）"
ok "数据库已恢复到 ${name}"

if [ -n "${data}" ]; then
  [ -f "${data}" ] || fail "找不到 data 备份：${data}"
  volume="${name}_data"
  docker volume create "${volume}" >/dev/null || fail "创建隔离数据卷失败：${volume}"
  docker run --rm -v "${volume}":/data -v "$(cd "$(dirname "${data}")" && pwd)":/backup postgres:17-alpine \
    tar -xzf "/backup/$(basename "${data}")" -C /data >/dev/null || fail "解压 data 备份失败：${volume}（卷保留着）"
  ok "data 卷已恢复到 ${volume}（未挂给任何服务）"
else
  warn "没有 --data：只恢复了数据库，data 卷没有恢复"
fi

say "== 核对 =="
compose exec -T db psql -U aihot -d "${name}" -Atc "select 'tasks='||count(*) from research_tasks; select 'sources='||count(*) from sources; select 'ledger='||count(*) from research_ledger_entries;" \
  | sed 's/^/  /'
say ""
ok "隔离恢复完成（数据库 ${name}）。确认数据没问题后，再按 docs/research-workspace/mac.md 的步骤切换。"
say "  核对完可以删：docker compose exec -T db psql -U aihot -d postgres -c 'DROP DATABASE ${name}'"
