/**
 * WebSocket 传输层实现
 *
 * 用于 Web 服务端，将事件推送到单个 WebSocket 客户端。
 */

import type { WebSocket } from 'ws'
import type { RendererTransport } from './types.ts'

export class WebSocketTransport implements RendererTransport {
  private ws: WebSocket

  constructor(ws: WebSocket) {
    this.ws = ws
  }

  send(channel: string, data: unknown): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify({ channel, data }))
    }
  }

  close(): void {
    this.ws.close()
  }
}
