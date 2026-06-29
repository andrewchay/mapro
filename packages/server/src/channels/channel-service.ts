/**
 * 跨平台渠道服务
 *
 * 负责渠道的 CRUD 操作、API Key 加密/解密、连接测试、模型拉取。
 * 使用注入的 SecretsStore 进行 API Key 加密，可在 Electron / Web / 测试环境复用。
 * 数据持久化到 {configDir}/channels.json。
 */

import { randomUUID } from 'node:crypto'
import type { AppContext } from '../context/types.ts'
import { getChannelsPath } from '../context/config-paths.ts'
import { readJsonFileSafe, writeJsonFileAtomic } from '../utils/safe-file.ts'
import type { SecretsStore } from '../secrets/types.ts'
import type {
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelsConfig,
  ChannelTestResult,
  ChannelModel,
  FetchModelsInput,
  FetchModelsResult,
  ProviderType,
} from '@ma-proma/shared'
import { PROVIDER_DEFAULT_URLS } from '@ma-proma/shared'
import {
  normalizeAnthropicBaseUrl,
  normalizeBaseUrl,
  normalizeVersionedAnthropicBaseUrl,
} from '@ma-proma/core'
import { validateChannelBaseUrl, validateChannelBaseUrlAsync } from './url-safety.ts'

/** 当前配置版本 */
const CONFIG_VERSION = 1

/** 模拟 fetch 类型，便于测试注入 */
export type FetchFn = typeof fetch

function readConfig(context: AppContext): ChannelsConfig {
  const configPath = getChannelsPath(context)
  const config = readJsonFileSafe<ChannelsConfig>(configPath)

  if (!config) {
    return { version: CONFIG_VERSION, channels: [] }
  }

  if (!Array.isArray(config.channels)) {
    console.warn('[渠道服务] channels.json 格式异常，重置为空列表')
    return { version: CONFIG_VERSION, channels: [] }
  }

  return config
}

function writeConfig(context: AppContext, config: ChannelsConfig): void {
  const configPath = getChannelsPath(context)
  writeJsonFileAtomic(configPath, config)
}

function encryptApiKey(secretsStore: SecretsStore, plainKey: string): string {
  if (!secretsStore.isAvailable()) {
    console.warn('[渠道服务] 加密不可用，将以明文存储')
    return plainKey
  }
  return secretsStore.encrypt(plainKey)
}

function decryptApiKey(secretsStore: SecretsStore, encryptedKey: string): string {
  if (!secretsStore.isAvailable()) {
    return encryptedKey
  }
  return secretsStore.decrypt(encryptedKey)
}

function createDeepSeekPreset(secretsStore: SecretsStore): Channel {
  const now = Date.now()
  return {
    id: randomUUID(),
    name: 'DeepSeek',
    provider: 'deepseek',
    baseUrl: PROVIDER_DEFAULT_URLS.deepseek,
    apiKey: encryptApiKey(secretsStore, ''),
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', enabled: true },
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: true },
    ],
    enabled: false,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 获取所有渠道
 *
 * 返回的渠道中 apiKey 保持加密状态。
 * 首次调用时，如果没有任何 DeepSeek 渠道，自动创建预设渠道。
 */
export function listChannels(context: AppContext, secretsStore: SecretsStore): Channel[] {
  const config = readConfig(context)

  const hasDeepSeek = config.channels.some(
    (c) => c.provider === 'deepseek' || c.baseUrl.includes('api.deepseek.com'),
  )

  if (!hasDeepSeek) {
    const preset = createDeepSeekPreset(secretsStore)
    config.channels.push(preset)
    writeConfig(context, config)
    console.log('[渠道服务] 已自动创建 DeepSeek 预设渠道')
    return config.channels
  }

  return config.channels
}

/**
 * 按 ID 获取渠道
 */
export function getChannelById(
  context: AppContext,
  _secretsStore: SecretsStore,
  id: string,
): Channel | undefined {
  const config = readConfig(context)
  return config.channels.find((c) => c.id === id)
}

/**
 * 创建渠道
 *
 * @param input 渠道创建数据（apiKey 为明文，会自动加密）
 */
