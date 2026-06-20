/**
 * Campaign 模块集成测试
 *
 * 自动验证：
 * 1. Campaign CRUD（创建、列表、获取）
 * 2. KOL 候选池导入
 * 3. 候选池查询
 */

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CreateCampaignInput } from '@ma-proma/shared'
import type {
  Campaign,
  CampaignKOLPoolItem,
  ImportKOLsToPoolInput,
  KOLSearchResult,
} from '@ma-proma/shared'

mock.module('electron', () => ({
  app: {
    getPath: () => TEST_DIR,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

const TEST_DIR = join(tmpdir(), `mapro-campaign-test-${Date.now()}`)

interface CampaignManagerModule {
  closeCampaignDatabase: () => void
  listCampaigns: () => Campaign[]
  createCampaign: (input: CreateCampaignInput) => Campaign
  getCampaignById: (id: string) => Campaign | undefined
  updateCampaign: (
    id: string,
    input: Partial<Pick<Campaign, 'phasePlans' | 'creativePlan'>>
  ) => Campaign | null
  getPoolKOLs: (campaignId: string) => CampaignKOLPoolItem[]
  importKOLsToPool: (input: ImportKOLsToPoolInput) => { imported: number }
  listAvailableKOLs: (filters?: { limit?: number }) => KOLSearchResult
}

let campaignManager: CampaignManagerModule

beforeAll(async () => {
  mkdirSync(TEST_DIR, { recursive: true })
  process.env._MAPRO_TEST_CONFIG_DIR = TEST_DIR
  campaignManager = await import('../campaign-manager') as CampaignManagerModule
})

afterAll(() => {
  campaignManager.closeCampaignDatabase()
  const dbPath = join(TEST_DIR, 'campaign-database.sqlite')
  if (existsSync(dbPath)) unlinkSync(dbPath)
  const kolDbPath = join(TEST_DIR, 'kol-database.sqlite')
  if (existsSync(kolDbPath)) unlinkSync(kolDbPath)
})

describe('Campaign 集成测试', () => {
  let testCampaignId: string

  it('Slice 1: 创建 Campaign', () => {
    const input: CreateCampaignInput = {
      name: 'VONBON 小红书 20万',
      brand: 'VONBON 甄果',
      platform: 'xiaohongshu',
      budget: 200000,
      durationMonths: 3,
      targetCity: ['上海', '杭州'],
      targetAudience: '25-35岁沪杭都市女性，追求品质生活',
    }

    const campaign = campaignManager.createCampaign(input)

    expect(campaign.id).toBeDefined()
    expect(campaign.name).toBe(input.name)
    expect(campaign.currentPhase).toBe(1)
    expect(campaign.phasePlans).toHaveLength(3)
    expect(campaign.phasePlans[0]?.budget).toBeGreaterThan(0)
    expect(campaign.creativePlan.bigIdea).toContain(input.brand)
    expect(campaign.status).toBe('draft')

    testCampaignId = campaign.id
  })

  it('Slice 1: 列表包含新 Campaign', () => {
    const list = campaignManager.listCampaigns()
    expect(list.length).toBeGreaterThan(0)
    const found = list.find((c) => c.id === testCampaignId)
    expect(found).toBeDefined()
    expect(found!.name).toBe('VONBON 小红书 20万')
  })

  it('Slice 2: 获取单个 Campaign', () => {
    const campaign = campaignManager.getCampaignById(testCampaignId)
    expect(campaign).toBeDefined()
    expect(campaign!.id).toBe(testCampaignId)
  })

  it('Slice 2: 可持久化更新阶段预算', () => {
    const campaign = campaignManager.getCampaignById(testCampaignId)
    expect(campaign).toBeDefined()

    const nextPhasePlans = campaign!.phasePlans.map((phase) =>
      phase.phase === 1 ? { ...phase, budget: 50000 } : phase,
    )
    const updated = campaignManager.updateCampaign(testCampaignId, { phasePlans: nextPhasePlans })

    expect(updated?.phasePlans.find((phase) => phase.phase === 1)?.budget).toBe(50000)
    expect(campaignManager.getCampaignById(testCampaignId)?.phasePlans.find((phase) => phase.phase === 1)?.budget).toBe(50000)
  })

  it('Slice 2: 可持久化更新创意策略', () => {
    const campaign = campaignManager.getCampaignById(testCampaignId)
    expect(campaign).toBeDefined()

    const updated = campaignManager.updateCampaign(testCampaignId, {
      creativePlan: {
        ...campaign!.creativePlan,
        bigIdea: '夏日轻盈通勤',
        tone: '清爽、可信、都市感',
      },
    })

    expect(updated?.creativePlan.bigIdea).toBe('夏日轻盈通勤')
    expect(campaignManager.getCampaignById(testCampaignId)?.creativePlan.tone).toBe('清爽、可信、都市感')
  })

  it('Slice 3: 候选池初始为空', () => {
    const pool = campaignManager.getPoolKOLs(testCampaignId)
    expect(pool).toEqual([])
  })

  it('Slice 3: 导入 KOL（gracious 处理空 DB）', () => {
    const result = campaignManager.importKOLsToPool({
      campaignId: testCampaignId,
      kolIds: ['mock_小红书_美妆达人小美'],
    })

    expect(typeof result.imported).toBe('number')
    // 如果 KOL DB 无数据，imported 为 0，不应抛错
    expect(result.imported).toBeGreaterThanOrEqual(0)
  })

  it('Slice 3: 获取可用 KOL 列表', () => {
    const result = campaignManager.listAvailableKOLs({ limit: 10 })
    expect(Array.isArray(result.kols)).toBe(true)
    expect(typeof result.total).toBe('number')
  })
})
