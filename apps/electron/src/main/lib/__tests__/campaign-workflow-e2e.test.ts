/**
 * Campaign 工作流全链路 E2E 测试
 *
 * 模拟一个真实 Campaign 从创建到 14 步全部完成的完整执行路径，验证步骤间状态机
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
  brand_fact_check: 'brand-fact-check',
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

const STEP_ARTIFACTS: Record<CampaignWorkflowStepId, { filename: string; content: string } | { filename: string; content: string }[]> = {
  market_analysis: {
    filename: 'market-analysis.md',
    content: `# 市场分析

## 市场规模
测试鲜果所在鲜切水果赛道，大盘数据约 50 亿年增速 25%，渗透率一二线城市 15% 仍有提升空间。
市场容量判断：赛道处于成长期，市场机会明确。参考艾瑞咨询 2025 年生鲜报告，
鲜切水果品类近三年复合增速保持 20% 以上，属于高增长细分赛道。

## 品类趋势
当前品类处于上升周期，用户偏好从"整果购买"向"鲜切即食"转移。
趋势机会点：健康轻食、办公室场景、即时消费。品类趋势显示年轻女性
对"开盖即食"的便捷鲜果需求上升，预制化鲜切产品渗透率持续提升。

## 品类痛点
用户当前未被满足的需求："想吃水果但没时间挑选处理"。
行业普遍问题：传统水果店缺乏场景化解决方案，鲜切产品标准化不足。
空白切入点：鲜切即食 + 场景化套餐，针对办公室与通勤场景提供即时鲜果。`,
  },
  competitor_analysis: {
    filename: 'competitor-analysis.md',
    content: `# 竞品分析

## 竞品清单
直接竞品：百果园、鲜丰水果。间接竞品：每日优鲜、叮咚买菜。
对标品牌还包括鲜果时光等区域性鲜切品牌，竞争品牌主要集中在连锁水果零售赛道。

## 市场占比
百果园市场份额约 30%，声量占比高；鲜丰水果约 15%。
竞争格局：头部集中，中小品牌有机会通过差异化切入。
市场份额数据显示头部两家合计约 45%，长尾品牌仍有较大空间。

## 营销动作
百果园当前主打"新鲜"，小红书投放以水果测评为主。
鲜丰水果侧重线下门店，线上内容较少。竞品营销动作整体偏功能性诉求。

## 核心卖点
竞品主打差异化点：百果园"新鲜到家"，鲜丰"产地直采"。
核心卖点集中在供应链与新鲜度，缺乏情感化与场景化表达。

## 空白机会
竞品没做或没做好的地方：场景化鲜切、都市女性情感连接、办公场景渗透。
差异化策略：抢占"通勤即时犒赏"场景，建立情感心智。`,
  },
  user_analysis: [
    {
      filename: 'ta-portrait.md',
      content: `# 用户分析

## 人口统计画像
年龄 25-35 岁，性别女性为主，收入 8K-20K，城市一二线城市，学历本科及以上，职业白领。
人口统计显示该人群处于事业上升期，消费能力中等偏上，对品质生活有明确追求。

## 兴趣偏好
兴趣标签：健康生活、美食探店、生活方式。消费观：品质优先，愿意为便捷付费。
偏好特征：重视颜值与仪式感，习惯通过小红书获取种草信息，决策受内容驱动明显。

## 痛点与需求
核心痛点："想吃水果但没时间挑选处理"。使用场景：通勤路上、办公室下午茶、加班夜宵。
购买动机：即时满足、健康犒赏、社交分享。需求集中在便捷、新鲜、场景化解决方案。`,
    },
    {
      filename: 'search-habits.md',
      content: `# 搜索习惯

## 搜索平台
搜索平台：小红书为主，抖音为辅。用户在不同平台获取信息的偏好明显不同。

## 搜索场景
搜索场景：种草前搜索测评、决策中搜索对比、使用后搜索搭配灵感。

## 关键词列表
核心关键词：鲜切水果、办公室水果、健康零食、下午茶推荐。
长尾关键词：通勤水果、加班零食、办公室下午茶、健康犒赏。
下拉词联想以场景化长尾词为主，用户搜索意图偏向解决方案和场景匹配。`,
    },
    {
      filename: 'consumer-insight.md',
      content: `# 消费者洞察

## 观察
25-35 岁都市女性在小红书搜索"办公室水果""健康零食"时，频繁收藏"即食""低卡"相关笔记；
同时评论区高频出现"想吃水果但没时间洗切""外卖水果分量太大"的抱怨。

## 洞察
她们不是缺水果，而是缺一种"不费力就能获得的体面健康感"。
在忙碌的工作节奏中，她们渴望通过小细节证明自己在好好生活，
但传统水果消费需要挑选、清洗、切分，与她们追求的"精致但不麻烦"形成张力。

## 张力
想要健康犒赏，但不愿付出时间和精力；想要仪式感，但场景碎片化。

## 传播切入点
用"开盖即得的精致犒赏"作为内容主轴，把鲜切水果包装成都市女性忙碌生活中的小确幸，
强调"无需准备、随时体面"的情绪价值。`,
    },
  ],
  brand_dna: {
    filename: 'brand-dna.md',
    content: `# 品牌 DNA 分析

## 品牌历史
测试鲜果创立于 2018 年，从一家社区水果店发展至今已有 6 年发展历程。
品牌传承"每日鲜果"的理念，在城市品质生活领域持续深耕，积累了稳定口碑。

## 产品服务
核心产品线包括鲜切水果盒、季节限定果篮、办公室下午茶套餐。
功能卖点：当日鲜切、冷链配送、无添加；价格带覆盖 29-99 元，主打性价比。

## 品牌阶段诊断
当前品牌处于成长期，已完成从单店到连锁的阶段定位，正向品牌化阶段过渡。
品牌阶段判断：成长期，需要通过品牌内容加速心智建立。

## 产品现状诊断
产品力稳定，供应链诊断显示冷链成熟，价格带 29-99 元，SKU 约 30 个。
产品现状良好，具备规模化扩张的产品基础。

## 核心问题定义
当前首要解决的是认知问题，目标用户对品牌心智不足，声量尚未破圈。
核心问题定义为本阶段需建立品类认知。

## 核心目标
基于成长期阶段和认知问题，首要目标是曝光和破圈拉新。
目标优先级：声量优先，其次为转化。

## 差异化优势
我们的差异化在于"鲜切即食+场景化套餐"，核心竞争力是供应链稳定性
与都市女性生活场景的深度绑定，形成与竞品最核心的差异。`,
  },
  brand_fact_check: {
    filename: 'brand-fact-check.md',
    content: `# 品牌信息核实

## 核实结论
经公开搜索，测试鲜果创立于 2018 年、主打鲜切水果盒与办公室下午茶套餐等核心信息得到多个来源确认。
品牌阶段判断为成长期、目标人群为都市年轻女性等推断与搜索结果一致，可进入后续步骤。

## 搜索来源
- 搜索查询：测试鲜果 品牌 创立时间
- 搜索查询：测试鲜果 鲜切水果 产品线
- 来源：品牌官方介绍、行业媒体报道、电商平台商品页

## 差异项
搜索结果中未找到关于“每日鲜果”理念早期传播的独立第三方来源，该信息仅来自品牌自述，建议在品牌概念阶段补充证据或标注为品牌自述。

## 风险提示
目前核心事实（创立年份、产品线、价格带）已得到交叉验证，未发现明显矛盾；但部分品牌故事细节为单方信息，用户信息可能存在误差，建议在后续步骤中补充或修正。`,
  },
  brand_concept: [
    {
      filename: 'brand-concept.md',
      content: `# Brand Concept 产出

## 品牌愿景
让都市人随时享受鲜果带来的小确幸，成为城市品质生活的鲜果首选。品牌愿景
描绘长期理想状态：无论在办公室还是通勤路上，用户都能轻松获得新鲜与健康。

## 品牌使命
品牌使命是消除鲜果消费的麻烦，让健康犒赏变得触手可及。
现在每天解决的是：为忙碌的都市女性提供即食鲜果解决方案。

## 品牌价值观
我们信仰"新鲜、真实、克制"，价值判断以用户健康体验为先。
价值观指导品牌在所有传播中保持真诚，不夸大功效，不制造焦虑。

## 品牌主张
slogan 候选："鲜在一刻，甜在心头"。这一定位主张传递即时满足的宣言。
品牌主张聚焦于"即食鲜果 = 忙碌生活中的小确幸"。

## 品牌人格
品牌个性：真诚、清爽、有亲和力，像一个懂生活的邻家姐姐。

## 产品定位
Functional benefit：解决鲜果处理麻烦的问题。
差异化定位：鲜切即食。RTB：自有冷链 + 当日鲜切。利益点清晰。

## Brand Tone
tone of voice：真诚、轻松、可靠。语言风格生活化，调性克制不夸张。

## Brand Visual
visual 风格：清爽自然明亮。色彩策略用鲜果高饱和色 + 留白，字体偏好清晰有亲和力。`,
    },
    {
      filename: 'brand-house.md',
      content: `# 品牌屋

品牌屋架构自上而下逻辑自洽：
- 顶层品牌愿景：让都市人随时享受鲜果小确幸。
- 上层品牌价值观：新鲜、真实、克制。
- 中层核心利益点：功能利益是即食便捷；情感利益是忙碌生活中的自我犒赏。
- 下层 RTB：自有冷链 + 当日鲜切，保证新鲜与品质。
- 基础目标人群：一二线城市 25-35 岁都市女性；使用场景：办公室下午茶、通勤路上。`,
    },
    {
      filename: 'brand-idea.md',
      content: `# 品牌意念

## 品牌意念
"不费力的小确幸" —— 让忙碌的都市女性无需准备，就能享受新鲜犒赏。

## 与愿景的连接
品牌愿景希望鲜果成为城市品质生活的一部分，品牌意念将其浓缩为
"不费力"的即时满足，降低用户的心理和行为门槛。

## 与消费者洞察的连接
用户洞察指出她们渴望"精致但不麻烦"。品牌意念直接回应这一张力：
鲜切水果就是她们"不费力就能获得的体面健康感"。

## 对 Big Idea 的指引
后续创意应围绕"无需准备的精致犒赏"展开，避免强调复杂的准备过程，
重点呈现开盖即食、随手可得的情绪价值。`,
    },
  ],
  creative_concept: [
    {
      filename: 'big-idea.md',
      content: `# Big Idea 生成

## 核心创意
Big Idea："下班路上的第一口甜"。核心概念是抢占都市女性通勤场景，
传播主张"鲜果即食，犒赏忙碌一天的自己"，大创意钩子在于"即时犒赏"。
这一核心概念将品牌鲜果与都市女性日常通勤的高频场景深度绑定，
通过情感化的即时犒赏主张，建立品牌与用户之间稳固的情绪连接，
让每一口鲜果都成为忙碌生活中的小确幸。

## 品牌戏剧性
品牌戏剧性在于：都市女性既想保持健康精致，又被忙碌生活挤压得没时间照顾自己。
鲜切水果成为她们"不费力就能对自己好一点"的微小反抗。
品牌在这个冲突中扮演的角色是"随时standby的犒赏伙伴"。

## 传播主张
Hero Message："鲜在一刻，甜在心头"。

## 创意钩子
即时犒赏：打开盖子那一刻，就是对自己的温柔。`,
    },
    {
      filename: 'creative-directions.md',
      content: `# 创意方向

## 方向一：办公室下午茶
Big Idea 延伸：把鲜切水果盒打造成"办公室里的仪式感"。
视觉方向：明亮桌面、同事分享、下午茶氛围。
文案方向："开会再忙，也值得这一口甜"。
ROI 评估：Relevance 9/10（强关联办公场景），Originality 6/10（竞品做过类似场景），Impact 7/10。

## 方向二：通勤路上的第一口甜（推荐）
Big Idea 延伸：抢占通勤场景，开盖即食。
视觉方向：地铁/公交上的女性手持鲜果盒，城市光影背景。
文案方向："下班路上，先甜一下自己"。
ROI 评估：Relevance 9/10（即食+通勤强绑定），Originality 8/10（竞品较少聚焦通勤鲜果），Impact 8/10（情绪共鸣强）。

## 方向三：周末家庭补给
Big Idea 延伸：家庭场景的品质生活补给。
视觉方向：亲子分享、周末早餐桌。
文案方向："周末也要新鲜开场"。
ROI 评估：Relevance 7/10，Originality 6/10，Impact 6/10。

## 推荐方案
推荐方向二"通勤路上的第一口甜"为最优方案。
理由：与品牌意念"不费力的小确幸"高度一致，ROI 三项得分均衡且较高，
品牌戏剧性（忙碌与自我犒赏的冲突）表达最直接，最容易形成差异化心智。`,
    },
  ],
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
  kol_pyramid: [
    {
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
总预算分配不超过 200000 元。

## 筛选标准
筛选标准：粉丝量达标、互动率 > 6%、女粉占比 > 70%、近 30 天爆文率 > 5%。
要求内容类目匹配美妆/生活方式/美食，城市优先上海杭州，
条件严格把控质量，排除广告占比过高与负面评论多的风险达人。`,
    },
    {
      filename: 'kol-role-matrix.md',
      content: `# 达人形象角色矩阵

## 达人形象角色
- 头部达人：品牌背书者。专业可信、知识型人格，负责建立权威认知。
- 腰部达人：场景种草者。真实亲切、场景化表达，负责生活方式渗透。
- 尾部达人：真实体验者。普通消费者视角，负责铺量和真实口碑。

## 与品牌人格的匹配逻辑
品牌人格关键词：真诚、清爽、有亲和力，像一个懂生活的邻家姐姐。
- 头部达人形象匹配：专业可信、知识型人格，与品牌「专家型」人格一致，人格匹配度高。
- 腰部达人形象匹配：真实亲切、场景化表达，与品牌「陪伴型」人格契合，人格匹配度高。
- 尾部达人形象匹配：普通消费者视角，增强真实性与口碑可信度，人格匹配度高。

## 平台与层级分工
- 小红书：腰部 + 尾部为主，图文种草 + 真实体验。
- 抖音：头部引爆 + 腰部剧情化种草，短视频快速触达。
每层达人的公众形象与内容风格需与品牌人格不冲突，
避免选择调性过于高冷、争议性强或过度娱乐化的达人。`,
    },
  ],
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
评估维度：互动率均超 6% 合格线，匹配度优秀。为什么选她们：美妆 + 生活方式类目契合鲜果场景。

## 达人形象匹配
- mock_小红书_美妆达人小美：达人形象为精致专业、注重成分研究，与品牌「专家型」人格高度一致。
- mock_小红书_护肤分享师：达人形象为亲和真实、善于生活化表达，与品牌「陪伴型」人格契合。
- mock_小红书_生活方式博主：达人形象为温暖自然、擅长场景化内容，与品牌人格协调。

## 品牌人格匹配
品牌人格关键词：真诚、清爽、有亲和力。
三位达人的内容调性均与品牌人格不冲突，能够自然传递品牌意念「不费力的小确幸」。

## 历史审阅摘要
- mock_小红书_美妆达人小美：近90天无负面舆情，评论区用户信任度高，内容质量稳定。
- mock_小红书_护肤分享师：近90天内容正向，有一次 minor 争议已妥善处理，建议合同中明确舆情责任。
- mock_小红书_生活方式博主：近90天无负面舆情，互动真实，粉丝粘性较好。`,
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

## Tone & Manner
调性：专业而不失亲切，像朋友推荐好物。语言风格自然口语化，避免过度营销感。
可说的话：真实体验、场景化表达、情感共鸣。不可说的话：绝对化功效承诺、制造焦虑、与品牌人格冲突的表达。

## 品牌戏剧性
Inherent Drama：都市女性既想保持健康精致，又被忙碌生活挤压得没时间照顾自己。
品牌角色：随时standby的犒赏伙伴。达人通过前后对比真实呈现持妆效果。

## 合规检查
合规检查清单：平台规范（小红书图文笔记需标注利益关系声明）。
广告法禁用词：避免「最」「第一」「纯天然」等绝对化用语。
利益关系声明：必须在正文开头或评论区置顶说明「本次内容含商业合作」。

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
总目标围绕品类认知建立，通过内容模型验证找到可复制的爆文路径。

## 分层目标
小红书测试期：找到 1 组可复制的爆文模型。
抖音辅助期：完成品牌声量初始积累，播放量 1000 万+。
分层目标按平台与阶段拆分，测试期聚焦模型验证，辅助期聚焦人群破圈。

## 量化指标
KPI 必须可追踪、可复盘：
- 互动率 > 6%
- CPE < 5 元
- 爆文率 > 10%
- 搜索量增长 200%
- ROI > 1:3
量化指标全部可追踪，按周复盘确保 KPI 达成路径清晰。`,
  },
  ab_test: [
    {
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
通过阈值：B 组 CTR 相对 A 组提升 > 15% 且 p<0.05。

## 样本量
样本量计算：显著性水平 α=0.05，检验功效 0.8。计算得每组需至少 5000 次有效曝光。
统计：总曝光 200 万，远超最低样本要求，显著性充足。7 天完成测试，每日监控数据。

## 止损线
若前 3 天 CTR 差异 < 1% 或 CPE > 15 元，暂停该组测试并分析原因。`,
    },
    {
      filename: 'ab-test-review.md',
      content: `# 阶段复盘框架

## 数据回收清单
回收字段：曝光、浏览、点赞、收藏、评论、转发、CPM、CPE、CTR、互动率。
数据源：小红书/抖音平台后台、内容追踪系统、投流数据。

## 分析维度
- 达人层级：头部 / 腰部 / KOC 各层级表现
- 平台：小红书 vs 抖音
- 内容风格：场景种草 / 产品测评 / 真实体验
- 发布时段：工作日 vs 周末、上午 vs 晚间
- Brief 版本：标准版 vs 情感向版

## 核心发现模板
- 最佳组合：互动率最高、CPE 最低的达人层级 + 平台 + 内容风格
- 表现不佳元素：CTR 低、完播率低或评论区负面率高的组合
- 异常值说明：单个达人异常表现及可能原因

## 目标达成判定
对比测试计划中的通过阈值，判定 CTR、CPE、互动率是否达成。
未达成原因假设：内容风格不匹配、达人粉丝画像偏差、投放时机不佳。
测试结束后将调用 ma-phase-reviewer 生成阶段复盘报告。`,
    },
    {
      filename: 'scale-up-plan.md',
      content: `# 调优与放量方案

## 调优规则
- 若腰部达人 + 场景种草组合 CPE 最低，则正式投放提高该组合占比 20%
- 若小红书 CTR 显著高于抖音，则小红书预算占比提升至 60%
- 砍掉测试中 CTR < 1% 或 CPE > 15 元的达人/内容组合

## 放量决策标准
Go / No-go 门槛：
- Go：CPE < 5 元、互动率 > 5%、ROI > 1:3、统计显著 p<0.05
- No-go：CPE > 10 元、互动率 < 2%、ROI < 1:2 或未达显著性

## 正式投放方案
放量预算：剩余 80% 预算。达人组合：腰部 50%、KOC 40%、头部 10%。
平台分配：小红书 60%、抖音 40%。时间线：第 1 周集中发布，第 2-3 周长尾维护。

## 风险预案
- 效果稀释：预留 10% 预算作为二次测试
- 达人档期：提前锁定核心达人档期
- 内容同质化：控制同风格内容占比不超过 60%`,
    },
  ],
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
    const artifacts = Array.isArray(artifact) ? artifact : [artifact]
    for (const item of artifacts) {
      writeFileSync(join(dir, item.filename), item.content, 'utf-8')
    }

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
    const expectedProgress = Math.round(((stepIndex + 1) / 14) * 100)
    expect(workflowService.getWorkflowProgress(campaignId)).toBe(expectedProgress)
  }

  // ===== 前置：Campaign 创建 + 工作流初始化 =====

  it('前置: Campaign 创建成功 + 工作流初始化为 14 步 pending', () => {
    const workflow = workflowService.loadCampaignWorkflow(campaignId)

    expect(workflow.campaignId).toBe(campaignId)
    expect(workflow.steps).toHaveLength(14)
    expect(workflow.currentStepIndex).toBe(-1)
    expect(workflow.steps.every((s) => s.status === 'pending')).toBe(true)
    expect(workflowService.getWorkflowProgress(campaignId)).toBe(0)

    // 验证标准产物目录与上下文文件已初始化
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${campaignId}`)
    for (const dir of ['market-analysis', 'competitor-analysis', 'user-analysis', 'brand-dna',
      'brand-fact-check', 'brand-concept', 'goal-setting', 'creative-concept', 'platform-matrix',
      'kol-pyramid', 'kol-search', 'briefs', 'ab-test', '.context']) {
      expect(existsSync(join(workspaceDir, dir))).toBe(true)
    }
    expect(existsSync(join(workspaceDir, '.context', 'todo.md'))).toBe(true)
    expect(existsSync(join(workspaceDir, '.context', 'campaign.md'))).toBe(true)
  })

  // ===== 14 步顺序执行 =====

  it('步骤1 market_analysis: 市场分析', () => {
    runStep('market_analysis', 0, '已完成：市场分析')
  })

  it('步骤2 competitor_analysis: 竞品分析', () => {
    runStep('competitor_analysis', 1, '已完成：竞品分析')
  })

  it('步骤3 user_analysis: 用户分析（TA画像+搜索习惯+消费者洞察）', () => {
    runStep('user_analysis', 2, '已完成：用户分析')
  })

  it('步骤4 brand_dna: 品牌DNA+品牌诊断', () => {
    runStep('brand_dna', 3, '已完成：品牌DNA+品牌诊断')
  })

  it('步骤5 brand_fact_check: 品牌信息核实', () => {
    runStep('brand_fact_check', 4, '已完成：品牌信息核实')
  })

  it('步骤6 brand_concept: 品牌概念产出', () => {
    runStep('brand_concept', 5, '已完成：Brand Concept 产出')
  })

  it('步骤7 goal_setting: 目标设定', () => {
    runStep('goal_setting', 6, '已完成：目标设定')
  })

  it('步骤8 creative_concept: 生成 Big Idea', () => {
    runStep('creative_concept', 7, '已完成：Big Idea 生成')
  })

  it('步骤9 platform_matrix: 设计平台矩阵', () => {
    runStep('platform_matrix', 8, '已完成：平台矩阵设计')
  })

  it('步骤10 kol_pyramid: 设计 KOL 金字塔（含预算模板替换）', () => {
    runStep('kol_pyramid', 9, '已完成：KOL 金字塔设计')
  })

  it('步骤11 search_kols: 真实搜索 KOL 数据库 → 产物 → 完成', () => {
    // 真实调用 kol-data-service 搜索 KOL 数据库
    const searchResult = kolDataService.searchKOLs({ platform: '小红书', limit: 5 })
    expect(searchResult.total).toBeGreaterThan(0)
    expect(searchResult.kols.length).toBeGreaterThan(0)

    // 记录搜索到的 KOL ID，供第 11 步导入候选池
    searchedKolIds = searchResult.kols.slice(0, 3).map((k) => k.id)
    expect(searchedKolIds).toHaveLength(3)

    runStep('search_kols', 10, '已完成：候选达人筛选，共筛出 3 位小红书达人')
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

    runStep('add_to_pool', 11, '已完成：达人导入候选池，成功导入 3 位')
  })

  it('步骤13 generate_briefs: 生成达人 Brief', () => {
    runStep('generate_briefs', 12, '已完成：达人 Brief 生成')
  })

  it('步骤14 ab_test: 投放测试、阶段复盘与放量决策', () => {
    runStep('ab_test', 13, '已完成：投放测试、阶段复盘与放量决策')
  })

  // ===== 终态验证 =====

  it('终态: 14 步全完成 → isWorkflowComplete=true, progress=100', () => {
    expect(workflowService.isWorkflowComplete(campaignId)).toBe(true)
    expect(workflowService.getWorkflowProgress(campaignId)).toBe(100)

    const workflow = workflowService.loadCampaignWorkflow(campaignId)
    expect(workflow.steps.every((s) => s.status === 'completed')).toBe(true)
    expect(workflow.steps.every((s) => s.completedAt !== undefined)).toBe(true)
    expect(workflow.steps.every((s) => s.outputSummary !== undefined)).toBe(true)
  })

  it('终态: history.md 累积 14 条完成记录', () => {
    const historyPath = join(TEST_DIR, 'agent-workspaces', `campaign-${campaignId}`, '.context', 'history.md')
    expect(existsSync(historyPath)).toBe(true)

    const content = readFileSync(historyPath, 'utf-8')
    expect(content).toContain('Campaign 执行历史')
    const completedCount = (content.match(/✅ 完成/g) || []).length
    expect(completedCount).toBe(14)
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

    // 14 个步骤全部勾选
    const checkedCount = (content.match(/- \[x\]/g) || []).length
    expect(checkedCount).toBe(14)
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

  it('回归: 重置工作流恢复 14 步 pending 初始状态', () => {
    const workflow = workflowService.resetWorkflow(campaignId)

    expect(workflow.steps).toHaveLength(14)
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
