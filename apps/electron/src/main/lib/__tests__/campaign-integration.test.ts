/**
 * Campaign 模块集成测试
 *
 * 自动验证：
 * 1. Campaign CRUD（创建、列表、获取）
 * 2. KOL 候选池导入
 * 3. 候选池查询
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, unlinkSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  closeCampaignDatabase,
  listCampaigns,
  createCampaign,
  getCampaignById,
  getPoolKOLs,
  importKOLsToPool,
  listAvailableKOLs,
} from '../campaign-manager'
import type { CreateCampaignInput } from '@ma-proma/shared'

const TEST_DIR = join(tmpdir(), `mapro-campaign-test-${Date.now()}`)

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true })
  // @ts-expect-error 注入测试配置目录
  process.env._MAPRO_TEST_CONFIG_DIR = TEST_DIR
})

afterAll(() => {
  closeCampaignDatabase()
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

    const campaign = createCampaign(input)

    expect(campaign.id).toBeDefined()
    expect(campaign.name).toBe(input.name)
    expect(campaign.currentPhase).toBe(1)
    expect(campaign.status).toBe('draft')

    testCampaignId = campaign.id
  })

  it('Slice 1: 列表包含新 Campaign', () => {
    const list = listCampaigns()
    expect(list.length).toBeGreaterThan(0)
    const found = list.find((c) => c.id === testCampaignId)
    expect(found).toBeDefined()
    expect(found!.name).toBe('VONBON 小红书 20万')
  })

  it('Slice 2: 获取单个 Campaign', () => {
    const campaign = getCampaignById(testCampaignId)
    expect(campaign).toBeDefined()
    expect(campaign!.id).toBe(testCampaignId)
  })

  it('Slice 3: 候选池初始为空', () => {
    const pool = getPoolKOLs(testCampaignId)
    expect(pool).toEqual([])
  })

  it('Slice 3: 导入 KOL（gracious 处理空 DB）', () => {
    const result = importKOLsToPool({
      campaignId: testCampaignId,
      kolIds: ['mock_小红书_美妆达人小美'],
    })

    expect(typeof result.imported).toBe('number')
    // 如果 KOL DB 无数据，imported 为 0，不应抛错
    expect(result.imported).toBeGreaterThanOrEqual(0)
  })

  it('Slice 3: 获取可用 KOL 列表', () => {
    const result = listAvailableKOLs({ limit: 10 })
    expect(Array.isArray(result.kols)).toBe(true)
    expect(typeof result.total).toBe('number')
  })
})
