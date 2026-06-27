/**
 * Campaign 工作流状态服务（基于 FileProvider + AppContext 抽象）
 *
 * 阶段 B2 Slice 1：
 * - 从 Electron 主进程迁移工作流状态机 CRUD 与 Workspace 文件同步。
 * - 保留 13 步标准工作流定义。
 * - 产物校验（validateStepArtifacts）与 Agent 兜底落盘放到 Slice 2/3。
 *
 * 存储位置：{AppContext.getAgentWorkspacePath('campaign-{id}')}/
 */

import { join } from 'node:path'
import type {
  AdvanceWorkflowInput,
  AgentMessage,
  CampaignWorkflow,
  CampaignWorkflowStep,
  CampaignWorkflowStepId,
  UpdateWorkflowStepInput,
} from '@ma-proma/shared'
import type { AppContext } from '../context/types.ts'
import type { FileProvider } from '../files/types.ts'
import { getAgentWorkspacePath } from '../context/config-paths.ts'
import { CampaignArtifactValidator } from './campaign-artifact-validator.ts'

// =====================================================================
// 标准目录定义
// =====================================================================

const ARTIFACT_DIRS = [
  'market-analysis',
  'competitor-analysis',
  'user-analysis',
  'brand-dna',
  'brand-concept',
  'goal-setting',
  'creative-concept',
  'platform-matrix',
  'kol-pyramid',
  'kol-search',
  'briefs',
  'ab-test',
  '.context',
]

