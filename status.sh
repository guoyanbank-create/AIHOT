#!/bin/bash
# 看本机运行状态。等价于 bash deploy/local/status.sh。
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/local/status.sh" "$@"
