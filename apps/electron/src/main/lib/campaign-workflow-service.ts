/**
 * Campaign 工作流状态服务
 *
 * 管理每个 Campaign 的 9 步标准工作流进度。
 * 存储位置：~/.mapro/agent-workspaces/campaign-{id}/
 *
 * 目录结构：
 *   campaign-workflow.json    # 工作流状态
 *   .context/
 *     ├── todo.md              # 结构化 todo 列表
 *     ├── campaign.md          # Campaign 上下文
 *     └── history.md           # 执行历史
 *   brand-dna/                 # 品牌 DNA 产物
 *   ta-portrait/               # TA 画像产物
 *   creative-concept/          # 创意概念产物
 *   platform-matrix/           # 平台矩阵产物
 *   kol-pyramid/             # KOL 金字塔产物
 *   kol-search/              # 搜索结果
 *   briefs/                  # KOL Briefs
 *   ab-test/                 # A/B 测试方案
 *
 * 每步完成后 Agent 可以更新状态，用户也可手动标记。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getAgentWorkspacePath } from './config-paths'
import type {
  CampaignWorkflow,
  CampaignWorkflowStep,
  CampaignWorkflowStepId,
  UpdateWorkflowStepInput,
  AdvanceWorkflowInput,
} from '@ma-proma/shared'

// =====================================================================
// 标准目录定义
// =====================================================================

const ARTIFACT_DIRS = [
  'brand-dna',
  'ta-portrait',
  'creative-concept',
  'platform-matrix',
  'kol-pyramid',
  'kol-search',
  'briefs',
  'ab-test',
  '.context',
]

const STEP_DIR_MAP: Record<CampaignWorkflowStepId, string> = {
  brand_dna: 'brand-dna',
  ta_portrait: 'ta-portrait',
  creative_concept: 'creative-concept',
  platform_matrix: 'platform-matrix',
  kol_pyramid: 'kol-pyramid',
  search_kols: 'kol-search',
  add_to_pool: 'kol-search',        // 搜索结果也放这里
  generate_briefs: 'briefs',
  ab_test: 'ab-test',
}

// =====================================================================
// 默认 9 步工作流定义
// =====================================================================

const DEFAULT_WORKFLOW_STEPS: Omit<CampaignWorkflowStep, 'status' | 'completedAt'>[] = [
  {
    id: 'brand_dna',
    title: '提取品牌 DNA',
    description: '分析品牌核心价值、视觉基因、语言调性，输出品牌 DNA 文档',
    toolName: 'ma-brand-dna',
    agentPrompt: '请使用 ma-brand-dna 工具分析当前 Campaign 的品牌 DNA。基于品牌名称、目标人群和投放平台，提取品牌核心价值主张、视觉基因、语言调性。将结果保存到工作区目录。',
  },
  {
    id: 'ta_portrait',
    title: '构建 TA 画像',
    description: '基于品牌 DNA 和目标城市，构建精准的受众画像（人口统计、兴趣、痛点）',
    toolName: 'ma-ta-portrait',
    agentPrompt: '请使用 ma-ta-portrait 工具构建当前 Campaign 的目标受众（TA）画像。基于品牌 DNA、目标城市（{targetCity}）、投放平台（{platform}），输出详细的受众画像报告。',
  },
  {
    id: 'creative_concept',
    title: '生成 Big Idea',
    description: '基于品牌 DNA 和 TA 画像，生成 Campaign 核心创意概念（Big Idea）',
    toolName: 'ma-creative-concept',
    agentPrompt: '请使用 ma-creative-concept 工具生成当前 Campaign 的核心创意概念（Big Idea）。基于品牌 DNA 和 TA 画像，输出 3 个创意方向，并推荐最优方案。',
  },
  {
    id: 'platform_matrix',
    title: '设计平台矩阵',
    description: '根据创意概念和 TA 画像，设计多平台内容分发矩阵和角色分工',
    toolName: 'ma-platform-role-mapper',
    agentPrompt: '请使用 ma-platform-role-mapper 工具设计当前 Campaign 的平台内容矩阵。基于 Big Idea 和 TA 画像，为每个平台分配内容角色、KPI 和预算比例。',
  },
  {
    id: 'kol_pyramid',
    title: '设计 KOL 金字塔',
    description: '根据预算和平台矩阵，设计 KOL 合作金字塔（头部/腰部/尾部比例）',
    toolName: 'ma-kol-pyramid',
    agentPrompt: '请使用 ma-kol-pyramid 工具设计当前 Campaign 的 KOL 合作金字塔。基于总预算 {budget} 元、平台矩阵和目标人群，设计头部/腰部/尾部 KOL 的比例、数量及预算分配。',
  },
  {
    id: 'search_kols',
    title: '筛选候选达人',
    description: '基于 KOL 金字塔参数，从数据库中搜索并筛选符合要求的候选达人',
    toolName: 'kol-data/search_kols',
    agentPrompt: '请使用 kol-data/search_kols 工具筛选当前 Campaign 的候选 KOL。基于 KOL 金字塔设计的参数（平台、类目、粉丝量级、预算范围），搜索并筛选出候选达人列表。',
  },
  {
    id: 'add_to_pool',
    title: '加入候选池',
    description: '将筛选出的达人加入 Campaign 候选池，并设置初始状态',
    toolName: 'ma-campaign-agent',
    agentPrompt: '请使用 ma-campaign-agent 的 kol_status 功能，将上一步筛选出的候选 KOL 加入当前 Campaign 的候选池。设置初始状态为 candidate，并记录筛选依据。',
  },
  {
    id: 'generate_briefs',
    title: '生成达人 Brief',
    description: '为每个已确认的达人生成个性化的合作 Brief（内容方向、交付物、时间线）',
    toolName: 'ma-creative-pilot',
    agentPrompt: '请使用 ma-creative-pilot 工具为当前 Campaign 候选池中的每位达人生成个性化 Brief。基于品牌 DNA、创意概念和达人特点，输出内容方向、交付物清单和时间线。',
  },
  {
    id: 'ab_test',
    title: '设计 A/B 测试',
    description: '为 Campaign 设计 A/B 测试方案（变量、分组、指标、样本量）',
    toolName: 'ma-campaign-tester',
    agentPrompt: '请使用 ma-campaign-tester 工具为当前 Campaign 设计 A/B 测试方案。基于创意概念和平台矩阵，定义测试变量、受众分组、成功指标和样本量计算。',
  },
]

// =====================================================================
// 目录和文件管理
// =====================================================================

/** 确保所有标准 artifact 目录存在 */
function ensureArtifactDirs(campaignId: string): void {
  const slug = `campaign-${campaignId}`
  const baseDir = getAgentWorkspacePath(slug)
  for (const dir of ARTIFACT_DIRS) {
    const dirPath = join(baseDir, dir)
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
      console.log(`[CampaignWorkflow] 已创建目录: ${dirPath}`)
    }
  }
}

