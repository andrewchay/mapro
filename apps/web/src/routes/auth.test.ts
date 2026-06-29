/**
 * 认证路由集成测试
 *
 * 验证 /auth/setup、/auth/login、/auth/refresh、/auth/logout、/auth/me 的行为。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { request } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import type { AuthService, PermissionService, UserRecord } from '@ma-proma/server'
import { createAuthRouter } from './auth.ts'

function createMockAuthService(): AuthService {
  let admin: UserRecord | null = null
  let adminPassword = ''
  const tokens = new Map<string, UserRecord>()
  const revoked = new Set<string>()
  let tokenCounter = 0

  return {
    async createInitialAdmin(config: { email: string; password: string; name?: string }) {
      if (admin) throw new Error('初始管理员已存在')
      adminPassword = config.password
      admin = {
        id: 'admin-1',
        email: config.email,
        passwordHash: null,
        name: config.name ?? '管理员',
        status: 'active',
        authProvider: 'local',
        providerSubject: null,
        tenantId: 'default',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as UserRecord
      return admin
    },
    async login(input: { email: string; password: string }) {
      if (!admin || admin.email !== input.email || input.password !== adminPassword) {
        throw new Error('邮箱或密码错误')
      }
      tokenCounter++
      const accessToken = `access-${tokenCounter}`
      const refreshToken = `refresh-${tokenCounter}`
      tokens.set(accessToken, admin)
      return { user: admin, accessToken, refreshToken, expiresAt: Date.now() + 60_000 }
    },
    async refresh(input: { refreshToken: string }) {
      if (revoked.has(input.refreshToken) || !input.refreshToken.startsWith('refresh-')) {
        throw new Error('Refresh token 无效')
      }
      revoked.add(input.refreshToken)
      tokenCounter++
      const accessToken = `access-${tokenCounter}`
      const refreshToken = `refresh-${tokenCounter}`
      tokens.set(accessToken, admin!)
      return { user: admin!, accessToken, refreshToken, expiresAt: Date.now() + 60_000 }
    },
    async logout(refreshToken: string) {
      revoked.add(refreshToken)
    },
    async verifyAccessToken(token: string) {
      const user = tokens.get(token)
      if (!user) throw new Error('凭证无效')
      return user
    },
  } as unknown as AuthService
}

function createMockPermissionService(): PermissionService {
  return {
    createSystemContext: () => ({
      userId: 'system',
      sessionId: '',
      tenantId: 'default',
      roles: ['super_admin'],
      permissions: ['*'],
      isSystemAccount: true,
    }),
    buildUserContext: async (user: UserRecord) => ({
      userId: user.id,
      sessionId: '',
      tenantId: user.tenantId,
      roles: [],
      permissions: ['campaign:read'],
      isSystemAccount: false,
    }),
    hasPermission: () => true,
    hasAnyPermission: () => true,
    requirePermission: () => {},
  } as unknown as PermissionService
}

interface HttpResponse {
  status: number
  headers: IncomingHttpHeaders
  body: unknown
}

function httpFetch(baseUrl: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<HttpResponse> {
  const url = new URL(path, baseUrl)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method ?? 'GET',
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, headers: res.headers as IncomingHttpHeaders, body: data ? JSON.parse(data) : null })
          } catch {
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data })
          }
        })
      },
    )
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

function getCookie(headers: IncomingHttpHeaders, name: string): string | undefined {
  const raw = headers['set-cookie']
  if (!raw) return undefined
  const list = Array.isArray(raw) ? raw : [raw]
  for (const cookie of list) {
    const match = cookie.match(new RegExp(`${name}=([^;]+)`))
    if (match) return decodeURIComponent(match[1] ?? '')
  }
  return undefined
}

describe('Auth Routes', () => {
  let server: Server
  let baseUrl: string
  let authService: AuthService

  beforeAll(async () => {
    authService = createMockAuthService()
    const app = express()
    app.use('/auth', createAuthRouter({ authService, permissionService: createMockPermissionService() }))

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}`
        }
        resolve()
      })
      server.on('error', reject)
    })
  })

  afterAll(() => {
    server?.close()
  })

  test('POST /auth/setup 创建初始管理员', async () => {
    const res = await httpFetch(baseUrl, '/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@test.com', password: '123456' }),
    })
    expect(res.status).toBe(200)
    expect((res.body as { success: boolean }).success).toBe(true)
    expect((res.body as { user: { email: string } }).user.email).toBe('admin@test.com')
  })

  test('POST /auth/setup 重复创建返回 400', async () => {
    const res = await httpFetch(baseUrl, '/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ email: 'other@test.com', password: '123456' }),
    })
    expect(res.status).toBe(400)
  })

  test('POST /auth/login 返回 accessToken 与 refresh cookie', async () => {
    const res = await httpFetch(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@test.com', password: '123456' }),
    })
    expect(res.status).toBe(200)
    const body = res.body as { success: boolean; accessToken: string }
    expect(body.success).toBe(true)
    expect(body.accessToken).toBeTruthy()

    const refreshCookie = getCookie(res.headers, 'refresh')
    expect(refreshCookie).toBeTruthy()
  })

  test('POST /auth/login 密码错误返回 401', async () => {
    const res = await httpFetch(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@test.com', password: 'wrong' }),
    })
    expect(res.status).toBe(401)
  })

  test('POST /auth/refresh 用 cookie 换发新 accessToken', async () => {
    const login = await httpFetch(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@test.com', password: '123456' }),
    })
    const refreshToken = getCookie(login.headers, 'refresh')

    const res = await httpFetch(baseUrl, '/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refresh=${encodeURIComponent(refreshToken ?? '')}` },
    })
    expect(res.status).toBe(200)
    const body = res.body as { success: boolean; accessToken: string }
    expect(body.success).toBe(true)
    expect(body.accessToken).not.toBe((login.body as { accessToken: string }).accessToken)
  })

  test('POST /auth/refresh 无 cookie 返回 401', async () => {
    const res = await httpFetch(baseUrl, '/auth/refresh', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  test('POST /auth/logout 清除 refresh cookie', async () => {
    const login = await httpFetch(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@test.com', password: '123456' }),
    })
    const refreshToken = getCookie(login.headers, 'refresh')

    const res = await httpFetch(baseUrl, '/auth/logout', {
      method: 'POST',
      headers: { Cookie: `refresh=${encodeURIComponent(refreshToken ?? '')}` },
    })
    expect(res.status).toBe(200)
    const cookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie']]
    expect(cookies.some((c) => c?.includes('Max-Age=0'))).toBe(true)
  })

  test('GET /auth/me 携带有效 access token 返回用户上下文', async () => {
    const login = await httpFetch(baseUrl, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@test.com', password: '123456' }),
    })
    const { accessToken } = login.body as { accessToken: string }

    const res = await httpFetch(baseUrl, '/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(res.status).toBe(200)
    const body = res.body as { success: boolean; userContext: { userId: string } }
    expect(body.success).toBe(true)
    expect(body.userContext.userId).toBe('admin-1')
  })

  test('GET /auth/me 无凭证返回 401', async () => {
    const res = await httpFetch(baseUrl, '/auth/me')
    expect(res.status).toBe(401)
  })
})
