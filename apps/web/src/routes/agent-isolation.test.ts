/**
 * Agent 行级/目录隔离测试
 *
 * 验证不同用户创建的 Agent 会话互相不可见，且各自落在独立的用户目录下。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext, UserContext } from '@ma-proma/server'
import type { RequestWithUserContext } from '../auth-middleware.ts'
import { createAgentRouter } from './agent.ts'
import type { AgentSessionMeta } from '@ma-proma/shared'
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

describe('Agent 行级隔离', () => {
  let dataDir: string
  let context: AppContext
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-agent-isolation-'))
    context = createTestContext(dataDir)

    const app = express()
    app.use(express.json())
    app.use('/agent', (req, _res, next) => {
      const userKey = (req.headers['x-test-user'] as string | undefined) ?? 'user-a'
      const ctx = users[userKey] ?? users['user-a']
      ;(req as unknown as RequestWithUserContext).userContext = ctx
      next()
    })
    app.use('/agent', await createAgentRouter({ context }))

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}/agent`
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

  async function createSession(userKey: string, title: string): Promise<AgentSessionMeta> {
    const res = await request(baseUrl, '/sessions', {
      method: 'POST',
      headers: { 'x-test-user': userKey },
      body: { title },
    })
    expect(res.json.success).toBe(true)
    return res.json.session as AgentSessionMeta
  }

  async function listSessionIds(userKey: string): Promise<string[]> {
    const res = await request(baseUrl, '/sessions', { headers: { 'x-test-user': userKey } })
    expect(res.json.success).toBe(true)
    return ((res.json.sessions as AgentSessionMeta[]) || []).map((s) => s.id)
  }

  async function getSession(userKey: string, id: string): Promise<{ status: number; found: boolean }> {
    const res = await request(baseUrl, `/sessions/${id}`, { headers: { 'x-test-user': userKey } })
    return { status: res.status, found: res.status === 200 }
  }

  test('普通用户只能看到自己的 Agent 会话', async () => {
    const sessionA = await createSession('user-a', 'Session A')
    const sessionB = await createSession('user-b', 'Session B')

    const idsA = await listSessionIds('user-a')
    expect(idsA).toContain(sessionA.id)
    expect(idsA).not.toContain(sessionB.id)

    const idsB = await listSessionIds('user-b')
    expect(idsB).toContain(sessionB.id)
    expect(idsB).not.toContain(sessionA.id)
  })

  test('普通用户无法获取他人的 Agent 会话', async () => {
    const sessionA = await createSession('user-a', 'Session A secret')

    const userBGet = await getSession('user-b', sessionA.id)
    expect(userBGet.found).toBe(false)
    expect(userBGet.status).toBe(404)
  })
})