/** 生成 todo.md 内容 */
function generateTodoMarkdown(workflow: CampaignWorkflow): string {
  const lines: string[] = [
    '# Campaign 工作流 Todo',
    '',
    `Campaign ID: ${workflow.campaignId}`,
    `创建时间: ${new Date(workflow.createdAt).toLocaleString()}`,
    `更新时间: ${new Date(workflow.updatedAt).toLocaleString()}`,
    '',
  ]

  // 当前步骤
  const currentStep = workflow.currentStepIndex >= 0 ? workflow.steps[workflow.currentStepIndex] : null
  if (currentStep && currentStep.status === 'in_progress') {
    lines.push('## 🔵 当前步骤', '')
    lines.push(`- [ ] **步骤 ${workflow.currentStepIndex + 1}**: ${currentStep.title} (${currentStep.toolName})`)
    lines.push(`  - 描述: ${currentStep.description}`)
    lines.push(`  - 产物目录: \`${STEP_DIR_MAP[currentStep.id]}\``)
    lines.push('')
  }

  // 已完成
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

  // 待完成
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

  // 已跳过
  const skipped = workflow.steps.filter((s) => s.status === 'skipped')
  if (skipped.length > 0) {
    lines.push('## ⏭️ 已跳过', '')
    for (const step of skipped) {
      const idx = workflow.steps.indexOf(step) + 1
      lines.push(`- **步骤 ${idx}**: ${step.title}`)
    }
    lines.push('')
  }

  // 产物目录索引
  lines.push('## 📁 产物目录索引', '')
  for (const dir of ARTIFACT_DIRS) {
    if (dir === '.context') continue
    lines.push(`- \`${dir}/\` — ${getDirDescription(dir)}`)
  }
  lines.push('')

  // 使用说明
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
    'brand-dna': '品牌 DNA 分析文档',
    'ta-portrait': '目标受众画像报告',
    'creative-concept': '核心创意概念（Big Idea）',
    'platform-matrix': '平台内容分发矩阵',
    'kol-pyramid': 'KOL 合作金字塔方案',
    'kol-search': '候选达人搜索结果',
    'briefs': 'KOL 个性化 Brief',
    'ab-test': 'A/B 测试设计方案',
  }
  return desc[dir] ?? '产物目录'
}

