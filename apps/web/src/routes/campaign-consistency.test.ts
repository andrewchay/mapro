/**
 * Campaign Web API 与共享业务逻辑一致性测试
 *
 * 验证 Web 路由层不会扭曲 Electron 端也在使用的 CampaignCommandService / CampaignQueryService 行为，
 * 同一数据库上的直接调用与 HTTP 调用应返回一致的数据。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '@ma-proma/server'
import {
  CampaignRepository,
  CampaignQueryService,
  CampaignCommandService,
  CampaignWorkflowService,
  CampaignArtifactValidator,
  ContentAuditService,
  KOLDatabaseRepository,
  LocalFileProvider,
  createDbProvider,
  WorkspaceFileService,
  getCampaignDbPath,
  getKolDbPath,
} from '@ma-proma/server'
import { createCampaignRouter } from './campaign.ts'
import type { Campaign } from '@ma-proma/shared'

function createTestContext(dataDir: string): AppContext {
  return {
    getConfigDir: () => dataDir,
    getResourcesPath: () => dataDir,
    isPackaged: () => false,
  }
}

async function createDirectServices(context: AppContext) {
  const db = createDbProvider({ sqlitePath: getCampaignDbPath(context) })
  const repository = new CampaignRepository(db)
  await repository.initSchema()

  const kolDb = createDbProvider({ sqlitePath: getKolDbPath(context) })
  const kolRepository = new KOLDatabaseRepository(kolDb, { seedMockData: false })
  await kolRepository.initSchema()

  const fileProvider = new LocalFileProvider()
  const validator = new CampaignArtifactValidator(context, fileProvider)
  const workflowService = new CampaignWorkflowService(context, fileProvider, validator)
  const contentAuditService = new ContentAuditService(null, repository)
  const commandService = new CampaignCommandService(repository, kolRepository, workflowService, {}, contentAuditService)
  const queryService = new CampaignQueryService(repository)
  return { commandService, queryService, repository, db, kolDb }
}

async function closeDirect(direct: Awaited<ReturnType<typeof createDirectServices>> | undefined): Promise<void> {
  if (!direct) return
  await direct.db.close()
  await direct.kolDb.close()
}

describe('Campaign Web API 与业务逻辑一致性', () => {
  let dataDir: string
  let context: AppContext
  let server: Server
  let baseUrl: string
  let direct: Awaited<ReturnType<typeof createDirectServices>>

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-campaign-consistency-'))
    context = createTestContext(dataDir)
    direct = await createDirectServices(context)

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
  })

  afterAll(async () => {
    server?.close()
    await closeDirect(direct)
    rmSync(dataDir, { recursive: true, force: true })
  })

  test('通过 API 创建的 Campaign 能被直接 queryService 读取', async () => {
    const createRes = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '一致性 Campaign', brand: 'Consistency', platform: 'xiaohongshu' }),
    })
    const createJson = (await createRes.json()) as { success: boolean; campaign: Campaign }
    expect(createJson.success).toBe(true)

    const fromService = await direct.queryService.getCampaignById(createJson.campaign.id)
    expect(fromService?.id).toBe(createJson.campaign.id)
    expect(fromService?.name).toBe('一致性 Campaign')
    expect(fromService?.brand).toBe('Consistency')
  })

  test('通过直接 service 创建的 Campaign 能在 API 列表中出现', async () => {
    const created = await direct.repository.createCampaign({
      name: 'Service Campaign',
      brand: 'ServiceBrand',
      platform: 'douyin',
      budget: 10000,
      durationMonths: 1,
      targetCity: [''],
      targetAudience: '',
    })

    const listRes = await fetch(`${baseUrl}/`)
    const listJson = (await listRes.json()) as { success: boolean; campaigns: Campaign[] }
    expect(listJson.success).toBe(true)
    expect(listJson.campaigns.some((c) => c.id === created.id)).toBe(true)

    const getRes = await fetch(`${baseUrl}/${created.id}`)
    const getJson = (await getRes.json()) as { success: boolean; campaign: Campaign }
    expect(getJson.success).toBe(true)
    expect(getJson.campaign.id).toBe(created.id)
    expect(getJson.campaign.platform).toBe('douyin')
  })

  test('工作流在 API 与直接 service 中状态一致', async () => {
    const created = await direct.repository.createCampaign({
      name: 'Workflow Consistency',
      brand: 'WFC',
      platform: 'xiaohongshu',
      budget: 10000,
      durationMonths: 1,
      targetCity: [''],
      targetAudience: '',
    })

    const [apiWorkflow, serviceWorkflow] = await Promise.all([
      fetch(`${baseUrl}/${created.id}/workflow`).then((r) => r.json() as Promise<{ success: boolean; workflow: { currentStepIndex: number; steps: { id: string }[] } }>),
      direct.commandService.loadWorkflow(created.id),
    ])

    expect(apiWorkflow.workflow.steps.length).toBe(serviceWorkflow.steps.length)
    expect(apiWorkflow.workflow.currentStepIndex).toBe(serviceWorkflow.currentStepIndex)
  })
})
