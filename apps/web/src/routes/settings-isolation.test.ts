/**
 * Settings 用户隔离测试
 *
 * 验证不同用户的 settings.json / user-profile.json 互相独立。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext, UserContext } from '@ma-proma/server'
import type { RequestWithUserContext } from '../auth-middleware.ts'
import { createSettingsRouter } from './settings.ts'
import { request } from '../test-utils/http-request.ts'

function createTestContext(dataDir: string): AppContext {
  return {
    getConfigDir: () => dataDir,
    getResourcesPath: () => dataDir,
    isPackaged: () => false,
  }
}

const users: Record<string, UserContext> = {
  'user-a': { userId: 'user-a', sessionId: 's1', tenantId: 'default', roles: [], permissions: [], isSystemAccount: false },
  'user-b': { userId: 'user-b', sessionId: 's2', tenantId: 'default', roles: [], permissions: [], isSystemAccount: false },
}

describe('Settings 用户隔离', () => {
  let dataDir: string
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-settings-isolation-'))
    const context = createTestContext(dataDir)

    const app = express()
    app.use((req, _res, next) => {
      const userKey = (req.headers['x-test-user'] as string | undefined) ?? 'user-a'
      const ctx = users[userKey] ?? users['user-a']
      ;(req as unknown as RequestWithUserContext).userContext = ctx
      next()
    })
    app.use(createSettingsRouter(context))

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
    rmSync(dataDir, { recursive: true, force: true })
  })

  async function getSettings(userKey: string): Promise<{ themeMode?: string; notificationsEnabled?: boolean }> {
    const res = await request(baseUrl, '/settings', { headers: { 'x-test-user': userKey } })
    expect(res.json.success).toBe(true)
    return (res.json.settings as Record<string, unknown>) as { themeMode?: string; notificationsEnabled?: boolean }
  }

  async function patchSettings(userKey: string, updates: Record<string, unknown>): Promise<void> {
    const res = await request(baseUrl, '/settings', {
      method: 'PATCH',
      headers: { 'x-test-user': userKey },
      body: updates,
    })
    expect(res.json.success).toBe(true)
  }

  test('用户 A 修改主题不影响用户 B', async () => {
    const beforeB = await getSettings('user-b')
    expect(beforeB.themeMode).toBe('dark')

    await patchSettings('user-a', { themeMode: 'light' })

    const afterA = await getSettings('user-a')
    expect(afterA.themeMode).toBe('light')

    const afterB = await getSettings('user-b')
    expect(afterB.themeMode).toBe('dark')
  })
})
