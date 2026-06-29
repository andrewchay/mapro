/**
 * 认证与授权类型
 */

import type { UserContext } from '../context/types.ts'

export type { UserContext }

/** 数据库用户记录 */
export interface UserRecord {
  id: string
  email: string
  passwordHash: string | null
  name: string
  status: 'active' | 'disabled' | 'pending'
  authProvider: 'local' | 'oidc'
  providerSubject: string | null
  tenantId: string
  createdAt: number
  updatedAt: number
}

/** 角色记录 */
export interface RoleRecord {
  id: string
  name: string
  description?: string
  isBuiltin: boolean
  tenantId: string
  createdAt: number
}

/** Refresh Token 记录 */
export interface RefreshTokenRecord {
  id: string
  userId: string
  tokenHash: string
  expiresAt: number
  revokedAt: number | null
  createdAt: number
  ipAddress: string | null
  userAgent: string | null
}

/** JWT Payload */
export interface JWTPayload {
  sub: string
  email: string
  tenantId: string
  roles: string[]
  permissions: string[]
  jti: string
  iat: number
  exp: number
  iss?: string
  aud?: string
}

/** 登录/刷新结果 */
export interface AuthResult {
  user: UserRecord
  accessToken: string
  refreshToken: string
  expiresAt: number
}

/** 初始管理员配置 */
export interface InitialAdminConfig {
  email: string
  password: string
  name?: string
}

/** JWT 配置 */
export interface JWTConfig {
  secret: string
  accessTokenTtlSeconds: number
  issuer?: string
  audience?: string
}
