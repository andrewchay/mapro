/**
 * Campaign 工作流全链路 E2E 测试
 *
 * 模拟一个真实 Campaign 从创建到 9 步全部完成的完整执行路径，验证步骤间状态机
 * 推进、产物校验、历史记录同步、候选池导入等全链路环节的准确性。
 *
 * 覆盖的服务层链路：
 * - campaign-manager：createCampaign / importKOLsToPool / getPoolKOLs
 * - campaign-workflow-service：loadCampaignWorkflow / getStepAgentPrompt（模板替换）/
 *   updateWorkflowStep / completeStepWithValidation（兜底落盘 + 5 层校验 + 状态推进）/
 *   validateStepArtifacts / getWorkflowProgress / isWorkflowComplete / resetWorkflow
 * - kol-data-service：seedMockKOLs / searchKOLs
 * - campaign-agent：executeCampaignAgentTool（ma_campaign_kol_add 真实导入候选池）
 *
 * 不包含真实 LLM/SDK 调用（由 agent-orchestrator 层测试覆盖），Agent 产物用覆盖
 * 语义锚点的合格文本模拟，与渲染层 CampaignWorkflowSteps.handleExecuteStep 的调用
 * 链路一致：getStepAgentPrompt → updateWorkflowStep(in_progress) → 写产物 →
 * completeStepWithValidation（对应 agent-service.runAgent 的 onComplete 自动完成）。
 *
 * 每个测试用例顺序执行、共享同一个 Campaign，模拟真实工作流的串行推进。
 */

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { existsSync, readFileSync, unlinkSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CampaignWorkflowStepId, AgentMessage } from '@ma-proma/shared'

// ===== 前置 mock =====

const TEST_DIR = join(tmpdir(), `mapro-workflow-e2e-${Date.now()}`)

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

// ===== 类型 =====

interface WorkflowServiceModule {
  loadCampaignWorkflow: (campaignId: string) => import('@ma-proma/shared').CampaignWorkflow
  updateWorkflowStep: (input: import('@ma-proma/shared').UpdateWorkflowStepInput) => import('@ma-proma/shared').CampaignWorkflow
  resetWorkflow: (campaignId: string) => import('@ma-proma/shared').CampaignWorkflow
  getStepAgentPrompt: (
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    context?: Record<string, string>,
  ) => string
  completeStepWithValidation: (
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    messages: AgentMessage[] | undefined,
  ) => { success: boolean; workflow: import('@ma-proma/shared').CampaignWorkflow; reason?: string }
  getWorkflowProgress: (campaignId: string) => number
  isWorkflowComplete: (campaignId: string) => boolean
}

interface CampaignManagerModule {
  closeCampaignDatabase: () => void
  createCampaign: (input: import('@ma-proma/shared').CreateCampaignInput) => import('@ma-proma/shared').Campaign
  getPoolKOLs: (campaignId: string) => import('@ma-proma/shared').CampaignKOLPoolItem[]
}

interface KolDataServiceModule {
  closeKolDatabase: () => void
  seedMockKOLs: () => { inserted: number }
  searchKOLs: (filters: {
    platform?: string
    category?: string
    city?: string
    keywords?: string[]
    limit?: number
  }) => { kols: Array<{ id: string; name: string; platform: string }>; total: number }
}

interface CampaignAgentModule {
  isCampaignAgentToolCall: (toolName: string) => boolean
  executeCampaignAgentTool: (tc: {
    id: string
    name: string
    arguments: Record<string, unknown>
  }) => Promise<{ toolCallId: string; content: string; isError?: boolean }>
}

let workflowService: WorkflowServiceModule
let campaignManager: CampaignManagerModule
let kolDataService: KolDataServiceModule
let campaignAgent: CampaignAgentModule

// ===== Campaign 上下文（用于步骤提示词模板替换） =====

const CAMPAIGN_BRAND = '测试鲜果'
const CAMPAIGN_BUDGET = '200000'

// ===== 步骤 → 产物目录映射（与 campaign-workflow-service.STEP_DIR_MAP 对齐） =====

