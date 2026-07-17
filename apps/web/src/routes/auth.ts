/**
 * 认证 REST API
 *
 * - POST /auth/setup：创建初始管理员（users 表为空时允许）
 * - POST /auth/login：登录，返回 access token 并设置 refresh cookie
 * - POST /auth/refresh：用 refresh cookie 换新的 access token
 * - POST /auth/logout：吊销 refresh token 并清除 cookie
 * - GET /auth/me：当前登录用户信息
 */

import { Router } from 'express'
import express from 'express'
import type { Request, Response } from 'express'
import cookieParser from 'cookie-parser'
import type { AuthService, PermissionService } from '@ma-proma/server'
import { createAuthMiddleware, type RequestWithUserContext } from '../auth-middleware.ts'
import { getApiToken } from '../security.ts'

export interface AuthRouterDeps {
  authService: AuthService
  permissionService: PermissionService
}

const REFRESH_COOKIE_DEV = 'refresh'
const REFRESH_COOKIE_PROD = '__Host-refresh'
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 天

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router()
  router.use(express.json({ limit: '64kb' }))
  router.use(cookieParser())
  const authMiddleware = createAuthMiddleware({
    authService: deps.authService,
    permissionService: deps.permissionService,
    apiToken: getApiToken(),
  })

  // ===== 登录限流（防在线爆破） =====
  /** 同一 IP+email 连续失败 5 次锁定 15 分钟 */
  const LOGIN_MAX_FAILURES = 5
  const LOGIN_LOCK_MS = 15 * 60 * 1000
  const loginFailures = new Map<string, { count: number; lockedUntil: number }>()

  function getLoginLockRemainingMs(key: string): number {
    const rec = loginFailures.get(key)
    // 未锁定（lockedUntil=0 的纯计数记录）直接放行，不能误删计数
    if (!rec || rec.lockedUntil <= 0) return 0
    const remaining = rec.lockedUntil - Date.now()
    if (remaining <= 0) {
      loginFailures.delete(key)
      return 0
    }
    return remaining
  }

  function recordLoginFailure(key: string): void {
    const rec = loginFailures.get(key) ?? { count: 0, lockedUntil: 0 }
    rec.count += 1
    if (rec.count >= LOGIN_MAX_FAILURES) {
      rec.lockedUntil = Date.now() + LOGIN_LOCK_MS
      rec.count = 0
      console.warn(`[Auth] 登录连续失败 ${LOGIN_MAX_FAILURES} 次，锁定 15 分钟: ${key}`)
    }
    loginFailures.set(key, rec)
  }

  // 定期清理过期记录，防止 Map 无限增长
  const cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, rec] of loginFailures) {
      if (rec.lockedUntil > 0 && rec.lockedUntil <= now) loginFailures.delete(key)
    }
  }, LOGIN_LOCK_MS)
  cleanupTimer.unref?.()

  /** setup 保护：仅允许本机来源或持有一次性 setup token 的请求创建初始管理员 */
  function isSetupAllowed(req: Request): boolean {
    const ip = getClientIp(req)
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true
    const setupToken = process.env.MAPRO_SETUP_TOKEN
    if (setupToken && req.headers['x-setup-token'] === setupToken) return true
    return false
  }

  // POST /auth/setup
  router.post('/setup', async (req: Request, res: Response) => {
    try {
      // 防止暴露部署时初始管理员被抢先注册
      if (!isSetupAllowed(req)) {
        res.status(403).json({ success: false, error: '仅允许本机来源或持有 setup token 的请求初始化管理员' })
        return
      }

      const { email, password, name } = req.body as Record<string, unknown>
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ success: false, error: 'email 与 password 必填' })
        return
      }

      const user = await deps.authService.createInitialAdmin({
        email,
        password,
        name: typeof name === 'string' ? name : undefined,
      })

      res.json({ success: true, user })
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建初始管理员失败'
      res.status(400).json({ success: false, error: message })
    }
  })

  // POST /auth/login
  router.post('/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as Record<string, unknown>
      if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ success: false, error: 'email 与 password 必填' })
        return
      }

      // 限流检查：锁定期间直接拒绝
      const rateLimitKey = `${getClientIp(req)}:${email.toLowerCase()}`
      const lockRemaining = getLoginLockRemainingMs(rateLimitKey)
      if (lockRemaining > 0) {
        res.status(429).json({ success: false, error: `失败次数过多，请 ${Math.ceil(lockRemaining / 60000)} 分钟后再试` })
        return
      }

      let result: Awaited<ReturnType<typeof deps.authService.login>>
      try {
        result = await deps.authService.login({
          email,
          password,
          ipAddress: getClientIp(req),
          userAgent: req.headers['user-agent'],
        })
      } catch (loginError) {
        recordLoginFailure(rateLimitKey)
        throw loginError
      }
      // 登录成功：清除失败记录
      loginFailures.delete(rateLimitKey)

      setRefreshCookie(res, result.refreshToken, req)
      res.json({
        success: true,
        user: result.user,
        accessToken: result.accessToken,
        expiresAt: result.expiresAt,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '登录失败'
      res.status(401).json({ success: false, error: message })
    }
  })

  // POST /auth/refresh
  router.post('/refresh', async (req: Request, res: Response) => {
    try {
      const refreshToken = req.cookies[getCookieName()]
      if (typeof refreshToken !== 'string' || !refreshToken) {
        res.status(401).json({ success: false, error: '缺少 refresh token' })
        return
      }

      const result = await deps.authService.refresh({
        refreshToken,
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent'],
      })

      setRefreshCookie(res, result.refreshToken, req)
      res.json({
        success: true,
        user: result.user,
        accessToken: result.accessToken,
        expiresAt: result.expiresAt,
      })
    } catch (error) {
      clearRefreshCookie(res, req)
      const message = error instanceof Error ? error.message : '刷新失败'
      res.status(401).json({ success: false, error: message })
    }
  })

  // POST /auth/logout
  router.post('/logout', async (req: Request, res: Response) => {
    try {
      const refreshToken = req.cookies[getCookieName()]
      if (typeof refreshToken === 'string' && refreshToken) {
        await deps.authService.logout(refreshToken)
      }
      clearRefreshCookie(res, req)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '登出失败'
      res.status(500).json({ success: false, error: message })
    }
  })

  // GET /auth/me
  router.get('/me', authMiddleware, (req: RequestWithUserContext, res: Response) => {
    if (!req.userContext) {
      res.status(401).json({ success: false, error: '未授权' })
      return
    }
    res.json({
      success: true,
      userContext: {
        userId: req.userContext.userId,
        tenantId: req.userContext.tenantId,
        roles: req.userContext.roles,
        permissions: req.userContext.permissions,
        isSystemAccount: req.userContext.isSystemAccount,
      },
    })
  })

  return router
}

function setRefreshCookie(res: Response, refreshToken: string, req: Request): void {
  const isProduction = process.env.NODE_ENV === 'production'
  const secure = isProduction || req.secure
  const cookieName = isProduction ? REFRESH_COOKIE_PROD : REFRESH_COOKIE_DEV
  const attributes = [
    'HttpOnly',
    'SameSite=Strict',
    `Path=/`,
    `Max-Age=${REFRESH_MAX_AGE_MS / 1000}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')
  res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(refreshToken)}; ${attributes}`)
}

function clearRefreshCookie(res: Response, req: Request): void {
  const isProduction = process.env.NODE_ENV === 'production'
  const secure = isProduction || req.secure
  const cookieName = isProduction ? REFRESH_COOKIE_PROD : REFRESH_COOKIE_DEV
  const attributes = ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0', secure ? 'Secure' : '']
    .filter(Boolean)
    .join('; ')
  res.setHeader('Set-Cookie', `${cookieName}=; ${attributes}`)
}

function getCookieName(): string {
  return process.env.NODE_ENV === 'production' ? REFRESH_COOKIE_PROD : REFRESH_COOKIE_DEV
}

function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim()
  return req.socket.remoteAddress
}
