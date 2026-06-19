/**
 * Campaign 项目管理数据服务
 *
 * 负责 Campaign 的本地存储（SQLite）。
 * 存储位置：~/.mapro/campaign-database.sqlite
 *
 * Slice 1: 仅实现 Campaign 核心表（创建 + 列表）
 * Slice 3: 添加 KOL 候选池表 + 导入功能
 * Slice 4: 添加 Brief 表 + 生成/保存功能
 */

import { existsSync, mkdirSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getConfigDir } from './config-paths'
import { getKOLById, computeKOLScores, recalculateAllScores, type KOLRecord } from './ma-tools/kol-data-service'
export { recalculateAllScores }
import { runContentAudit } from './ma-tools/content-audit'
import type { Campaign, CreateCampaignInput, KOLListItem } from '@ma-proma/shared'

// =====================================================================
// SQLite 运行时适配层（复用 kol-data-service 模式）
// =====================================================================

let _nativeDb: any = null

function loadEngine(): { Database: new (path: string) => any } {
  if (typeof Bun !== 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('bun:' + 'sqlite')
      return { Database: mod.Database }
    } catch {
      // fall through to better-sqlite3
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return { Database: require('better-sqlite3') }
}

function getEngine(): { Database: new (path: string) => any } {
  if (!_nativeDb) {
    _nativeDb = loadEngine()
  }
  return _nativeDb
}

class Database {
  private db: any

  constructor(path: string) {
    const { Database: NativeDb } = getEngine()
    this.db = new NativeDb(path)
  }

  run(sql: string, ...params: unknown[]): { changes: number } {
    const flat = flattenParams(params)
    if (flat.length === 0) {
      this.db.exec(sql)
      return { changes: 0 }
    }
    return this.db.prepare(sql).run(...flat)
  }

  query(sql: string) {
    const stmt = this.db.prepare(sql)
    return {
      get: (...params: unknown[]) => stmt.get(...flattenParams(params)) ?? null,
      all: (...params: unknown[]) => stmt.all(...flattenParams(params)),
    }
  }

  close(): void {
    this.db.close()
  }
}

function flattenParams(params: unknown[]): any[] {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0] as any[]
  }
  return params as any[]
}

// =====================================================================
// 测试注入：支持通过环境变量覆盖配置目录
// =====================================================================

function getTestConfigDir(): string | undefined {
  return process.env._MAPRO_TEST_CONFIG_DIR
}

// =====================================================================
// 数据库初始化
// =====================================================================

let dbInstance: Database | null = null

function getDbPath(): string {
  const testDir = getTestConfigDir()
  return join(testDir ?? getConfigDir(), 'campaign-database.sqlite')
}

export function getDb(): Database {
  if (dbInstance) return dbInstance

  const dbPath = getDbPath()
  const dir = join(getTestConfigDir() ?? getConfigDir())
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  dbInstance = new Database(dbPath)

  // Campaign 核心表（Slice 1）
  dbInstance.run(`
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
      status TEXT DEFAULT 'draft',
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `)

  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status)`)
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_campaigns_brand ON campaigns(brand)`)

  // Campaign KOL 候选池表（Slice 3）
  dbInstance.run(`
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
      added_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      PRIMARY KEY (campaign_id, kol_id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
    )
  `)

  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_pool_campaign ON campaign_kol_pool(campaign_id)`)
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_pool_status ON campaign_kol_pool(status)`)
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_pool_platform ON campaign_kol_pool(platform)`)

  // Campaign KOL Brief 表（Slice 4）
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS campaign_briefs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      kol_id TEXT NOT NULL,
      kol_name TEXT NOT NULL,
      content TEXT NOT NULL,
      ai_generated INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      UNIQUE(campaign_id, kol_id)
    )
  `)

  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_briefs_campaign ON campaign_briefs(campaign_id)`)
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_briefs_kol ON campaign_briefs(kol_id)`)

  console.log('[Campaign 服务] 数据库已初始化:', dbPath)
  return dbInstance
}

