/**
 * Campaign 纯数据访问层（基于 DbProvider 抽象）
 *
 * 阶段 B1 范围：
 * - 在 B0 基础上补齐 Brief / 内容追踪 / 数据标准基准的 CRUD 与计算
 * - 保留 SQLite 方言的 Schema 初始化逻辑（内部版仍使用 SQLite）
 * - 候选池导入（依赖 KOL 数据库）放到 Slice 2
 *
 * 不包含：
 * - Agent Workspace 创建
 * - 工作流服务
 * - 阶段复盘报告 / A/B 测试
 * - LLM AI 分析（保留纯本地计算）
 */

import type {
  Campaign,
  CampaignBrief,
  CampaignCreativePlan,
  CampaignKOLPoolItem,
  CampaignPhasePlan,
  ContentAudit,
  ContentBenchmark,
  CreateBenchmarkInput,
  CreateCampaignInput,
  CreateContentAuditInput,
  CreateContentTrackingInput,
  KOLContentTracking,
  SaveCampaignBriefInput,
  UpdateAnalysisInput,
  UpdateContentTrackingDataInput,
  AddPaidDataInput,
} from '@ma-proma/shared'
import type { DbProvider } from '../db/types.ts'
import type { UserContext } from '../context/types.ts'
import { BuiltInRoles } from '../auth/rbac-constants.ts'

export interface CampaignRepositoryOptions {
  db: DbProvider
  userContext?: UserContext
}

export class CampaignRepository {
  private db: DbProvider
  private userContext?: UserContext

  constructor(options: CampaignRepositoryOptions | DbProvider) {
    if ('db' in options) {
      this.db = options.db
      this.userContext = options.userContext
    } else {
      this.db = options
    }
  }

  /** 是否可访问全部数据（系统账号、super_admin、通配权限） */
  private canAccessAll(): boolean {
    if (!this.userContext) return true
    if (this.userContext.isSystemAccount) return true
    if (this.userContext.roles.includes(BuiltInRoles.SUPER_ADMIN)) return true
    if (this.userContext.permissions.includes('*')) return true
    return false
  }

  /** 当前用户的 tenant_id */
  private get tenantId(): string {
    return this.userContext?.tenantId ?? 'default'
  }

  /** 当前用户的 owner_id */
  private get ownerId(): string {
    return this.userContext?.userId ?? 'legacy'
  }

  /** 生成 WHERE 子句片段（含 leading space）与参数 */
  private ownerFilter(tableAlias = ''): { sql: string; params: unknown[] } {
    if (this.canAccessAll()) return { sql: '', params: [] }
    const prefix = tableAlias ? `${tableAlias}.` : ''
    return {
      sql: ` AND ${prefix}tenant_id = $T AND ${prefix}owner_id = $O`,
      params: [this.tenantId, this.ownerId],
    }
  }

  /** 用占位符序号替换 $T/$O */
  private applyParamIndex(sql: string, baseIndex: number): string {
    return sql.replace(/\$T/g, `$${baseIndex}`).replace(/\$O/g, `$${baseIndex + 1}`)
  }