export const STEP_DIR_MAP: Record<CampaignWorkflowStepId, string> = {
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

// =====================================================================
// 默认 13 步工作流定义
// =====================================================================

const DEFAULT_WORKFLOW_STEPS: Omit<CampaignWorkflowStep, 'status' | 'completedAt'>[] = [
  {
    id: 'market_analysis',
    title: '市场分析',
    description: '分析市场规模、品类趋势、品类痛点，判断市场机会与趋势切入点',
    toolName: 'ma-market-analysis',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: '市场规模', aliases: ['规模', '大盘', '增速', '渗透率', '市场容量'] },
      { name: '品类趋势', aliases: ['趋势', '周期', '上升', '衰退', '偏好变化', '趋势机会'] },
      { name: '品类痛点', aliases: ['痛点', '需求', '未被满足', '空白', '切入', '机会点'] },
    ],
    agentPrompt: `## 步骤 1: 市场分析

目标：系统分析目标市场的规模、品类趋势与品类痛点，为后续品牌策略提供市场数据支撑。

分析框架：
1. **市场规模**：大盘数据、品类增速、渗透率、市场容量
2. **品类趋势**：当前处于什么周期（上升/平稳/衰退），用户偏好变化趋势
3. **品类痛点**：用户当前未被满足的需求、行业普遍问题、空白切入点

执行要求：
1. 使用 ma-market-analysis 工具分析市场
2. 产出必须保存到以下目录：\`market-analysis/\`
3. 文件命名建议：\`market-analysis.md\`
4. 完成标准（校验时会检查）：
   - market-analysis.md 必须包含市场规模、品类趋势、品类痛点分析（至少300字）
   - 需标明数据来源（如艾瑞咨询、36氪等）

完成后，请返回 "已完成：市场分析"并附上产物摘要。`,
  },
  {
    id: 'competitor_analysis',
    title: '竞品分析',
    description: '列出直接竞品与间接竞品，分析市场份额、营销动作、核心卖点与空白机会',
    toolName: 'ma-competitor-analyzer',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: '竞品清单', aliases: ['竞品', '对手', '竞争', '品牌', '对标'] },
      { name: '市场占比', aliases: ['份额', '声量', '占比', '竞争格局'] },
      { name: '营销动作', aliases: ['营销', '动作', '追踪', '平台', '内容', '达人'] },
      { name: '核心卖点', aliases: ['卖点', '差异化', '主张', '定位', 'USP'] },
      { name: '空白机会', aliases: ['空白', '机会', '差异化', '策略', '没做'] },
    ],
    agentPrompt: `## 步骤 2: 竞品分析

目标：系统分析竞品矩阵，识别竞争格局与差异化机会。

分析框架：
1. **竞品清单**：列出直接竞品 + 间接竞品
2. **市场占比**：各竞品的市场份额、声量占比
3. **营销动作**：竞品当前在做什么平台、什么内容、什么达人
4. **核心卖点**：竞品主打的差异化点
5. **空白机会**：竞品没做或没做好的地方

执行要求：
1. 使用 ma-competitor-analyzer 工具分析竞品
2. 产出必须保存到以下目录：\`competitor-analysis/\`
3. 文件命名建议：\`competitor-analysis.md\`、\`competitor-matrix.md\`
4. 完成标准（校验时会检查）：
   - competitor-analysis.md 必须包含竞品清单、市场占比、营销动作、核心卖点、空白机会（至少300字）
   - competitor-matrix.md 必须包含竞品矩阵对比表（至少300字）

前置产物：\`market-analysis/\` 目录中的市场分析文件
完成后，请返回 "已完成：竞品分析"并附上产物摘要。`,
  },
  {
    id: 'user_analysis',
    title: '用户分析（TA画像 + 搜索习惯）',
    description: '构建精准受众画像，补充用户搜索习惯（平台、场景、关键词）',
    toolName: 'ma-ta-portrait',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: '人口统计', aliases: ['年龄', '性别', '收入', '城市', '地域', '学历', '职业'] },
      { name: '兴趣偏好', aliases: ['兴趣', '偏好', '爱好', '生活方式', '消费观'] },
      { name: '痛点需求', aliases: ['痛点', '需求', '场景', '问题', '欲望', '动机'] },
      { name: '搜索习惯', aliases: ['搜索', '关键词', '平台', '场景', '下拉词', '联想词'] },
    ],
    agentPrompt: `## 步骤 3: 用户分析（TA画像 + 搜索习惯）

目标：基于市场分析和竞品分析，构建精准受众画像，并补充用户搜索习惯分析。

分析框架：
1. **人口统计画像**：年龄、性别、收入、城市、地域、学历、职业
2. **兴趣偏好**：兴趣标签、生活方式、消费观、价值观
3. **痛点与需求**：核心痛点、使用场景、未被满足的需求、购买动机
4. **搜索习惯**：
   - 在什么平台搜索（小红书、抖音、百度等）
   - 在什么场景下搜索（种草前、决策中、使用后等）
   - 搜索什么关键词（核心词、长尾词、竞品词）
   - 建议接入小红书聚光平台关键词规划师、千瓜/蝉妈妈/新红等工具的实时数据

执行要求：
1. 使用 ma-ta-portrait 工具构建用户画像
2. 产出必须保存到以下目录：\`user-analysis/\`
3. 文件命名建议：\`ta-portrait.md\`、\`search-habits.md\`
4. 完成标准（校验时会检查）：
   - ta-portrait.md 必须包含人口统计、兴趣偏好、痛点需求（至少300字）
   - search-habits.md 必须包含搜索平台、搜索场景、关键词列表（至少300字）

前置产物：\`market-analysis/\`、\`competitor-analysis/\` 目录中的文件
完成后，请返回 "已完成：用户分析"并附上产物摘要。`,
  },
  {
    id: 'brand_dna',
    title: '品牌DNA + 品牌诊断',
    description: '基于市场/竞品/用户分析，提取品牌核心价值并输出品牌诊断（品牌阶段、产品现状、核心问题、核心目标）',
    toolName: 'ma-brand-dna',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: '品牌历史', aliases: ['历史', '创立', '发展', '里程碑', '传承', 'heritage'] },
      { name: '产品服务', aliases: ['产品', '服务', '功能', '卖点', '价格', '产品线'] },
      { name: '品牌阶段', aliases: ['起步期', '成长期', '成熟期', '焕新期', '阶段', '定位'] },
      { name: '产品现状', aliases: ['产品力', '供应链', '价格带', 'SKU', '产品诊断'] },
      { name: '核心问题', aliases: ['认知问题', '转化问题', '口碑问题', '问题', '定义'] },
      { name: '核心目标', aliases: ['目标', '优先级', '曝光', '破圈', '拉新', '首要目标'] },
      { name: '差异化优势', aliases: ['差异化', '优势', '差异', '不同', '独特', '核心竞争力'] },
    ],
    agentPrompt: `## 步骤 4: 品牌DNA + 品牌诊断

目标：基于市场分析、竞品分析和用户分析的数据支撑，提取品牌核心价值并输出品牌诊断。

分析框架：
1. **品牌自身历史**：创立背景、发展历程、里程碑事件、品牌传承
2. **产品/服务 + 现有传播**：核心产品线、功能卖点、价格带、过往 campaign、slogan、核心文案
3. **品牌阶段诊断**：起步期 / 成长期 / 成熟期 / 焕新期
4. **产品现状诊断**：产品力、供应链、价格带、SKU
5. **核心问题定义**：当前要解决的是认知问题 / 转化问题 / 口碑问题
6. **核心目标**：基于阶段和问题，确定首要目标（曝光/破圈拉新）及目标优先级
7. **差异化优势**：结合市场/竞品/用户分析，总结能戳到洞察的核心差异点

执行要求：
1. 使用 ma-brand-dna 工具分析品牌
2. 产出必须保存到以下目录：\`brand-dna/\`
3. 文件命名建议：\`brand-dna.md\`、\`brand-diagnosis.md\`、\`differentiation.md\`
4. 完成标准（校验时会检查）：
   - brand-dna.md 必须包含品牌历史、产品/服务、品牌核心价值、差异化优势（至少300字）
   - brand-diagnosis.md 必须包含品牌阶段、产品现状、核心问题、核心目标（至少300字）
   - differentiation.md 必须包含差异化优势总结（至少300字）

前置产物：\`market-analysis/\`、\`competitor-analysis/\`、\`user-analysis/\` 目录中的文件
完成后，请返回 "已完成：品牌DNA + 品牌诊断"并附上产物摘要。`,
  },
  {
    id: 'brand_concept',
    title: 'Brand Concept 产出',
    description: '基于品牌DNA和品牌诊断，产出品牌愿景、价值观、品牌主张、slogan、品牌屋、Brand Tone & Visual',
    toolName: 'ma-brand-house',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: '品牌愿景', aliases: ['愿景', '使命', '长期目标', 'vision', 'mission'] },
      { name: '品牌价值观', aliases: ['价值观', '信仰', 'value', '信念'] },
      { name: '品牌主张', aliases: ['主张', 'slogan', 'tagline', '宣言', '定位'] },
      { name: '品牌人格', aliases: ['人格', '个性', '性格', 'personality', '拟人'] },
      { name: '产品定位', aliases: ['定位', 'functional benefit', 'rtb', '差异化定位', '利益点'] },
      { name: '品牌屋', aliases: ['品牌屋', 'brand house', '架构', '金字塔', '品牌模型'] },
      { name: 'Brand Tone', aliases: ['tone', '调性', '语气', '语言风格', 'tone of voice'] },
      { name: 'Brand Visual', aliases: ['visual', '视觉', '色彩', '风格', '字体'] },
    ],
    agentPrompt: `## 步骤 5: Brand Concept 产出

目标：基于品牌DNA（步骤4产物）和品牌诊断，系统产出品牌概念体系，包括品牌愿景、价值观、品牌主张、品牌屋、Brand Tone 和 Brand Visual。

产出框架：
1. **品牌愿景**（使命 + 长期目标）：品牌希望实现的长期理想状态 & 品牌为什么存在
2. **品牌价值观**：品牌的核心信仰与价值判断
3. **品牌主张**：并生成 slogan / tagline 候选
4. **附加价值**（情感定位）：情感、文化、生活方式层面的价值定位
5. **品牌人格**：3-5 个具体的形容词描述品牌拟人化特质
6. **产品定位**（支持情感定位）：
   - Functional benefit：产品具体解决什么问题
   - 差异化定位：与竞品最核心的差异
   - RTB（Reasons to Believe）：支持点 / 证据
7. **品牌屋搭建**：确保愿景→价值观→利益点→RTB→目标人群 各层级逻辑自洽
8. **Brand Tone 产出**：语言风格、用词风格、禁忌词
9. **Brand Visual 产出**：视觉风格、色彩策略、字体偏好

执行要求：
1. 使用 ma-brand-house 工具构建品牌概念体系
2. 产出必须保存到：\`brand-concept/\`
3. 文件命名建议：\`brand-concept.md\`、\`brand-house.md\`、\`tone-visual.md\`
4. 完成标准（校验时会检查）：
   - brand-concept.md 必须包含品牌愿景、品牌价值观、品牌主张、slogan（至少300字）
   - brand-house.md 必须包含品牌屋架构（愿景/价值观/利益点/RTB/目标人群）（至少300字）
   - tone-visual.md 必须包含 Brand Tone 和 Brand Visual 描述（至少300字）

前置产物：\`brand-dna/\` 目录中的品牌DNA与品牌诊断文件
完成后，请返回 "已完成：Brand Concept 产出"并附上产物摘要。`,
  },
  {
    id: 'goal_setting',
    title: '目标设定',
    description: '基于品牌诊断，设定总目标、分层目标与量化指标（KPI）',
    toolName: 'ma-campaign-optimizer',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: '总目标', aliases: ['总目标', '核心问题', '品类认知', '内容模型', '搜索转化'] },
      { name: '分层目标', aliases: ['分层', '平台', '阶段', '人群', '测试期', '爆文模型'] },
      { name: '量化指标', aliases: ['KPI', '指标', '互动率', 'CPE', '爆文率', '搜索量', 'ROI', '可追踪'] },
    ],
    agentPrompt: `## 步骤 6: 目标设定

目标：基于品牌诊断（步骤4产物），设定Campaign的总目标、分层目标与量化指标。

目标框架：
1. **总目标**：本阶段要解决的核心问题
   - 示例：建立品类认知 / 验证内容模型 / 拉动搜索转化
2. **分层目标**：按平台/阶段/人群拆解
   - 示例：小红书测试期：找到1组可复制的爆文模型
3. **量化指标**：KPI必须可追踪、可复盘
   - 示例：互动率、CPE、爆文率、搜索量、ROI

执行要求：
1. 使用 ma-campaign-optimizer 工具设定目标
2. 产出必须保存到：\`goal-setting/\`
3. 文件命名建议：\`goal-setting.md\`
4. 完成标准（校验时会检查）：
   - goal-setting.md 必须包含总目标、分层目标、量化指标（至少300字）
   - 指标必须具体、可量化、可追踪

前置产物：\`brand-dna/\` 目录中的品牌诊断文件
完成后，请返回 "已完成：目标设定"并附上产物摘要。`,
  },
  {
    id: 'creative_concept',
    title: '生成 Big Idea',
    description: '基于品牌DNA、Brand Concept和目标设定，生成Campaign核心创意概念（Big Idea）',
    toolName: 'ma-creative-concept',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: '核心创意', aliases: ['Big Idea', '核心概念', '创意概念', '传播主张', '大创意'] },
      { name: '创意方向', aliases: ['创意方向', '视觉方向', '文案方向', '内容方向', '媒介建议'] },
      { name: '推荐方案', aliases: ['推荐', '最优方案', '首选', '主推方案', '最终选择'] },
    ],
    agentPrompt: `## 步骤 7: 生成 Big Idea

目标：基于品牌DNA、Brand Concept和目标设定，生成3个创意方向并推荐最优方案。

执行要求：
1. 使用 ma-creative-concept 工具生成创意概念
2. 产出必须保存到：\`creative-concept/\`
3. 文件命名建议：\`big-idea.md\`、\`creative-directions.md\`
4. 完成标准（校验时会检查）：
   - big-idea.md 必须包含核心创意概念、传播主张、创意钩子（至少300字）
   - creative-directions.md 必须包含3个方向及推荐（至少300字）
   - 必须明确推荐最优方案及理由

前置产物：\`brand-dna/\`、\`brand-concept/\`、\`goal-setting/\` 目录中的文件
完成后，请返回 "已完成：Big Idea 生成"并附上产物摘要。`,
  },
  {
    id: 'platform_matrix',
    title: '设计平台矩阵',
    description: '根据创意概念和TA画像，设计多平台内容分发矩阵和角色分工',
    toolName: 'ma-platform-role-mapper',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: '平台角色', aliases: ['平台角色', '平台定位', '平台策略', '内容角色', '分发策略'] },
      { name: 'KPI', aliases: ['KPI', '指标', '目标', '考核', '效果指标'] },
      { name: '预算分配', aliases: ['预算', '分配', '预算比例', '预算分配', '资源分配'] },
      { name: '内容排期', aliases: ['排期', '日历', '排期表', '时间线', '内容日历'] },
    ],
    agentPrompt: `## 步骤 8: 设计平台矩阵

目标：基于 Big Idea 和 TA 画像，为每个平台分配内容角色、KPI 和预算比例。

执行要求：
1. 使用 ma-platform-role-mapper 工具设计平台矩阵
2. 产出必须保存到：\`platform-matrix/\`
3. 文件命名建议：\`platform-matrix.md\`、\`content-calendar.md\`
4. 完成标准（校验时会检查）：
   - platform-matrix.md 必须包含各平台角色、内容类型、发布频率、KPI、预算分配（至少300字）
   - content-calendar.md 必须包含首月内容排期（至少300字）

前置产物：\`creative-concept/\` 目录中的 Big Idea 文件
完成后，请返回 "已完成：平台矩阵设计"并附上产物摘要。`,
  },
  {
    id: 'kol_pyramid',
    title: '设计 KOL 金字塔',
    description: '根据预算和平台矩阵，设计 KOL 合作金字塔（头部/腰部/尾部比例）',
    toolName: 'ma-kol-pyramid',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: '金字塔结构', aliases: ['金字塔', '层级', '头部', '腰部', '尾部', '比例'] },
      { name: '预算分配', aliases: ['预算', '预算分配', '预算比例', '费用', '投入'] },
      { name: '筛选标准', aliases: ['筛选', '标准', '要求', '条件', '粉丝量', '互动率'] },
    ],
    agentPrompt: `## 步骤 9: 设计 KOL 金字塔

目标：基于总预算 {budget} 元、平台矩阵和目标人群，设计头部/腰部/尾部 KOL 金字塔。

执行要求：
1. 使用 ma-kol-pyramid 工具设计 KOL 金字塔
2. 产出必须保存到：\`kol-pyramid/\`
3. 文件命名建议：\`kol-pyramid.md\`、\`kol-tier-spec.md\`
4. 完成标准（校验时会检查）：
   - kol-pyramid.md 必须包含各层级比例、数量、预算分配、筛选标准（至少300字）
   - kol-tier-spec.md 必须包含各层级 KOL 的具体要求（至少300字）
   - 总预算分配不超过 {budget} 元

前置产物：\`platform-matrix/\` 目录中的平台矩阵文件
完成后，请返回 "已完成：KOL 金字塔设计"并附上产物摘要。`,
  },
  {
    id: 'search_kols',
    title: '筛选候选达人',
    description: '基于 KOL 金字塔参数，从数据库中搜索并筛选符合要求的候选达人',
    toolName: 'kol-data/search_kols',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: '搜索条件', aliases: ['搜索', '筛选', '条件', '参数', '筛选标准'] },
      { name: 'KOL 列表', aliases: ['KOL', '达人', '博主', '候选人', '推荐列表'] },
      { name: '推荐理由', aliases: ['推荐理由', '匹配度', '分析', '评估', '为什么'] },
    ],
    agentPrompt: `## 步骤 10: 筛选候选达人

目标：基于 KOL 金字塔参数（平台、类目、粉丝量级、预算范围），搜索并筛选候选达人。

执行要求：
1. 使用 kol-data/search_kols 工具筛选候选 KOL
2. 筛选结果必须保存到：\`kol-search/\`
3. 文件命名建议：\`kol-search-results.md\`、\`kol-shortlist.md\`
4. 完成标准（校验时会检查）：
   - kol-search-results.md 必须包含搜索条件、筛选逻辑、KOL 列表（至少300字）
   - kol-shortlist.md 必须包含精选推荐及推荐理由（至少300字）
   - 每位 KOL 信息包含：ID、名称、平台、粉丝量、互动率、类目、报价、城市

前置产物：\`kol-pyramid/\` 目录中的 KOL 金字塔文件
完成后，请返回 "已完成：候选达人筛选"并附上产物摘要。`,
  },
  {
    id: 'add_to_pool',
    title: '加入候选池',
    description: '将筛选出的达人从数据库导入 Campaign 候选池，并设置初始状态',
    toolName: 'ma-campaign-agent',
    minArtifactLength: 100,
    artifactRequirements: [
      { name: '导入记录', aliases: ['导入', '加入', '候选池', '导入记录', '导入日志'] },
      { name: 'KOL ID', aliases: ['KOL ID', '达人ID', 'ID列表', 'kol_id', '编号'] },
      { name: '导入结果', aliases: ['成功', '失败', '跳过', '结果', '状态'] },
    ],
    agentPrompt: `## 步骤 11: 将达人加入候选池

目标：将上一步筛选出的候选 KOL 从数据库导入当前 Campaign 候选池。

执行要求：
1. 使用 ma-campaign-agent 的 ma_campaign_kol_add 功能（不是 kol_status！）
2. 提供 kol_ids 参数（逗号分隔的 KOL ID 列表，从 kol-search-results.md 中提取）
3. 导入完成后，调用 ma_campaign_kol_list 确认导入结果
4. 记录保存到：\`kol-search/\`
5. 文件命名建议：\`pool-import-log.md\`
6. 完成标准（校验时会检查）：
   - pool-import-log.md 必须包含导入时间、KOL ID 列表、成功/失败数、导入后候选池总数（至少100字）
   - 所有目标 KOL 都已出现在候选池中（status = candidate）
   - 已存在的 KOL 会被跳过（不会重复导入）

前置产物：\`kol-search/\` 目录中的搜索结果文件
完成后，请返回 "已完成：达人导入候选池"并附上导入摘要。`,
  },
  {
    id: 'generate_briefs',
    title: '生成达人 Brief',
    description: '为每个已确认的达人生成个性化的合作 Brief（内容方向、交付物、时间线）',
    toolName: 'ma-creative-pilot',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: 'Brief 索引', aliases: ['Brief', '索引', 'briefs', '清单', '列表'] },
      { name: '内容方向', aliases: ['内容方向', '内容策略', '关键信息', '信息点', '核心信息'] },
      { name: '交付物', aliases: ['交付物', '交付清单', '要求', '产出', '作品'] },
      { name: '时间线', aliases: ['时间', '时间线', '节点', 'deadline', '截止日期'] },
    ],
    agentPrompt: `## 步骤 12: 生成达人 Brief

目标：为当前 Campaign 候选池中的每位已确认达人（status = confirmed）生成个性化 Brief。

执行要求：
1. 使用 ma-creative-pilot 工具生成 Brief
2. 产出必须保存到：\`briefs/\`
3. 文件命名建议：\`briefs-index.md\`、\`brief-{kol-id}.md\`（每位达人单独一个文件）
4. 完成标准（校验时会检查）：
   - briefs-index.md 必须包含所有已确认 KOL 列表、Brief 状态、交付时间线（至少300字）
   - 每个 brief-{kol-id}.md 必须包含：内容方向、交付物清单、时间节点（至少300字）
   - 每位达人的 Brief 都体现其个人风格和受众特点

前置产物：\`brand-dna/\`、\`creative-concept/\`、\`kol-search/\` 目录中的文件
完成后，请返回 "已完成：达人 Brief 生成"并附上产物摘要。`,
  },
  {
    id: 'ab_test',
    title: '设计 A/B 测试',
    description: '为 Campaign 设计 A/B 测试方案（变量、分组、指标、样本量）',
    toolName: 'ma-campaign-tester',
    minArtifactLength: 300,
    artifactRequirements: [
      { name: '测试变量', aliases: ['变量', '测试变量', 'A/B测试', '对比', '测试方案'] },
      { name: '分组方案', aliases: ['分组', '受众分组', '分组方案', '测试组', '对照组'] },
      { name: '指标', aliases: ['指标', 'KPI', '关键指标', '成功指标', '统计指标'] },
      { name: '样本量', aliases: ['样本量', '样本', '计算', '统计', '显著性'] },
    ],
    agentPrompt: `## 步骤 13: 设计 A/B 测试

目标：为 Campaign 设计 A/B 测试方案，定义测试变量、受众分组、成功指标和样本量计算。

执行要求：
1. 使用 ma-campaign-tester 工具设计 A/B 测试
2. 产出必须保存到：\`ab-test/\`
3. 文件命名建议：\`ab-test-plan.md\`、\`test-metrics.md\`
4. 完成标准（校验时会检查）：
   - ab-test-plan.md 必须包含测试目标、变量定义、分组方案、测试周期（至少300字）
   - test-metrics.md 必须包含关键指标、样本量计算、统计显著性阈值（至少300字）
   - 测试方案与创意概念和平台矩阵一致

前置产物：\`creative-concept/\`、\`platform-matrix/\` 目录中的文件
完成后，请返回 "已完成：A/B 测试设计"并附上产物摘要。`,
  },
]

