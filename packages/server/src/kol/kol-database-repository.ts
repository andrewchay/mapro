/**
 * KOL 数据库访问层（基于 DbProvider 抽象）
 *
 * 阶段 B1 Slice 2：为 Campaign 候选池导入提供 KOL 数据读取能力。
 * 当前只暴露导入/筛选所需的最小字段集，避免引入完整的 KOL 数据管理逻辑。
 */

import type { KOLListItem, KOLSearchResult } from '@ma-proma/shared'
import type { DbProvider } from '../db/types.ts'

export interface KOLDatabaseRepositoryOptions {
  /** 是否在数据库为空时自动填充 mock 数据（仅开发/测试） */
  seedMockData?: boolean
}

export class KOLDatabaseRepository {
  private db: DbProvider
  private options: KOLDatabaseRepositoryOptions

  constructor(db: DbProvider, options: KOLDatabaseRepositoryOptions = {}) {
    this.db = db
    this.options = options
  }

  async initSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS kols (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        followers TEXT,
        engagement TEXT,
        category TEXT,
        price TEXT,
        city TEXT,
        avatar TEXT,
        source TEXT NOT NULL,
        raw_data TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)

    // 兼容原始数据库：评分与扩展字段
    await this.ensureColumn('kols', 'fan_score', 'REAL DEFAULT 0')
    await this.ensureColumn('kols', 'engagement_score', 'REAL DEFAULT 0')
    await this.ensureColumn('kols', 'content_score', 'REAL DEFAULT 0')
    await this.ensureColumn('kols', 'overall_score', 'REAL DEFAULT 0')
    await this.ensureColumn('kols', 'value_score', 'REAL DEFAULT 0')
    await this.ensureColumn('kols', 'ad_quality_score', 'REAL DEFAULT 0')
    await this.ensureColumn('kols', 'risk_score', 'REAL DEFAULT 0')
    await this.ensureColumn('kols', 'extended_data', 'TEXT')
    await this.ensureColumn('kols', 'value_tags', 'TEXT')
    await this.ensureColumn('kols', 'risk_flags', 'TEXT')

    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_kols_platform ON kols(platform)`)
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_kols_category ON kols(category)`)
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_kols_name ON kols(name)`)
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_kols_source ON kols(source)`)
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_kols_overall_score ON kols(overall_score DESC)`)

    if (this.options.seedMockData) {
      await this.seedMockKOLsIfEmpty()
    }
  }

  private async ensureColumn(table: string, column: string, type: string): Promise<void> {
    const columns = await this.db.listTableColumns(table)
    if (!columns.includes(column)) {
      await this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    }
  }

  async getKOLById(id: string): Promise<KOLListItem | null> {
    const row = await this.db.queryOne<Record<string, unknown>>('SELECT * FROM kols WHERE id = $1', [id])
    return row ? rowToKOLListItem(row) : null
  }

  async listAvailableKOLs(filters?: {
    platform?: string
    category?: string
    keywords?: string[]
    limit?: number
  }): Promise<KOLSearchResult> {
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (filters?.platform) {
      conditions.push('platform = $' + (params.length + 1))
      params.push(filters.platform)
    }
    if (filters?.category) {
      conditions.push('category = $' + (params.length + 1))
      params.push(filters.category)
    }
    if (filters?.keywords && filters.keywords.length > 0) {
      for (const kw of filters.keywords) {
        params.push(`%${kw}%`)
      }
      const keywordStartIndex = params.length - filters.keywords.length + 1
      const keywordConditions = filters.keywords
        .map((_, i) => `LOWER(name) LIKE LOWER($${keywordStartIndex + i})`)
        .join(' OR ')
      conditions.push(`(${keywordConditions})`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filters?.limit ?? 50

    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM kols ${whereClause} ORDER BY overall_score DESC, updated_at DESC LIMIT $${params.length + 1}`,
      [...params, limit]
    )

    const countResult = await this.db.queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM kols ${whereClause}`,
      params
    )

    return {
      kols: rows.map(rowToKOLListItem),
      total: countResult?.total ?? rows.length,
    }
  }

  /**
   * 解析报价字符串为数值（元）
   *
   * 支持："3万" → 30000，"1.5万" → 15000，纯数字直接返回
   */
  parsePrice(price: string | undefined | null): number {
    if (!price) return 0
    const normalized = String(price).trim()
    const numericPart = parseFloat(normalized.replace(/[万亿]/g, ''))
    if (Number.isNaN(numericPart)) return 0

    if (normalized.includes('万')) return numericPart * 10000
    if (normalized.includes('亿')) return numericPart * 100000000
    return numericPart
  }

  private async seedMockKOLsIfEmpty(): Promise<void> {
    const countResult = await this.db.queryOne<{ total: number }>('SELECT COUNT(*) as total FROM kols')
    if ((countResult?.total ?? 0) > 0) return

    const now = Date.now()
    const mockKOLs = [
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
      await this.db.execute(
        `INSERT INTO kols (id, name, platform, followers, engagement, category, price, city, avatar, source, raw_data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [kol.id, kol.name, kol.platform, kol.followers, kol.engagement, kol.category, kol.price, kol.city, kol.avatar, kol.source, kol.rawData, now, now]
      )
    }
  }
}

function rowToKOLListItem(row: Record<string, unknown>): KOLListItem {
  const extRaw = row.extended_data ? String(row.extended_data) : null
  let extendedData: KOLListItem['extendedData'] = undefined
  if (extRaw) {
    try {
      extendedData = JSON.parse(extRaw) as KOLListItem['extendedData']
    } catch {
      extendedData = undefined
    }
  }

  return {
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
    extendedData,
    fanScore: row.fan_score != null ? Number(row.fan_score) : undefined,
    engagementScore: row.engagement_score != null ? Number(row.engagement_score) : undefined,
    valueScore: row.value_score != null ? Number(row.value_score) : undefined,
    adQualityScore: row.ad_quality_score != null ? Number(row.ad_quality_score) : undefined,
    riskScore: row.risk_score != null ? Number(row.risk_score) : undefined,
    valueTags: row.value_tags ? String(row.value_tags).split(',').filter(Boolean) : undefined,
    riskFlags: row.risk_flags ? String(row.risk_flags).split(',').filter(Boolean) : undefined,
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
  }
}
