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

import { existsSync, mkdirSync, cpSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getConfigDir, getAgentWorkspacePath } from './config-paths'
import { createAgentWorkspace } from './agent-workspace-manager'
import { getKOLById, computeKOLScores, recalculateAllScores, type KOLRecord } from './ma-tools/kol-data-service'
export { recalculateAllScores }
import { runContentAudit } from './ma-tools/content-audit'
import type { Campaign, CampaignCreativePlan, CampaignPhasePlan, CreateCampaignInput, KOLListItem } from '@ma-proma/shared'

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
      phase_plans TEXT,
      creative_plan TEXT,
      status TEXT DEFAULT 'draft',
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `)

  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status)`)
  dbInstance.run(`CREATE INDEX IF NOT EXISTS idx_campaigns_brand ON campaigns(brand)`)

  const campaignColumns = dbInstance.query(`PRAGMA table_info(campaigns)`).all() as Array<{ name: string }>
  if (!campaignColumns.some((col) => col.name === 'phase_plans')) {
    dbInstance.run(`ALTER TABLE campaigns ADD COLUMN phase_plans TEXT`)
  }
  if (!campaignColumns.some((col) => col.name === 'creative_plan')) {
    dbInstance.run(`ALTER TABLE campaigns ADD COLUMN creative_plan TEXT`)
  }

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

  if (!getTestConfigDir()) {
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
  }

  kolDbInstance = new Database(dbPath)

  kolDbInstance.run(`
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
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    )
  `)

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
    ...[
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
    ].map((kol) => ({ ...kol, baseScore: 0, contentScore: 0, commercialScore: 0, overallScore: 0 })),
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
// Campaign Agent Workspace 工具脚本
// =====================================================================

