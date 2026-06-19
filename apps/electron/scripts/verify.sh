#!/bin/bash
#
# MAPro 快速验证模式（模拟生产）
# 先完整 build，然后运行 Electron（不依赖 dev server）
#

set -e

cd /Users/chaihao/LLM/ma-proma/apps/electron

echo "🚀 MAPro 快速验证模式"
echo "========================"

# 1. 编译 main
echo "📦 [1/4] 编译 main..."
node node_modules/esbuild/bin/esbuild src/main/index.ts \
  --bundle --platform=node --format=cjs \
  --outfile=dist/main.cjs \
  --external:electron \
  --external:bun:sqlite \
  --external:better-sqlite3

# 2. 编译 preload
echo "📦 [2/4] 编译 preload..."
node node_modules/esbuild/bin/esbuild src/preload/index.ts \
  --bundle --platform=node --format=cjs \
  --outfile=dist/preload.cjs \
  --external:electron

# 3. 编译 renderer
echo "📦 [3/4] 编译前端（Vite）..."
node node_modules/vite/bin/vite.js build

# 4. 复制资源
echo "📦 [4/4] 复制资源..."
cp -r resources dist/ 2>/dev/null || true

echo ""
echo "✅ Build 完成！"
echo "========================"
echo ""
echo "🚀 启动 Electron（生产模式，加载本地文件）..."
echo "   退出: Ctrl+C"
echo ""

# 5. 启动 Electron（加载 dist/renderer/index.html，不依赖 dev server）
NODE_ENV=production node node_modules/electron/cli.js .
