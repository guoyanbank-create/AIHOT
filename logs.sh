#!/bin/bash
# 跟踪本机日志：./logs.sh api|worker|web。等价于 bash deploy/local/logs.sh。
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/local/logs.sh" "$@"
