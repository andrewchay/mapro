/**
 * Chat 工具配置服务
 *
 * 管理 {configDir}/chat-tools.json 的读写。
 * 存储工具开关状态和非记忆工具的凭据。
 */

import type { ChatToolsFileConfig, ChatToolState, ChatToolMeta } from '@ma-proma/shared'
import { getChatToolsConfigPath } from '../context/config-paths.ts'
import { readJsonFileSafe, writeJsonFileAtomic } from '../utils/safe-file.ts'
import type { AppContext } from '../context/types.ts'

/** 默认配置 */
const DEFAULT_CONFIG: ChatToolsFileConfig = {
  toolStates: {
    memory: { enabled: true },
    'agent-mode-recommend': { enabled: true },
    'web-search': { enabled: true },
    'web-scraper': { enabled: true },
    'nano-banana': { enabled: false },
    'ma-kol-data-mcp': { enabled: true },
    'ma-strategy-iq': { enabled: true },
    'ma-match-ai': { enabled: true },
    'ma-connect-bot': { enabled: true },
    'ma-creative-pilot': { enabled: true },
    'ma-kol-search': { enabled: true },
    'ma-campaign-optimizer': { enabled: true },
    'ma-script-studio': { enabled: true },
    'ma-content-audit': { enabled: true },
    'ma-campaign-tester': { enabled: true },
    'ma-campaign-agent': { enabled: true },
    'ma-kol-crm': { enabled: true },
    'ma-kol-portal': { enabled: true },
    'ma-budget-forecast': { enabled: true },
    'ma-content-tracker': { enabled: true },
    'ma-phase-reviewer': { enabled: true },
  },
  toolCredentials: {},
  customTools: [],
}

export interface ChatToolConfigServiceDeps {
  context: AppContext
}

export class ChatToolConfigService {
  private context: AppContext

  constructor(deps: ChatToolConfigServiceDeps) {
    this.context = deps.context
  }

  /**
   * 读取工具配置
   */
  getChatToolsConfig(): ChatToolsFileConfig {
    const data = readJsonFileSafe<Partial<ChatToolsFileConfig>>(getChatToolsConfigPath(this.context))
    if (!data) {
      return structuredClone(DEFAULT_CONFIG)
    }

    return {
      toolStates: { ...DEFAULT_CONFIG.toolStates, ...data.toolStates },
      toolCredentials: data.toolCredentials ?? {},
      customTools: data.customTools ?? [],
    }
  }

  /**
   * 保存工具配置
   */
  saveChatToolsConfig(config: ChatToolsFileConfig): void {
    writeJsonFileAtomic(getChatToolsConfigPath(this.context), config)
    console.log('[Chat 工具配置] 已保存')
  }

  /**
   * 更新单个工具的开关状态
   */
  updateToolState(toolId: string, state: ChatToolState): void {
    const config = this.getChatToolsConfig()
    config.toolStates[toolId] = state
    this.saveChatToolsConfig(config)
  }

  /**
   * 更新工具凭据
   */
  updateToolCredentials(toolId: string, credentials: Record<string, string>): void {
    const config = this.getChatToolsConfig()
    config.toolCredentials[toolId] = credentials
    this.saveChatToolsConfig(config)
  }

  /**
   * 获取工具开关状态（不存在时返回默认关闭）
   */
  getToolState(toolId: string): ChatToolState {
    const config = this.getChatToolsConfig()
    return config.toolStates[toolId] ?? { enabled: false }
  }

  /**
   * 获取工具凭据
   */
  getToolCredentials(toolId: string): Record<string, string> {
    const config = this.getChatToolsConfig()
    return config.toolCredentials[toolId] ?? {}
  }

  /**
   * 添加自定义工具
   */
  addCustomTool(meta: ChatToolMeta): void {
    const config = this.getChatToolsConfig()
    config.customTools = config.customTools.filter((t) => t.id !== meta.id)
    config.customTools.push(meta)
    this.saveChatToolsConfig(config)
  }

  /**
   * 删除自定义工具
   */
  removeCustomTool(toolId: string): void {
    const config = this.getChatToolsConfig()
    config.customTools = config.customTools.filter((t) => t.id !== toolId)
    this.saveChatToolsConfig(config)
  }
}
