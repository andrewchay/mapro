/**
 * Campaign 纯数据访问层
 *
 * 阶段 A 范围：
 * - Campaign 表的初始化、list/get/create/update
 * - 内容追踪表的 list/get（只读）
 *
 * 不包含：
 * - Agent Workspace 创建
 * - KOL 候选池导入
 * - Brief / 内容审核 / AB 测试
 * - 阶段复盘报告生成
 */

import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import type {
  Campaign,
  CampaignCreativePlan,
  CampaignPhasePlan,
  CreateCampaignInput,
  KOLContentTracking,
} from '@ma-proma/shared'
import type { AppContext } from '../context/types.ts'
import { getConfigDir } from '../context/config-paths.ts'
import { SqliteDatabase } from '../context/sqlite-adapter.ts'

export class CampaignRepository {
  private context: AppContext
  private dbInstance: SqliteDatabase | null = null

  constructor(context: AppContext) {
    this.context = context
  }

  private getDbPath(): string {
    return join(getConfigDir(this.context), 'campaign-database.sqlite')
  }

  private getDb(): SqliteDatabase {
    if (this.dbInstance) return this.dbInstance

    const dbPath = this.getDbPath()
    const dir = getConfigDir(this.context)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.dbInstance = new SqliteDatabase(dbPath)
    this.initSchema()
    return this.dbInstance
  }

