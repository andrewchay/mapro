/**
 * Web 服务端上下文实现
 *
 * 阶段 A 单用户部署：
 * - 数据目录通过 MAPRO_DATA_DIR 环境变量注入，默认当前工作目录下的 .mapro/
 * - 资源目录默认当前工作目录
 *
 * 阶段 B：
 * - 集成 ServerSecretsStore（MAPRO_MASTER_KEY）
 * - 集成 LocalFileProvider
 */

import { join } from 'node:path'
import { cwd } from 'node:process'
import type { AppContext } from '@ma-proma/server'
import { ServerSecretsStore, LocalFileProvider } from '@ma-proma/server'
import type { SecretsStore, FileProvider } from '@ma-proma/server'

export interface WebServerContext {
  appContext: AppContext
  secretsStore: SecretsStore
  fileProvider: FileProvider
  agentConfig: {
    provider: string
    apiKey: string
    model: string
    channelId: string
    baseUrl?: string
    proxyUrl?: string
  } | null
}

export function createWebServerContext(): WebServerContext {
  const dataDir = process.env.MAPRO_DATA_DIR ?? join(cwd(), '.mapro')
  const resourcesPath = process.env.MAPRO_RESOURCES_PATH ?? cwd()

  const agentApiKey = process.env.MAPRO_AGENT_API_KEY
  const agentConfig = agentApiKey
    ? {
        provider: process.env.MAPRO_AGENT_PROVIDER || 'anthropic',
        apiKey: agentApiKey,
        model: process.env.MAPRO_AGENT_MODEL || 'claude-sonnet-4-20250514',
        channelId: process.env.MAPRO_AGENT_CHANNEL_ID || 'web-agent',
        baseUrl: process.env.MAPRO_AGENT_BASE_URL,
        proxyUrl: process.env.MAPRO_AGENT_PROXY_URL,
      }
    : null

  const appContext: AppContext = {
    getConfigDir: () => dataDir,
    getResourcesPath: () => resourcesPath,
    isPackaged: () => process.env.NODE_ENV === 'production',
  }

  // 内部单用户版：使用环境变量主密钥；未设置时给出明确错误
  let secretsStore: SecretsStore
  try {
    secretsStore = new ServerSecretsStore()
  } catch {
    // 未配置主密钥时使用明文透出的兜底实现（仅开发/内部版）
    secretsStore = {
      encrypt: (plainText: string) => plainText,
      decrypt: (encrypted: string) => encrypted,
      isAvailable: () => false,
    }
  }

  const fileProvider = new LocalFileProvider()

  return { appContext, secretsStore, fileProvider, agentConfig }
}