const CAMPAIGN_TOOLS_SCRIPT = `#!/usr/bin/env python3
\"\"\"Campaign 数据管理工具

用法:
  python campaign.py get <campaign_id>
  python campaign.py update <campaign_id> --field value ...
  python campaign.py update-phase <campaign_id> <phase> --budget <amount>
  python campaign.py update-creative <campaign_id> --big_idea <text> --core_message <text>
  python campaign.py list-kols <campaign_id>
  python campaign.py update-kol <campaign_id> <kol_id> --status <status>
  python campaign.py get-brief <campaign_id> <kol_id>
  python campaign.py update-brief <campaign_id> <kol_id> <content>
"""

import sqlite3
import json
import os
import sys
import time
from pathlib import Path

DB_PATH = os.path.expanduser("~/.mapro/campaign-database.sqlite")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def normalize_update_value(key, value):
    if key == "target_city":
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return json.dumps(parsed, ensure_ascii=False)
        except Exception:
            pass
        cities = [item.strip() for item in value.replace("，", ",").replace("、", ",").split(",") if item.strip()]
        return json.dumps(cities, ensure_ascii=False)
    if key in ("budget", "duration_months", "current_phase"):
        try:
            return int(float(value))
        except Exception:
            return value
    if key == "phase_plans":
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return json.dumps(parsed, ensure_ascii=False)
        except Exception:
            pass
    return value

def default_phase_plans(budget, duration_months):
    phase_budget = round(float(budget or 0) / max(int(duration_months or 1), 1) * 2)
    return [
        {"phase": 1, "name": "美学吸睛期", "months": "第 1-2 月", "goal": "建立视觉认知，占领关键词", "budget": phase_budget},
        {"phase": 2, "name": "场景渗透期", "months": "第 3-4 月", "goal": "场景绑定，情感连接", "budget": phase_budget},
        {"phase": 3, "name": "价值深化期", "months": "第 5-6 月", "goal": "品牌护城河，长尾维护", "budget": phase_budget},
    ]

def split_list(value):
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except Exception:
        pass
    return [item.strip() for item in value.replace("，", ",").replace("、", ",").split(",") if item.strip()]

def default_creative_plan(brand, target_audience):
    return {
        "bigIdea": f"{brand} 的生活方式种草",
        "coreMessage": f"面向{target_audience or '目标人群'}传递品牌价值与使用场景。",
        "contentPillars": ["产品体验", "生活场景", "用户口碑"],
        "tone": "真实、克制、有质感",
        "mandatoryElements": [brand],
        "forbiddenElements": [],
    }

def cmd_get(campaign_id):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM campaigns WHERE id = ?", (campaign_id,)
        ).fetchone()
        if not row:
            print(json.dumps({"error": "Campaign not found"}))
            return
        print(json.dumps(dict(row), default=str))

def cmd_update(campaign_id, kwargs):
    if not kwargs:
        print(json.dumps({"error": "No fields to update"}))
        return
    fields = []
    values = []
    field_map = {
        "name": "name",
        "brand": "brand",
        "platform": "platform",
        "budget": "budget",
        "duration_months": "duration_months",
        "target_city": "target_city",
        "target_audience": "target_audience",
        "current_phase": "current_phase",
        "phase_plans": "phase_plans",
        "status": "status",
    }
    for k, v in kwargs.items():
        col = field_map.get(k)
        if col:
            fields.append(f"{col} = ?")
            values.append(normalize_update_value(k, v))
    if not fields:
        print(json.dumps({"error": "No valid fields"}))
        return
    values.append(campaign_id)
    sql = f"UPDATE campaigns SET {', '.join(fields)}, updated_at = ? WHERE id = ?"
    with get_db() as conn:
        conn.execute(sql, (*values[:-1], int(time.time() * 1000), campaign_id))
        conn.commit()
    print(json.dumps({"success": True, "updated": len(fields)}))

def cmd_update_phase(campaign_id, phase, kwargs):
    with get_db() as conn:
        row = conn.execute(
            "SELECT budget, duration_months, phase_plans FROM campaigns WHERE id = ?",
            (campaign_id,),
        ).fetchone()
        if not row:
            print(json.dumps({"error": "Campaign not found"}))
            return
        try:
            plans = json.loads(row["phase_plans"]) if row["phase_plans"] else default_phase_plans(row["budget"], row["duration_months"])
        except Exception:
            plans = default_phase_plans(row["budget"], row["duration_months"])

        phase_num = int(phase)
        target = next((p for p in plans if int(p.get("phase", 0)) == phase_num), None)
        if not target:
            print(json.dumps({"error": f"Phase {phase_num} not found"}))
            return
        if "name" in kwargs:
            target["name"] = kwargs["name"]
        if "months" in kwargs:
            target["months"] = kwargs["months"]
        if "goal" in kwargs:
            target["goal"] = kwargs["goal"]
        if "budget" in kwargs:
            target["budget"] = int(float(kwargs["budget"]))

        conn.execute(
            "UPDATE campaigns SET phase_plans = ?, updated_at = ? WHERE id = ?",
            (json.dumps(plans, ensure_ascii=False), int(time.time() * 1000), campaign_id),
        )
        conn.commit()
        print(json.dumps({"success": True, "phasePlans": plans}, ensure_ascii=False))

def cmd_update_creative(campaign_id, kwargs):
    with get_db() as conn:
        row = conn.execute(
            "SELECT brand, target_audience, creative_plan FROM campaigns WHERE id = ?",
            (campaign_id,),
        ).fetchone()
        if not row:
            print(json.dumps({"error": "Campaign not found"}))
            return
        try:
            plan = json.loads(row["creative_plan"]) if row["creative_plan"] else default_creative_plan(row["brand"], row["target_audience"])
        except Exception:
            plan = default_creative_plan(row["brand"], row["target_audience"])

        field_map = {
            "big_idea": "bigIdea",
            "core_message": "coreMessage",
            "content_pillars": "contentPillars",
            "tone": "tone",
            "mandatory_elements": "mandatoryElements",
            "forbidden_elements": "forbiddenElements",
        }
        list_fields = {"contentPillars", "mandatoryElements", "forbiddenElements"}
        for key, value in kwargs.items():
            target = field_map.get(key)
            if not target:
                continue
            plan[target] = split_list(value) if target in list_fields else value

        conn.execute(
            "UPDATE campaigns SET creative_plan = ?, updated_at = ? WHERE id = ?",
            (json.dumps(plan, ensure_ascii=False), int(time.time() * 1000), campaign_id),
        )
        conn.commit()
        print(json.dumps({"success": True, "creativePlan": plan}, ensure_ascii=False))

def cmd_list_kols(campaign_id):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM campaign_kol_pool WHERE campaign_id = ? ORDER BY added_at DESC",
            (campaign_id,),
        ).fetchall()
        print(json.dumps([dict(r) for r in rows], default=str))

def cmd_update_kol(campaign_id, kol_id, status):
    with get_db() as conn:
        conn.execute(
            "UPDATE campaign_kol_pool SET status = ? WHERE campaign_id = ? AND kol_id = ?",
            (status, campaign_id, kol_id),
        )
        conn.commit()
    print(json.dumps({"success": True}))

def cmd_get_brief(campaign_id, kol_id):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM campaign_briefs WHERE campaign_id = ? AND kol_id = ?",
            (campaign_id, kol_id),
        ).fetchone()
        if not row:
            print(json.dumps({"error": "Brief not found"}))
            return
        print(json.dumps(dict(row), default=str))

def cmd_update_brief(campaign_id, kol_id, content, kol_name=""):
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM campaign_briefs WHERE campaign_id = ? AND kol_id = ?",
            (campaign_id, kol_id),
        ).fetchone()
        now = int(time.time() * 1000)
        if existing:
            conn.execute(
                "UPDATE campaign_briefs SET content = ?, updated_at = ? WHERE id = ?",
                (content, now, existing["id"]),
            )
        else:
            brief_id = f"brief_{now}_{os.urandom(4).hex()}"
            conn.execute(
                """INSERT INTO campaign_briefs (id, campaign_id, kol_id, kol_name, content, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (brief_id, campaign_id, kol_id, kol_name or kol_id, content, now, now),
            )
        conn.commit()
    print(json.dumps({"success": True}))

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    campaign_id = sys.argv[2]

    if cmd == "get":
        cmd_get(campaign_id)
    elif cmd == "update":
        kwargs = {}
        i = 3
        while i < len(sys.argv):
            if sys.argv[i].startswith("--"):
                key = sys.argv[i][2:]
                val = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
                kwargs[key] = val
                i += 2
            else:
                i += 1
        cmd_update(campaign_id, kwargs)
    elif cmd == "update-phase":
        if len(sys.argv) < 4:
            print(json.dumps({"error": "Missing phase"}))
            sys.exit(1)
        kwargs = {}
        i = 4
        while i < len(sys.argv):
            if sys.argv[i].startswith("--"):
                key = sys.argv[i][2:]
                val = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
                kwargs[key] = val
                i += 2
            else:
                i += 1
        cmd_update_phase(campaign_id, sys.argv[3], kwargs)
    elif cmd == "update-creative":
        kwargs = {}
        i = 3
        while i < len(sys.argv):
            if sys.argv[i].startswith("--"):
                key = sys.argv[i][2:]
                val = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
                kwargs[key] = val
                i += 2
            else:
                i += 1
        cmd_update_creative(campaign_id, kwargs)
    elif cmd == "list-kols":
        cmd_list_kols(campaign_id)
    elif cmd == "update-kol":
        if len(sys.argv) < 5:
            print(json.dumps({"error": "Missing kol_id or status"}))
            sys.exit(1)
        kol_id = sys.argv[3]
        status = sys.argv[5] if len(sys.argv) > 5 else "candidate"
        cmd_update_kol(campaign_id, kol_id, status)
    elif cmd == "get-brief":
        if len(sys.argv) < 4:
            print(json.dumps({"error": "Missing kol_id"}))
            sys.exit(1)
        cmd_get_brief(campaign_id, sys.argv[3])
    elif cmd == "update-brief":
        if len(sys.argv) < 5:
            print(json.dumps({"error": "Missing kol_id or content"}))
            sys.exit(1)
        cmd_update_brief(campaign_id, sys.argv[3], sys.argv[4])
    else:
        print(json.dumps({"error": f"Unknown command: {cmd}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
`