// =====================================================================
// CampaignWorkflowService
// =====================================================================

export class CampaignWorkflowService {
  private context: AppContext
  private files: FileProvider
  private validator: CampaignArtifactValidator | null

  constructor(context: AppContext, files: FileProvider, validator: CampaignArtifactValidator | null = null) {
    this.context = context
    this.files = files
    this.validator = validator
  }

  setValidator(validator: CampaignArtifactValidator): void {
    this.validator = validator
  }

  // -----------------------------------------------------------------
  // 路径与目录
  // -----------------------------------------------------------------

  private getWorkspacePath(campaignId: string): string {
    return getAgentWorkspacePath(this.context, `campaign-${campaignId}`)
  }

  private getWorkflowPath(campaignId: string): string {
    return join(this.getWorkspacePath(campaignId), 'campaign-workflow.json')
  }

  private async ensureArtifactDirs(campaignId: string): Promise<void> {
    const baseDir = this.getWorkspacePath(campaignId)
    for (const dir of ARTIFACT_DIRS) {
      const dirPath = join(baseDir, dir)
      const exists = await this.files.exists(dirPath)
      if (!exists) {
        await this.files.mkdir(dirPath)
      }
    }
  }

  private async syncWorkspaceFiles(workflow: CampaignWorkflow): Promise<void> {
    const baseDir = this.getWorkspacePath(workflow.campaignId)
    const contextDir = join(baseDir, '.context')

    await this.ensureArtifactDirs(workflow.campaignId)

    await this.files.writeTextFile(join(contextDir, 'todo.md'), generateTodoMarkdown(workflow))

    const campaignMdPath = join(contextDir, 'campaign.md')
    const campaignMdExists = await this.files.exists(campaignMdPath)
    if (!campaignMdExists) {
      await this.files.writeTextFile(campaignMdPath, generateCampaignMdPlaceholder(workflow))
    }
  }

