/**
 * Web 服务安全基元
 *
 * 集中管理 HTTP / WebSocket 鉴权与 CORS 策略，避免在 index.ts 中混杂安全逻辑。
 */

import type { CorsOptions } from 'cors'
import type { IncomingMessage } from 'node:http'
import { URL } from 'node:url'

/** Web UI 自动认证用的 httpOnly Cookie 名称 */
export const API_TOKEN_COOKIE_NAME = 'mapro_api_token'

/** 当前进程配置的 API Token */
export function getApiToken(): string | undefined {
  return process.env.MAPRO_API_TOKEN
}

/** 从请求 Cookie 头中解析 API Token（供 httpOnly Cookie 自动认证路径使用） */
export function getApiTokenFromCookies(req: { headers?: { cookie?: string } }): string | undefined {
  const cookieHeader = req.headers?.cookie
  if (!cookieHeader) return undefined
  const match = cookieHeader.match(new RegExp(`(?:^|\\s)${API_TOKEN_COOKIE_NAME}=([^;]+)`))
  return match ? decodeURIComponent(match[1]!) : undefined
}

/** 校验 HTTP Authorization Bearer Token；未配置 token 时直接放行 */
export function validateBearerToken(authHeader: string | undefined): boolean {
  const apiToken = getApiToken()
  if (!apiToken) return true
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  return token === apiToken
}

/** 从 WebSocket 握手 URL 的 query string 解析 token */
export function parseWebSocketToken(req: IncomingMessage): string | undefined {
  const url = new URL(req.url ?? '/', 'http://localhost')
  return url.searchParams.get('token') ?? getApiTokenFromCookies(req) ?? undefined
}

/** 校验 WebSocket token；未配置 token 时直接放行 */
export function isValidWebSocketToken(token: string | undefined): boolean {
  const apiToken = getApiToken()
  if (!apiToken) return true
  return token === apiToken
}

const LOCAL_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/localhost(:\d+)?$/,
  /^https:\/\/127\.0\.0\.1(:\d+)?$/,
]

/** 判断 origin 是否为本地开发地址 */
export function isLocalOrigin(origin: string): boolean {
  return LOCAL_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))
}

/** 判断 origin 是否在 MAPRO_ALLOWED_ORIGINS 白名单中 */
export function isAllowedOrigin(origin: string): boolean {
  const allowedOrigins = process.env.MAPRO_ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
  return allowedOrigins.includes(origin)
}

/**
 * 构造 CORS 配置。
 *
 * 策略：
 * - 若配置了 MAPRO_ALLOWED_ORIGINS，则只允许这些 origin
 * - 若配置了 MAPRO_API_TOKEN，默认禁止跨域（ Defense in depth ）
 * - 未配置 token 的本地模式：只允许 localhost / 127.0.0.1，降低恶意网页调用风险
 */
export function createCorsOptions(): CorsOptions {
  const allowedOriginsEnv = process.env.MAPRO_ALLOWED_ORIGINS
  const allowedOrigins = allowedOriginsEnv?.split(',').map((s) => s.trim()).filter(Boolean) ?? []

  return {
    origin: (origin, callback) => {
      const apiToken = getApiToken()

      // 无 origin 头通常出现在同源请求或非浏览器客户端，允许
      if (!origin) {
        callback(null, true)
        return
      }

      if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }

      if (apiToken) {
        // 已启用 token 鉴权：除非显式放行，否则默认禁止跨域
        callback(new Error('CORS 策略：未允许的 Origin'), false)
        return
      }

      // 未启用 token：仅允许本地 origin
      if (isLocalOrigin(origin)) {
        callback(null, true)
        return
      }

      callback(new Error('CORS 策略：未允许的 Origin'), false)
    },
    credentials: true,
  }
}