export function createChannel(
  context: AppContext,
  secretsStore: SecretsStore,
  input: ChannelCreateInput,
): Channel {
  const config = readConfig(context)
  const now = Date.now()

  const channel: Channel = {
    id: randomUUID(),
    name: input.name,
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiKey: encryptApiKey(secretsStore, input.apiKey),
    models: input.models,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now,
  }

  config.channels.push(channel)
  writeConfig(context, config)

  console.log(`[渠道服务] 已创建渠道: ${channel.name} (${channel.id})`)
  return channel
}

/**
 * 更新渠道
 *
 * @param id 渠道 ID
 * @param input 更新数据（apiKey 为明文，空字符串/undefined/null 表示不更新）
 */
export function updateChannel(
  context: AppContext,
  secretsStore: SecretsStore,
  id: string,
  input: ChannelUpdateInput,
): Channel {
  const config = readConfig(context)
  const index = config.channels.findIndex((c) => c.id === id)

  if (index === -1) {
    throw new Error(`渠道不存在: ${id}`)
  }

  const existing = config.channels[index]!

  const updated: Channel = {
    ...existing,
    name: input.name ?? existing.name,
    provider: input.provider ?? existing.provider,
    baseUrl: input.baseUrl ?? existing.baseUrl,
    apiKey: input.apiKey ? encryptApiKey(secretsStore, input.apiKey) : existing.apiKey,
    models: input.models ?? existing.models,
    enabled: input.enabled ?? existing.enabled,
    updatedAt: Date.now(),
  }

  config.channels[index] = updated
  writeConfig(context, config)

  console.log(`[渠道服务] 已更新渠道: ${updated.name} (${updated.id})`)
  return updated
}

/**
 * 删除渠道
 */
export function deleteChannel(
  context: AppContext,
  _secretsStore: SecretsStore,
  id: string,
): void {
  const config = readConfig(context)
  const index = config.channels.findIndex((c) => c.id === id)

  if (index === -1) {
    throw new Error(`渠道不存在: ${id}`)
  }

  const removed = config.channels.splice(index, 1)[0]!
  writeConfig(context, config)

  console.log(`[渠道服务] 已删除渠道: ${removed.name} (${removed.id})`)
}

// ===== 连接测试相关 =====

async function testAnthropicCompatible(
  baseUrl: string,
  apiKey: string,
  provider: ProviderType,
  fetchFn: FetchFn,
): Promise<ChannelTestResult> {
  const isNonVersionedPath =
    provider === 'deepseek' || provider === 'kimi-api' || provider === 'kimi-coding'
  const url =
    provider === 'minimax'
      ? normalizeVersionedAnthropicBaseUrl(baseUrl)
      : isNonVersionedPath
        ? normalizeBaseUrl(baseUrl)
        : normalizeAnthropicBaseUrl(baseUrl)

  let testModel: string
  switch (provider) {
    case 'deepseek':
      testModel = 'deepseek-v4-pro'
      break
    case 'kimi-api':
      testModel = 'kimi-k2.6'
      break
    case 'kimi-coding':
      testModel = 'kimi-for-coding'
      break
    case 'minimax':
      testModel = 'MiniMax-M2.7'
      break
    default:
      testModel = 'claude-sonnet-4-6'
  }

  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }
  if (provider === 'kimi-coding') {
    headers.Authorization = `Bearer ${apiKey}`
    headers['User-Agent'] = 'KimiCLI/1.3'
  } else if (provider === 'minimax') {
    headers.Authorization = `Bearer ${apiKey}`
  } else {
    headers['x-api-key'] = apiKey
    headers.Authorization = `Bearer ${apiKey}`
  }

  try {
    const response = await fetchFn(`${url}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: testModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

    if (response.ok) {
      return { success: true, message: '连接成功' }
    }

    if (response.status === 401) {
      const text = await response.text().catch(() => '')
      return { success: false, message: `API Key 无效${text ? `: ${text.slice(0, 150)}` : ''}` }
    }

    return { success: true, message: '连接成功' }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { success: false, message: `连接测试失败: ${message}` }
  }
}

async function testOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  fetchFn: FetchFn,
): Promise<ChannelTestResult> {
  const url = normalizeBaseUrl(baseUrl)

  try {
    const response = await fetchFn(`${url}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })

    if (response.ok) {
      return { success: true, message: '连接成功' }
    }

    if (response.status === 401) {
      return { success: false, message: 'API Key 无效' }
    }

    const text = await response.text().catch(() => '')
    return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { success: false, message: `连接测试失败: ${message}` }
  }
}