  // -----------------------------------------------------------------
  // 初始化与读写
  // -----------------------------------------------------------------

  private createDefaultWorkflow(campaignId: string): CampaignWorkflow {
    const now = Date.now()
    return {
      campaignId,
      currentStepIndex: -1,
      steps: DEFAULT_WORKFLOW_STEPS.map((step) => ({
        ...step,
        status: 'pending' as const,
        agentPrompt: step.agentPrompt,
      })),
      createdAt: now,
      updatedAt: now,
    }
  }

  async loadCampaignWorkflow(campaignId: string): Promise<CampaignWorkflow> {
    const path = this.getWorkflowPath(campaignId)
    const exists = await this.files.exists(path)

    if (exists) {
      try {
        const raw = await this.files.readTextFile(path)
        const workflow = JSON.parse(raw) as CampaignWorkflow
        if (workflow.steps.length !== DEFAULT_WORKFLOW_STEPS.length) {
          const migrated = this.migrateWorkflow(workflow, campaignId)
          await this.syncWorkspaceFiles(migrated)
          return migrated
        }
        await this.syncWorkspaceFiles(workflow)
        return workflow
      } catch (err) {
        console.error(`[CampaignWorkflow] 读取失败，重新初始化: ${campaignId}`, err)
      }
    }

    const workflow = this.createDefaultWorkflow(campaignId)
    await this.saveWorkflow(workflow)
    return workflow
  }