  async initSchema(): Promise<void> {
    const db = this.db

    // Campaign 核心表
    await db.exec(`
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
        owner_id TEXT,
        tenant_id TEXT DEFAULT 'default' NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    await db.exec(`CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_campaigns_brand ON campaigns(brand)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_campaigns_owner ON campaigns(tenant_id, owner_id)`)

    const campaignColumns = await db.listTableColumns('campaigns')
    if (!campaignColumns.includes('phase_plans')) {
      await db.exec(`ALTER TABLE campaigns ADD COLUMN phase_plans TEXT`)
    }
    if (!campaignColumns.includes('creative_plan')) {
      await db.exec(`ALTER TABLE campaigns ADD COLUMN creative_plan TEXT`)
    }
    if (!campaignColumns.includes('owner_id')) {
      await db.exec(`ALTER TABLE campaigns ADD COLUMN owner_id TEXT`)
      await db.exec(`UPDATE campaigns SET owner_id = 'legacy', tenant_id = 'default' WHERE owner_id IS NULL`)
    }
    if (!campaignColumns.includes('tenant_id')) {
      await db.exec(`ALTER TABLE campaigns ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL`)
    }

    // Campaign KOL 候选池表
    await db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_kol_pool (
        campaign_id TEXT NOT NULL,
        kol_id TEXT NOT NULL,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        followers TEXT,
        engagement TEXT,
        category TEXT,
        price TEXT,
        city TEXT,
        status TEXT DEFAULT 'candidate',
        notes TEXT,
        added_at INTEGER,
        owner_id TEXT,
        tenant_id TEXT DEFAULT 'default' NOT NULL,
        PRIMARY KEY (campaign_id, kol_id),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
      )
    `)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_campaign ON campaign_kol_pool(campaign_id)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_status ON campaign_kol_pool(status)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_platform ON campaign_kol_pool(platform)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_owner ON campaign_kol_pool(tenant_id, owner_id)`)

    const poolColumns = await db.listTableColumns('campaign_kol_pool')
    if (!poolColumns.includes('owner_id')) {
      await db.exec(`ALTER TABLE campaign_kol_pool ADD COLUMN owner_id TEXT`)
      await db.exec(`UPDATE campaign_kol_pool SET owner_id = 'legacy', tenant_id = 'default' WHERE owner_id IS NULL`)
    }
    if (!poolColumns.includes('tenant_id')) {
      await db.exec(`ALTER TABLE campaign_kol_pool ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL`)
    }

    // KOL Brief 表（B1 新增）
    await db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_briefs (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        kol_id TEXT NOT NULL,
        kol_name TEXT NOT NULL,
        content TEXT NOT NULL,
        ai_generated INTEGER DEFAULT 0,
        status TEXT DEFAULT 'draft',
        owner_id TEXT,
        tenant_id TEXT DEFAULT 'default' NOT NULL,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(campaign_id, kol_id)
      )
    `)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_briefs_campaign ON campaign_briefs(campaign_id)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_briefs_kol ON campaign_briefs(kol_id)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_briefs_owner ON campaign_briefs(tenant_id, owner_id)`)

    const briefColumns = await db.listTableColumns('campaign_briefs')
    if (!briefColumns.includes('owner_id')) {
      await db.exec(`ALTER TABLE campaign_briefs ADD COLUMN owner_id TEXT`)
      await db.exec(`UPDATE campaign_briefs SET owner_id = 'legacy', tenant_id = 'default' WHERE owner_id IS NULL`)
    }
    if (!briefColumns.includes('tenant_id')) {
      await db.exec(`ALTER TABLE campaign_briefs ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL`)
    }

    // 内容数据追踪表
    await db.exec(`
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
        owner_id TEXT,
        tenant_id TEXT DEFAULT 'default' NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_content_tracking_campaign ON kol_content_tracking(campaign_id)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_content_tracking_kol ON kol_content_tracking(kol_id)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_content_tracking_platform ON kol_content_tracking(platform)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_content_tracking_owner ON kol_content_tracking(tenant_id, owner_id)`)

    const trackingColumns = await db.listTableColumns('kol_content_tracking')
    if (!trackingColumns.includes('owner_id')) {
      await db.exec(`ALTER TABLE kol_content_tracking ADD COLUMN owner_id TEXT`)
      await db.exec(`UPDATE kol_content_tracking SET owner_id = 'legacy', tenant_id = 'default' WHERE owner_id IS NULL`)
    }
    if (!trackingColumns.includes('tenant_id')) {
      await db.exec(`ALTER TABLE kol_content_tracking ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL`)
    }

    // 数据标准基准表（B1 新增）
    await db.exec(`
      CREATE TABLE IF NOT EXISTS content_benchmarks (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        price_tier TEXT NOT NULL,
        followers_range TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        excellent_threshold REAL DEFAULT 0,
        good_threshold REAL DEFAULT 0,
        normal_threshold REAL DEFAULT 0,
        description TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(platform, price_tier, followers_range, metric_name)
      )
    `)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_benchmarks_platform ON content_benchmarks(platform)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_benchmarks_tier ON content_benchmarks(price_tier)`)

    // 内容审核表（B1 新增）
    await db.exec(`
      CREATE TABLE IF NOT EXISTS content_audits (
        audit_id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        kol_id TEXT NOT NULL,
        kol_name TEXT NOT NULL,
        content_url TEXT,
        platform TEXT NOT NULL,
        audit_status TEXT DEFAULT 'pending',
        compliance_score INTEGER DEFAULT 0,
        brand_alignment_score INTEGER DEFAULT 0,
        quality_score INTEGER DEFAULT 0,
        overall_score INTEGER DEFAULT 0,
        audit_report TEXT,
        auditor TEXT,
        owner_id TEXT,
        tenant_id TEXT DEFAULT 'default' NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_content_audits_campaign ON content_audits(campaign_id)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_content_audits_kol ON content_audits(kol_id)`)
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_content_audits_owner ON content_audits(tenant_id, owner_id)`)

    const auditColumns = await db.listTableColumns('content_audits')
    if (!auditColumns.includes('owner_id')) {
      await db.exec(`ALTER TABLE content_audits ADD COLUMN owner_id TEXT`)
      await db.exec(`UPDATE content_audits SET owner_id = 'legacy', tenant_id = 'default' WHERE owner_id IS NULL`)
    }
    if (!auditColumns.includes('tenant_id')) {
      await db.exec(`ALTER TABLE content_audits ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL`)
    }

    await this.seedContentBenchmarks()
  }

  // =====================================================================
  // Campaign 基础 CRUD
  // =====================================================================

  async listCampaigns(): Promise<Campaign[]> {
    const filter = this.ownerFilter()
    const sql = `SELECT * FROM campaigns${filter.sql ? ' WHERE 1=1' + filter.sql : ''} ORDER BY created_at DESC`
    const { rows } = await this.db.query<Record<string, unknown>>(
      this.applyParamIndex(sql, 1),
      filter.params,
    )
    return rows.map((row) => rowToCampaign(row))
  }

  async getCampaignById(id: string): Promise<Campaign | null> {
    const filter = this.ownerFilter()
    const sql = `SELECT * FROM campaigns WHERE id = $1${filter.sql}`
    const params = [id, ...filter.params]
    const row = await this.db.queryOne<Record<string, unknown>>(
      this.applyParamIndex(sql, 2),
      params,
    )
    return row ? rowToCampaign(row) : null
  }

  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    const now = Date.now()
    const id = generateId()
    const budget = input.budget ?? 0
    const durationMonths = input.durationMonths ?? 1
    const platform = input.platform ?? 'xiaohongshu'
    const targetCity = input.targetCity ?? []
    const targetAudience = input.targetAudience ?? ''
    const phasePlans = normalizePhasePlans(input.phasePlans, budget, durationMonths)
    const creativePlan = normalizeCreativePlan(input.creativePlan, {
      brand: input.brand,
      targetAudience,
    })

    await this.db.execute(
      `INSERT INTO campaigns (id, name, brand, platform, budget, duration_months, target_city, target_audience, current_phase, phase_plans, creative_plan, status, owner_id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        id,
        input.name,
        input.brand,
        platform,
        budget,
        durationMonths,
        JSON.stringify(targetCity),
        targetAudience,
        1,
        JSON.stringify(phasePlans),
        JSON.stringify(creativePlan),
        'draft',
        this.ownerId,
        this.tenantId,
        now,
        now,
      ]
    )

    return {
      id,
      name: input.name,
      brand: input.brand,
      platform,
      budget,
      durationMonths,
      targetCity,
      targetAudience,
      currentPhase: 1,
      phasePlans,
      creativePlan,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
  }

  async updateCampaign(
    id: string,
    updates: Partial<Pick<Campaign, 'name' | 'brand' | 'platform' | 'budget' | 'durationMonths' | 'targetCity' | 'targetAudience' | 'currentPhase' | 'phasePlans' | 'creativePlan' | 'status'>>,
  ): Promise<Campaign | null> {
    const campaign = await this.getCampaignById(id)
    if (!campaign) return null

    const fields: string[] = []
    const values: unknown[] = []

    if (updates.name !== undefined) { fields.push('name = $' + (values.length + 1)); values.push(updates.name) }
    if (updates.brand !== undefined) { fields.push('brand = $' + (values.length + 1)); values.push(updates.brand) }
    if (updates.platform !== undefined) { fields.push('platform = $' + (values.length + 1)); values.push(updates.platform) }
    if (updates.budget !== undefined) { fields.push('budget = $' + (values.length + 1)); values.push(updates.budget) }
    if (updates.durationMonths !== undefined) { fields.push('duration_months = $' + (values.length + 1)); values.push(updates.durationMonths) }
    if (updates.targetCity !== undefined) { fields.push('target_city = $' + (values.length + 1)); values.push(JSON.stringify(updates.targetCity)) }
    if (updates.targetAudience !== undefined) { fields.push('target_audience = $' + (values.length + 1)); values.push(updates.targetAudience) }
    if (updates.currentPhase !== undefined) { fields.push('current_phase = $' + (values.length + 1)); values.push(updates.currentPhase) }
    if (updates.phasePlans !== undefined) { fields.push('phase_plans = $' + (values.length + 1)); values.push(JSON.stringify(updates.phasePlans)) }
    if (updates.creativePlan !== undefined) { fields.push('creative_plan = $' + (values.length + 1)); values.push(JSON.stringify(updates.creativePlan)) }
    if (updates.status !== undefined) { fields.push('status = $' + (values.length + 1)); values.push(updates.status) }

    if (fields.length === 0) return campaign

    fields.push('updated_at = $' + (values.length + 1))
    values.push(Date.now())

    const filter = this.ownerFilter()
    const idIndex = values.length + 1
    const whereSql = `WHERE id = $${idIndex}${this.applyParamIndex(filter.sql, idIndex + 1)}`
    const params = [...values, id, ...filter.params]

    await this.db.execute(
      `UPDATE campaigns SET ${fields.join(', ')} ${whereSql}`,
      params,
    )

    return this.getCampaignById(id)
  }

  // =====================================================================
  // KOL 候选池（只读；导入写入放到 Slice 2）
  // =====================================================================

  async getPoolKOLs(campaignId: string): Promise<CampaignKOLPoolItem[]> {
    const filter = this.ownerFilter()
    const sql = `SELECT * FROM campaign_kol_pool WHERE campaign_id = $1${filter.sql} ORDER BY added_at DESC`
    const params = [campaignId, ...filter.params]
    const { rows } = await this.db.query<Record<string, unknown>>(
      this.applyParamIndex(sql, 2),
      params,
    )
    return rows.map(rowToPoolItem)
  }

  async addPoolKOL(item: Omit<CampaignKOLPoolItem, 'addedAt' | 'status' | 'notes'> & { status?: CampaignKOLPoolItem['status']; notes?: string }): Promise<void> {
    await this.db.execute(
      `INSERT INTO campaign_kol_pool (campaign_id, kol_id, name, platform, followers, engagement, category, price, city, status, added_at, owner_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        item.campaignId,
        item.kolId,
        item.name,
        item.platform,
        item.followers,
        item.engagement,
        item.category,
        item.price,
        item.city,
        item.status ?? 'candidate',
        Date.now(),
        this.ownerId,
        this.tenantId,
      ]
    )
  }

  // =====================================================================
  // KOL Brief
  // =====================================================================

  async getBrief(campaignId: string, kolId: string): Promise<CampaignBrief | null> {
    const filter = this.ownerFilter()
    const sql = `SELECT * FROM campaign_briefs WHERE campaign_id = $1 AND kol_id = $2${filter.sql}`
    const params = [campaignId, kolId, ...filter.params]
    const row = await this.db.queryOne<Record<string, unknown>>(
      this.applyParamIndex(sql, 3),
      params,
    )
    return row ? rowToBrief(row) : null
  }

  async saveBrief(input: SaveCampaignBriefInput): Promise<CampaignBrief> {
    const now = Date.now()
    const filter = this.ownerFilter()
    const existingSql = `SELECT id FROM campaign_briefs WHERE campaign_id = $1 AND kol_id = $2${filter.sql}`
    const existingParams = [input.campaignId, input.kolId, ...filter.params]
    const existing = await this.db.queryOne<{ id: string }>(
      this.applyParamIndex(existingSql, 3),
      existingParams,
    )

    if (existing) {
      const updateFilter = this.ownerFilter()
      const updateSql = `UPDATE campaign_briefs
         SET content = $1, kol_name = $2, ai_generated = $3, status = $4, updated_at = $5
         WHERE id = $6${updateFilter.sql}`
      const updateParams = [input.content, input.kolName, input.aiGenerated ? 1 : 0, 'draft', now, existing.id, ...updateFilter.params]
      await this.db.execute(
        this.applyParamIndex(updateSql, 7),
        updateParams,
      )
      const updated = await this.getBrief(input.campaignId, input.kolId)
      return updated!
    }

    const id = generateId()
    await this.db.execute(
      `INSERT INTO campaign_briefs (id, campaign_id, kol_id, kol_name, content, ai_generated, status, owner_id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, input.campaignId, input.kolId, input.kolName, input.content, input.aiGenerated ? 1 : 0, 'draft', this.ownerId, this.tenantId, now, now]
    )

    const created = await this.getBrief(input.campaignId, input.kolId)
    return created!
  }

  generateBriefTemplate(campaign: Campaign, kol: CampaignKOLPoolItem): string {
    const platformLabel: Record<string, string> = {
      xiaohongshu: '小红书',
      douyin: '抖音',
    }

    return `# ${campaign.brand} × ${kol.name} 合作 Brief

## 合作背景
- **品牌**：${campaign.brand}
- **项目**：${campaign.name}
- **投放平台**：${platformLabel[campaign.platform] ?? campaign.platform}
- **目标人群**：${campaign.targetAudience || '待补充'}
- **投放周期**：${campaign.durationMonths} 个月

## KOL 画像
- **账号**：${kol.name}
- **平台**：${kol.platform}
- **粉丝量**：${kol.followers}
- **互动率**：${kol.engagement}
- **内容类目**：${kol.category}
${kol.city ? `- **所在城市**：${kol.city}` : ''}
${kol.price ? `- **合作报价**：${kol.price}` : ''}

## 内容方向（三阶段投放策略）

### 第一阶段：美学吸睛期（建立视觉认知）
- 产品开箱 / 颜值展示
- 强调包装设计、色彩美学
- 适配 ${kol.platform} 平台视觉调性

### 第二阶段：场景渗透期（场景绑定）
- 都市女性生活场景植入
- 办公室下午茶 / 健身后补充 / 旅行便携
- 情感共鸣：忙碌生活中的品质小确幸

### 第三阶段：价值深化期（品牌护城河）
- 品牌理念传递：天然、健康、可持续
- 与其他品牌的差异化对比
- 用户证言 / 复购理由

## 内容要求
- [ ] 必须露出品牌名「${campaign.brand}」
- [ ] 强调核心卖点：天然、健康、品质
- [ ] 内容风格适配 ${kol.platform} 平台调性
- [ ] 避免过度营销感，保持真实分享感

## 交付要求
- 笔记/视频数量：____ 条
- 发布时间：配合 Campaign 整体排期
- 需提前 3 天提交内容审核
- 发布后 7 天内提供数据截图

## 审核标准
- 内容真实、有情感共鸣
- 产品露出自然不生硬
- 评论区互动积极回应
- 无负面舆情风险

---
*此 Brief 由 MAPro 自动生成，可根据实际合作需求调整。*
`
  }

  // =====================================================================
  // 内容数据追踪
  // =====================================================================

  async getContentTracking(id: string): Promise<KOLContentTracking | null> {
    const filter = this.ownerFilter()
    const sql = `SELECT * FROM kol_content_tracking WHERE id = $1${filter.sql}`
    const params = [id, ...filter.params]
    const row = await this.db.queryOne<Record<string, unknown>>(
      this.applyParamIndex(sql, 2),
      params,
    )
    return row ? rowToContentTracking(row) : null
  }

  async listContentTracking(campaignId: string): Promise<KOLContentTracking[]> {
    const filter = this.ownerFilter()
    const sql = `SELECT * FROM kol_content_tracking WHERE campaign_id = $1${filter.sql} ORDER BY created_at DESC`
    const params = [campaignId, ...filter.params]
    const { rows } = await this.db.query<Record<string, unknown>>(
      this.applyParamIndex(sql, 2),
      params,
    )
    return rows.map(rowToContentTracking)
  }

  async createContentTracking(input: CreateContentTrackingInput): Promise<KOLContentTracking> {
    const now = Date.now()
    const id = generateTrackingId()
    const estimatedPrice = input.paidSpend ?? 0
    const metrics = calculateMetrics({
      exposure: input.exposure,
      views: input.views,
      likes: input.likes,
      saves: input.saves,
      comments: input.comments,
      shares: input.shares,
      estimatedPrice,
    })

    await this.db.execute(
      `INSERT INTO kol_content_tracking (
        id, campaign_id, kol_id, kol_name, platform, content_url, content_type, publish_date,
        exposure, views, likes, saves, comments, shares, completion_rate,
        cpm, cpe, ctr, engagement_rate, data_source, collected_at,
        performance_grade, benchmark_comparison, paid_spend, created_at, updated_at,
        phase, test_group, note_type, cost, is_organic, owner_id, tenant_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)`,
      [
        id,
        input.campaignId,
        input.kolId,
        input.kolName,
        input.platform,
        input.contentUrl,
        input.contentType,
        input.publishDate,
        input.exposure,
        input.views,
        input.likes,
        input.saves,
        input.comments,
        input.shares,
        input.completionRate ?? null,
        metrics.cpm,
        metrics.cpe,
        metrics.ctr,
        metrics.engagementRate,
        input.dataSource,
        now,
        'pending',
        '',
        estimatedPrice,
        now,
        now,
        input.phase ?? 1,
        input.testGroup ?? '',
        input.noteType ?? '',
        input.cost ?? 0,
        input.isOrganic ?? true ? 1 : 0,
        this.ownerId,
        this.tenantId,
      ]
    )

    const created = await this.getContentTracking(id)
    return created!
  }

  async updateContentTrackingData(input: UpdateContentTrackingDataInput): Promise<KOLContentTracking | null> {
    const existing = await this.getContentTracking(input.id)
    if (!existing) return null

    const estimatedPrice = existing.paidSpend > 0 ? existing.paidSpend : 0
    const metrics = calculateMetrics({
      exposure: input.exposure,
      views: input.views,
      likes: input.likes,
      saves: input.saves,
      comments: input.comments,
      shares: input.shares,
      estimatedPrice,
    })
    const now = Date.now()

    const filter = this.ownerFilter()
    const updateSql = `UPDATE kol_content_tracking SET
        exposure = $1, views = $2, likes = $3, saves = $4, comments = $5, shares = $6,
        completion_rate = $7, cpm = $8, cpe = $9, ctr = $10, engagement_rate = $11,
        data_source = $12, collected_at = $13, updated_at = $14
       WHERE id = $15${filter.sql}`
    const updateParams = [
      input.exposure,
      input.views,
      input.likes,
      input.saves,
      input.comments,
      input.shares,
      input.completionRate ?? null,
      metrics.cpm,
      metrics.cpe,
      metrics.ctr,
      metrics.engagementRate,
      input.dataSource,
      now,
      now,
      input.id,
      ...filter.params,
    ]
    await this.db.execute(
      this.applyParamIndex(updateSql, 16),
      updateParams,
    )

    return this.getContentTracking(input.id)
  }

  async addPaidData(input: AddPaidDataInput): Promise<KOLContentTracking | null> {
    const now = Date.now()
    const paidFilter = this.ownerFilter()
    const paidSql = `UPDATE kol_content_tracking SET
        paid_spend = $1, paid_exposure = $2, paid_views = $3, paid_likes = $4,
        paid_data = $5, updated_at = $6
       WHERE id = $7${paidFilter.sql}`
    const paidParams = [input.paidSpend, input.paidExposure, input.paidViews, input.paidLikes, input.paidData, now, input.id, ...paidFilter.params]
    await this.db.execute(
      this.applyParamIndex(paidSql, 8),
      paidParams,
    )
    return this.getContentTracking(input.id)
  }

  async updateContentTrackingAnalysis(input: UpdateAnalysisInput): Promise<KOLContentTracking | null> {
    const now = Date.now()
    const analysisFilter = this.ownerFilter()
    const analysisSql = `UPDATE kol_content_tracking SET
        performance_grade = $1, benchmark_comparison = $2, ai_analysis = $3,
        recommendations = $4, updated_at = $5
       WHERE id = $6${analysisFilter.sql}`
    const analysisParams = [input.performanceGrade, input.benchmarkComparison, input.aiAnalysis, input.recommendations, now, input.id, ...analysisFilter.params]
    await this.db.execute(
      this.applyParamIndex(analysisSql, 7),
      analysisParams,
    )
    return this.getContentTracking(input.id)
  }

  async deleteContentTracking(id: string): Promise<boolean> {
    const filter = this.ownerFilter()
    const sql = `DELETE FROM kol_content_tracking WHERE id = $1${filter.sql}`
    const params = [id, ...filter.params]
    const result = await this.db.execute(this.applyParamIndex(sql, 2), params)
    return result.changes > 0
  }

  // =====================================================================
  // 内容审核
  // =====================================================================

  async getContentAudit(auditId: string): Promise<ContentAudit | null> {
    const filter = this.ownerFilter()
    const sql = `SELECT * FROM content_audits WHERE audit_id = $1${filter.sql}`
    const params = [auditId, ...filter.params]
    const row = await this.db.queryOne<Record<string, unknown>>(
      this.applyParamIndex(sql, 2),
      params,
    )
    return row ? rowToContentAudit(row) : null
  }

  async listContentAudits(campaignId: string): Promise<ContentAudit[]> {
    const filter = this.ownerFilter()
    const sql = `SELECT * FROM content_audits WHERE campaign_id = $1${filter.sql} ORDER BY created_at DESC`
    const params = [campaignId, ...filter.params]
    const { rows } = await this.db.query<Record<string, unknown>>(
      this.applyParamIndex(sql, 2),
      params,
    )
    return rows.map(rowToContentAudit)
  }

  async createContentAudit(input: CreateContentAuditInput & {
    auditStatus: ContentAudit['auditStatus']
    complianceScore: number
    brandAlignmentScore: number
    qualityScore: number
    overallScore: number
    auditReport: string
    auditor: string
  }): Promise<ContentAudit> {
    const now = Date.now()
    const auditId = generateAuditId()

    await this.db.execute(
      `INSERT INTO content_audits (
        audit_id, campaign_id, kol_id, kol_name, content_url, platform,
        audit_status, compliance_score, brand_alignment_score, quality_score, overall_score,
        audit_report, auditor, owner_id, tenant_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        auditId,
        input.campaignId,
        input.kolId,
        input.kolName,
        input.contentUrl ?? '',
        input.platform,
        input.auditStatus,
        input.complianceScore,
        input.brandAlignmentScore,
        input.qualityScore,
        input.overallScore,
        input.auditReport,
        input.auditor,
        this.ownerId,
        this.tenantId,
        now,
        now,
      ]
    )

    const created = await this.getContentAudit(auditId)
    return created!
  }

  // =====================================================================
  // 数据标准基准
  // =====================================================================

  async seedContentBenchmarks(): Promise<void> {
    const { rows: countRows } = await this.db.query<{ total: number }>('SELECT COUNT(*) as total FROM content_benchmarks')
    if ((countRows[0]?.total ?? 0) > 0) return

    const now = Date.now()
    const benchmarks: Array<Omit<ContentBenchmark, 'id' | 'createdAt' | 'updatedAt'>> = [
      // 小红书
      { platform: '小红书', priceTier: 'budget', followersRange: '10k-100k', metricName: 'ctr', excellentThreshold: 10, goodThreshold: 8, normalThreshold: 5, description: '点击率（浏览/曝光）' },
      { platform: '小红书', priceTier: 'budget', followersRange: '10k-100k', metricName: 'engagement_rate', excellentThreshold: 8, goodThreshold: 5, normalThreshold: 3, description: '互动率（总互动/曝光）' },
      { platform: '小红书', priceTier: 'budget', followersRange: '10k-100k', metricName: 'cpm', excellentThreshold: 50, goodThreshold: 100, normalThreshold: 200, description: '千次曝光成本（元），越低越好' },
      { platform: '小红书', priceTier: 'budget', followersRange: '10k-100k', metricName: 'cpe', excellentThreshold: 5, goodThreshold: 10, normalThreshold: 20, description: '单次互动成本（元），越低越好' },
      { platform: '小红书', priceTier: 'mid', followersRange: '100k-1m', metricName: 'ctr', excellentThreshold: 12, goodThreshold: 9, normalThreshold: 6, description: '点击率（浏览/曝光）' },
      { platform: '小红书', priceTier: 'mid', followersRange: '100k-1m', metricName: 'engagement_rate', excellentThreshold: 10, goodThreshold: 7, normalThreshold: 4, description: '互动率（总互动/曝光）' },
      { platform: '小红书', priceTier: 'mid', followersRange: '100k-1m', metricName: 'cpm', excellentThreshold: 80, goodThreshold: 150, normalThreshold: 300, description: '千次曝光成本（元），越低越好' },
      { platform: '小红书', priceTier: 'mid', followersRange: '100k-1m', metricName: 'cpe', excellentThreshold: 8, goodThreshold: 15, normalThreshold: 30, description: '单次互动成本（元），越低越好' },
      { platform: '小红书', priceTier: 'premium', followersRange: '1m+', metricName: 'ctr', excellentThreshold: 15, goodThreshold: 11, normalThreshold: 7, description: '点击率（浏览/曝光）' },
      { platform: '小红书', priceTier: 'premium', followersRange: '1m+', metricName: 'engagement_rate', excellentThreshold: 12, goodThreshold: 8, normalThreshold: 5, description: '互动率（总互动/曝光）' },
      { platform: '小红书', priceTier: 'premium', followersRange: '1m+', metricName: 'cpm', excellentThreshold: 120, goodThreshold: 200, normalThreshold: 400, description: '千次曝光成本（元），越低越好' },
      { platform: '小红书', priceTier: 'premium', followersRange: '1m+', metricName: 'cpe', excellentThreshold: 12, goodThreshold: 20, normalThreshold: 40, description: '单次互动成本（元），越低越好' },
      // 抖音
      { platform: '抖音', priceTier: 'budget', followersRange: '10k-100k', metricName: 'ctr', excellentThreshold: 8, goodThreshold: 6, normalThreshold: 4, description: '点击率（浏览/曝光）' },
      { platform: '抖音', priceTier: 'budget', followersRange: '10k-100k', metricName: 'engagement_rate', excellentThreshold: 6, goodThreshold: 4, normalThreshold: 2, description: '互动率（总互动/曝光）' },
      { platform: '抖音', priceTier: 'budget', followersRange: '10k-100k', metricName: 'cpm', excellentThreshold: 40, goodThreshold: 80, normalThreshold: 150, description: '千次曝光成本（元），越低越好' },
      { platform: '抖音', priceTier: 'budget', followersRange: '10k-100k', metricName: 'cpe', excellentThreshold: 4, goodThreshold: 8, normalThreshold: 15, description: '单次互动成本（元），越低越好' },
      { platform: '抖音', priceTier: 'mid', followersRange: '100k-1m', metricName: 'ctr', excellentThreshold: 10, goodThreshold: 7, normalThreshold: 4, description: '点击率（浏览/曝光）' },
      { platform: '抖音', priceTier: 'mid', followersRange: '100k-1m', metricName: 'engagement_rate', excellentThreshold: 8, goodThreshold: 5, normalThreshold: 3, description: '互动率（总互动/曝光）' },
      { platform: '抖音', priceTier: 'mid', followersRange: '100k-1m', metricName: 'cpm', excellentThreshold: 60, goodThreshold: 120, normalThreshold: 250, description: '千次曝光成本（元），越低越好' },
      { platform: '抖音', priceTier: 'mid', followersRange: '100k-1m', metricName: 'cpe', excellentThreshold: 6, goodThreshold: 12, normalThreshold: 25, description: '单次互动成本（元），越低越好' },
      { platform: '抖音', priceTier: 'premium', followersRange: '1m+', metricName: 'ctr', excellentThreshold: 12, goodThreshold: 9, normalThreshold: 6, description: '点击率（浏览/曝光）' },
      { platform: '抖音', priceTier: 'premium', followersRange: '1m+', metricName: 'engagement_rate', excellentThreshold: 10, goodThreshold: 7, normalThreshold: 4, description: '互动率（总互动/曝光）' },
      { platform: '抖音', priceTier: 'premium', followersRange: '1m+', metricName: 'cpm', excellentThreshold: 100, goodThreshold: 180, normalThreshold: 350, description: '千次曝光成本（元），越低越好' },
      { platform: '抖音', priceTier: 'premium', followersRange: '1m+', metricName: 'cpe', excellentThreshold: 10, goodThreshold: 18, normalThreshold: 35, description: '单次互动成本（元），越低越好' },
      // 微博
      { platform: '微博', priceTier: 'budget', followersRange: '10k-100k', metricName: 'ctr', excellentThreshold: 5, goodThreshold: 3, normalThreshold: 2, description: '点击率（浏览/曝光）' },
      { platform: '微博', priceTier: 'budget', followersRange: '10k-100k', metricName: 'engagement_rate', excellentThreshold: 4, goodThreshold: 2.5, normalThreshold: 1.5, description: '互动率（总互动/曝光）' },
      { platform: '微博', priceTier: 'budget', followersRange: '10k-100k', metricName: 'cpm', excellentThreshold: 30, goodThreshold: 60, normalThreshold: 120, description: '千次曝光成本（元），越低越好' },
      { platform: '微博', priceTier: 'budget', followersRange: '10k-100k', metricName: 'cpe', excellentThreshold: 3, goodThreshold: 6, normalThreshold: 12, description: '单次互动成本（元），越低越好' },
      { platform: '微博', priceTier: 'mid', followersRange: '100k-1m', metricName: 'ctr', excellentThreshold: 7, goodThreshold: 5, normalThreshold: 3, description: '点击率（浏览/曝光）' },
      { platform: '微博', priceTier: 'mid', followersRange: '100k-1m', metricName: 'engagement_rate', excellentThreshold: 6, goodThreshold: 4, normalThreshold: 2, description: '互动率（总互动/曝光）' },
      { platform: '微博', priceTier: 'mid', followersRange: '100k-1m', metricName: 'cpm', excellentThreshold: 50, goodThreshold: 100, normalThreshold: 200, description: '千次曝光成本（元），越低越好' },
      { platform: '微博', priceTier: 'mid', followersRange: '100k-1m', metricName: 'cpe', excellentThreshold: 5, goodThreshold: 10, normalThreshold: 20, description: '单次互动成本（元），越低越好' },
    ]

    for (const bm of benchmarks) {
      await this.db.execute(
        `INSERT INTO content_benchmarks (id, platform, price_tier, followers_range, metric_name, excellent_threshold, good_threshold, normal_threshold, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [generateBenchmarkId(), bm.platform, bm.priceTier, bm.followersRange, bm.metricName, bm.excellentThreshold, bm.goodThreshold, bm.normalThreshold, bm.description, now, now]
      )
    }
  }

  async analyzeContentPerformance(
    platform: string,
    priceTier: string,
    followersRange: string,
    ctr: number,
    engagementRate: number,
    cpm: number,
    cpe: number,
  ): Promise<{ grade: 'excellent' | 'good' | 'normal' | 'poor'; comparison: Record<string, unknown> }> {
    const { rows } = await this.db.query<{
      metric_name: string
      excellent_threshold: number
      good_threshold: number
      normal_threshold: number
    }>(
      `SELECT metric_name, excellent_threshold, good_threshold, normal_threshold
       FROM content_benchmarks
       WHERE platform = $1 AND price_tier = $2 AND followers_range = $3`,
      [platform, priceTier, followersRange]
    )

    if (rows.length === 0) {
      return { grade: 'pending' as 'excellent' | 'good' | 'normal' | 'poor', comparison: { reason: '未找到对应基准数据' } }
    }

    const comparison: Record<string, unknown> = {}
    let excellentCount = 0
    let goodCount = 0
    let poorCount = 0

    for (const row of rows) {
      const metricName = row.metric_name
      const excellent = row.excellent_threshold
      const good = row.good_threshold
      const normal = row.normal_threshold

      let value = 0
      switch (metricName) {
        case 'ctr': value = ctr; break
        case 'engagement_rate': value = engagementRate; break
        case 'cpm': value = cpm; break
        case 'cpe': value = cpe; break
        default: continue
      }

      const isLowerBetter = metricName === 'cpm' || metricName === 'cpe'
      let grade: string
      if (isLowerBetter) {
        if (value <= excellent) grade = 'excellent'
        else if (value <= good) grade = 'good'
        else if (value <= normal) grade = 'normal'
        else grade = 'poor'
      } else {
        if (value >= excellent) grade = 'excellent'
        else if (value >= good) grade = 'good'
        else if (value >= normal) grade = 'normal'
        else grade = 'poor'
      }

      comparison[metricName] = {
        value: Number(value.toFixed(2)),
        excellent: isLowerBetter ? `<= ${excellent}` : `>= ${excellent}`,
        good: isLowerBetter ? `<= ${good}` : `>= ${good}`,
        normal: isLowerBetter ? `<= ${normal}` : `>= ${normal}`,
        grade,
      }

      if (grade === 'excellent') excellentCount++
      if (grade === 'good') goodCount++
      if (grade === 'poor') poorCount++
    }

    let finalGrade: 'excellent' | 'good' | 'normal' | 'poor'
    if (excellentCount >= 2) {
      finalGrade = 'excellent'
    } else if (excellentCount >= 1 || goodCount >= 2) {
      finalGrade = 'good'
    } else if (poorCount > 0) {
      finalGrade = 'poor'
    } else {
      finalGrade = 'normal'
    }

    return { grade: finalGrade, comparison }
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

function generateTrackingId(): string {
  return `ct_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function generateBenchmarkId(): string {
  return `bm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function generateAuditId(): string {
  return `ca_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function calculateMetrics(input: {
  exposure: number
  views: number
  likes: number
  saves: number
  comments: number
  shares: number
  estimatedPrice: number
}): { cpm: number; cpe: number; ctr: number; engagementRate: number } {
  const safeExposure = Math.max(input.exposure, 1)
  const safeEngagement = Math.max(input.likes + input.saves + input.comments + input.shares, 1)

  const cpm = input.estimatedPrice > 0 ? (input.estimatedPrice / safeExposure) * 1000 : 0
  const cpe = input.estimatedPrice > 0 ? input.estimatedPrice / safeEngagement : 0
  const ctr = (input.views / safeExposure) * 100
  const engagementRate = (safeEngagement / safeExposure) * 100

  return { cpm, cpe, ctr, engagementRate }
}

function rowToPoolItem(row: Record<string, unknown>): CampaignKOLPoolItem {
  return {
    campaignId: String(row.campaign_id),
    kolId: String(row.kol_id),
    name: String(row.name),
    platform: String(row.platform),
    followers: String(row.followers ?? ''),
    engagement: String(row.engagement ?? ''),
    category: String(row.category ?? ''),
    price: String(row.price ?? ''),
    city: String(row.city ?? ''),
    status: row.status as CampaignKOLPoolItem['status'],
    notes: String(row.notes ?? ''),
    addedAt: Number(row.added_at),
  }
}

function rowToBrief(row: Record<string, unknown>): CampaignBrief {
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    kolId: String(row.kol_id),
    kolName: String(row.kol_name),
    content: String(row.content),
    aiGenerated: Boolean(row.ai_generated),
    status: row.status as 'draft' | 'final',
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
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

function rowToContentAudit(row: Record<string, unknown>): ContentAudit {
  return {
    auditId: String(row.audit_id),
    campaignId: String(row.campaign_id),
    kolId: String(row.kol_id),
    kolName: String(row.kol_name),
    contentUrl: String(row.content_url ?? ''),
    platform: String(row.platform),
    auditStatus: String(row.audit_status ?? 'pending') as ContentAudit['auditStatus'],
    complianceScore: Number(row.compliance_score ?? 0),
    brandAlignmentScore: Number(row.brand_alignment_score ?? 0),
    qualityScore: Number(row.quality_score ?? 0),
    overallScore: Number(row.overall_score ?? 0),
    auditReport: String(row.audit_report ?? ''),
    auditor: String(row.auditor ?? ''),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}
