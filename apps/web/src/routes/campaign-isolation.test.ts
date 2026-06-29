/**
 * Campaign 行级隔离测试
 *
 * 验证普通用户只能访问 owner_id / tenant_id 匹配的记录，
 * system / super_admin 类账号可访问全部记录。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext, UserContext } from '@ma-proma/server'
import type { RequestWithUserContext } from '../auth-middleware.ts'
import { createCampaignRouter } from './campaign.ts'
import type { Campaign } from '@ma-proma/shared'
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
  system: { userId: 'system', sessionId: 's0', tenantId: 'default', roles: ['system'], permissions: ['*'], isSystemAccount: true },
}

describe('Campaign 行级隔离', () => {
  let dataDir: string
  let context: AppContext
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-campaign-isolation-'))
    context = createTestContext(dataDir)

    const app = express()
    app.use(express.json())
    app.use('/campaigns', (req, _res, next) => {
      const userKey = (req.headers['x-test-user'] as string | undefined) ?? 'system'
      const ctx = users[userKey] ?? users.system
      ;(req as unknown as RequestWithUserContext).userContext = ctx
      next()
    })
    app.use('/campaigns', await createCampaignRouter(context))

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}/campaigns`
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

  async function createCampaign(userKey: string, name: string): Promise<Campaign> {
    const res = await request(baseUrl, '/', {
      method: 'POST',
      headers: { 'x-test-user': userKey },
      body: { name, brand: 'IsolationBrand', platform: 'xiaohongshu' },
    })
    expect(res.json.success).toBe(true)
    return res.json.campaign as Campaign
  }

  async function listCampaignIds(userKey: string): Promise<string[]> {
    const res = await request(baseUrl, '/', { headers: { 'x-test-user': userKey } })
    expect(res.json.success).toBe(true)
    return ((res.json.campaigns as Campaign[]) || []).map((c) => c.id)
  }

  async function getCampaign(userKey: string, id: string): Promise<{ status: number; found: boolean }> {
    const res = await request(baseUrl, `/${id}`, { headers: { 'x-test-user': userKey } })
    return { status: res.status, found: res.status === 200 }
  }

  test('普通用户只能看到自己的 Campaign', async () => {
    const campaignA = await createCampaign('user-a', 'Campaign A')
    const campaignB = await createCampaign('user-b', 'Campaign B')

    const idsA = await listCampaignIds('user-a')
    expect(idsA).toContain(campaignA.id)
    expect(idsA).not.toContain(campaignB.id)

    const idsB = await listCampaignIds('user-b')
    expect(idsB).toContain(campaignB.id)
    expect(idsB).not.toContain(campaignA.id)
  })

  test('普通用户无法获取他人的 Campaign', async () => {
    const campaignA = await createCampaign('user-a', 'Campaign A secret')

    const userBGet = await getCampaign('user-b', campaignA.id)
    expect(userBGet.found).toBe(false)
    expect(userBGet.status).toBe(404)
  })

  test('system 账号可以访问全部 Campaign', async () => {
    const campaignA = await createCampaign('user-a', 'Campaign A system')
    const campaignB = await createCampaign('user-b', 'Campaign B system')

    const idsSystem = await listCampaignIds('system')
    expect(idsSystem).toContain(campaignA.id)
    expect(idsSystem).toContain(campaignB.id)

    const getA = await getCampaign('system', campaignA.id)
    expect(getA.found).toBe(true)
  })
})