  async saveWorkflow(workflow: CampaignWorkflow): Promise<void> {
    const path = this.getWorkflowPath(workflow.campaignId)
    workflow.updatedAt = Date.now()
    await this.files.writeTextFile(path, JSON.stringify(workflow, null, 2))
    await this.syncWorkspaceFiles(workflow)
  }

  private migrateWorkflow(old: CampaignWorkflow, campaignId: string): CampaignWorkflow {
    const now = Date.now()
    const stepMap = new Map(old.steps.map((s) => [s.id, s]))
    const oldCurrentStepId = old.currentStepIndex >= 0 ? old.steps[old.currentStepIndex]?.id : undefined
    const newSteps: CampaignWorkflowStep[] = DEFAULT_WORKFLOW_STEPS.map((defaultStep) => {
      const existing = stepMap.get(defaultStep.id)
      if (existing) {
        return {
          ...defaultStep,
          status: existing.status,
          completedAt: existing.completedAt,
          outputSummary: existing.outputSummary,
          notes: existing.notes,
        }
      }
      return { ...defaultStep, status: 'pending' as const }
    })
    const migratedCurrentIndex = resolveMigratedCurrentStepIndex(newSteps, oldCurrentStepId)

    return {
      campaignId,
      currentStepIndex: migratedCurrentIndex,
      steps: newSteps,
      createdAt: old.createdAt,
      updatedAt: now,
    }
  }

