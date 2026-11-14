#!/bin/bash
# 首次构建、迁移、启动并做私有边界检查。失败时保留容器和数据卷，打印日志后退出非零。
#   bash deploy/mac/start-mac.sh [--skip-doctor] [--no-verify]
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

skip_doctor=0; verify=1
for arg in "$@"; do
  case "${arg}" in
    --skip-doctor) skip_doctor=1 ;;
    --no-verify) verify=0 ;;
    *) fail "未知参数：${arg}（支持 --skip-doctor、--no-verify）" ;;
  esac
done

[ "${skip_doctor}" = "1" ] || bash "${SCRIPT_DIR}/doctor-mac.sh"

[ -f "${ENV_FILE}" ] || fail "没有 .env：先运行 node scripts/init-env.ts --llm-key <你的模型 API Key>"
admin="$(env_value ADMIN_PASSWORD || true)"
[ -n "${admin:-}" ] || fail ".env 里没有 ADMIN_PASSWORD"
[ -f "${ROOT}/package.json" ] || fail "不在仓库根目录？找不到 package.json"

say "== 构建镜像（首次会久一些） =="
compose build || { compose logs --tail 60 2>/dev/null || true; fail "构建失败：上面有原因；没有删除任何数据卷"; }

say "== 启动（setup 先跑迁移和种子数据） =="
compose up -d || fail "启动失败：docker compose ps / logs 查看；没有删除任何数据卷"

say "== 等 api 健康检查 =="
if ! wait_for_api 90; then
  compose logs --tail 80 || true
  fail "api 没有在 3 分钟内健康；容器和数据卷都保留着，可先看日志再修"
fi
ok "api 健康"

if [ "${verify}" = "1" ]; then
  say "== 私有边界检查 =="
  bash "${SCRIPT_DIR}/verify-private.sh" || fail "私有边界检查没通过（见上面的 ✗）；站点先不要对外，按提示修"
fi

say ""
ok "工作台已启动：http://127.0.0.1:${PORT}"
say "  登录：http://127.0.0.1:${PORT}/admin/login"
say "  停止：bash deploy/mac/stop.sh    备份：bash deploy/mac/backup.sh"
say "  说明：docs/research-workspace/mac.md（含 Mac 睡眠期间不运行的说明）"