async function testGoogle(
  baseUrl: string,
  apiKey: string,
  fetchFn: FetchFn,
): Promise<ChannelTestResult> {
  const url = normalizeBaseUrl(baseUrl)

  try {
    const response = await fetchFn(`${url}/v1beta/models?key=${apiKey}`, {
      method: 'GET',
    })

    if (response.ok) {
      return { success: true, message: '连接成功' }
    }

    if (response.status === 400 || response.status === 403) {
      return { success: false, message: 'API Key 无效' }
    }

    const text = await response.text().catch(() => '')
    return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { success: false, message: `连接测试失败: ${message}` }
  }
}

async function resolveTestResult(
  provider: ProviderType,
  baseUrl: string,
  apiKey: string,
  fetchFn: FetchFn,
): Promise<ChannelTestResult> {
  const literalSafety = validateChannelBaseUrl(baseUrl)
  if (!literalSafety.safe) {
    return { success: false, message: `URL 不安全: ${literalSafety.reason}` }
  }

  const dnsSafety = await validateChannelBaseUrlAsync(baseUrl)
  if (!dnsSafety.safe) {
    return { success: false, message: `URL 不安全: ${dnsSafety.reason}` }
  }

  switch (provider) {
    case 'anthropic':
    case 'deepseek':
    case 'kimi-api':
    case 'kimi-coding':
    case 'minimax':
      return testAnthropicCompatible(baseUrl, apiKey, provider, fetchFn)
    case 'openai':
    case 'zhipu':
    case 'doubao':
    case 'qwen':
    case 'custom':
      return testOpenAICompatible(baseUrl, apiKey, fetchFn)
    case 'google':
      return testGoogle(baseUrl, apiKey, fetchFn)
    default:
      return Promise.resolve({
        success: false,
        message: `不支持的供应商: ${provider}。你可能过去使用的是 MAPro 商业版，请重新下载商业版覆盖安装，当前版本为开源版本。`,
      })
  }
}

/**
 * 测试已保存渠道的连接
 */
export async function testChannel(
  context: AppContext,
  secretsStore: SecretsStore,
  fetchFn: FetchFn,
  id: string,
): Promise<ChannelTestResult> {
  const config = readConfig(context)
  const channel = config.channels.find((c) => c.id === id)

  if (!channel) {
    return { success: false, message: '渠道不存在' }
  }

  const apiKey = decryptApiKey(secretsStore, channel.apiKey)
  return resolveTestResult(channel.provider, channel.baseUrl, apiKey, fetchFn)
}

/**
 * 直接测试连接（无需已保存渠道）
 */
export async function testChannelDirect(
  _context: AppContext,
  _secretsStore: SecretsStore,
  fetchFn: FetchFn,
  input: FetchModelsInput,
): Promise<ChannelTestResult> {
  return resolveTestResult(input.provider, input.baseUrl, input.apiKey, fetchFn)
}

// ===== 模型拉取相关 =====

interface AnthropicModelItem {
  id: string
  display_name?: string
  type?: string
}

