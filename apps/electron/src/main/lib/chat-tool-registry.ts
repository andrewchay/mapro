/**
 * Chat 工具注册表
 *
 * 管理所有可用的 Chat 工具：
 * - 内置工具（记忆、联网搜索）
 * - 自定义工具（用户配置的 HTTP 工具）
 *
 * 提供统一接口获取启用的工具定义和系统提示词。
 */

import type { ToolDefinition, ToolParameterProperty } from '@ma-proma/core'
import type { ChatToolInfo, ChatToolMeta } from '@ma-proma/shared'
import { getChatToolsConfig } from './chat-tool-config'
import {
  MEMORY_TOOL_META,
  MEMORY_TOOL_DEFINITIONS,
  isMemoryAvailable,
} from './chat-tools/memory-tool'
import {
  WEB_SEARCH_TOOL_META,
  WEB_SEARCH_TOOL_DEFINITIONS,
  isWebSearchAvailable,
} from './chat-tools/web-search-tool'
import {
  WEB_SCRAPER_TOOL_META,
  WEB_SCRAPER_TOOL_DEFINITIONS,
  isWebScraperAvailable,
} from './chat-tools/web-scraper-tool'
import {
  COMPUTER_USE_TOOL_META,
  COMPUTER_USE_TOOL_DEFINITIONS,
  isComputerUseAvailable,
} from './chat-tools/computer-use-tool'
import {
  AGENT_RECOMMEND_TOOL_META,
  AGENT_RECOMMEND_TOOL_DEFINITIONS,
  isAgentRecommendAvailable,
} from './chat-tools/agent-recommend-tool'
import {
  NANO_BANANA_TOOL_META,
  NANO_BANANA_TOOL_DEFINITIONS,
  isNanoBananaAvailable,
} from './chat-tools/nano-banana-tool'
import {
  STRATEGY_IQ_TOOL_META,
  STRATEGY_IQ_TOOL_DEFINITIONS,
  isStrategyIQAvailable,
  MATCH_AI_TOOL_META,
  MATCH_AI_TOOL_DEFINITIONS,
  isMatchAIAvailable,
  CONNECT_BOT_TOOL_META,
  CONNECT_BOT_TOOL_DEFINITIONS,
  isConnectBotAvailable,
  CREATIVE_PILOT_TOOL_META,
  CREATIVE_PILOT_TOOL_DEFINITIONS,
  isCreativePilotAvailable,
  KOL_SEARCH_TOOL_META,
  KOL_SEARCH_TOOL_DEFINITIONS,
  isKOLSearchAvailable,
  CAMPAIGN_OPTIMIZER_TOOL_META,
  CAMPAIGN_OPTIMIZER_TOOL_DEFINITIONS,
  isCampaignOptimizerAvailable,
  SCRIPT_STUDIO_TOOL_META,
  SCRIPT_STUDIO_TOOL_DEFINITIONS,
  isScriptStudioAvailable,
  KOL_CRM_TOOL_META,
  KOL_CRM_TOOL_DEFINITIONS,
  isKOLCRMAvailable,
  CONTENT_AUDIT_TOOL_META,
  CONTENT_AUDIT_TOOL_DEFINITIONS,
  isContentAuditAvailable,
  KOL_PORTAL_TOOL_META,
  KOL_PORTAL_TOOL_DEFINITIONS,
  isKOLPortalAvailable,
  CAMPAIGN_TESTER_TOOL_META,
  CAMPAIGN_TESTER_TOOL_DEFINITIONS,
  isCampaignTesterAvailable,
  CAMPAIGN_AGENT_TOOL_META,
  CAMPAIGN_AGENT_TOOL_DEFINITIONS,
  isCampaignAgentAvailable,
  CONTENT_TRACKER_TOOL_META,
  CONTENT_TRACKER_TOOL_DEFINITIONS,
  isContentTrackerAvailable,
  PHASE_REVIEWER_TOOL_META,
  PHASE_REVIEWER_TOOL_DEFINITIONS,
  isPhaseReviewerAvailable,
} from './ma-tools'
import {
  KOL_DATA_MCP_TOOL_META,
  KOL_DATA_MCP_TOOL_DEFINITIONS,
  isKOLDataMcpAvailable,
} from './ma-tools/kol-data-mcp-tool'
import {
  BUDGET_FORECAST_TOOL_META,
  BUDGET_FORECAST_TOOL_DEFINITIONS,
  isBudgetForecastAvailable,
} from './ma-tools/budget-forecast'

// ===== 内置工具注册 =====

