/**
 * 推导 WebSocket URL
 *
 * 生产环境（HTTPS）默认使用同源 /ws 路径，由反向代理（Caddy/nginx）转发到后端 WebSocket。
 * 开发环境可通过 VITE_WS_BASE 覆盖。
 */

export function resolveWebSocketBase(): string {
  const envBase = import.meta.env.VITE_WS_BASE
  if (typeof envBase === 'string' && envBase.length > 0) {
    return envBase
  }

  if (typeof window === 'undefined') {
    // 测试/SSR 兜底
    return 'ws://localhost:8081'
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}
