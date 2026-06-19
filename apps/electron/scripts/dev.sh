#!/bin/bash
#
# MAPro 开发模式一键启动
# 同时启动 Vite dev server + Electron（热重载）
#

set -e

cd /Users/chaihao/LLM/ma-proma/apps/electron

echo "🚀 启动 MAPro 开发模式..."
echo "========================"

# 1. 编译 main + preload
echo "📦 编译 main..."
node node_modules/esbuild/bin/esbuild src/main/index.ts \
  --bundle --platform=node --format=cjs \
  --outfile=dist/main.cjs \
  --external:electron \
  --external:bun:sqlite \
  --external:better-sqlite3

echo "📦 编译 preload..."
node node_modules/esbuild/bin/esbuild src/preload/index.ts \
  --bundle --platform=node --format=cjs \
  --outfile=dist/preload.cjs \
  --external:electron

# 2. 复制资源
cp -r resources dist/ 2>/dev/null || true

echo ""
echo "🚀 启动 Vite dev server + Electron..."
echo "   - 渲染代码修改 → 自动热重载"
echo "   - 主进程修改 → 需要按 Ctrl+R 刷新"
echo ""
echo "   退出: Ctrl+C"
echo "========================"

# 3. 同时启动 Vite + Electron
node node_modules/concurrently/dist/bin/concurrently.js \
  -k -n vite,electron -c blue,green \
  "node node_modules/vite/bin/vite.js dev" \
  "node node_modules/electron/cli.js ."