async function fetchAnthropicCompatibleModels(
  baseUrl: string,
  apiKey: string,
  provider: ProviderType,
  fetchFn: FetchFn,
): Promise<FetchModelsResult> {
  const isNonVersionedPath =
    provider === 'deepseek' || provider === 'kimi-api' || provider === 'kimi-coding'
  const url =
    provider === 'minimax'
      ? normalizeVersionedAnthropicBaseUrl(baseUrl)
      : isNonVersionedPath
        ? normalizeBaseUrl(baseUrl)
        : normalizeAnthropicBaseUrl(baseUrl)

  const headers: Record<string, string> = {
    'anthropic-version': '2023-06-01',
  }
  if (provider === 'kimi-coding') {
    headers.Authorization = `Bearer ${apiKey}`
    headers['User-Agent'] = 'KimiCLI/1.3'
  } else if (provider === 'minimax') {
    headers.Authorization = `Bearer ${apiKey}`
  } else {
    headers['x-api-key'] = apiKey
    headers.Authorization = `Bearer ${apiKey}`
  }

  try {
    const response = await fetchFn(`${url}/models`, {
      method: 'GET',
      headers,
    })

    if (response.status === 401) {
      const text = await response.text().catch(() => '')
      return { success: false, message: `API Key 无效${text ? `: ${text.slice(0, 150)}` : ''}`, models: [] }
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}`, models: [] }
    }

    const data = (await response.json()) as { data?: AnthropicModelItem[] }
    const items = data.data ?? []

    const models: ChannelModel[] = items.map((item) => ({
      id: item.id,
      name: item.display_name || item.id,
      enabled: true,
    }))

    return {
      success: true,
      message: `成功获取 ${models.length} 个模型`,
      models,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { success: false, message: `拉取模型失败: ${message}`, models: [] }
  }
}

interface OpenAIModelItem {
  id: string
  owned_by?: string
}

async function fetchOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string,
  fetchFn: FetchFn,
): Promise<FetchModelsResult> {
  const url = normalizeBaseUrl(baseUrl)

  try {
    const response = await fetchFn(`${url}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })

    if (response.status === 401) {
      return { success: false, message: 'API Key 无效', models: [] }
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}`, models: [] }
    }

    const data = (await response.json()) as { data?: OpenAIModelItem[] }
    const items = data.data ?? []

    const models: ChannelModel[] = items.map((item) => ({
      id: item.id,
      name: item.id,
      enabled: true,
    }))

    models.sort((a, b) => a.id.localeCompare(b.id))

    return {
      success: true,
      message: `成功获取 ${models.length} 个模型`,
      models,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { success: false, message: `拉取模型失败: ${message}`, models: [] }
  }
}

interface GoogleModelItem {
  name: string
  displayName?: string
  description?: string
  supportedGenerationMethods?: string[]
}

async function fetchGoogleModels(
  baseUrl: string,
  apiKey: string,
  fetchFn: FetchFn,
): Promise<FetchModelsResult> {
  const url = normalizeBaseUrl(baseUrl)

  try {
    const response = await fetchFn(`${url}/v1beta/models?key=${apiKey}`, {
      method: 'GET',
    })

    if (response.status === 400 || response.status === 403) {
      return { success: false, message: 'API Key 无效', models: [] }
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { success: false, message: `请求失败 (${response.status}): ${text.slice(0, 200)}`, models: [] }
    }

    const data = (await response.json()) as { models?: GoogleModelItem[] }
    const items = data.models ?? []

    const chatModels = items.filter((item) =>
      item.supportedGenerationMethods?.includes('generateContent'),
    )

    const models: ChannelModel[] = chatModels.map((item) => {
      const id = item.name.replace(/^models\//, '')
      return {
        id,
        name: item.displayName || id,
        enabled: true,
      }
    })

    return {
      success: true,
      message: `成功获取 ${models.length} 个模型`,
      models,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { success: false, message: `拉取模型失败: ${message}`, models: [] }
  }
}

async function resolveFetchModels(
  provider: ProviderType,
  baseUrl: string,
  apiKey: string,
  fetchFn: FetchFn,
): Promise<FetchModelsResult> {
  const literalSafety = validateChannelBaseUrl(baseUrl)
  if (!literalSafety.safe) {
    return { success: false, message: `URL 不安全: ${literalSafety.reason}`, models: [] }
  }

  const dnsSafety = await validateChannelBaseUrlAsync(baseUrl)
  if (!dnsSafety.safe) {
    return { success: false, message: `URL 不安全: ${dnsSafety.reason}`, models: [] }
  }

  switch (provider) {
    case 'anthropic':
    case 'deepseek':
    case 'kimi-api':
    case 'kimi-coding':
    case 'minimax':
      return fetchAnthropicCompatibleModels(baseUrl, apiKey, provider, fetchFn)
    case 'openai':
    case 'zhipu':
    case 'doubao':
    case 'qwen':
    case 'custom':
      return fetchOpenAICompatibleModels(baseUrl, apiKey, fetchFn)
    case 'google':
      return fetchGoogleModels(baseUrl, apiKey, fetchFn)
    default:
      return Promise.resolve({ success: false, message: `不支持的供应商: ${provider}`, models: [] })
  }
}

/**
 * 从供应商 API 拉取可用模型列表
 */
export async function fetchModels(
  _context: AppContext,
  _secretsStore: SecretsStore,
  fetchFn: FetchFn,
  input: FetchModelsInput,
): Promise<FetchModelsResult> {
  return resolveFetchModels(input.provider, input.baseUrl, input.apiKey, fetchFn)
}
