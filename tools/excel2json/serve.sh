#!/usr/bin/env bash
# 构建并起一个局域网可访问的 demo 服务
#   ./serve.sh [端口]     默认 8899
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8899}"
node ../../web/node_modules/esbuild/bin/esbuild src/browser.ts \
  --bundle --format=iife --minify --target=es2020 --outfile=web/app.js
cp -f sample-timetable.xlsx web/
[ -f real-timetable.xls ] && cp -f real-timetable.xls web/
echo "→ http://$(ip -4 addr 2>/dev/null | grep -oP 'inet \K192\.168\.[0-9.]+' | head -1):${PORT}/"
exec node scripts/serve.mjs "$PORT"
