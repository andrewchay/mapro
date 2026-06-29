/**
 * API Token 管理
 *
 * Web UI 需要携带 MAPRO_API_TOKEN 才能访问受保护的 HTTP API 与 WebSocket。
 * 读取优先级：
 * 1. 构建时注入的 import.meta.env.VITE_API_TOKEN（适合 Docker / 静态部署）
 * 2. localStorage 中的 mapro-api-token（运行时用户输入，适合本地开发或多租户场景）
 */

const STORAGE_KEY = 'mapro-api-token'

export function getApiToken(): string | undefined {
  // 1. 运行时由服务端注入（Docker / 后端托管静态资源场景）
  if (typeof window !== 'undefined' && (window as unknown as Record<string, string>).MAPRO_API_TOKEN) {
    return (window as unknown as Record<string, string>).MAPRO_API_TOKEN
  }

  // 2. 构建时注入（纯静态 CDN / Vercel 等场景）
  const envToken = import.meta.env.VITE_API_TOKEN
  if (typeof envToken === 'string' && envToken.length > 0) {
    return envToken
  }

  // 3. 用户本地存储（运行时输入，适合本地开发或多租户）
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && stored.length > 0) {
      return stored
    }
  }

  return undefined
}

export function setApiToken(token: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, token)
  }
}

export function clearApiToken(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
}
