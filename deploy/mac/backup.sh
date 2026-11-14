#!/bin/bash
# 备份：PostgreSQL、data 卷和配置版本。写到 backups/<时间戳>/，不删除用户数据。
#   bash deploy/mac/backup.sh
# 备份里含 .env（有密钥），目录权限会设成 700/600；不要提交、不要发到公开地方。
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

stamp="$(date +%Y%m%d-%H%M%S)"
dir="${BACKUP_DIR}/${stamp}"
mkdir -p "${dir}"
chmod 700 "${BACKUP_DIR}" "${dir}"

say "== PostgreSQL =="
compose exec -T db pg_dump -U aihot -d aihot --format=custom --no-owner --compress=6 > "${dir}/db.dump" \
  || fail "pg_dump 失败：db 容器在运行吗？"
chmod 600 "${dir}/db.dump"
ok "数据库：${dir}/db.dump"

say "== data 卷 =="
# 用已有的 postgres 镜像里的 tar，不额外拉镜像；挂载只读数据卷和备份目录。
compose exec -T db sh -c 'true' >/dev/null
project="$(compose config --format json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || true)"
data_volume=""
if [ -n "${project:-}" ]; then
  data_volume="$(docker volume ls -q --filter "label=com.docker.compose.project=${project}" --filter "label=com.docker.compose.volume=data" | head -1)"
fi
if [ -z "${data_volume:-}" ]; then
  data_volume="$(compose config --format json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('volumes',{}).get('data',{}).get('name',''))" 2>/dev/null || true)"
fi
if [ -n "${data_volume:-}" ]; then
  docker run --rm -v "${data_volume}":/data:ro -v "${dir}":/backup postgres:17-alpine tar -czf /backup/data.tgz -C /data . >/dev/null \
    || fail "data 卷备份失败（数据卷没有删除）"
  chmod 600 "${dir}/data.tgz"
  ok "data 卷：${dir}/data.tgz"
else
  warn "拿不到 data 卷名（compose config 不可用？）：跳过 data 卷备份，只备份了数据库和配置"
fi

say "== 配置版本 =="
git -C "${ROOT}" rev-parse HEAD > "${dir}/git-head.txt" 2>/dev/null || echo "not-a-git-checkout" > "${dir}/git-head.txt"
ls database/migrations modules/*/migrations >/dev/null 2>&1 || true
{ find database/migrations modules/*/migrations -name '*.sql' 2>/dev/null | sort; } > "${dir}/migrations.txt"
[ -f "${ENV_FILE}" ] && install -m 600 "${ENV_FILE}" "${dir}/env.backup" && warn ".env 已备份到 ${dir}/env.backup（含密钥，勿外传）"
ok "配置版本：${dir}/git-head.txt、${dir}/migrations.txt"

cat > "${dir}/manifest.json" <<JSON
{"createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","gitHead":"$(cat "${dir}/git-head.txt")","port":${PORT},"postgres":"17","files":["db.dump","data.tgz","git-head.txt","migrations.txt","env.backup"]}
JSON
ok "备份完成：${dir}"
