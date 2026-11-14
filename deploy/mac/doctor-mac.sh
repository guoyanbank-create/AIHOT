#!/bin/bash
# M4 Mac 部署体检：架构、系统、Docker、磁盘、端口、配置。只读，不改文件、不删数据。
#   bash deploy/mac/doctor-mac.sh
# 退出码 0 表示可以 start；1 表示有必须处理的问题（问题在输出里逐条列出）。
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

problems=0
note() { problems=$((problems + 1)); fail_later+=("$*"); }
fail_later=()

say "== 架构与系统 =="
arch="$(uname -m)"
[ "${arch}" = "arm64" ] && ok "Apple Silicon（${arch}）" || note "不是 arm64（${arch}）：脚本按 M4 写，Intel Mac 需要另装 Docker"
if [ "$(uname -s)" = "Darwin" ]; then
  ok "macOS $(sw_vers -productVersion)"
  mem_gb=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
  [ "${mem_gb}" -ge 16 ] && ok "内存 ${mem_gb}GB" || warn "内存 ${mem_gb}GB：Docker 构建可能吃紧，建议 16GB 以上"
else
  note "不是在 macOS 上运行（$(uname -s)）"
fi

say "== Docker =="
if command -v docker >/dev/null 2>&1; then
  ok "docker $(docker --version | sed 's/^Docker version //; s/,.*//')"
  if docker info >/dev/null 2>&1; then ok "Docker daemon 在运行"; else note "Docker daemon 没在运行：先打开 Docker Desktop 或 colima start"; fi
  if docker compose version >/dev/null 2>&1; then ok "docker compose $(docker compose version --short)"; else note "没有 docker compose 插件"; fi
else
  note "没有 docker：先装 Docker Desktop for Apple Silicon"
fi

say "== 端口 =="
for port in "${PORT}" 5432 3001; do
  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    case "${port}" in
      5432|3001) warn "端口 ${port} 已被占用：Docker 里 api/db 不发布到宿主，一般无碍；确认不是别的 PostgreSQL/API 在使用" ;;
      *) note "端口 ${port} 已被占用：改 .env 的 PORT 或先停掉占用的程序" ;;
    esac
  else
    ok "端口 ${port} 空闲"
  fi
done

say "== 磁盘 =="
free_gb=$(( $(df -g "${ROOT}" | awk 'NR==2 {print $4}') ))
[ "${free_gb}" -ge 15 ] && ok "可用磁盘 ${free_gb}GB" || note "可用磁盘只有 ${free_gb}GB：镜像、备份和数据卷建议留 15GB 以上"

say "== 配置 =="
if [ -f "${ENV_FILE}" ]; then
  ok ".env 存在"
  for name in ADMIN_PASSWORD SESSION_SECRET IMG_PROXY_SIGN_SECRET POSTGRES_PASSWORD; do
    value="$(env_value "${name}" || true)"
    if [ -n "${value:-}" ]; then ok "${name} 已填写"; else note ".env 缺少 ${name}"; fi
  done
  admin="$(env_value ADMIN_PASSWORD || true)"
  if [ -n "${admin:-}" ] && [ "${#admin}" -lt 12 ]; then note "ADMIN_PASSWORD 少于 12 位"; fi
  url="$(env_value SITE_URL || true)"
  [ -n "${url:-}" ] && ok "SITE_URL=${url}" || note ".env 缺少 SITE_URL"
  llm_key="$(env_value LLM_API_KEY || true)"
  [ -n "${llm_key:-}" ] && ok "LLM_API_KEY 已填写（主动研究会调用模型）" || warn "没有 LLM_API_KEY：采集和模型调用不会真正跑，界面仍可用"
  [ -n "$(env_value TAVILY_API_KEY || true)" ] && ok "TAVILY_API_KEY 已填写（搜索会联网）" || warn "没有 TAVILY_API_KEY：主动研究使用本地 fixtures（未联网），设置页会显示未配置"
  bind="$(env_value BIND_ADDR || true)"
  [ -z "${bind:-}" ] || [ "${bind}" = "127.0.0.1" ] && ok "网页绑定在本机（BIND_ADDR 默认 127.0.0.1）" || warn "BIND_ADDR=${bind}：局域网/公网可访问，鉴权仍在，但请确认这是你要的"
else
  note "没有 .env：运行 node scripts/init-env.ts --llm-key <你的模型 API Key>（或按 .env.example 手写）"
fi

say "== 结论 =="
if [ ${#fail_later[@]} -gt 0 ]; then
  printf '  - %s\n' "${fail_later[@]}"
fi
if [ "${problems}" -gt 0 ]; then
  fail "${problems} 项需要先处理"
fi
ok "体检通过，可以 bash deploy/mac/start-mac.sh"
