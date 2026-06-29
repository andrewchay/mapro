/**
 * Access Token 内存存储
 *
 * Refresh Token 保存在 httpOnly cookie 中，由浏览器自动携带。
 * Access Token 仅存内存，避免 XSS 窃取。
 */

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string): void {
  accessToken = token
}

export function clearAccessToken(): void {
  accessToken = null
}
