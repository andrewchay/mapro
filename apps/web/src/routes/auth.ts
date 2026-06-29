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

  // POST /auth/setup
  router.post('/setup', async (req: Request, res: Response) => {
    try {
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

      const result = await deps.authService.login({
        email,
        password,
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
