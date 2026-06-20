/**
 * Campaign 项目管理系统类型定义
 *
 * KOL 投放 Campaign 的核心数据模型和 IPC 通道常量。
 */

// ===== Campaign 核心实体 =====

/** 投放平台 */
export type CampaignPlatform = 'xiaohongshu' | 'douyin' | 'dual'

/** Campaign 状态 */
export type CampaignStatus =
  | 'draft'
  | 'strategy'
  | 'kol_selection'
  | 'negotiation'
  | 'content_production'
  | 'live'
  | 'review'
  | 'completed'

/** Campaign 阶段计划 */
export interface CampaignPhasePlan {
  /** 阶段序号 */
  phase: number
  /** 阶段名称 */
  name: string
  /** 阶段月份范围 */
  months: string
  /** 阶段目标 */
  goal: string
  /** 阶段预算（元） */
  budget: number
}

/** Campaign 创意策略 */
export interface CampaignCreativePlan {
  /** 核心创意概念 */
  bigIdea: string
  /** 核心传播信息 */
  coreMessage: string
  /** 内容支柱 */
  contentPillars: string[]
  /** 语气与风格 */
  tone: string
  /** 必须包含的元素 */
  mandatoryElements: string[]
  /** 禁止或规避的元素 */
  forbiddenElements: string[]
}