/** 内置工具列表（元数据 + 获取 ToolDefinition 的方法） */
interface BuiltinToolEntry {
  meta: ChatToolMeta
  getDefinitions: () => ToolDefinition[]
  checkAvailable: () => boolean
}

/** 所有内置工具 */
const BUILTIN_TOOLS: BuiltinToolEntry[] = [
  {
    meta: MEMORY_TOOL_META,
    getDefinitions: () => MEMORY_TOOL_DEFINITIONS,
    checkAvailable: isMemoryAvailable,
  },
  {
    meta: WEB_SEARCH_TOOL_META,
    getDefinitions: () => WEB_SEARCH_TOOL_DEFINITIONS,
    checkAvailable: isWebSearchAvailable,
  },
  {
    meta: WEB_SCRAPER_TOOL_META,
    getDefinitions: () => WEB_SCRAPER_TOOL_DEFINITIONS,
    checkAvailable: isWebScraperAvailable,
  },
  {
    meta: COMPUTER_USE_TOOL_META,
    getDefinitions: () => COMPUTER_USE_TOOL_DEFINITIONS,
    checkAvailable: isComputerUseAvailable,
  },
  {
    meta: AGENT_RECOMMEND_TOOL_META,
    getDefinitions: () => AGENT_RECOMMEND_TOOL_DEFINITIONS,
    checkAvailable: isAgentRecommendAvailable,
  },
  {
    meta: NANO_BANANA_TOOL_META,
    getDefinitions: () => NANO_BANANA_TOOL_DEFINITIONS,
    checkAvailable: isNanoBananaAvailable,
  },
  {
    meta: STRATEGY_IQ_TOOL_META,
    getDefinitions: () => STRATEGY_IQ_TOOL_DEFINITIONS,
    checkAvailable: isStrategyIQAvailable,
  },
  {
    meta: MATCH_AI_TOOL_META,
    getDefinitions: () => MATCH_AI_TOOL_DEFINITIONS,
    checkAvailable: isMatchAIAvailable,
  },
  {
    meta: CONNECT_BOT_TOOL_META,
    getDefinitions: () => CONNECT_BOT_TOOL_DEFINITIONS,
    checkAvailable: isConnectBotAvailable,
  },
  {
    meta: CREATIVE_PILOT_TOOL_META,
    getDefinitions: () => CREATIVE_PILOT_TOOL_DEFINITIONS,
    checkAvailable: isCreativePilotAvailable,
  },
  {
    meta: KOL_SEARCH_TOOL_META,
    getDefinitions: () => KOL_SEARCH_TOOL_DEFINITIONS,
    checkAvailable: isKOLSearchAvailable,
  },
  {
    meta: KOL_DATA_MCP_TOOL_META,
    getDefinitions: () => KOL_DATA_MCP_TOOL_DEFINITIONS,
    checkAvailable: isKOLDataMcpAvailable,
  },
  {
    meta: CAMPAIGN_OPTIMIZER_TOOL_META,
    getDefinitions: () => CAMPAIGN_OPTIMIZER_TOOL_DEFINITIONS,
    checkAvailable: isCampaignOptimizerAvailable,
  },
  {
    meta: SCRIPT_STUDIO_TOOL_META,
    getDefinitions: () => SCRIPT_STUDIO_TOOL_DEFINITIONS,
    checkAvailable: isScriptStudioAvailable,
  },
  {
    meta: KOL_CRM_TOOL_META,
    getDefinitions: () => KOL_CRM_TOOL_DEFINITIONS,
    checkAvailable: isKOLCRMAvailable,
  },
  {
    meta: KOL_PORTAL_TOOL_META,
    getDefinitions: () => KOL_PORTAL_TOOL_DEFINITIONS,
    checkAvailable: isKOLPortalAvailable,
  },
  {
    meta: CONTENT_AUDIT_TOOL_META,
    getDefinitions: () => CONTENT_AUDIT_TOOL_DEFINITIONS,
    checkAvailable: isContentAuditAvailable,
  },
  {
    meta: CAMPAIGN_TESTER_TOOL_META,
    getDefinitions: () => CAMPAIGN_TESTER_TOOL_DEFINITIONS,
    checkAvailable: isCampaignTesterAvailable,
  },
  {
    meta: CAMPAIGN_AGENT_TOOL_META,
    getDefinitions: () => CAMPAIGN_AGENT_TOOL_DEFINITIONS,
    checkAvailable: isCampaignAgentAvailable,
  },
  {
    meta: BUDGET_FORECAST_TOOL_META,
    getDefinitions: () => BUDGET_FORECAST_TOOL_DEFINITIONS,
    checkAvailable: isBudgetForecastAvailable,
  },
  {
    meta: CONTENT_TRACKER_TOOL_META,
    getDefinitions: () => CONTENT_TRACKER_TOOL_DEFINITIONS,
    checkAvailable: isContentTrackerAvailable,
  },
  {
    meta: PHASE_REVIEWER_TOOL_META,
    getDefinitions: () => PHASE_REVIEWER_TOOL_DEFINITIONS,
    checkAvailable: isPhaseReviewerAvailable,
  },
]

