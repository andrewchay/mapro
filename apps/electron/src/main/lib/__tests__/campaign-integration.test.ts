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
  CampaignBrief,
  CampaignKOLPoolItem,
  ImportKOLsToPoolInput,
  KOLSearchResult,
  SaveCampaignBriefInput,
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
  getBrief: (campaignId: string, kolId: string) => CampaignBrief | null
  saveBrief: (input: SaveCampaignBriefInput) => CampaignBrief
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

  it('Slice 4: Brief 携带 JTBD 结构化字段落库并回读', () => {
    const jobSpec = JSON.stringify({
      functional: '快速获得新鲜即食的水果甜点',
      emotional: '缓解疲惫与自责感',
      social: '呈现精致自律的生活态度',
      competing_solutions: ['奶茶', '蛋糕', '代餐奶昔'],
      anxieties: ['担心糖分', '担心不新鲜'],
      tradeoffs: '愿意为新鲜支付溢价，不愿牺牲便捷',
    })
    const forcesMap = JSON.stringify({
      push: '放大"想吃甜又怕负担"的场景痛点',
      pull: '突出"下班路上顺手犒赏"的憧憬',
      inertia: '强调和点奶茶一样方便',
      anxiety: '用冷链溯源与明码标价消解担忧',
    })

    const saved = campaignManager.saveBrief({
      campaignId: testCampaignId,
      kolId: 'mock_小红书_美妆达人小美',
      kolName: '美妆达人小美',
      content: '# 测试 Brief\nJTBD 任务陈述与四力分析。',
      jobSpec,
      forcesMap,
      aiGenerated: true,
    })

    expect(saved.jobSpec).toBe(jobSpec)
    expect(saved.forcesMap).toBe(forcesMap)

    const fetched = campaignManager.getBrief(testCampaignId, 'mock_小红书_美妆达人小美')
    expect(fetched).not.toBeNull()
    expect(fetched!.jobSpec).toBe(jobSpec)
    expect(fetched!.forcesMap).toBe(forcesMap)
    expect(JSON.parse(fetched!.jobSpec!).competing_solutions).toContain('奶茶')
  })

  it('Slice 4: 更新 Brief 时不传 JTBD 字段则保留原值', () => {
    const before = campaignManager.getBrief(testCampaignId, 'mock_小红书_美妆达人小美')
    expect(before).not.toBeNull()

    const updated = campaignManager.saveBrief({
      campaignId: testCampaignId,
      kolId: 'mock_小红书_美妆达人小美',
      kolName: '美妆达人小美',
      content: '# 更新后的 Brief 内容',
    })

    expect(updated.content).toBe('# 更新后的 Brief 内容')
    expect(updated.jobSpec).toBe(before!.jobSpec)
    expect(updated.forcesMap).toBe(before!.forcesMap)
  })
})

describe('阶段复盘报告 · 三分决策', () => {
  let testCampaignId: string

  beforeAll(async () => {
    const campaign = campaignManager.createCampaign({
      name: '复盘决策测试 Campaign',
      brand: 'VONBON 甄果',
      platform: 'xiaohongshu',
      budget: 50000,
      durationMonths: 1,
      targetCity: ['上海'],
      targetAudience: '测试人群',
    })
    testCampaignId = campaign.id
  })

  interface PhaseReportModule {
    getPhaseReport: (id: string) => import('@ma-proma/shared').CampaignPhaseReport | null
    updatePhaseReport: (
      id: string,
      updates: Partial<Pick<import('@ma-proma/shared').CampaignPhaseReport, 'aiDecisions' | 'status'>>
    ) => import('@ma-proma/shared').CampaignPhaseReport | null
    deletePhaseReport: (id: string) => boolean
  }
  let phaseModule: PhaseReportModule
  let reportId: string

  const decisions: import('@ma-proma/shared').PhaseDecision[] = [
    {
      element: '桌面对决',
      decision: 'keep',
      evidence: '曝光 61,739 全场最高 · CPE ¥3.47 全场最低',
      reason: '场景代入感强，用户愿意停留和讨论',
      nextAction: '下一批主推，人数从 6 扩到 8',
    },
    {
      element: '穿搭撞色',
      decision: 'stop',
      evidence: '曝光 2,380 · CPE ¥3.86 偏高',
      reason: '数据差且投入产出比不合理',
      nextAction: '不再追加',
    },
    {
      element: 'plog 拼图',
      decision: 'start',
      evidence: '互动率 2.74% / 收藏率 0.73% 四项最优，但样本仅 2 人',
      reason: '样本不足不作结论，方向值得小规模再验证',
      nextAction: '下一批分配 4 人小规模验证',
    },
  ]

  beforeAll(async () => {
    phaseModule = (await import('../campaign-manager')) as unknown as PhaseReportModule
  })


  it('Slice A: 人工写入的三分决策总表可落库并回读', () => {
    // 直接经 updatePhaseReport 写入（generatePhaseReport 的 LLM 产出同列存储）
    const db = (campaignManager as unknown as { getDb: () => { run: (sql: string, ...v: unknown[]) => void; query: (sql: string) => { get: (...v: unknown[]) => Record<string, unknown> } } })
    // 用 INSERT 造一条最小报告行，避免依赖 LLM
    db.getDb().run(
      `INSERT INTO campaign_phase_reports (id, campaign_id, phase, report_type, start_date, end_date, status, generated_by, created_at, updated_at)
       VALUES (?, ?, 1, 'phase', '2026-07-01', '2026-07-31', 'generated', 'manual', ?, ?)`,
      'report_test_decision', testCampaignId, Date.now(), Date.now()
    )
    reportId = 'report_test_decision'

    const updated = phaseModule.updatePhaseReport(reportId, { aiDecisions: decisions })
    expect(updated).not.toBeNull()
    expect(updated!.aiDecisions).toHaveLength(3)
  })

  it('Slice B: 回读报告时三分决策结构完整', () => {
    const report = phaseModule.getPhaseReport(reportId)
    expect(report).not.toBeNull()
    expect(report!.aiDecisions).toEqual(decisions)
    expect(report!.aiDecisions[0]!.decision).toBe('keep')
    expect(report!.aiDecisions[1]!.decision).toBe('stop')
    expect(report!.aiDecisions[2]!.decision).toBe('start')
    expect(report!.aiDecisions[0]!.evidence).toContain('CPE ¥3.47')
  })

  it('Slice C: 无决策的旧报告回读 aiDecisions 为空数组', () => {
    phaseModule.updatePhaseReport(reportId, { aiDecisions: [] })
    const report = phaseModule.getPhaseReport(reportId)
    expect(report!.aiDecisions).toEqual([])
  })

  afterAll(() => {
    phaseModule.deletePhaseReport(reportId)
  })
})
