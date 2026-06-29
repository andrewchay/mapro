/**
 * 认证与授权中间件
 *
 * 阶段 C：将 JWT / API Token / 显式降级统一为 req.userContext。
 */

import type { Request, Response, NextFunction } from 'express'
import type { UserContext } from '@ma-proma/server'
import type { AuthService, PermissionService } from '@ma-proma/server'

export interface RequestWithUserContext extends Request {
  userContext?: UserContext
}

export interface AuthMiddlewareOptions {
  authService: AuthService
  permissionService: PermissionService
  apiToken?: string
}

export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const { authService, permissionService, apiToken } = options

  return async (req: RequestWithUserContext, res: Response, next: NextFunction): Promise<void> => {
    // 显式单用户降级
    if (process.env.MAPRO_AUTH_DISABLED === '1') {
      req.userContext = permissionService.createSystemContext()
      next()
      return
    }

    const authHeader = req.headers.authorization
    const token = extractBearerToken(authHeader)

    if (!token) {
      res.status(401).json({ success: false, error: '未授权：缺少凭证' })
      return
    }

    // 全局服务账号 Token
    if (apiToken && token === apiToken) {
      req.userContext = permissionService.createSystemContext()
      next()
      return
    }

    // JWT access token
    try {
      const user = await authService.verifyAccessToken(token)
      req.userContext = await permissionService.buildUserContext(user)
      next()
    } catch (error) {
      const message = error instanceof Error ? error.message : '凭证无效'
      res.status(401).json({ success: false, error: `未授权：${message}` })
    }
  }
}

export function createRequirePermissionMiddleware(permission: string) {
  return (req: RequestWithUserContext, res: Response, next: NextFunction): void => {
    const userContext = req.userContext
    if (!userContext) {
      res.status(401).json({ success: false, error: '未授权：缺少用户上下文' })
      return
    }

    // 简单权限检查：后续由 PermissionService 提供更完整的能力
    if (userContext.isSystemAccount || userContext.permissions.includes('*') || userContext.permissions.includes(permission)) {
      next()
      return
    }

    res.status(403).json({ success: false, error: `禁止访问：缺少权限 ${permission}` })
  }
}

export function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return undefined
  return authHeader.slice(7)
}

export async function resolveWebSocketToken(
  token: string | undefined,
  options: AuthMiddlewareOptions,
): Promise<UserContext | undefined> {
  if (process.env.MAPRO_AUTH_DISABLED === '1') {
    return options.permissionService.createSystemContext()
  }

  if (!token) return undefined

  if (options.apiToken && token === options.apiToken) {
    return options.permissionService.createSystemContext()
  }

  try {
    const user = await options.authService.verifyAccessToken(token)
    return options.permissionService.buildUserContext(user)
  } catch {
    return undefined
  }
}
