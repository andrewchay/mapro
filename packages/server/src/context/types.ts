/**
 * 应用上下文抽象
 *
 * 用于替代 Electron 的 app.getPath / app.resourcesPath 等运行时依赖，
 * 使核心服务逻辑可在 Electron 主进程、Web 服务端、测试环境之间共享。
 */
export interface AppContext {
  /** 获取配置/数据根目录 */
  getConfigDir(): string
  /** 获取资源目录 */
  getResourcesPath(): string
  /** 当前是否为打包后的生产环境 */
  isPackaged(): boolean
}

/**
 * 加密提供者抽象
 *
 * 用于替代 Electron safeStorage，Web 端可用 AES-256-GCM + 服务器密钥实现。
 */
export interface CryptoProvider {
  encrypt(plainText: string): string
  decrypt(encrypted: string): string
}

/**
 * 事件推送抽象
 *
 * 用于替代 Electron webContents.send()，Web 端可用 WebSocket 实现。
 */
export interface EventSink {
  send(channel: string, data: unknown): void
}

/**
 * 用户上下文
 *
 * 阶段 A 单用户部署可固定为匿名用户；阶段 C 多用户/多租户时用于隔离与授权。
 */
export interface UserContext {
  userId: string
  sessionId: string
  /** 租户标识，单租户场景默认 'default' */
  tenantId: string
  /** 用户所属角色 ID 列表 */
  roles: string[]
  /** 用户拥有的权限点列表 */
  permissions: string[]
  /** 是否为系统/服务账号 */
  isSystemAccount?: boolean
}