  private initSchema(): void {
    const db = this.dbInstance!

    // Campaign 核心表
    db.run(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        brand TEXT NOT NULL,
        platform TEXT NOT NULL,
        budget INTEGER DEFAULT 0,
        duration_months INTEGER DEFAULT 1,
        target_city TEXT,
        target_audience TEXT,
        current_phase INTEGER DEFAULT 1,
        phase_plans TEXT,
        creative_plan TEXT,
        status TEXT DEFAULT 'draft',
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `)

    db.run(`CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_campaigns_brand ON campaigns(brand)`)

    const campaignColumns = db.query(`PRAGMA table_info(campaigns)`).all() as Array<{ name: string }>
    if (!campaignColumns.some((col) => col.name === 'phase_plans')) {
      db.run(`ALTER TABLE campaigns ADD COLUMN phase_plans TEXT`)
    }
    if (!campaignColumns.some((col) => col.name === 'creative_plan')) {
      db.run(`ALTER TABLE campaigns ADD COLUMN creative_plan TEXT`)
    }

    // 内容数据追踪表（阶段 A 只读）
    db.run(`
      CREATE TABLE IF NOT EXISTS kol_content_tracking (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        kol_id TEXT NOT NULL,
        kol_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        content_url TEXT,
        content_type TEXT DEFAULT 'organic',
        publish_date TEXT,
        exposure INTEGER DEFAULT 0,
        views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        saves INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        shares INTEGER DEFAULT 0,
        completion_rate REAL,
        cpm REAL,
        cpe REAL,
        ctr REAL,
        engagement_rate REAL,
        data_source TEXT DEFAULT 'manual',
        collected_at INTEGER,
        performance_grade TEXT DEFAULT 'pending',
        benchmark_comparison TEXT,
        ai_analysis TEXT,
        recommendations TEXT,
        paid_data TEXT,
        paid_spend REAL DEFAULT 0,
        paid_exposure INTEGER DEFAULT 0,
        paid_views INTEGER DEFAULT 0,
        paid_likes INTEGER DEFAULT 0,
        phase INTEGER DEFAULT 1,
        test_group TEXT DEFAULT '',
        note_type TEXT DEFAULT '',
        cost REAL DEFAULT 0,
        is_organic INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      )
    `)
    db.run(`CREATE INDEX IF NOT EXISTS idx_content_tracking_campaign ON kol_content_tracking(campaign_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_content_tracking_kol ON kol_content_tracking(kol_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_content_tracking_platform ON kol_content_tracking(platform)`)
  }

  listCampaigns(): Campaign[] {
    const db = this.getDb()
    const rows = db.query(`SELECT * FROM campaigns ORDER BY created_at DESC`).all() as Record<string, unknown>[]
    return rows.map((row) => rowToCampaign(row))
  }

  getCampaignById(id: string): Campaign | null {
    const db = this.getDb()
    const row = db.query(`SELECT * FROM campaigns WHERE id = ?`).get(id) as Record<string, unknown> | null
    return row ? rowToCampaign(row) : null
  }

  createCampaign(input: CreateCampaignInput): Campaign {
    const db = this.getDb()
    const now = Date.now()
    const id = generateId()
    const phasePlans = normalizePhasePlans(input.phasePlans, input.budget, input.durationMonths)
    const creativePlan = normalizeCreativePlan(input.creativePlan, {
      brand: input.brand,
      targetAudience: input.targetAudience,
    })

    db.run(
      `INSERT INTO campaigns (id, name, brand, platform, budget, duration_months, target_city, target_audience, current_phase, phase_plans, creative_plan, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.brand,
      input.platform,
      input.budget,
      input.durationMonths,
      JSON.stringify(input.targetCity),
      input.targetAudience,
      1,
      JSON.stringify(phasePlans),
      JSON.stringify(creativePlan),
      'draft',
      now,
      now,
    )

    return {
      id,
      name: input.name,
      brand: input.brand,
      platform: input.platform,
      budget: input.budget,
      durationMonths: input.durationMonths,
      targetCity: input.targetCity,
      targetAudience: input.targetAudience,
      currentPhase: 1,
      phasePlans,
      creativePlan,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
  }

  updateCampaign(
    id: string,
    updates: Partial<Pick<Campaign, 'name' | 'brand' | 'platform' | 'budget' | 'durationMonths' | 'targetCity' | 'targetAudience' | 'currentPhase' | 'phasePlans' | 'creativePlan' | 'status'>>,
  ): Campaign | null {
    const db = this.getDb()
    const campaign = this.getCampaignById(id)
    if (!campaign) return null

    const fields: string[] = []
    const values: unknown[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.brand !== undefined) { fields.push('brand = ?'); values.push(updates.brand) }
    if (updates.platform !== undefined) { fields.push('platform = ?'); values.push(updates.platform) }
    if (updates.budget !== undefined) { fields.push('budget = ?'); values.push(updates.budget) }
    if (updates.durationMonths !== undefined) { fields.push('duration_months = ?'); values.push(updates.durationMonths) }
    if (updates.targetCity !== undefined) { fields.push('target_city = ?'); values.push(JSON.stringify(updates.targetCity)) }
    if (updates.targetAudience !== undefined) { fields.push('target_audience = ?'); values.push(updates.targetAudience) }
    if (updates.currentPhase !== undefined) { fields.push('current_phase = ?'); values.push(updates.currentPhase) }
    if (updates.phasePlans !== undefined) { fields.push('phase_plans = ?'); values.push(JSON.stringify(updates.phasePlans)) }
    if (updates.creativePlan !== undefined) { fields.push('creative_plan = ?'); values.push(JSON.stringify(updates.creativePlan)) }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }

    if (fields.length === 0) return campaign

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(id)

    db.run(
      `UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`,
      ...values,
    )

    return this.getCampaignById(id)!
  }

  listContentTracking(campaignId: string): KOLContentTracking[] {
    const db = this.getDb()
    const rows = db.query(`SELECT * FROM kol_content_tracking WHERE campaign_id = ? ORDER BY created_at DESC`).all(campaignId) as Record<string, unknown>[]
    return rows.map(rowToContentTracking)
  }

  getContentTracking(id: string): KOLContentTracking | null {
    const db = this.getDb()
    const row = db.query('SELECT * FROM kol_content_tracking WHERE id = ?').get(id) as Record<string, unknown> | null
    return row ? rowToContentTracking(row) : null
  }
}

// =====================================================================
// 内部工具函数
// =====================================================================

const DEFAULT_PHASE_TEMPLATE: Array<Omit<CampaignPhasePlan, 'budget'>> = [
  { phase: 1, name: '美学吸睛期', months: '第 1-2 月', goal: '建立视觉认知，占领关键词' },
  { phase: 2, name: '场景渗透期', months: '第 3-4 月', goal: '场景绑定，情感连接' },
  { phase: 3, name: '价值深化期', months: '第 5-6 月', goal: '品牌护城河，长尾维护' },
]

function buildDefaultPhasePlans(budget: number, durationMonths: number): CampaignPhasePlan[] {
  const phaseBudget = Math.round(budget / Math.max(durationMonths, 1) * 2)
  return DEFAULT_PHASE_TEMPLATE.map((phase) => ({ ...phase, budget: phaseBudget }))
}

function normalizePhasePlans(value: unknown, budget: number, durationMonths: number): CampaignPhasePlan[] {
  if (!value) return buildDefaultPhasePlans(budget, durationMonths)

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (Array.isArray(parsed)) {
      return parsed.map((item, index) => {
        const raw = item as Partial<CampaignPhasePlan>
        const fallback = DEFAULT_PHASE_TEMPLATE[index] ?? DEFAULT_PHASE_TEMPLATE[0]!
        return {
          phase: Number(raw.phase ?? fallback.phase),
          name: String(raw.name ?? fallback.name),
          months: String(raw.months ?? fallback.months),
          goal: String(raw.goal ?? fallback.goal),
          budget: Number(raw.budget ?? Math.round(budget / Math.max(durationMonths, 1) * 2)),
        }
      })
    }
  } catch {
    // 兼容旧数据，回退到默认三阶段预算。
  }

  return buildDefaultPhasePlans(budget, durationMonths)
}

function buildDefaultCreativePlan(campaign: Pick<Campaign, 'brand' | 'targetAudience'>): CampaignCreativePlan {
  return {
    bigIdea: `${campaign.brand} 的生活方式种草`,
    coreMessage: `面向${campaign.targetAudience || '目标人群'}传递品牌价值与使用场景。`,
    contentPillars: ['产品体验', '生活场景', '用户口碑'],
    tone: '真实、克制、有质感',
    mandatoryElements: [campaign.brand],
    forbiddenElements: [],
  }
}

function normalizeCreativePlan(
  value: unknown,
  campaign: Pick<Campaign, 'brand' | 'targetAudience'>,
): CampaignCreativePlan {
  const fallback = buildDefaultCreativePlan(campaign)
  if (!value) return fallback

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (parsed && typeof parsed === 'object') {
      const raw = parsed as Partial<CampaignCreativePlan>
      return {
        bigIdea: String(raw.bigIdea ?? fallback.bigIdea),
        coreMessage: String(raw.coreMessage ?? fallback.coreMessage),
        contentPillars: Array.isArray(raw.contentPillars) ? raw.contentPillars.map(String) : fallback.contentPillars,
        tone: String(raw.tone ?? fallback.tone),
        mandatoryElements: Array.isArray(raw.mandatoryElements) ? raw.mandatoryElements.map(String) : fallback.mandatoryElements,
        forbiddenElements: Array.isArray(raw.forbiddenElements) ? raw.forbiddenElements.map(String) : fallback.forbiddenElements,
      }
    }
  } catch {
    // 兼容旧数据，回退到默认创意策略。
  }

  return fallback
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function rowToCampaign(row: Record<string, unknown>): Campaign {
  const parseTargetCity = (value: unknown): string[] => {
    if (!value) return []
    if (Array.isArray(value)) return value.map(String)
    const text = String(value)
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      // 兼容旧工具脚本直接写入的「上海、杭州」或「上海,杭州」字符串。
    }
    return text
      .split(/[、,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const budget = Number(row.budget ?? 0)
  const durationMonths = Number(row.duration_months ?? 1)
  const brand = String(row.brand)
  const targetAudience = String(row.target_audience ?? '')
  return {
    id: String(row.id),
    name: String(row.name),
    brand,
    platform: row.platform as Campaign['platform'],
    budget,
    durationMonths,
    targetCity: parseTargetCity(row.target_city),
    targetAudience,
    currentPhase: Number(row.current_phase ?? 1),
    phasePlans: normalizePhasePlans(row.phase_plans, budget, durationMonths),
    creativePlan: normalizeCreativePlan(row.creative_plan, { brand, targetAudience }),
    status: row.status as Campaign['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToContentTracking(row: Record<string, unknown>): KOLContentTracking {
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    kolId: String(row.kol_id),
    kolName: String(row.kol_name),
    platform: String(row.platform),
    contentUrl: String(row.content_url ?? ''),
    contentType: String(row.content_type ?? 'organic') as 'organic' | 'paid' | 'mixed',
    publishDate: String(row.publish_date ?? ''),
    exposure: Number(row.exposure ?? 0),
    views: Number(row.views ?? 0),
    likes: Number(row.likes ?? 0),
    saves: Number(row.saves ?? 0),
    comments: Number(row.comments ?? 0),
    shares: Number(row.shares ?? 0),
    completionRate: row.completion_rate != null ? Number(row.completion_rate) : undefined,
    cpm: Number(row.cpm ?? 0),
    cpe: Number(row.cpe ?? 0),
    ctr: Number(row.ctr ?? 0),
    engagementRate: Number(row.engagement_rate ?? 0),
    dataSource: String(row.data_source ?? 'manual') as 'api' | 'manual' | 'screenshot' | 'estimated',
    collectedAt: Number(row.collected_at ?? 0),
    performanceGrade: String(row.performance_grade ?? 'pending') as 'excellent' | 'good' | 'normal' | 'poor' | 'pending',
    benchmarkComparison: String(row.benchmark_comparison ?? ''),
    aiAnalysis: String(row.ai_analysis ?? ''),
    recommendations: String(row.recommendations ?? ''),
    paidData: String(row.paid_data ?? ''),
    paidSpend: Number(row.paid_spend ?? 0),
    paidExposure: Number(row.paid_exposure ?? 0),
    paidViews: Number(row.paid_views ?? 0),
    paidLikes: Number(row.paid_likes ?? 0),
    phase: Number(row.phase ?? 1),
    testGroup: String(row.test_group ?? ''),
    noteType: String(row.note_type ?? ''),
    cost: Number(row.cost ?? 0),
    isOrganic: Boolean(row.is_organic ?? 1),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}
