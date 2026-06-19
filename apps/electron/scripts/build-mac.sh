#!/bin/bash
#
# MAPro macOS 自动编译脚本
# 一键编译 main + preload + renderer + 打包
#

set -e

echo "🚀 MAPro macOS 自动编译开始"
echo "=============================="

cd /Users/chaihao/LLM/ma-proma/apps/electron

# 获取版本号
VERSION=$(node -p "require('./package.json').version")
echo "📌 当前版本: $VERSION"

# 1. 编译主进程
echo ""
echo "📦 [1/5] 编译主进程..."
node node_modules/esbuild/bin/esbuild src/main/index.ts \
  --bundle --platform=node --format=cjs \
  --outfile=dist/main.cjs \
  --external:electron \
  --external:@anthropic-ai/claude-agent-sdk \
  --external:bun:sqlite \
  --external:better-sqlite3

# 2. 编译 preload
echo ""
echo "📦 [2/5] 编译 preload..."
node node_modules/esbuild/bin/esbuild src/preload/index.ts \
  --bundle --platform=node --format=cjs \
  --outfile=dist/preload.cjs \
  --external:electron

# 3. 编译前端
echo ""
echo "📦 [3/5] 编译前端（Vite）..."
node node_modules/vite/bin/vite.js build

# 4. 复制资源
echo ""
echo "📦 [4/5] 复制资源文件..."
cp -r resources dist/ 2>/dev/null || true

# 5. 打包 macOS 应用
echo ""
echo "📦 [5/5] 打包 macOS App..."
node node_modules/electron-builder/cli.js \
  --mac \
  --arm64 \
  --config=electron-builder.yml

# 输出结果
echo ""
echo "✅ 编译完成！"
echo "=============================="
echo ""
echo "📦 输出产物:"
echo ""

ZIP_PATH="out/MAPro-${VERSION}-arm64-mac.zip"
APP_PATH="out/mac-arm64/MAPro.app"

if [ -f "$ZIP_PATH" ]; then
  echo "   📦 ZIP: $ZIP_PATH"
  echo "      大小: $(du -h $ZIP_PATH | cut -f1)"
fi

if [ -d "$APP_PATH" ]; then
  echo "   📱 App: $APP_PATH"
  echo ""
  echo "🚀 直接运行:"
  echo "   open \"$APP_PATH\""
fi

echo ""
echo "⚠️  首次运行可能需要右键 > 打开，以绕过 Gatekeeper"