/** 关闭数据库连接（主要用于测试） */
export function closeCampaignDatabase(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
  if (kolDbInstance) {
    kolDbInstance.close()
    kolDbInstance = null
  }
}

// =====================================================================
// KOL 数据库连接（用于查询可用 KOL）
// =====================================================================

let kolDbInstance: Database | null = null

function getKolDbPath(): string {
  const testDir = getTestConfigDir()
  return join(testDir ?? getConfigDir(), 'kol-database.sqlite')
}

function getKolDb(): Database {
  if (kolDbInstance) return kolDbInstance

  const dbPath = getKolDbPath()
  const defaultDbPath = join(homedir(), 'LLM', 'ma', 'data', 'kol_database.db')

  // 确保 .mapro 和 .mapro-dev 目录都存在
  const maproDir = join(homedir(), '.mapro')
  const maproDevDir = join(homedir(), '.mapro-dev')
  if (!existsSync(maproDir)) mkdirSync(maproDir, { recursive: true })
  if (!existsSync(maproDevDir)) mkdirSync(maproDevDir, { recursive: true })

  const maproPath = join(maproDir, 'kol-database.sqlite')
  const maproDevPath = join(maproDevDir, 'kol-database.sqlite')

  console.log(`[Campaign 服务] KOL 数据库路径: ${dbPath}`)
  console.log(`[Campaign 服务] 默认数据库路径: ${defaultDbPath}`)
  console.log(`[Campaign 服务] 默认数据库存在: ${existsSync(defaultDbPath)}`)
  console.log(`[Campaign 服务] .mapro 数据库存在: ${existsSync(maproPath)}`)
  console.log(`[Campaign 服务] .mapro-dev 数据库存在: ${existsSync(maproDevPath)}`)

  // 同时复制到 .mapro 和 .mapro-dev
  for (const targetPath of [maproPath, maproDevPath]) {
    if (!existsSync(targetPath) && existsSync(defaultDbPath)) {
      try {
        cpSync(defaultDbPath, targetPath)
        console.log(`[Campaign 服务] 已复制 KOL 数据库到 ${targetPath}`)
      } catch (err) {
        console.warn(`[Campaign 服务] 复制到 ${targetPath} 失败:`, err)
      }
    } else if (existsSync(targetPath)) {
      console.log(`[Campaign 服务] ${targetPath} 已存在，跳过复制`)
    }
  }

  kolDbInstance = new Database(dbPath)

  // 兼容原始数据库：如果原始数据库没有评分字段，添加它们
  // 使用显式列存在检查，避免 try/catch 吞掉真正的错误
  const hasColumn = (table: string, col: string): boolean => {
    try {
      const rows = kolDbInstance!.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      return rows.some((r) => r.name === col)
    } catch {
      return false
    }
  }

  if (!hasColumn('kols', 'fan_score')) {
    kolDbInstance.run(`ALTER TABLE kols ADD COLUMN fan_score REAL DEFAULT 0`)
  }
  if (!hasColumn('kols', 'engagement_score')) {
    kolDbInstance.run(`ALTER TABLE kols ADD COLUMN engagement_score REAL DEFAULT 0`)
  }
  if (!hasColumn('kols', 'content_score')) {
    kolDbInstance.run(`ALTER TABLE kols ADD COLUMN content_score REAL DEFAULT 0`)
  }
  if (!hasColumn('kols', 'overall_score')) {
    kolDbInstance.run(`ALTER TABLE kols ADD COLUMN overall_score REAL DEFAULT 0`)
  }

  // 确保索引存在
  kolDbInstance.run(`CREATE INDEX IF NOT EXISTS idx_kols_platform ON kols(platform)`)
  kolDbInstance.run(`CREATE INDEX IF NOT EXISTS idx_kols_category ON kols(category)`)
  kolDbInstance.run(`CREATE INDEX IF NOT EXISTS idx_kols_name ON kols(name)`)
  kolDbInstance.run(`CREATE INDEX IF NOT EXISTS idx_kols_source ON kols(source)`)
  kolDbInstance.run(`CREATE INDEX IF NOT EXISTS idx_kols_overall_score ON kols(overall_score DESC)`)

  // 统计 KOL 数量
  const countRow = kolDbInstance.query('SELECT COUNT(*) as total FROM kols').get() as { total: number } | null
  console.log(`[Campaign 服务] KOL 数据库已连接: ${dbPath}, KOL 数量: ${countRow?.total ?? 0}`)
  return kolDbInstance
}