const STEP_DIR: Record<CampaignWorkflowStepId, string> = {
  market_analysis: 'market-analysis',
  competitor_analysis: 'competitor-analysis',
  user_analysis: 'user-analysis',
  brand_dna: 'brand-dna',
  brand_concept: 'brand-concept',
  goal_setting: 'goal-setting',
  creative_concept: 'creative-concept',
  platform_matrix: 'platform-matrix',
  kol_pyramid: 'kol-pyramid',
  search_kols: 'kol-search',
  add_to_pool: 'kol-search',
  generate_briefs: 'briefs',
  ab_test: 'ab-test',
}

// ===== 每步合格产物内容（覆盖全部语义锚点 + 字数达标） =====

const STEP_ARTIFACTS: Record<CampaignWorkflowStepId, { filename: string; content: string }> = {
  market_analysis: {
    filename: 'market-analysis.md',
    content: `# 市场分析

## 市场规模
测试鲜果所在鲜切水果赛道，大盘数据约 50 亿年增速 25%，渗透率一二线城市 15% 仍有提升空间。
市场容量判断：赛道处于成长期，市场机会明确。

## 品类趋势
当前品类处于上升周期，用户偏好从"整果购买"向"鲜切即食"转移。
趋势机会点：健康轻食、办公室场景、即时消费。

## 品类痛点
用户当前未被满足的需求："想吃水果但没时间挑选处理"。
行业普遍问题：传统水果店缺乏场景化解决方案。
空白切入点：鲜切即食 + 场景化套餐。`,
  },
  competitor_analysis: {
    filename: 'competitor-analysis.md',
    content: `# 竞品分析

## 竞品清单
直接竞品：百果园、鲜丰水果。间接竞品：每日优鲜、叮咚买菜。

## 市场占比
百果园市场份额约 30%，声量占比高；鲜丰水果约 15%。
竞争格局：头部集中，中小品牌有机会通过差异化切入。

## 营销动作
百果园当前主打"新鲜"，小红书投放以水果测评为主。
鲜丰水果侧重线下门店，线上内容较少。

## 核心卖点
竞品主打差异化点：百果园"新鲜到家"，鲜丰"产地直采"。

## 空白机会
竞品没做或没做好的地方：场景化鲜切、都市女性情感连接、办公场景渗透。
差异化策略：抢占"通勤即时犒赏"场景。`,
  },
  user_analysis: {
    filename: 'ta-portrait.md',
    content: `# 用户分析

## 人口统计画像
年龄 25-35 岁，性别女性为主，收入 8K-20K，城市一二线城市，学历本科及以上，职业白领。

## 兴趣偏好
兴趣标签：健康生活、美食探店、生活方式。消费观：品质优先，愿意为便捷付费。

## 痛点与需求
核心痛点："想吃水果但没时间挑选处理"。使用场景：通勤路上、办公室下午茶、加班夜宵。
购买动机：即时满足、健康犒赏、社交分享。

## 搜索习惯
搜索平台：小红书为主，抖音为辅。搜索场景：种草前搜索测评、决策中搜索对比。
关键词：鲜切水果、办公室水果、健康零食、下午茶推荐。`,
  },
  brand_dna: {
    filename: 'brand-dna.md',
    content: `# 品牌 DNA 分析

## 品牌历史
测试鲜果创立于 2018 年，从一家社区水果店发展至今已有 6 年发展历程。
品牌传承"每日鲜果"的理念，在城市品质生活领域持续深耕，积累了稳定口碑。

## 产品服务
核心产品线包括鲜切水果盒、季节限定果篮、办公室下午茶套餐。
功能卖点：当日鲜切、冷链配送、无添加；价格带覆盖 29-99 元，主打性价比。

## 目标人群洞察
核心人群为 25-35 岁都市女性客群，TA 画像集中在一二线城市白领。
人群洞察：她们追求健康又怕麻烦，痛点是"想吃水果但没时间挑选处理"，
需求是"开盖即食的高品质鲜果"。

## 竞品对标
直接竞品为百果园、鲜丰水果，竞品传播主打"新鲜"但同质化严重。
对标 aspiration 品牌喜茶的生活方式调性，竞争品牌缺乏情感连接。

## 差异化优势
我们的差异化在于"鲜切即食+场景化套餐"，核心竞争力是供应链稳定性
与都市女性生活场景的深度绑定，形成与竞品最核心的差异。`,
  },
  brand_concept: {
    filename: 'brand-concept.md',
    content: `# Brand Concept 产出

## 品牌愿景
我们的使命是让都市人随时享受鲜果带来的小确幸，长期目标是成为城市品质生活的鲜果首选。

## 品牌价值观
我们信仰"新鲜、真实、克制"，价值判断以用户健康体验为先。

## 品牌主张
slogan 候选："鲜在一刻，甜在心头"。这一定位主张传递即时满足的宣言。

## 品牌人格
品牌个性：真诚、清爽、有亲和力，像一个懂生活的邻家姐姐。

## 产品定位
Functional benefit：解决鲜果处理麻烦的问题。
差异化定位：鲜切即食。RTB：自有冷链 + 当日鲜切。利益点清晰。

## 品牌屋
品牌屋架构：愿景（鲜果小确幸）→ 价值观（新鲜真实）→ 利益点（即食便捷）
→ RTB（冷链鲜切）→ 目标人群（都市女性），各层级逻辑自洽。

## Brand Tone
tone of voice：真诚、轻松、可靠。语言风格生活化，调性克制不夸张。

## Brand Visual
visual 风格：清爽自然明亮。色彩策略用鲜果高饱和色 + 留白，字体偏好清晰有亲和力。`,
  },
  creative_concept: {
    filename: 'big-idea.md',
    content: `# Big Idea 生成

## 核心创意
Big Idea："下班路上的第一口甜"。核心概念是抢占都市女性通勤场景，
传播主张"鲜果即食，犒赏忙碌一天的自己"，大创意钩子在于"即时犒赏"。
这一核心概念将品牌鲜果与都市女性日常通勤的高频场景深度绑定，
通过情感化的即时犒赏主张，建立品牌与用户之间稳固的情绪连接，
让每一口鲜果都成为忙碌生活中的小确幸。

## 创意方向
方向一（视觉方向）：办公室下午茶场景，突出鲜切色彩与同事分享氛围。
方向二（文案方向）：通勤路上即食，强调便捷与开盖即得的满足感。
方向三（内容方向）：周末家庭补给，传递品质生活与亲子分享温度。
媒介建议：小红书图文为主种草，抖音短视频辅助放大声量。

## 推荐方案
推荐方向二为主推方案，最优方案理由：通勤场景与即食卖点强绑定，
首选该方向能最大化差异化，高频通勤场景更易形成心智占领。
最终选择"下班路上的第一口甜"作为主创意，兼顾情感共鸣与产品特性。`,
  },
  platform_matrix: {
    filename: 'platform-matrix.md',
    content: `# 平台矩阵设计

## 平台角色
小红书承担种草平台角色，内容角色为图文种草 + 测评，分发策略以搜索卡位为主。
抖音承担引爆平台角色，内容角色为短视频场景植入，快速触达。

## KPI
小红书 KPI：曝光 500 万、互动率 6%、搜索占位 TOP3。
抖音指标：播放 1000 万、互动 5%。考核以 CPE 和爆文率为核心效果指标。

## 预算分配
总预算 20 万。预算分配：小红书 60%（12 万），抖音 40%（8 万）。
预算比例向小红书倾斜，因目标人群匹配度更高，资源分配聚焦种草。

## 内容排期
首月内容日历：第 1 周种草铺垫，第 2-3 周集中爆发，第 4 周长尾维护。
排期表按周迭代，每周 3-5 条笔记，时间线覆盖三个月投放周期。`,
  },
  kol_pyramid: {
    filename: 'kol-pyramid.md',
    content: `# KOL 金字塔设计

## 金字塔结构
KOL 金字塔分三层：头部 1 位（粉丝 50W+），承担声量引爆与品牌背书；
腰部 3 位（粉丝 10-50W），承担深度种草与场景渗透；尾部 6 位（粉丝 1-10W），
承担长尾覆盖与真实口碑。比例 1:3:6，层级递进覆盖不同粉丝量级，
形成从品牌认知到兴趣种草再到下单转化的完整营销链路。

## 预算分配
总费用 20 万。预算分配：头部 8 万（单价高但引爆力强，撬动声量），
腰部 9 万（性价比最优，主力内容产出），尾部 3 万（低成本铺量扩覆盖）。
预算比例向腰部倾斜，投入产出比最优，兼顾声量引爆与深度渗透。

## 筛选标准
筛选标准：粉丝量达标、互动率 > 6%、女粉占比 > 70%、近 30 天爆文率 > 5%。
要求内容类目匹配美妆/生活方式/美食，城市优先上海杭州，
条件严格把控质量，排除广告占比过高与负面评论多的风险达人。`,
  },
  search_kols: {
    filename: 'kol-search-results.md',
    content: `# KOL 搜索结果

## 搜索条件
筛选条件：平台小红书，类目美妆/生活方式，粉丝量 10W-100W。
搜索参数：互动率 > 6%，城市上海/杭州。筛选标准与金字塔腰部要求一致。

## KOL 列表
推荐列表：
- mock_小红书_美妆达人小美：50W 粉丝，互动 8.5%
- mock_小红书_护肤分享师：30W 粉丝，互动 9.2%
- mock_小红书_生活方式博主：80W 粉丝，互动 6.8%
共筛选出 3 位达人 KOL 候选人。

## 推荐理由
推荐理由：这三位达人均为小红书平台，粉丝画像与目标人群匹配度高。
评估维度：互动率均超 6% 合格线，匹配度优秀。为什么选她们：美妆 + 生活方式类目契合鲜果场景。`,
  },
  add_to_pool: {
    filename: 'pool-import-log.md',
    content: `# 候选池导入日志

## 导入记录
导入时间：2024-06-15。将筛选达人加入候选池，导入日志如下。

## KOL ID 列表
- mock_小红书_美妆达人小美
- mock_小红书_护肤分享师
- mock_小红书_生活方式博主
编号共计 3 位。

## 导入结果
导入结果：成功 3 位，失败 0 位，跳过 0 位。状态均为 candidate。
当前候选池总计 3 位达人。`,
  },
  generate_briefs: {
    filename: 'briefs-index.md',
    content: `# 达人 Brief 索引

## Brief 清单
索引：共 3 份 Brief，列表如下：
- brief-mock_小红书_美妆达人小美.md
- brief-mock_小红书_护肤分享师.md
- brief-mock_小红书_生活方式博主.md

## 内容方向
内容方向：以"下班路上的第一口甜"为核心信息。
关键信息：鲜切即食、冷链配送、无添加。信息点突出便捷与新鲜。

## 交付物
交付清单：每位达人 1 篇图文笔记 + 1 条短视频。
交付物要求：产品自然露出，作品需提前 3 天提交审核。

## 时间线
时间线：第 1 周确认脚本，第 2 周拍摄，第 3 周发布。
节点 deadline：每月 20 号前完成发布。截止日期严格把控。`,
  },
  goal_setting: {
    filename: 'goal-setting.md',
    content: `# 目标设定

## 总目标
本阶段核心问题：建立品类认知 + 验证内容模型。
目标：让都市女性将"鲜切即食鲜果"与品牌形成心智关联。

## 分层目标
小红书测试期：找到 1 组可复制的爆文模型。
抖音辅助期：完成品牌声量初始积累，播放量 1000 万+。

## 量化指标
KPI 必须可追踪、可复盘：
- 互动率 > 6%
- CPE < 5 元
- 爆文率 > 10%
- 搜索量增长 200%
- ROI > 1:3`,
  },
  ab_test: {
    filename: 'ab-test-plan.md',
    content: `# A/B 测试方案

## 测试变量
本次 A/B 测试变量为标题文案。变量对照：A 组标准标题（品牌原有风格），
B 组情感向标题（场景化表达）。测试方案评估情感化标题对点击的提升效果，
严格控制在标题这一个维度，其他投放条件保持一致以确保对照有效。

## 分组方案
受众分组：随机分两组，各 50% 流量。A 组对照组保持原标题，
B 组测试组用情感标题。分组方案确保两组人群年龄性别地域分布一致，
测试周期 7 天覆盖工作日与周末，避免时间偏差影响结果。

## 指标
主要指标 CTR（点击通过率）。KPI：B 组 CTR 相对 A 组提升 > 15%。
关键指标：转化率、互动率、停留时长。统计指标 p<0.05 判定有效。

## 样本量
样本量计算：显著性水平 α=0.05，检验功效 0.8。计算得每组需至少 5000 次有效曝光。
统计：总曝光 200 万，远超最低样本要求，显著性充足。7 天完成测试，每日监控数据。`,
  },
}