/** Campaign 项目 */
export interface Campaign {
  /** 唯一标识 */
  id: string
  /** 项目名称（如：VONBON 小红书 20万） */
  name: string
  /** 品牌名 */
  brand: string
  /** 投放平台 */
  platform: CampaignPlatform
  /** 总预算（元） */
  budget: number
  /** 投放周期（月） */
  durationMonths: number
  /** 目标城市 */
  targetCity: string[]
  /** 目标人群描述 */
  targetAudience: string
  /** 当前阶段（1-3） */
  currentPhase: number
  /** 阶段计划 */
  phasePlans: CampaignPhasePlan[]
  /** 创意策略 */
  creativePlan: CampaignCreativePlan
  /** 状态 */
  status: CampaignStatus
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

/** 创建 Campaign 输入 */
export interface CreateCampaignInput {
  name: string
  brand: string
  platform: CampaignPlatform
  budget: number
  durationMonths: number
  targetCity: string[]
  targetAudience: string
  phasePlans?: CampaignPhasePlan[]
  creativePlan?: CampaignCreativePlan
}

/** 更新 Campaign 输入 */
export interface UpdateCampaignInput {
  name?: string
  brand?: string
  platform?: CampaignPlatform
  budget?: number
  durationMonths?: number
  targetCity?: string[]
  targetAudience?: string
  currentPhase?: number
  phasePlans?: CampaignPhasePlan[]
  creativePlan?: CampaignCreativePlan
  status?: CampaignStatus
}

// ===== KOL 候选池 =====

/** KOL 在候选池中的状态 */
export type PoolKOLStatus = 'candidate' | 'shortlisted' | 'contacted' | 'confirmed' | 'rejected'

/** Campaign KOL 候选池记录 */
export interface CampaignKOLPoolItem {
  /** Campaign ID */
  campaignId: string
  /** KOL ID（来自 KOL 数据库） */
  kolId: string
  /** KOL 名称 */
  name: string
  /** 平台 */
  platform: string
  /** 粉丝量 */
  followers: string
  /** 互动率 */
  engagement: string
  /** 类目 */
  category: string
  /** 报价 */
  price: string
  /** 城市 */
  city: string
  /** 候选池状态 */
  status: PoolKOLStatus
  /** 备注 */
  notes: string
  /** 加入时间 */
  addedAt: number
}

/** 导入 KOL 到候选池输入 */
export interface ImportKOLsToPoolInput {
  campaignId: string
  kolIds: string[]
}

// ===== KOL 搜索（用于导入弹窗） =====

/** KOL 记录（简化版，用于列表展示） */
export interface KOLListItem {
  id: string
  name: string
  platform: string
  followers: string
  engagement: string
  category: string
  price: string
  city: string
  avatar: string
  source: string
  rawData: string
  baseScore: number      // 基础数据评分（VONBON §4.1）
  contentScore: number   // 内容质量评分
  commercialScore: number // 商业适配评分
  overallScore: number  // 综合评分
  createdAt: number
  updatedAt: number
}

/** KOL 搜索结果 */
export interface KOLSearchResult {
  kols: KOLListItem[]
  total: number
}

// ===== KOL Brief =====

/** KOL 合作 Brief */
export interface CampaignBrief {
  /** 唯一标识 */
  id: string
  /** Campaign ID */
  campaignId: string
  /** KOL ID */
  kolId: string
  /** KOL 名称 */
  kolName: string
  /** Brief 内容（Markdown） */
  content: string
  /** 是否 AI 生成 */
  aiGenerated: boolean
  /** 状态：draft / final */
  status: 'draft' | 'final'
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

/** 保存 Brief 输入 */
export interface SaveCampaignBriefInput {
  campaignId: string
  kolId: string
  kolName: string
  content: string
  aiGenerated?: boolean
}

// ===== IPC 通道常量 =====

/**
 * Campaign 相关 IPC 通道常量
 */
export const CAMPAIGN_IPC_CHANNELS = {
  /** 获取 Campaign 列表 */
  LIST: 'campaign:list',
  /** 获取单个 Campaign */
  GET: 'campaign:get',
  /** 创建 Campaign */
  CREATE: 'campaign:create',
  /** 更新 Campaign */
  UPDATE: 'campaign:update',
  /** 获取 Campaign 候选池 KOL */
  GET_POOL_KOLS: 'campaign:getPoolKols',
  /** 导入 KOL 到候选池 */
  IMPORT_KOLS: 'campaign:importKols',
  /** 获取 KOL 数据库中可用 KOL（用于导入弹窗） */
  LIST_AVAILABLE_KOLS: 'campaign:listAvailableKols',
  /** 获取 KOL Brief */
  GET_BRIEF: 'campaign:getBrief',
  /** 保存 KOL Brief */
  SAVE_BRIEF: 'campaign:saveBrief',
  /** 推进 Campaign 到下一阶段 */
  ADVANCE_PHASE: 'campaign:advancePhase',
  /** 确保 Campaign Workspace 工具文件存在（旧 Campaign 兼容） */
  ENSURE_WORKSPACE: 'campaign:ensureWorkspace',
} as const

// ===== 内容审核 =====

export interface ContentAudit {
  auditId: string
  campaignId: string
  kolId: string
  kolName: string
  contentUrl: string
  platform: string
  auditStatus: 'pending' | 'reviewing' | 'passed' | 'failed'
  complianceScore: number
  brandAlignmentScore: number
  qualityScore: number
  overallScore: number
  auditReport: string
  auditor: string
  createdAt: number
  updatedAt: number
}

export interface CreateContentAuditInput {
  campaignId: string
  kolId: string
  kolName: string
  brand: string
  product: string
  platform: string
  contentType: string
  contentDescription: string
  contentUrl?: string
}

export const CONTENT_AUDIT_IPC_CHANNELS = {
  LIST: 'contentAudit:list',
  GET: 'contentAudit:get',
  CREATE: 'contentAudit:create',
  UPDATE_STATUS: 'contentAudit:updateStatus',
} as const

// ===== KOL 数据管理 =====

export interface UpdateKOLInput {
  id: string
  name: string
  platform: string
  followers: string
  engagement: string
  category: string
  price: string
  city: string
}

export const KOL_DATA_IPC_CHANNELS = {
  LIST_ALL: 'kol:listAll',
  UPDATE: 'kol:update',
  DELETE: 'kol:delete',
  RECALCULATE_SCORES: 'kol:recalculateScores',
} as const
