/**
 * localStorage key 迁移工具
 *
 * 将旧版 `proma-*` 前缀的 localStorage key 迁移到 `mapro-*` 前缀，
 * 保证品牌统一的同时不丢失用户已保存的设置。
 *
 * 迁移逻辑：
 * 1. 检查 `mapro-ls-migrated` 标志，避免重复迁移
 * 2. 遍历所有已知的 `proma-*` key，将值复制到 `mapro-*` key
 * 3. 删除旧 key
 * 4. 设置迁移完成标志
 *
 * 必须在任何 Jotai atomWithStorage 读取之前调用（即在 ReactDOM.render 之前）。
 */

/** 旧 key → 新 key 映射表 */
const KEY_MIGRATIONS: Record<string, string> = {
  'proma-sidebar-collapsed': 'mapro-sidebar-collapsed',
  'proma-selected-system-prompt-id': 'mapro-selected-system-prompt-id',
  'proma-theme-mode': 'mapro-theme-mode',
  'proma-theme-style': 'mapro-theme-style',
  'proma-workspace-list-height': 'mapro-workspace-list-height',
  'proma-agent-sidebar-top-height': 'mapro-agent-sidebar-top-height',
  'proma-selected-model': 'mapro-selected-model',
  'proma-context-length': 'mapro-context-length',
  'proma-thinking-enabled': 'mapro-thinking-enabled',
  'proma-thinking-expanded': 'mapro-thinking-expanded',
  'proma-agent-sidepanel-open': 'mapro-agent-sidepanel-open',
  'proma-agent-sidepanel-width': 'mapro-agent-sidepanel-width',
  'proma-preview-split-ratio': 'mapro-preview-split-ratio',
  'proma-auto-preview-enabled': 'mapro-auto-preview-enabled',
  'proma-app-mode': 'mapro-app-mode',
}

const MIGRATION_FLAG = 'mapro-ls-migrated'

/**
 * 执行 localStorage key 迁移（proma-* → mapro-*）。
 * 幂等：已迁移过则直接返回。
 */
export function migratePromaKeysToMapro(): void {
  try {
    if (localStorage.getItem(MIGRATION_FLAG) === '1') return

    for (const [oldKey, newKey] of Object.entries(KEY_MIGRATIONS)) {
      const value = localStorage.getItem(oldKey)
      if (value !== null) {
        localStorage.setItem(newKey, value)
        localStorage.removeItem(oldKey)
      }
    }

    localStorage.setItem(MIGRATION_FLAG, '1')
  } catch {
    // localStorage 不可用时静默跳过，不影响应用启动
  }
}
