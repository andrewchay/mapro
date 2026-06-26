import type { ProviderType } from '@ma-proma/shared'
import { PROVIDER_DEFAULT_URLS } from '@ma-proma/shared'
import type { ChatProviderConfig } from './types.ts'

const DEFAULT_MODELS: Partial<Record<ProviderType, string>> = {
  deepseek: 'deepseek-v4-pro',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  doubao: 'doubao-pro-256k',
  qwen: 'qwen-max',
  zhipu: 'glm-4',
  minimax: 'minimax-text-01',
  google: 'gemini-2.5-pro',
  custom: 'custom-model',
}

/**
 * 从环境变量读取阶段 A 最小 Chat 配置
 *
 * 必填：MAPRO_CHAT_PROVIDER, MAPRO_CHAT_API_KEY
 * 可选：MAPRO_CHAT_BASE_URL, MAPRO_CHAT_MODEL
 */
export function loadChatConfig(): ChatProviderConfig | null {
  const provider = process.env.MAPRO_CHAT_PROVIDER as ProviderType | undefined
  const apiKey = process.env.MAPRO_CHAT_API_KEY

  if (!provider || !apiKey) {
    return null
  }

  const baseUrl = process.env.MAPRO_CHAT_BASE_URL ?? PROVIDER_DEFAULT_URLS[provider] ?? ''
  const modelId = process.env.MAPRO_CHAT_MODEL ?? DEFAULT_MODELS[provider] ?? 'default'

  return { provider, baseUrl, apiKey, modelId }
}
