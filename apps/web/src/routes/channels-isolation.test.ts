/**
 * Channels 用户隔离测试
 *
 * 验证不同用户的 channels.json 互相独立。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext, UserContext } from '@ma-proma/server'
import { ServerSecretsStore } from '@ma-proma/server'
import type { SecretsStore } from '@ma-proma/server'
import type { RequestWithUserContext } from '../auth-middleware.ts'
import { createChannelsRouter } from './channels.ts'
import type { Channel } from '@ma-proma/shared'
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

describe('Channels 用户隔离', () => {
  let dataDir: string
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-channels-isolation-'))
    const context = createTestContext(dataDir)
    const secretsStore: SecretsStore = new ServerSecretsStore('test-master-key')

    const app = express()
    app.use((req, _res, next) => {
      const userKey = (req.headers['x-test-user'] as string | undefined) ?? 'user-a'
      const ctx = users[userKey] ?? users['user-a']
      ;(req as unknown as RequestWithUserContext).userContext = ctx
      next()
    })
    app.use(createChannelsRouter({ context, secretsStore }))

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

  async function createChannel(userKey: string, name: string): Promise<Channel> {
    const res = await request(baseUrl, '/', {
      method: 'POST',
      headers: { 'x-test-user': userKey },
      body: {
        name,
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        models: [{ id: 'gpt-4o', name: 'GPT-4o', enabled: true }],
        enabled: true,
      },
    })
    expect(res.json.success).toBe(true)
    return res.json.channel as Channel
  }

  async function listChannelIds(userKey: string): Promise<string[]> {
    const res = await request(baseUrl, '/', { headers: { 'x-test-user': userKey } })
    expect(res.json.success).toBe(true)
    return ((res.json.channels as Channel[]) || []).map((c) => c.id)
  }

  async function getChannel(userKey: string, id: string): Promise<{ status: number; found: boolean }> {
    const res = await request(baseUrl, `/${id}`, { headers: { 'x-test-user': userKey } })
    return { status: res.status, found: res.status === 200 }
  }

  test('普通用户只能看到自己的渠道', async () => {
    // 每个用户首次 list 会自动创建 DeepSeek 预设渠道
    const beforeA = await listChannelIds('user-a')
    const channelA = await createChannel('user-a', 'Channel A')
    const channelB = await createChannel('user-b', 'Channel B')

    const idsA = await listChannelIds('user-a')
    expect(idsA).toContain(channelA.id)
    expect(idsA).not.toContain(channelB.id)

    const idsB = await listChannelIds('user-b')
    expect(idsB).toContain(channelB.id)
    expect(idsB).not.toContain(channelA.id)

    // 清理预设渠道数量以便断言稳定
    expect(beforeA.length).toBeGreaterThanOrEqual(1)
  })

  test('普通用户无法获取他人的渠道', async () => {
    const channelA = await createChannel('user-a', 'Channel A secret')

    const userBGet = await getChannel('user-b', channelA.id)
    expect(userBGet.found).toBe(false)
    expect(userBGet.status).toBe(404)
  })
})