  // -----------------------------------------------------------------
  // 状态机操作
  // -----------------------------------------------------------------

  async updateWorkflowStep(input: UpdateWorkflowStepInput): Promise<CampaignWorkflow> {
    const workflow = await this.loadCampaignWorkflow(input.campaignId)
    const stepIndex = workflow.steps.findIndex((s) => s.id === input.stepId)
    if (stepIndex === -1) {
      throw new Error(`步骤不存在: ${input.stepId}`)
    }

    const step = workflow.steps[stepIndex]!
    if (input.status !== undefined) {
      step.status = input.status
      if (input.status === 'completed') {
        step.completedAt = Date.now()
        if (workflow.currentStepIndex === stepIndex) {
          workflow.currentStepIndex = Math.min(stepIndex + 1, workflow.steps.length - 1)
        }
      } else if (input.status === 'in_progress') {
        workflow.currentStepIndex = stepIndex
      }
    }
    if (input.outputSummary !== undefined) step.outputSummary = input.outputSummary
    if (input.notes !== undefined) step.notes = input.notes

    await this.saveWorkflow(workflow)
    return workflow
  }

  async advanceWorkflow(input: AdvanceWorkflowInput): Promise<CampaignWorkflow> {
    const workflow = await this.loadCampaignWorkflow(input.campaignId)
    const stepIndex = workflow.steps.findIndex((s) => s.id === input.stepId)
    if (stepIndex === -1) {
      throw new Error(`步骤不存在: ${input.stepId}`)
    }

    workflow.steps[stepIndex]!.status = 'completed'
    workflow.steps[stepIndex]!.completedAt = Date.now()

    const nextIndex = workflow.steps.findIndex((s) => s.id === input.nextStepId)
    if (nextIndex !== -1) {
      workflow.currentStepIndex = nextIndex
      workflow.steps[nextIndex]!.status = 'in_progress'
    }

    await this.saveWorkflow(workflow)
    return workflow
  }

  async resetWorkflow(campaignId: string): Promise<CampaignWorkflow> {
    const workflow = this.createDefaultWorkflow(campaignId)
    await this.saveWorkflow(workflow)
    return workflow
  }

  // -----------------------------------------------------------------
  // 查询与提示词
  // -----------------------------------------------------------------