/** 更新所有工作区文件 */
function syncWorkspaceFiles(workflow: CampaignWorkflow): void {
  const slug = `campaign-${workflow.campaignId}`
  const baseDir = getAgentWorkspacePath(slug)
  const contextDir = join(baseDir, '.context')

  // 1. 确保目录存在
  ensureArtifactDirs(workflow.campaignId)

  // 2. 更新 todo.md
  writeFileSync(join(contextDir, 'todo.md'), generateTodoMarkdown(workflow), 'utf-8')

  // 3. 更新 campaign.md（如果还没创建）
  const campaignMdPath = join(contextDir, 'campaign.md')
  if (!existsSync(campaignMdPath)) {
    writeFileSync(campaignMdPath, generateCampaignMdPlaceholder(workflow), 'utf-8')
  }
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
brand-dna/          — 品牌 DNA
ta-portrait/        — TA 画像
creative-concept/   — 创意概念
platform-matrix/    — 平台矩阵
kol-pyramid/      — KOL 金字塔
kol-search/       — 达人搜索
briefs/           — KOL Briefs
ab-test/          — A/B 测试
\`\`\`

## 历史记录

见 history.md
`
}

// =====================================================================
// 工作流文件路径
// =====================================================================

function getWorkflowPath(campaignId: string): string {
  const slug = `campaign-${campaignId}`
  return join(getAgentWorkspacePath(slug), 'campaign-workflow.json')
}

// =====================================================================
// 初始化工作流
// =====================================================================

function createDefaultWorkflow(campaignId: string): CampaignWorkflow {
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

// =====================================================================
// 读写工作流
// =====================================================================

export function loadCampaignWorkflow(campaignId: string): CampaignWorkflow {
  const path = getWorkflowPath(campaignId)

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf-8')
      const workflow = JSON.parse(raw) as CampaignWorkflow
      // 如果步骤数量不匹配（版本升级），需要合并/更新
      if (workflow.steps.length !== DEFAULT_WORKFLOW_STEPS.length) {
        const migrated = migrateWorkflow(workflow, campaignId)
        syncWorkspaceFiles(migrated)
        return migrated
      }
      // 确保目录和 todo.md 存在（旧 Campaign 兼容）
      syncWorkspaceFiles(workflow)
      return workflow
    } catch (err) {
      console.error(`[CampaignWorkflow] 读取失败，重新初始化: ${campaignId}`, err)
    }
  }

  const workflow = createDefaultWorkflow(campaignId)
  saveWorkflow(workflow)
  syncWorkspaceFiles(workflow)
  return workflow
}

export function saveWorkflow(workflow: CampaignWorkflow): void {
  const path = getWorkflowPath(workflow.campaignId)
  workflow.updatedAt = Date.now()
  writeFileSync(path, JSON.stringify(workflow, null, 2), 'utf-8')
  // 同步更新 todo.md 等文件
  syncWorkspaceFiles(workflow)
}