/** 填充 Mock KOL 数据到 KOL 数据库 */
function seedMockKOLsIntoKolDb(db: Database): void {
  const now = Date.now()
  const mockKOLs: Array<Omit<KOLListItem, 'createdAt' | 'updatedAt'>> = [
    { id: 'mock_xhs_美妆达人小美', name: '@美妆达人小美', platform: '小红书', followers: '50万', engagement: '8.5%', category: '美妆', price: '3万', city: '上海', avatar: '', source: 'mock', rawData: '{}' },
    { id: 'mock_xhs_护肤分享师', name: '@护肤分享师', platform: '小红书', followers: '30万', engagement: '9.2%', category: '美妆', price: '2万', city: '杭州', avatar: '', source: 'mock', rawData: '{}' },
    { id: 'mock_xhs_生活方式博主', name: '@生活方式博主', platform: '小红书', followers: '80万', engagement: '6.8%', category: '生活方式', price: '5万', city: '北京', avatar: '', source: 'mock', rawData: '{}' },
    { id: 'mock_xhs_母婴博主乐乐', name: '@母婴博主乐乐', platform: '小红书', followers: '40万', engagement: '10.1%', category: '母婴', price: '2.5万', city: '广州', avatar: '', source: 'mock', rawData: '{}' },
    { id: 'mock_xhs_数码测评君', name: '@数码测评君', platform: '小红书', followers: '60万', engagement: '7.5%', category: '3C', price: '4万', city: '深圳', avatar: '', source: 'mock', rawData: '{}' },
    { id: 'mock_dy_时尚小姐姐', name: '@时尚小姐姐', platform: '抖音', followers: '200万', engagement: '5.2%', category: '时尚', price: '15万', city: '上海', avatar: '', source: 'mock', rawData: '{}' },
    { id: 'mock_dy_搞笑日常', name: '@搞笑日常', platform: '抖音', followers: '500万', engagement: '4.8%', category: '娱乐', price: '30万', city: '成都', avatar: '', source: 'mock', rawData: '{}' },
    { id: 'mock_dy_美食探店', name: '@美食探店', platform: '抖音', followers: '150万', engagement: '6.5%', category: '美食', price: '10万', city: '重庆', avatar: '', source: 'mock', rawData: '{}' },
    { id: 'mock_dy_科技大人', name: '@科技大人', platform: '抖音', followers: '300万', engagement: '5.8%', category: '3C', price: '20万', city: '北京', avatar: '', source: 'mock', rawData: '{}' },
    { id: 'mock_wb_时尚icon', name: '@时尚icon', platform: '微博', followers: '800万', engagement: '3.5%', category: '时尚', price: '50万', city: '北京', avatar: '', source: 'mock', rawData: '{}' },
    { id: 'mock_wb_美妆教主', name: '@美妆教主', platform: '微博', followers: '600万', engagement: '4.2%', category: '美妆', price: '40万', city: '上海', avatar: '', source: 'mock', rawData: '{}' },
    { id: 'mock_bz_测评实验室', name: '@测评实验室', platform: 'B站', followers: '150万', engagement: '12.5%', category: '3C', price: '12万', city: '上海', avatar: '', source: 'mock', rawData: '{}' },
  ]

  for (const kol of mockKOLs) {
    db.run(
      `INSERT INTO kols (id, name, platform, followers, engagement, category, price, city, avatar, source, raw_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      kol.id,
      kol.name,
      kol.platform,
      kol.followers,
      kol.engagement,
      kol.category,
      kol.price,
      kol.city,
      kol.avatar,
      kol.source,
      kol.rawData,
      now,
      now,
    )
  }

  console.log(`[Campaign 服务] KOL 数据库自动填充: ${mockKOLs.length} 条 mock 数据`)
}

// =====================================================================
// CRUD 操作
// =====================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 行数据 → Campaign 对象 */
function rowToCampaign(row: any): Campaign {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    platform: row.platform as Campaign['platform'],
    budget: row.budget ?? 0,
    durationMonths: row.duration_months ?? 1,
    targetCity: row.target_city ? JSON.parse(row.target_city) : [],
    targetAudience: row.target_audience ?? '',
    currentPhase: row.current_phase ?? 1,
    status: row.status as Campaign['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 行数据 → CampaignKOLPoolItem */
function rowToPoolItem(row: any): import('@ma-proma/shared').CampaignKOLPoolItem {
  return {
    campaignId: row.campaign_id,
    kolId: row.kol_id,
    name: row.name,
    platform: row.platform,
    followers: row.followers ?? '',
    engagement: row.engagement ?? '',
    category: row.category ?? '',
    price: row.price ?? '',
    city: row.city ?? '',
    status: row.status as import('@ma-proma/shared').PoolKOLStatus,
    notes: row.notes ?? '',
    addedAt: row.added_at,
  }
}

/** 获取 Campaign 列表（按创建时间倒序） */
export function listCampaigns(): Campaign[] {
  const db = getDb()
  const rows = db.query(
    `SELECT * FROM campaigns ORDER BY created_at DESC`
  ).all()
  return rows.map(rowToCampaign)
}

/** 创建 Campaign */
export function createCampaign(input: CreateCampaignInput): Campaign {
  const db = getDb()
  const now = Date.now()
  const id = generateId()

  db.run(
    `INSERT INTO campaigns (id, name, brand, platform, budget, duration_months, target_city, target_audience, current_phase, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.name,
    input.brand,
    input.platform,
    input.budget,
    input.durationMonths,
    JSON.stringify(input.targetCity),
    input.targetAudience,
    1,
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
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
}

/** 获取单个 Campaign */
export function getCampaignById(id: string): Campaign | null {
  const db = getDb()
  const row = db.query(
    `SELECT * FROM campaigns WHERE id = ?`
  ).get(id)
  return row ? rowToCampaign(row) : null
}

// =====================================================================
// KOL 候选池操作（Slice 3）
// =====================================================================

/** 获取 Campaign 候选池 KOL */
export function getPoolKOLs(campaignId: string): import('@ma-proma/shared').CampaignKOLPoolItem[] {
  const db = getDb()
  const rows = db.query(
    `SELECT * FROM campaign_kol_pool WHERE campaign_id = ? ORDER BY added_at DESC`
  ).all(campaignId)
  return rows.map(rowToPoolItem)
}

/** 导入 KOL 到候选池 */
export function importKOLsToPool(input: import('@ma-proma/shared').ImportKOLsToPoolInput): { imported: number } {
  const campaignDb = getDb()
  const kolDb = getKolDb()
  let imported = 0

  for (const kolId of input.kolIds) {
    // 从 KOL 数据库获取信息
    const kolRow = kolDb.query('SELECT * FROM kols WHERE id = ?').get(kolId) as Record<string, unknown> | null
    if (!kolRow) continue

    // 检查是否已存在
    const existing = campaignDb.query(
      'SELECT 1 FROM campaign_kol_pool WHERE campaign_id = ? AND kol_id = ?'
    ).get(input.campaignId, kolId)
    if (existing) continue

    // 插入到候选池
    campaignDb.run(
      `INSERT INTO campaign_kol_pool (campaign_id, kol_id, name, platform, followers, engagement, category, price, city, status, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.campaignId,
      kolId,
      String(kolRow.name ?? ''),
      String(kolRow.platform ?? ''),
      String(kolRow.followers ?? ''),
      String(kolRow.engagement ?? ''),
      String(kolRow.category ?? ''),
      String(kolRow.price ?? ''),
      String(kolRow.city ?? ''),
      'candidate',
      Date.now(),
    )
    imported++
  }

  return { imported }
}

/** 获取 KOL 数据库中可用 KOL（用于导入弹窗） */
export function listAvailableKOLs(
  filters?: { platform?: string; category?: string; keywords?: string[]; limit?: number }
): import('@ma-proma/shared').KOLSearchResult {
  const kolDb = getKolDb()
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (filters?.platform) {
    conditions.push('platform = ?')
    params.push(filters.platform)
  }
  if (filters?.category) {
    conditions.push('category = ?')
    params.push(filters.category)
  }
  if (filters?.keywords && filters.keywords.length > 0) {
    const keywordConditions = filters.keywords.map(() => 'name LIKE ?').join(' OR ')
    conditions.push(`(${keywordConditions})`)
    for (const kw of filters.keywords) {
      params.push(`%${kw}%`)
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters?.limit ?? 50

  const rows = kolDb.query(`SELECT * FROM kols ${whereClause} ORDER BY updated_at DESC LIMIT ?`).all(
    ...params,
    limit,
  ) as Record<string, unknown>[]

  const countRow = kolDb.query(`SELECT COUNT(*) as total FROM kols ${whereClause}`).get(...params) as { total: number } | null

  const kols = rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    platform: String(row.platform),
    followers: String(row.followers ?? ''),
    engagement: String(row.engagement ?? ''),
    category: String(row.category ?? ''),
    price: String(row.price ?? ''),
    city: String(row.city ?? ''),
    avatar: String(row.avatar ?? ''),
    source: String(row.source),
    rawData: String(row.raw_data ?? ''),
    baseScore: Number(row.fan_score ?? 0),
    contentScore: Number(row.engagement_score ?? 0),
    commercialScore: Number(row.content_score ?? 0),
    overallScore: Number(row.overall_score ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }))

  return {
    kols,
    total: countRow?.total ?? kols.length,
  }
}

// =====================================================================
// Brief 操作（Slice 4）
// =====================================================================

/** 获取 KOL 的 Brief */
export function getBrief(campaignId: string, kolId: string): import('@ma-proma/shared').CampaignBrief | null {
  const db = getDb()
  const row = db.query(
    `SELECT * FROM campaign_briefs WHERE campaign_id = ? AND kol_id = ?`
  ).get(campaignId, kolId) as Record<string, unknown> | null

  if (!row) return null

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

/** 保存/更新 KOL Brief */
export function saveBrief(input: import('@ma-proma/shared').SaveCampaignBriefInput): import('@ma-proma/shared').CampaignBrief {
  const db = getDb()
  const now = Date.now()
  const id = generateId()

  // 检查是否已存在
  const existing = db.query(
    `SELECT id FROM campaign_briefs WHERE campaign_id = ? AND kol_id = ?`
  ).get(input.campaignId, input.kolId) as { id: string } | null

  if (existing) {
    // 更新
    db.run(
      `UPDATE campaign_briefs
       SET content = ?, kol_name = ?, ai_generated = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      input.content,
      input.kolName,
      input.aiGenerated ? 1 : 0,
      'draft',
      now,
      existing.id,
    )

    return {
      id: existing.id,
      campaignId: input.campaignId,
      kolId: input.kolId,
      kolName: input.kolName,
      content: input.content,
      aiGenerated: input.aiGenerated ?? false,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
  }

  // 新建
  db.run(
    `INSERT INTO campaign_briefs (id, campaign_id, kol_id, kol_name, content, ai_generated, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.campaignId,
    input.kolId,
    input.kolName,
    input.content,
    input.aiGenerated ? 1 : 0,
    'draft',
    now,
    now,
  )

  return {
    id,
    campaignId: input.campaignId,
    kolId: input.kolId,
    kolName: input.kolName,
    content: input.content,
    aiGenerated: input.aiGenerated ?? false,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
}

// =====================================================================
// Brief 模板生成
// =====================================================================

/**
 * 根据 Campaign 和 KOL 信息生成基础 Brief
 */
export function generateBriefTemplate(
  campaign: Campaign,
  kol: import('@ma-proma/shared').CampaignKOLPoolItem
): string {
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

/** 获取所有 KOL（用于 KOL 数据管理页面） */
export function listAllKOLs(): KOLListItem[] {
  const kolDb = getKolDb()
  const rows = kolDb.query(
    `SELECT * FROM kols ORDER BY overall_score DESC, updated_at DESC`
  ).all() as Record<string, unknown>[]

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    platform: String(row.platform),
    followers: String(row.followers ?? ''),
    engagement: String(row.engagement ?? ''),
    category: String(row.category ?? ''),
    price: String(row.price ?? ''),
    city: String(row.city ?? ''),
    avatar: String(row.avatar ?? ''),
    source: String(row.source),
    rawData: String(row.raw_data ?? ''),
    baseScore: Number(row.fan_score ?? 0),
    contentScore: Number(row.engagement_score ?? 0),
    commercialScore: Number(row.content_score ?? 0),
    overallScore: Number(row.overall_score ?? 0),
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
  }))
}

/** 更新 KOL 信息 */
export function updateKOL(input: import('@ma-proma/shared').UpdateKOLInput): boolean {
  const kolDb = getKolDb()

  // 重新计算评分
  const kol = getKOLById(input.id)
  if (!kol) return false

  const updatedKol: KOLRecord = {
    ...kol,
    name: input.name,
    platform: input.platform,
    followers: input.followers,
    engagement: input.engagement,
    category: input.category,
    price: input.price,
    city: input.city,
  }
  const scores = computeKOLScores(updatedKol)

  const result = kolDb.run(
    `UPDATE kols SET name = ?, platform = ?, followers = ?, engagement = ?, category = ?, price = ?, city = ?, fan_score = ?, engagement_score = ?, content_score = ?, overall_score = ?, updated_at = ? WHERE id = ?`,
    input.name,
    input.platform,
    input.followers,
    input.engagement,
    input.category,
    input.price,
    input.city,
    scores.baseScore,
    scores.contentScore,
    scores.commercialScore,
    scores.overallScore,
    Date.now(),
    input.id,
  )
  return result.changes > 0
}

/** 删除 KOL */
export function deleteKOL(id: string): boolean {
  const kolDb = getKolDb()
  const result = kolDb.run('DELETE FROM kols WHERE id = ?', id)
  return result.changes > 0
}

// =====================================================================
// 阶段推进（Slice 5）
// =====================================================================

const PHASE_STATUS_MAP: Record<number, Campaign['status']> = {
  1: 'strategy',
  2: 'kol_selection',
  3: 'content_production',
}

/** 推进 Campaign 到下一阶段 */
export function advanceCampaignPhase(id: string): Campaign | null {
  const db = getDb()
  const campaign = getCampaignById(id)
  if (!campaign) return null

  const nextPhase = campaign.currentPhase + 1
  if (nextPhase > 3) return null // 已到最后阶段

  const nextStatus = PHASE_STATUS_MAP[nextPhase] ?? campaign.status
  const now = Date.now()

  db.run(
    `UPDATE campaigns SET current_phase = ?, status = ?, updated_at = ? WHERE id = ?`,
    nextPhase,
    nextStatus,
    now,
    id,
  )

  return getCampaignById(id)
}

// =====================================================================
// 内容审核流水线（内容审核流水线）
// =====================================================================

/** 生成唯一 ID */
function generateAuditId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/** 查询 Campaign 的审核记录 */
export function listContentAudits(campaignId: string): import('@ma-proma/shared').ContentAudit[] {
  const db = getDb()
  const rows = db.query(
    `SELECT * FROM content_audits WHERE campaign_id = ? ORDER BY created_at DESC`
  ).all(campaignId) as Record<string, unknown>[]

  return rows.map((row) => ({
    auditId: String(row.audit_id),
    campaignId: String(row.campaign_id),
    kolId: String(row.kol_id),
    kolName: '', // 从 KOL 数据库补充
    contentUrl: String(row.content_url ?? ''),
    platform: String(row.platform ?? ''),
    auditStatus: String(row.audit_status ?? 'pending') as import('@ma-proma/shared').ContentAudit['auditStatus'],
    complianceScore: Number(row.compliance_score ?? 0),
    brandAlignmentScore: Number(row.brand_alignment_score ?? 0),
    qualityScore: Number(row.quality_score ?? 0),
    overallScore: Number(row.overall_score ?? 0),
    auditReport: String(row.audit_report ?? ''),
    auditor: String(row.auditor ?? 'ai'),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }))
}

/** 获取单个审核记录 */
export function getContentAudit(auditId: string): import('@ma-proma/shared').ContentAudit | null {
  const db = getDb()
  const row = db.query('SELECT * FROM content_audits WHERE audit_id = ?').get(auditId) as Record<string, unknown> | null
  if (!row) return null

  return {
    auditId: String(row.audit_id),
    campaignId: String(row.campaign_id),
    kolId: String(row.kol_id),
    kolName: '',
    contentUrl: String(row.content_url ?? ''),
    platform: String(row.platform ?? ''),
    auditStatus: String(row.audit_status ?? 'pending') as import('@ma-proma/shared').ContentAudit['auditStatus'],
    complianceScore: Number(row.compliance_score ?? 0),
    brandAlignmentScore: Number(row.brand_alignment_score ?? 0),
    qualityScore: Number(row.quality_score ?? 0),
    overallScore: Number(row.overall_score ?? 0),
    auditReport: String(row.audit_report ?? ''),
    auditor: String(row.auditor ?? 'ai'),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/** 创建并执行内容审核 */
export async function createContentAudit(
  input: import('@ma-proma/shared').CreateContentAuditInput
): Promise<import('@ma-proma/shared').ContentAudit | null> {
  const db = getDb()
  const auditId = generateAuditId()
  const now = Date.now()

  // 先插入 pending 记录
  db.run(
    `INSERT INTO content_audits (audit_id, campaign_id, kol_id, content_url, platform, audit_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    auditId,
    input.campaignId,
    input.kolId,
    input.contentUrl ?? '',
    input.platform,
    'reviewing',
    now,
    now,
  )

  // 执行 AI 审核
  const auditResult = await runContentAudit({
    brand: input.brand,
    product: input.brand, // 简化：品牌名作为产品名
    platform: input.platform,
    contentType: input.contentType,
    contentDescription: input.contentDescription,
    kolId: input.kolId,
    contentUrl: input.contentUrl ?? '',
  })

  if (!auditResult.success) {
    // 更新为失败状态
    db.run(
      `UPDATE content_audits SET audit_status = ?, audit_report = ?, updated_at = ? WHERE audit_id = ?`,
      'failed',
      `审核失败: ${auditResult.error ?? '未知错误'}`,
      Date.now(),
      auditId,
    )
    return getContentAudit(auditId)
  }

  // 判定最终状态
  const finalStatus: 'passed' | 'failed' = (auditResult.overallScore ?? 0) >= 60 ? 'passed' : 'failed'

  // 更新审核结果
  db.run(
    `UPDATE content_audits SET
      audit_status = ?, compliance_score = ?, brand_alignment_score = ?, quality_score = ?, overall_score = ?, audit_report = ?, updated_at = ?
     WHERE audit_id = ?`,
    finalStatus,
    auditResult.complianceScore ?? 0,
    auditResult.brandAlignmentScore ?? 0,
    auditResult.qualityScore ?? 0,
    auditResult.overallScore ?? 0,
    auditResult.report ?? '',
    Date.now(),
    auditId,
  )

  return getContentAudit(auditId)
}

/** 更新审核状态（人工复核） */
export function updateContentAuditStatus(
  auditId: string,
  status: 'pending' | 'reviewing' | 'passed' | 'failed'
): boolean {
  const db = getDb()
  const result = db.run(
    `UPDATE content_audits SET audit_status = ?, updated_at = ? WHERE audit_id = ?`,
    status,
    Date.now(),
    auditId,
  )
  return result.changes > 0
}
