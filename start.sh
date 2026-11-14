#!/bin/bash
# 一键启动（本机 Node + PostgreSQL 容器，生产模式）。等价于 bash deploy/local/start.sh。
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/local/start.sh" "$@"
