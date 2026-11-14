#!/bin/bash
# 停止本机服务（数据不删）。等价于 bash deploy/local/stop.sh。
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/local/stop.sh" "$@"
