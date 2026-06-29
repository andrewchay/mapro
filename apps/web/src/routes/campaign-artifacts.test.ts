/**
 * Campaign 产物预览 API 测试
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext, WorkspaceFileEntry } from '@ma-proma/server'
import { createCampaignRouter } from './campaign.ts'
import type { Campaign } from '@ma-proma/shared'

function createTestContext(dataDir: string): AppContext {
  return {
    getConfigDir: () => dataDir,
    getResourcesPath: () => dataDir,
    isPackaged: () => false,
  }
}

function writeArtifact(dataDir: string, campaignId: string, relativePath: string, content: string): void {
  const fullDir = join(dataDir, 'agent-workspaces', `campaign-${campaignId}`, relativePath)
  mkdirSync(fullDir, { recursive: true })
  writeFileSync(join(fullDir, 'artifact.md'), content, 'utf-8')
}

describe('Campaign Artifacts API', () => {
  let dataDir: string
  let context: AppContext
  let server: Server
  let baseUrl: string
  let campaign: Campaign

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-campaign-artifacts-test-'))
    context = createTestContext(dataDir)

    const app = express()
    app.use(express.json())
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

    const createRes = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '测试 Campaign', brand: 'TestBrand', platform: 'xiaohongshu' }),
    })
    const createJson = (await createRes.json()) as { success: boolean; campaign: Campaign }
    campaign = createJson.campaign
  })

  afterAll(() => {
    server?.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  test('GET /:id/workflow/artifacts/:stepId 返回步骤目录文件', async () => {
    writeArtifact(dataDir, campaign.id, 'market-analysis', '# 市场分析产物')

    const res = await fetch(`${baseUrl}/${campaign.id}/workflow/artifacts/market_analysis`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; files: WorkspaceFileEntry[] }
    expect(json.success).toBe(true)
    expect(json.files.map((f) => f.path)).toContain('market-analysis/artifact.md')
  })

  test('GET /:id/workflow/artifacts/:stepId/*filePath 读取产物内容', async () => {
    writeArtifact(dataDir, campaign.id, 'brand-dna', '# 品牌 DNA')

    const res = await fetch(`${baseUrl}/${campaign.id}/workflow/artifacts/brand_dna/artifact.md`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; content: string }
    expect(json.success).toBe(true)
    expect(json.content).toBe('# 品牌 DNA')
  })

  test('search_kols 与 add_to_pool 返回同一目录', async () => {
    const dir = join(dataDir, 'agent-workspaces', `campaign-${campaign.id}`, 'kol-search')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'pool.md'), 'KOL 池', 'utf-8')

    const searchRes = await fetch(`${baseUrl}/${campaign.id}/workflow/artifacts/search_kols`)
    const addRes = await fetch(`${baseUrl}/${campaign.id}/workflow/artifacts/add_to_pool`)

    const searchJson = (await searchRes.json()) as { success: boolean; files: WorkspaceFileEntry[] }
    const addJson = (await addRes.json()) as { success: boolean; files: WorkspaceFileEntry[] }

    expect(searchJson.files.map((f) => f.path)).toContain('kol-search/pool.md')
    expect(addJson.files.map((f) => f.path)).toContain('kol-search/pool.md')
  })

  test('未知 stepId 返回 400', async () => {
    const res = await fetch(`${baseUrl}/${campaign.id}/workflow/artifacts/unknown_step`)
    expect(res.status).toBe(400)
  })
})
