/**
 * Campaign 工作流状态服务
 *
 * 管理每个 Campaign 的 9 步标准工作流进度。
 * 存储位置：~/.mapro/agent-workspaces/campaign-{id}/campaign-workflow.json
 *
 * 每步完成后 Agent 可以更新状态，用户也可手动标记。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
        return migrateWorkflow(workflow, campaignId)
      }
      return workflow
    } catch (err) {
      console.error(`[CampaignWorkflow] 读取失败，重新初始化: ${campaignId}`, err)
    }
  }

  const workflow = createDefaultWorkflow(campaignId)
  saveWorkflow(workflow)
  return workflow
}

export function saveWorkflow(workflow: CampaignWorkflow): void {
  const path = getWorkflowPath(workflow.campaignId)
  workflow.updatedAt = Date.now()
  writeFileSync(path, JSON.stringify(workflow, null, 2), 'utf-8')
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
