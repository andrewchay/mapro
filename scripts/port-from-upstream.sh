#!/bin/bash
# 从 upstream (proma-mit) 移植文件的 codemod 脚本。
#
# 用法：
#   scripts/port-from-upstream.sh <upstream相对路径> [目标相对路径]
#   scripts/port-from-upstream.sh --batch <清单位文件>
#
# 行为：
#   1. git show upstream/main:<路径> 取文件内容
#   2. 机械重写 @proma/ → @ma-proma/（workspace 包名）
#   3. 重写 proma-mit 配置目录字面量 → mapro（兜底，正常应走 config-paths.ts）
#   4. 写入目标路径（默认与 upstream 相同），目标已存在时先备份到 /tmp
#
# 注意：重写后必须人工 review diff 并跑 typecheck。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

port_one() {
  local src="$1"
  local dst="${2:-$1}"

  if ! git cat-file -e "upstream/main:$src" 2>/dev/null; then
    echo "✗ upstream 不存在: $src" >&2
    return 1
  fi

  if [[ -f "$dst" ]]; then
    cp "$dst" "/tmp/port-backup-$(echo "$dst" | tr '/' '_')"
    echo "  (已备份现有 $dst 到 /tmp)"
  fi

  mkdir -p "$(dirname "$dst")"
  # 重命名规则（顺序敏感）：
  #   @proma/ → @ma-proma/  workspace 包名
  #   PROMA_  → MAPRO_      常量前缀
  #   Proma   → MAPro       类型/类名前缀
  #   'proma_event' → 'mapro_event'  payload kind
  #   proma:// → mapro://   DeepLink 协议
  #   .proma-mit → .mapro   配置目录字面量（兜底）
  # 注意保留 'proma' runtime 字面量不改。
  git show "upstream/main:$src" \
    | sed -e 's|@proma/|@ma-proma/|g' \
          -e 's/PROMA_/MAPRO_/g' \
          -e 's/Proma/MAPro/g' \
          -e "s/'proma_event'/'mapro_event'/g" \
          -e 's|proma://|mapro://|g' \
          -e 's|\.proma-mit-dev|.mapro-dev|g' \
          -e 's|\.proma-mit|.mapro|g' \
    > "$dst"
  echo "✓ $src → $dst"
}

if [[ "${1:-}" == "--batch" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" =~ ^# ]] && continue
    port_one $line
  done < "$2"
else
  port_one "$@"
fi