/** 工作流版本迁移：新增步骤时保留已有状态 */
function migrateWorkflow(old: CampaignWorkflow, campaignId: string): CampaignWorkflow {
  const now = Date.now()
  const stepMap = new Map(old.steps.map((s) => [s.id, s]))
  const newSteps: CampaignWorkflowStep[] = DEFAULT_WORKFLOW_STEPS.map((defaultStep) => {
    const existing = stepMap.get(defaultStep.id)
    if (existing) {
      return {
        ...defaultStep,
        status: existing.status,
        completedAt: existing.completedAt,
        outputSummary: existing.outputSummary,
        notes: existing.notes,
        agentPrompt: existing.agentPrompt || defaultStep.agentPrompt,
      }
    }
    return { ...defaultStep, status: 'pending' as const }
  })

  const workflow: CampaignWorkflow = {
    campaignId,
    currentStepIndex: old.currentStepIndex,
    steps: newSteps,
    createdAt: old.createdAt,
    updatedAt: now,
  }
  saveWorkflow(workflow)
  return workflow
}

// =====================================================================
// 工作流操作
// =====================================================================

/** 更新单个步骤状态 */
export function updateWorkflowStep(input: UpdateWorkflowStepInput): CampaignWorkflow {
  const workflow = loadCampaignWorkflow(input.campaignId)
  const stepIndex = workflow.steps.findIndex((s) => s.id === input.stepId)
  if (stepIndex === -1) {
    throw new Error(`步骤不存在: ${input.stepId}`)
  }

  const step = workflow.steps[stepIndex]!
  if (input.status !== undefined) {
    step.status = input.status
    if (input.status === 'completed') {
      step.completedAt = Date.now()
      // 如果完成了当前步骤，自动推进到下一步
      if (workflow.currentStepIndex === stepIndex) {
        workflow.currentStepIndex = Math.min(stepIndex + 1, workflow.steps.length - 1)
      }
    } else if (input.status === 'in_progress') {
      workflow.currentStepIndex = stepIndex
    }
  }
  if (input.outputSummary !== undefined) step.outputSummary = input.outputSummary
  if (input.notes !== undefined) step.notes = input.notes

  saveWorkflow(workflow)
  return workflow
}

/** 推进到指定步骤 */
export function advanceWorkflow(input: AdvanceWorkflowInput): CampaignWorkflow {
  const workflow = loadCampaignWorkflow(input.campaignId)
  const stepIndex = workflow.steps.findIndex((s) => s.id === input.stepId)
  if (stepIndex === -1) {
    throw new Error(`步骤不存在: ${input.stepId}`)
  }

  // 标记当前步骤为完成
  workflow.steps[stepIndex]!.status = 'completed'
  workflow.steps[stepIndex]!.completedAt = Date.now()

  // 推进到下一步
  const nextIndex = workflow.steps.findIndex((s) => s.id === input.nextStepId)
  if (nextIndex !== -1) {
    workflow.currentStepIndex = nextIndex
    workflow.steps[nextIndex]!.status = 'in_progress'
  }

  saveWorkflow(workflow)
  return workflow
}

/** 重置工作流 */
export function resetWorkflow(campaignId: string): CampaignWorkflow {
  const workflow = createDefaultWorkflow(campaignId)
  saveWorkflow(workflow)
  return workflow
}

/** 获取某步骤的 Agent 提示词（支持模板替换） */
export function getStepAgentPrompt(
  campaignId: string,
  stepId: CampaignWorkflowStepId,
  context?: Record<string, string>,
): string {
  const workflow = loadCampaignWorkflow(campaignId)
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

/** 获取当前活跃步骤 */
export function getCurrentStep(campaignId: string): CampaignWorkflowStep | null {
  const workflow = loadCampaignWorkflow(campaignId)
  if (workflow.currentStepIndex < 0) return null
  return workflow.steps[workflow.currentStepIndex] ?? null
}

/** 获取已完成步骤列表 */
export function getCompletedSteps(campaignId: string): CampaignWorkflowStep[] {
  const workflow = loadCampaignWorkflow(campaignId)
  return workflow.steps.filter((s) => s.status === 'completed')
}

/** 检查工作流是否全部完成 */
export function isWorkflowComplete(campaignId: string): boolean {
  const workflow = loadCampaignWorkflow(campaignId)
  return workflow.steps.every((s) => s.status === 'completed' || s.status === 'skipped')
}

/** 获取工作流进度百分比 */
export function getWorkflowProgress(campaignId: string): number {
  const workflow = loadCampaignWorkflow(campaignId)
  const completed = workflow.steps.filter(
    (s) => s.status === 'completed' || s.status === 'skipped',
  ).length
  return Math.round((completed / workflow.steps.length) * 100)
}