// ===== 自定义工具转换 =====

/**
 * 将 ChatToolMeta 转换为 ToolDefinition（Provider API 格式）
 *
 * 将简化的 params 格式映射为 JSON Schema。
 */
function convertMetaToDefinition(meta: ChatToolMeta): ToolDefinition {
  const properties: Record<string, ToolParameterProperty> = {}
  const required: string[] = []

  for (const param of meta.params) {
    const prop: ToolParameterProperty = {
      type: param.type,
      description: param.description,
    }
    if (param.enum && param.enum.length > 0) {
      prop.enum = param.enum
    }
    properties[param.name] = prop

    if (param.required) {
      required.push(param.name)
    }
  }

  return {
    name: meta.id,
    description: meta.description,
    parameters: {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    },
  }
}

// ===== 公开接口 =====

/** 获取启用工具的返回结果 */
export interface EnabledToolsResult {
  /** 合并后的工具定义列表 */
  tools: ToolDefinition[] | undefined
  /** 合并后的系统提示词追加 */
  systemPromptAppend: string | undefined
}

/**
 * 获取当前启用的工具定义
 *
 * 根据前端传入的 enabledToolIds 和配置文件中的开关状态，
 * 返回最终要注入到 API 请求中的工具定义和系统提示词。
 *
 * @param enabledToolIds 前端传入的启用工具 ID 列表
 * @returns 合并后的工具定义和系统提示词
 */
export function getEnabledTools(enabledToolIds?: string[]): EnabledToolsResult {
  // 未传入 enabledToolIds 时使用配置文件的开关状态
  const config = getChatToolsConfig()

  const allDefinitions: ToolDefinition[] = []
  const systemPromptParts: string[] = []

  for (const entry of BUILTIN_TOOLS) {
    const toolId = entry.meta.id
    const state = config.toolStates[toolId]

    // 检查工具是否启用（前端开关 + 配置开关）
    const isEnabledByUser = enabledToolIds ? enabledToolIds.includes(toolId) : (state?.enabled ?? false)
    if (!isEnabledByUser) continue

    // 检查工具是否可用（凭据已配置）
    if (!entry.checkAvailable()) continue

    // 收集工具定义
    allDefinitions.push(...entry.getDefinitions())

    // 收集系统提示词
    if (entry.meta.systemPromptAppend) {
      systemPromptParts.push(entry.meta.systemPromptAppend)
    }
  }

  // 自定义工具
  for (const customMeta of config.customTools) {
    const toolId = customMeta.id
    const isEnabledByUser = enabledToolIds
      ? enabledToolIds.includes(toolId)
      : (config.toolStates[toolId]?.enabled ?? false)
    if (!isEnabledByUser) continue

    // 自定义工具不需要凭据检查，httpConfig 即为配置
    allDefinitions.push(convertMetaToDefinition(customMeta))

    if (customMeta.systemPromptAppend) {
      systemPromptParts.push(customMeta.systemPromptAppend)
    }
  }

  return {
    tools: allDefinitions.length > 0 ? allDefinitions : undefined,
    systemPromptAppend: systemPromptParts.length > 0 ? systemPromptParts.join('\n') : undefined,
  }
}

/**
 * 获取所有工具信息（供前端展示）
 *
 * 返回所有内置 + 自定义工具的元数据、开关状态和可用性。
 */
export function getAllToolInfos(): ChatToolInfo[] {
  const config = getChatToolsConfig()
  const infos: ChatToolInfo[] = []

  // 内置工具
  for (const entry of BUILTIN_TOOLS) {
    const toolId = entry.meta.id
    const state = config.toolStates[toolId]

    infos.push({
      meta: entry.meta,
      enabled: state?.enabled ?? false,
      available: entry.checkAvailable(),
    })
  }

  // 自定义工具
  for (const customMeta of config.customTools) {
    const state = config.toolStates[customMeta.id]

    infos.push({
      meta: customMeta,
      enabled: state?.enabled ?? false,
      available: !!customMeta.httpConfig,
    })
  }

  return infos
}
