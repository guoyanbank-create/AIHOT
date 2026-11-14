#!/bin/bash
# 开发模式（改代码自动重启）。等价于 bash deploy/local/dev.sh。
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/local/dev.sh" "$@"