  async getStepAgentPrompt(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    context?: Record<string, string>,
  ): Promise<string> {
    const workflow = await this.loadCampaignWorkflow(campaignId)
    const step = workflow.steps.find((s) => s.id === stepId)
    if (!step) return ''

    let prompt = step.agentPrompt
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
      }
    }
    return prompt
  }

  async getCurrentStep(campaignId: string): Promise<CampaignWorkflowStep | null> {
    const workflow = await this.loadCampaignWorkflow(campaignId)
    if (workflow.currentStepIndex < 0) return null
    return workflow.steps[workflow.currentStepIndex] ?? null
  }

  async getCompletedSteps(campaignId: string): Promise<CampaignWorkflowStep[]> {
    const workflow = await this.loadCampaignWorkflow(campaignId)
    return workflow.steps.filter((s) => s.status === 'completed')
  }

  async isWorkflowComplete(campaignId: string): Promise<boolean> {
    const workflow = await this.loadCampaignWorkflow(campaignId)
    return workflow.steps.every((s) => s.status === 'completed' || s.status === 'skipped')
  }

  async getWorkflowProgress(campaignId: string): Promise<number> {
    const workflow = await this.loadCampaignWorkflow(campaignId)
    const completed = workflow.steps.filter(
      (s) => s.status === 'completed' || s.status === 'skipped',
    ).length
    return Math.round((completed / workflow.steps.length) * 100)
  }

  // -----------------------------------------------------------------
  // 产物校验
  // -----------------------------------------------------------------

  async validateStepArtifacts(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
  ): Promise<import('./campaign-artifact-validator.ts').ArtifactValidationResult> {
    if (!this.validator) {
      throw new Error('CampaignArtifactValidator 未注入，无法校验产物')
    }
    const workflow = await this.loadCampaignWorkflow(campaignId)
    const step = workflow.steps.find((s) => s.id === stepId)
    if (!step) {
      throw new Error(`步骤不存在: ${stepId}`)
    }
    return this.validator.validateStepArtifacts(campaignId, stepId, step)
  }

  // -----------------------------------------------------------------
  // 带产物校验的完成步骤
  // -----------------------------------------------------------------

  async completeStep(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    messages: AgentMessage[] | undefined,
  ): Promise<{ success: boolean; workflow: CampaignWorkflow; reason?: string }> {
    if (!this.validator) {
      throw new Error('CampaignArtifactValidator 未注入，无法完成带校验的步骤')
    }

    const workflow = await this.loadCampaignWorkflow(campaignId)
    const step = workflow.steps.find((s) => s.id === stepId)
    if (!step) {
      throw new Error(`步骤不存在: ${stepId}`)
    }

    await this.validator.materializeAssistantOutputIfNeeded(campaignId, stepId, step.title, messages)
    const validation = await this.validator.validateStepArtifacts(campaignId, stepId, step)
    const outputSummary = await this.validator.extractOutputSummary(messages)

    if (!validation.valid) {
      const failedWorkflow = await this.updateWorkflowStep({
        campaignId,
        stepId,
        status: 'failed',
        outputSummary: `产物校验失败: ${validation.missing.join('; ')}`,
      })
      await this.appendHistory(campaignId, stepId, step.title, 'failed', outputSummary)
      return { success: false, workflow: failedWorkflow, reason: validation.missing.join('; ') }
    }

    const completedWorkflow = await this.updateWorkflowStep({
      campaignId,
      stepId,
      status: 'completed',
      outputSummary,
    })
    await this.appendHistory(campaignId, stepId, step.title, 'completed', outputSummary)
    return { success: true, workflow: completedWorkflow }
  }

  private async appendHistory(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    stepTitle: string,
    status: 'completed' | 'failed' | 'adjusted',
    outputSummary: string,
  ): Promise<void> {
    const baseDir = this.getWorkspacePath(campaignId)
    const contextDir = join(baseDir, '.context')
    await this.ensureArtifactDirs(campaignId)
    const historyPath = join(contextDir, 'history.md')

    const timestamp = new Date().toLocaleString()
    const statusLabel =
      status === 'completed' ? '✅ 完成' : status === 'failed' ? '❌ 失败' : '🔄 调整'
    const entry = `## ${timestamp} — ${stepTitle}\n\n- 状态: ${statusLabel}\n- 步骤: ${stepId}\n- 摘要: ${outputSummary}\n\n---\n\n`

    try {
      const exists = await this.files.exists(historyPath)
      if (exists) {
        const existing = await this.files.readTextFile(historyPath)
        await this.files.writeTextFile(historyPath, existing + entry)
      } else {
        await this.files.writeTextFile(historyPath, `# Campaign 执行历史\n\n记录所有工作流步骤的执行历史。\n\n${entry}`)
      }
    } catch (err) {
      console.error('[CampaignWorkflow] 写入 history.md 失败:', err)
    }
  }
}

// =====================================================================
// 内部工具函数
// =====================================================================

function resolveMigratedCurrentStepIndex(
  steps: CampaignWorkflowStep[],
  oldCurrentStepId: CampaignWorkflowStepId | undefined,
): number {
  if (oldCurrentStepId) {
    const sameStepIndex = steps.findIndex((step) => step.id === oldCurrentStepId)
    if (sameStepIndex >= 0 && steps[sameStepIndex]?.status === 'in_progress') {
      return sameStepIndex
    }
  }

  const inProgressIndex = steps.findIndex((step) => step.status === 'in_progress')
  if (inProgressIndex >= 0) return inProgressIndex

  const nextPendingIndex = steps.findIndex((step) => step.status === 'pending' || step.status === 'failed')
  return nextPendingIndex >= 0 ? nextPendingIndex : -1
}

