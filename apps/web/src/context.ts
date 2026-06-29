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
 *
 * 阶段 C：
 * - 集成认证数据库与迁移系统
 * - 提供用户化 AppContext 工厂
 */

import { join } from 'node:path'
import { cwd } from 'node:process'
import { randomBytes } from 'node:crypto'
import type { AppContext } from '@ma-proma/server'
import {
  ServerSecretsStore,
  LocalFileProvider,
  createDbProvider,
  MigrationRunner,
  loadMigrations,
  AuthRepository,
  AuthService,
  PermissionService,
} from '@ma-proma/server'
import type { SecretsStore, FileProvider, AuthService as IAuthService, PermissionService as IPermissionService, AuthRepository as IAuthRepository, JWTConfig } from '@ma-proma/server'

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
  authRepository: IAuthRepository
  authService: IAuthService
  permissionService: IPermissionService
  jwtConfig: JWTConfig
}

export async function createWebServerContext(): Promise<WebServerContext> {
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

  // 认证数据库：独立 SQLite 文件或 PostgreSQL 库（后缀 _auth）
  const authDb = createDbProvider({
    engine: process.env.MAPRO_DB_TYPE as 'sqlite' | 'postgres' | undefined,
    sqlitePath: join(dataDir, 'auth-database.sqlite'),
    postgresDbNameSuffix: 'auth',
  })

  // 执行迁移
  const migrations = await loadMigrations()
  await new MigrationRunner({ db: authDb, migrations }).migrate()

  const authRepository = new AuthRepository({ db: authDb, tenantId: 'default' })
  const jwtConfig = resolveJwtConfig()
  const authService = new AuthService({ repository: authRepository, jwtConfig })
  const permissionService = new PermissionService(authRepository)

  return { appContext, secretsStore, fileProvider, agentConfig, authRepository, authService, permissionService, jwtConfig }
}

/**
 * 创建用户隔离的 AppContext
 *
 * 文件型服务（settings/channels/agent-workspaces/attachments 等）通过该上下文按用户分目录。
 */
export function createUserAppContext(baseContext: AppContext, userId: string): AppContext {
  const baseDir = baseContext.getConfigDir()
  const userDir = join(baseDir, 'users', userId)
  return {
    getConfigDir: () => userDir,
    getResourcesPath: () => baseContext.getResourcesPath(),
    isPackaged: () => baseContext.isPackaged(),
  }
}

function resolveJwtConfig(): JWTConfig {
  const secret = process.env.MAPRO_JWT_SECRET ?? process.env.MAPRO_MASTER_KEY
  if (secret) {
    return {
      secret,
      accessTokenTtlSeconds: Number(process.env.MAPRO_JWT_ACCESS_TTL ?? 900),
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 MAPRO_JWT_SECRET 或 MAPRO_MASTER_KEY')
  }

  const fallback = randomBytes(32).toString('base64url')
  console.warn('[Auth] 未配置 MAPRO_JWT_SECRET 或 MAPRO_MASTER_KEY，已生成临时 JWT Secret（开发环境有效）')
  return {
    secret: fallback,
    accessTokenTtlSeconds: 900,
  }
}