/** 确保 Campaign 的 Workspace 工具文件存在（用于旧 Campaign 兼容性） */
export function ensureCampaignWorkspace(campaign: Campaign): string {
  const workspaceSlug = `campaign-${campaign.id}`
  
  try {
    const workspacePath = getAgentWorkspacePath(workspaceSlug)
    
    // 如果 Workspace 目录不存在，创建它
    if (!existsSync(workspacePath)) {
      createAgentWorkspace(campaign.name, workspaceSlug)
    }
    
    const toolsDir = join(workspacePath, '.campaign-tools')
    if (!existsSync(toolsDir)) {
      mkdirSync(toolsDir, { recursive: true })
    }
    
    // 动态替换 DB_PATH
    const dbPath = join(getConfigDir(), 'campaign-database.sqlite')
    const scriptWithCorrectPath = CAMPAIGN_TOOLS_SCRIPT.replace(
      'DB_PATH = os.path.expanduser("~/.mapro/campaign-database.sqlite")',
      `DB_PATH = os.path.expanduser("${dbPath}")`
    )
    
    const scriptPath = join(toolsDir, 'campaign.py')
    writeFileSync(scriptPath, scriptWithCorrectPath)
    
    const jsonPath = join(workspacePath, 'campaign.json')
    if (!existsSync(jsonPath)) {
      writeFileSync(
        jsonPath,
        JSON.stringify({
          id: campaign.id,
          name: campaign.name,
          brand: campaign.brand,
          platform: campaign.platform,
          budget: campaign.budget,
          durationMonths: campaign.durationMonths,
          targetCity: campaign.targetCity,
          targetAudience: campaign.targetAudience,
          currentPhase: campaign.currentPhase,
          phasePlans: campaign.phasePlans,
          creativePlan: campaign.creativePlan,
          status: campaign.status,
        }, null, 2)
      )
    }
    
    return workspacePath
  } catch (err) {
    console.error(`[Campaign] 确保 Workspace 失败 (${campaign.id}):`, err)
    throw err
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** 行数据 → Campaign 对象 */
function rowToCampaign(row: any): Campaign {
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

  const budget = row.budget ?? 0
  const durationMonths = row.duration_months ?? 1
  const brand = row.brand
  const targetAudience = row.target_audience ?? ''
  return {
    id: row.id,
    name: row.name,
    brand,
    platform: row.platform as Campaign['platform'],
    budget,
    durationMonths,
    targetCity: parseTargetCity(row.target_city),
    targetAudience,
    currentPhase: row.current_phase ?? 1,
    phasePlans: normalizePhasePlans(row.phase_plans, budget, durationMonths),
    creativePlan: normalizeCreativePlan(row.creative_plan, { brand, targetAudience }),
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

  const campaign: Campaign = {
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

  // 创建 Campaign 专属的 Agent Workspace
  const workspaceSlug = `campaign-${id}`
  try {
    createAgentWorkspace(campaign.name, workspaceSlug)

    // 在 Workspace 中创建 Campaign 工具脚本
    const workspacePath = getAgentWorkspacePath(workspaceSlug)
    const toolsDir = join(workspacePath, '.campaign-tools')
    mkdirSync(toolsDir, { recursive: true })

    // 动态替换 DB_PATH 为正确的配置目录
    const dbPath = join(getConfigDir(), 'campaign-database.sqlite')
    const scriptWithCorrectPath = CAMPAIGN_TOOLS_SCRIPT.replace(
      'DB_PATH = os.path.expanduser("~/.mapro/campaign-database.sqlite")',
      `DB_PATH = os.path.expanduser("${dbPath}")`
    )

    // 创建工具脚本
    writeFileSync(join(toolsDir, 'campaign.py'), scriptWithCorrectPath)

    // 创建初始 Campaign 数据文件
    writeFileSync(
      join(workspacePath, 'campaign.json'),
      JSON.stringify({
        id: campaign.id,
        name: campaign.name,
        brand: campaign.brand,
        platform: campaign.platform,
        budget: campaign.budget,
        durationMonths: campaign.durationMonths,
        targetCity: campaign.targetCity,
        targetAudience: campaign.targetAudience,
        currentPhase: campaign.currentPhase,
        phasePlans: campaign.phasePlans,
        creativePlan: campaign.creativePlan,
        status: campaign.status,
      }, null, 2)
    )
  } catch (err) {
    console.error('[Campaign] 创建 Agent Workspace 失败:', err)
  }

  return campaign
}

/** 获取单个 Campaign */
export function getCampaignById(id: string): Campaign | null {
  const db = getDb()
  const row = db.query(
    `SELECT * FROM campaigns WHERE id = ?`
  ).get(id)
  return row ? rowToCampaign(row) : null
}

/** 更新 Campaign */
export function updateCampaign(
  id: string,
  updates: Partial<Pick<Campaign, 'name' | 'brand' | 'platform' | 'budget' | 'durationMonths' | 'targetCity' | 'targetAudience' | 'currentPhase' | 'phasePlans' | 'creativePlan' | 'status'>>
): Campaign | null {
  const db = getDb()
  const campaign = getCampaignById(id)
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
    ...values
  )

  const updatedCampaign = getCampaignById(id)!

  // 同步更新 workspace 中的 campaign.json
  try {
    const workspacePath = getAgentWorkspacePath(`campaign-${id}`)
    const campaignJsonPath = join(workspacePath, 'campaign.json')
    if (existsSync(campaignJsonPath)) {
      writeFileSync(campaignJsonPath, JSON.stringify(updatedCampaign, null, 2))
    }
  } catch (err) {
    console.error('[Campaign] 同步 campaign.json 失败:', err)
  }

  return updatedCampaign
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