function generateTodoMarkdown(workflow: CampaignWorkflow): string {
  const lines: string[] = [
    '# Campaign 工作流 Todo',
    '',
    `Campaign ID: ${workflow.campaignId}`,
    `创建时间: ${new Date(workflow.createdAt).toLocaleString()}`,
    `更新时间: ${new Date(workflow.updatedAt).toLocaleString()}`,
    '',
  ]

  const currentStep = workflow.currentStepIndex >= 0 ? workflow.steps[workflow.currentStepIndex] : null
  if (currentStep && currentStep.status === 'in_progress') {
    lines.push('## 🔵 当前步骤', '')
    lines.push(`- [ ] **步骤 ${workflow.currentStepIndex + 1}**: ${currentStep.title} (${currentStep.toolName})`)
    lines.push(`  - 描述: ${currentStep.description}`)
    lines.push(`  - 产物目录: \`${STEP_DIR_MAP[currentStep.id]}\``)
    lines.push('')
  }

  const completed = workflow.steps.filter((s) => s.status === 'completed')
  if (completed.length > 0) {
    lines.push('## ✅ 已完成', '')
    for (const step of completed) {
      const idx = workflow.steps.indexOf(step) + 1
      lines.push(`- [x] **步骤 ${idx}**: ${step.title}`)
      if (step.outputSummary) {
        lines.push(`  - 产出: ${step.outputSummary}`)
      }
      if (step.completedAt) {
        lines.push(`  - 完成于: ${new Date(step.completedAt).toLocaleString()}`)
      }
      lines.push(`  - 产物目录: \`${STEP_DIR_MAP[step.id]}\``)
    }
    lines.push('')
  }

  const pending = workflow.steps.filter((s) => s.status !== 'completed' && s.status !== 'skipped')
  if (pending.length > 0) {
    lines.push('## ⏳ 待完成', '')
    for (const step of pending) {
      const idx = workflow.steps.indexOf(step) + 1
      const icon = step.status === 'in_progress' ? '🔵' : '⭕'
      lines.push(`${icon} **步骤 ${idx}**: ${step.title} (${step.toolName})`)
      lines.push(`   描述: ${step.description}`)
      lines.push(`   产物目录: \`${STEP_DIR_MAP[step.id]}\``)
      lines.push('')
    }
  }

  const skipped = workflow.steps.filter((s) => s.status === 'skipped')
  if (skipped.length > 0) {
    lines.push('## ⏭️ 已跳过', '')
    for (const step of skipped) {
      const idx = workflow.steps.indexOf(step) + 1
      lines.push(`- **步骤 ${idx}**: ${step.title}`)
    }
    lines.push('')
  }

  lines.push('## 📁 产物目录索引', '')
  for (const dir of ARTIFACT_DIRS) {
    if (dir === '.context') continue
    lines.push(`- \`${dir}/\` — ${getDirDescription(dir)}`)
  }
  lines.push('')

  lines.push('## 📝 使用说明', '')
  lines.push('1. 点击"执行此步骤"按钮，Agent 会自动执行该步骤')
  lines.push('2. 执行完成后，点击"标记完成"或让 Agent 自动回写状态')
  lines.push('3. 如果需要调整已完成的步骤，点击"重新执行"或"调整此步骤"')
  lines.push('4. 所有产物文件保存在对应的目录中')
  lines.push('')

  return lines.join('\n')
}

function getDirDescription(dir: string): string {
  const desc: Record<string, string> = {
    'market-analysis': '市场分析文档（市场规模/品类趋势/品类痛点）',
    'competitor-analysis': '竞品分析文档（竞品矩阵/竞争格局/差异化策略）',
    'user-analysis': '用户分析文档（TA画像/搜索习惯/关键词）',
    'brand-dna': '品牌DNA + 品牌诊断（品牌阶段/产品现状/核心问题/核心目标）',
    'brand-concept': '品牌概念产出（愿景/价值观/品牌屋/Tone/Visual）',
    'goal-setting': '目标设定（总目标/分层目标/量化指标）',
    'creative-concept': '核心创意概念（Big Idea）',
    'platform-matrix': '平台内容分发矩阵',
    'kol-pyramid': 'KOL 合作金字塔方案',
    'kol-search': '候选达人搜索结果',
    briefs: 'KOL 个性化 Brief',
    'ab-test': 'A/B 测试设计方案',
  }
  return desc[dir] ?? '产物目录'
}

function generateCampaignMdPlaceholder(workflow: CampaignWorkflow): string {
  return `# Campaign 上下文

Campaign ID: ${workflow.campaignId}

## 基本信息

- 品牌:
- 平台:
- 总预算:
- 投放周期:
- 目标城市:
- 目标人群:

## 工作流进度

${workflow.steps.map((s, i) => `- ${s.status === 'completed' ? '[x]' : '[ ]'} 步骤 ${i + 1}: ${s.title}`).join('\n')}

## 产物目录

\`\`\`
market-analysis/      — 市场分析（市场规模/品类趋势/品类痛点）
competitor-analysis/  — 竞品分析（竞品矩阵/竞争格局/差异化策略）
user-analysis/        — 用户分析（TA画像/搜索习惯/关键词）
brand-dna/            — 品牌DNA + 品牌诊断（品牌阶段/产品现状/核心问题/核心目标）
brand-concept/        — 品牌概念（愿景/价值观/品牌屋/Tone/Visual）
goal-setting/         — 目标设定（总目标/分层目标/量化指标）
creative-concept/     — 创意概念（Big Idea）
platform-matrix/      — 平台矩阵
kol-pyramid/          — KOL 金字塔
kol-search/           — 达人搜索
briefs/               — KOL Briefs
ab-test/              — A/B 测试
\`\`\`

## 历史记录

见 history.md
`
}
