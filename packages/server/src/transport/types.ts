/**
 * 渲染进程传输层抽象
 *
 * 替代 Electron 的 webContents.send，使业务逻辑可在 Electron 和 Web 服务端共享。
 */

export interface TransportMessage {
  channel: string
  data: unknown
}

export interface RendererTransport {
  /** 发送事件到渲染进程 / Web 客户端 */
  send(channel: string, data: unknown): void

  /** 向所有连接的客户端广播（Web 端用；Electron 实现可忽略） */
  broadcast?(channel: string, data: unknown): void

  /** 关闭传输层 */
  close?(): void
}

/** 创建 Transport 的工厂函数上下文 */
export interface TransportContext {
  /** 当前会话/用户标识 */
  sessionId?: string
  userId?: string
}