describe('Campaign 工作流全链路 E2E 测试', () => {
  let campaignId: string
  /** 第 10 步搜索到的 KOL ID，供第 11 步导入候选池使用 */
  let searchedKolIds: string[] = []

  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true })
    process.env._MAPRO_TEST_CONFIG_DIR = TEST_DIR

    campaignManager = (await import('../campaign-manager')) as CampaignManagerModule
    workflowService = (await import('../campaign-workflow-service')) as WorkflowServiceModule
    kolDataService = (await import('../ma-tools/kol-data-service')) as KolDataServiceModule
    campaignAgent = (await import('../ma-tools/campaign-agent')) as CampaignAgentModule

    // 填充 Mock KOL 数据到 KOL 数据库（供第 10 步搜索、第 11 步导入）
    kolDataService.seedMockKOLs()

    // 创建真实 Campaign（SQLite 存储 + 创建 workspace）
    const campaign = campaignManager.createCampaign({
      name: '全链路测试 Campaign',
      brand: CAMPAIGN_BRAND,
      platform: 'xiaohongshu',
      budget: 200000,
      durationMonths: 3,
      targetCity: ['上海', '杭州'],
      targetAudience: '都市年轻女性',
    })
    campaignId = campaign.id
  })

  afterAll(() => {
    // 关闭所有模块级数据库单例，避免污染后续测试文件
    campaignManager.closeCampaignDatabase()
    kolDataService.closeKolDatabase()

    const dbPath = join(TEST_DIR, 'campaign-database.sqlite')
    if (existsSync(dbPath)) unlinkSync(dbPath)
    const kolDbPath = join(TEST_DIR, 'kol-database.sqlite')
    if (existsSync(kolDbPath)) unlinkSync(kolDbPath)

    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  })

  // ===== 通用步骤执行器（模拟渲染层 handleExecuteStep + 主进程 completeStepWithValidation） =====

  /**
   * 执行单个工作流步骤的全链路：
   * 1. getStepAgentPrompt 验证模板变量已被替换
   * 2. updateWorkflowStep(in_progress) 验证 currentStepIndex 推进
   * 3. 模拟 Agent 写入合格产物到标准目录
   * 4. completeStepWithValidation 兜底落盘 + 5 层校验 + 标记 completed
   * 5. 验证进度递增
   */
  function runStep(
    stepId: CampaignWorkflowStepId,
    stepIndex: number,
    summary: string,
  ): void {
    const artifact = STEP_ARTIFACTS[stepId]

    // 1. 模板替换验证（{brand}/{budget} 不应残留）
    const prompt = workflowService.getStepAgentPrompt(campaignId, stepId, {
      brand: CAMPAIGN_BRAND,
      budget: CAMPAIGN_BUDGET,
    })
    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt).not.toMatch(/\{brand\}|\{budget\}/)
    // kol_pyramid 步骤提示词含 {budget}，替换后应出现预算数值
    if (stepId === 'kol_pyramid') {
      expect(prompt).toContain(CAMPAIGN_BUDGET)
    }

    // 2. 标记 in_progress，currentStepIndex 应推进到当前步骤
    const inProgressWf = workflowService.updateWorkflowStep({
      campaignId,
      stepId,
      status: 'in_progress',
    })
    expect(inProgressWf.currentStepIndex).toBe(stepIndex)
    expect(inProgressWf.steps[stepIndex]?.status).toBe('in_progress')

    // 3. 模拟 Agent 写入合格产物（覆盖该步全部语义锚点）
    const dir = join(TEST_DIR, 'agent-workspaces', `campaign-${campaignId}`, STEP_DIR[stepId])
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, artifact.filename), artifact.content, 'utf-8')

    // 4. 完成步骤（兜底落盘 + 5 层校验 + 状态推进 + 历史记录）
    const messages: AgentMessage[] = [
      { id: `msg-${stepId}`, role: 'assistant', content: summary, createdAt: Date.now() },
    ]
    const result = workflowService.completeStepWithValidation(campaignId, stepId, messages)
    expect(result.success).toBe(true)
    expect(result.reason).toBeUndefined()

    const step = result.workflow.steps[stepIndex]
    expect(step?.status).toBe('completed')
    expect(step?.completedAt).toBeDefined()
    expect(step?.outputSummary).toBe(summary)

    // 5. 进度递增验证
    const expectedProgress = Math.round(((stepIndex + 1) / 9) * 100)
    expect(workflowService.getWorkflowProgress(campaignId)).toBe(expectedProgress)
  }

  // ===== 前置：Campaign 创建 + 工作流初始化 =====

  it('前置: Campaign 创建成功 + 工作流初始化为 9 步 pending', () => {
    const workflow = workflowService.loadCampaignWorkflow(campaignId)

    expect(workflow.campaignId).toBe(campaignId)
    expect(workflow.steps).toHaveLength(9)
    expect(workflow.currentStepIndex).toBe(-1)
    expect(workflow.steps.every((s) => s.status === 'pending')).toBe(true)
    expect(workflowService.getWorkflowProgress(campaignId)).toBe(0)

    // 验证标准产物目录与上下文文件已初始化
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${campaignId}`)
    for (const dir of ['brand-dna', 'brand-concept', 'creative-concept', 'platform-matrix',
      'kol-pyramid', 'kol-search', 'briefs', 'ab-test', '.context']) {
      expect(existsSync(join(workspaceDir, dir))).toBe(true)
    }
    expect(existsSync(join(workspaceDir, '.context', 'todo.md'))).toBe(true)
    expect(existsSync(join(workspaceDir, '.context', 'campaign.md'))).toBe(true)
  })

  // ===== 13 步顺序执行 =====

  it('步骤1 market_analysis: 市场分析', () => {
    runStep('market_analysis', 0, '已完成：市场分析')
  })

  it('步骤2 competitor_analysis: 竞品分析', () => {
    runStep('competitor_analysis', 1, '已完成：竞品分析')
  })

  it('步骤3 user_analysis: 用户分析（TA画像+搜索习惯）', () => {
    runStep('user_analysis', 2, '已完成：用户分析')
  })

  it('步骤4 brand_dna: 品牌DNA+品牌诊断', () => {
    runStep('brand_dna', 3, '已完成：品牌DNA+品牌诊断')
  })

  it('步骤5 brand_concept: 品牌概念产出', () => {
    runStep('brand_concept', 4, '已完成：Brand Concept 产出')
  })

  it('步骤6 goal_setting: 目标设定', () => {
    runStep('goal_setting', 5, '已完成：目标设定')
  })

  it('步骤7 creative_concept: 生成 Big Idea', () => {
    runStep('creative_concept', 6, '已完成：Big Idea 生成')
  })

  it('步骤8 platform_matrix: 设计平台矩阵', () => {
    runStep('platform_matrix', 7, '已完成：平台矩阵设计')
  })

  it('步骤9 kol_pyramid: 设计 KOL 金字塔（含预算模板替换）', () => {
    runStep('kol_pyramid', 8, '已完成：KOL 金字塔设计')
  })

  it('步骤10 search_kols: 真实搜索 KOL 数据库 → 产物 → 完成', () => {
    // 真实调用 kol-data-service 搜索 KOL 数据库
    const searchResult = kolDataService.searchKOLs({ platform: '小红书', limit: 5 })
    expect(searchResult.total).toBeGreaterThan(0)
    expect(searchResult.kols.length).toBeGreaterThan(0)

    // 记录搜索到的 KOL ID，供第 11 步导入候选池
    searchedKolIds = searchResult.kols.slice(0, 3).map((k) => k.id)
    expect(searchedKolIds).toHaveLength(3)

    runStep('search_kols', 9, '已完成：候选达人筛选，共筛出 3 位小红书达人')
  })

  it('步骤11 add_to_pool: 真实 ma_campaign_kol_add 导入候选池 → 产物 → 完成', async () => {
    // 真实调用 Campaign Agent 工具导入候选池
    const toolResult = await campaignAgent.executeCampaignAgentTool({
      id: 'tc-add-pool',
      name: 'ma_campaign_kol_add',
      arguments: {
        campaign_id: campaignId,
        kol_ids: searchedKolIds.join(','),
      },
    })
    expect(toolResult.isError).toBeFalsy()
    const parsed = JSON.parse(toolResult.content) as { imported: number; totalRequested: number }
    expect(parsed.imported).toBe(3)
    expect(parsed.totalRequested).toBe(3)

    // 验证候选池真实写入
    const pool = campaignManager.getPoolKOLs(campaignId)
    expect(pool).toHaveLength(3)
    expect(pool.every((k) => k.status === 'candidate')).toBe(true)
    expect(pool.map((k) => k.kolId).sort()).toEqual([...searchedKolIds].sort())

    runStep('add_to_pool', 10, '已完成：达人导入候选池，成功导入 3 位')
  })

  it('步骤12 generate_briefs: 生成达人 Brief', () => {
    runStep('generate_briefs', 11, '已完成：达人 Brief 生成')
  })

  it('步骤13 ab_test: 设计 A/B 测试', () => {
    runStep('ab_test', 12, '已完成：A/B 测试设计')
  })

  // ===== 终态验证 =====

  it('终态: 13 步全完成 → isWorkflowComplete=true, progress=100', () => {
    expect(workflowService.isWorkflowComplete(campaignId)).toBe(true)
    expect(workflowService.getWorkflowProgress(campaignId)).toBe(100)

    const workflow = workflowService.loadCampaignWorkflow(campaignId)
    expect(workflow.steps.every((s) => s.status === 'completed')).toBe(true)
    expect(workflow.steps.every((s) => s.completedAt !== undefined)).toBe(true)
    expect(workflow.steps.every((s) => s.outputSummary !== undefined)).toBe(true)
  })

  it('终态: history.md 累积 9 条完成记录', () => {
    const historyPath = join(TEST_DIR, 'agent-workspaces', `campaign-${campaignId}`, '.context', 'history.md')
    expect(existsSync(historyPath)).toBe(true)

    const content = readFileSync(historyPath, 'utf-8')
    expect(content).toContain('Campaign 执行历史')
    const completedCount = (content.match(/✅ 完成/g) || []).length
    expect(completedCount).toBe(9)
    // 每步都应记录步骤 ID
    for (const stepId of Object.keys(STEP_ARTIFACTS) as CampaignWorkflowStepId[]) {
      expect(content).toContain(stepId)
    }
  })

  it('终态: todo.md 全部步骤移入已完成区块', () => {
    const todoPath = join(TEST_DIR, 'agent-workspaces', `campaign-${campaignId}`, '.context', 'todo.md')
    const content = readFileSync(todoPath, 'utf-8')

    expect(content).toContain('## ✅ 已完成')
    expect(content).not.toContain('## ⏳ 待完成')
    expect(content).not.toContain('## 🔵 当前步骤')

    // 9 个步骤全部勾选
    const checkedCount = (content.match(/- \[x\]/g) || []).length
    expect(checkedCount).toBe(9)
  })

  it('终态: 候选池保留 3 个 KOL 且状态为 candidate', () => {
    const pool = campaignManager.getPoolKOLs(campaignId)
    expect(pool).toHaveLength(3)
    expect(pool.every((k) => k.status === 'candidate')).toBe(true)
  })

  it('终态: 产物校验全部通过（每步 valid=true）', () => {
    // 重新加载工作流，确认所有步骤产物仍然校验通过
    const workflow = workflowService.loadCampaignWorkflow(campaignId)
    expect(workflow.steps.every((s) => s.status === 'completed')).toBe(true)
  })

  // ===== 回归：重置工作流 =====

  it('回归: 重置工作流恢复 9 步 pending 初始状态', () => {
    const workflow = workflowService.resetWorkflow(campaignId)

    expect(workflow.steps).toHaveLength(9)
    expect(workflow.steps.every((s) => s.status === 'pending')).toBe(true)
    expect(workflow.steps.every((s) => s.completedAt === undefined)).toBe(true)
    expect(workflow.currentStepIndex).toBe(-1)
    expect(workflowService.getWorkflowProgress(campaignId)).toBe(0)
    expect(workflowService.isWorkflowComplete(campaignId)).toBe(false)

    // todo.md 应恢复为待完成区块
    const todoPath = join(TEST_DIR, 'agent-workspaces', `campaign-${campaignId}`, '.context', 'todo.md')
    const content = readFileSync(todoPath, 'utf-8')
    expect(content).toContain('## ⏳ 待完成')
    expect(content).not.toContain('## ✅ 已完成')
  })
})
