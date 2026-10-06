/**
 * Campaign 确认状态判定（纯函数，Electron / Server 共用）
 *
 * 统一两类门：
 * - M0 对齐门：brief-intake 对齐卡存在未决问题或缺失时阻断研究到目标设定
 * - confidence_gate 门：产物声明置信不足且被下游引用时阻断引用步骤
 *
 * 本模块不依赖文件系统，产物内容由调用方以字符串传入；解析失败一律降级为不阻断。
 */

import type {
  CampaignWorkflow,
  CampaignWorkflowStep,
  CampaignWorkflowStepId,
  ConfidenceGate,
  ConfirmationItem,
} from '../types/campaign'

/** M0 对齐门的稳定 ID */
export const M0_ALIGNMENT_ITEM_ID = 'm0_alignment'

/** M0 门阻断的步骤（研究 → 目标设定） */
export const M0_BLOCKED_STEP_IDS: CampaignWorkflowStepId[] = [
  'market_analysis',
  'competitor_analysis',
  'user_analysis',
  'brand_dna',
  'brand_fact_check',
  'brand_concept',
  'goal_setting',
]

/** 置信门归属步骤：产物所在步骤 → 其下游被阻断步骤集合 */
export const CONFIDENCE_GATE_STEP_IDS: CampaignWorkflowStepId[] = [
  'user_analysis',
  'brand_concept',
  'goal_setting',
  'creative_concept',
]

const ASSUMPTION_PATTERN = /\[(假设|待验证|工作假设|待确认)\]/g
const PENDING_QUESTION_HEADING = /^#{1,4}\s*未决问题/m

/** 结构化置信门块标记：带 confidence_gate 标签的围栏，或含 confidence 字段的 json 围栏 */
const GATE_BLOCK_PATTERN = /```(?:json)?\s*(?:confidence_gate)?\s*([\s\S]*?)```/gi

/** 从产物文本解析结构化 confidence_gate 块，失败返回 null */
export function parseConfidenceGate(artifactText: string): ConfidenceGate | null {
  if (!artifactText) return null
  GATE_BLOCK_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = GATE_BLOCK_PATTERN.exec(artifactText)) !== null) {
    const body = (match[1] ?? '').trim()
    if (!body.startsWith('{')) continue
    let parsed: Partial<ConfidenceGate>
    try {
      parsed = JSON.parse(body) as Partial<ConfidenceGate>
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    if (parsed.confidence !== 'verified' && parsed.confidence !== 'assumption') continue
    if (typeof parsed.message !== 'string') continue
    return {
      confidence: parsed.confidence,
      gateId: typeof parsed.gateId === 'string' && parsed.gateId ? parsed.gateId : 'confidence',
      message: parsed.message,
      blocksStepId: parsed.blocksStepId,
    }
  }
  return null
}

/** 产物是否含未确认标注（[假设]/[待验证]/[工作假设]/[待确认]） */
export function hasAssumptionMarkers(artifactText: string): boolean {
  if (!artifactText) return false
  ASSUMPTION_PATTERN.lastIndex = 0
  return ASSUMPTION_PATTERN.test(artifactText)
}

/**
 * 判定某个步骤的确认项（不含历史确认状态，由调用方合并）
 * @param step 步骤定义
 * @param artifactText 该步骤产物正文（可能为多文件拼接）
 * @param blockedByM0 是否为受 M0 门影响的下游步骤
/** 构建 M0 对齐门的单一确认项（工作流级，不随步骤重复） */
export function buildM0Confirmation(m0Unresolved: boolean): ConfirmationItem[] {
  if (!m0Unresolved) return []
  return [
    {
      id: M0_ALIGNMENT_ITEM_ID,
      label: 'M0 对齐卡：五类形态假设',
      reason: 'M0 对齐卡存在未决问题或缺失，需确认后才能推进研究与目标设定',
      status: 'pending',
      source: 'm0',
      blocking: true,
    },
  ]
}

/**
 * 判定某个步骤的确认项（仅 confidence_gate，M0 门由 buildM0Confirmation 统一处理）
 */
export function evaluateStepConfirmations(
  step: Pick<CampaignWorkflowStep, 'id' | 'title'>,
  artifactText: string,
): ConfirmationItem[] {
  const items: ConfirmationItem[] = []
  const text = artifactText ?? ''

  if (CONFIDENCE_GATE_STEP_IDS.includes(step.id)) {
    const gate = parseConfidenceGate(text)
    if (gate && gate.confidence === 'assumption') {
      items.push({
        id: `confidence:${gate.gateId}`,
        label: `${step.title}·置信门`,
        reason: gate.message || '产物含未确认判断，被下游引用前需确认',
        status: 'pending',
        source: 'confidence_gate',
        blocking: true,
        stepId: step.id,
      })
    } else if (!gate && hasAssumptionMarkers(text)) {
      items.push({
        id: `confidence:${step.id}`,
        label: `${step.title}·未确认标注`,
        reason: '产物含 [假设]/[待验证] 标注，被下游引用前需确认',
        status: 'pending',
        source: 'confidence_gate',
        blocking: true,
        stepId: step.id,
      })
    }
  }

  return items
}

/**
 * 合并新判定结果与已有确认状态：
 * - 已 confirmed / rejected 的确认项保留原状态，不被覆盖回 pending
 * - 新出现的确认项以 pending 加入
 * - 已消失的确认项（判定不再触发）直接移除
 */
export function mergeConfirmations(
  existing: ConfirmationItem[] | undefined,
  evaluated: ConfirmationItem[],
): ConfirmationItem[] {
  const prev = new Map((existing ?? []).map((item) => [item.id, item]))
  return evaluated.map((item) => {
    const old = prev.get(item.id)
    if (old && old.status !== 'pending') {
      return {
        ...item,
        status: old.status,
        confirmedAt: old.confirmedAt,
        confirmedBy: old.confirmedBy,
        evidence: old.evidence,
      }
    }
    return item
  })
}

/** 收集工作流中所有阻断中的确认项 */
export function collectBlockingConfirmations(workflow: CampaignWorkflow): ConfirmationItem[] {
  const items: ConfirmationItem[] = []
  for (const item of workflow.confirmations ?? []) {
    if (item.blocking && item.status !== 'confirmed') items.push(item)
  }
  for (const step of workflow.steps) {
    for (const item of step.confirmations ?? []) {
      if (item.blocking && item.status !== 'confirmed') items.push(item)
    }
  }
  return items
}

/** 判断目标步骤是否被未确认的阻断项拦截 */
export function findBlockersForStep(
  workflow: CampaignWorkflow,
  stepId: CampaignWorkflowStepId,
): ConfirmationItem[] {
  return collectBlockingConfirmations(workflow).filter((item) => {
    if (item.source === 'm0') return M0_BLOCKED_STEP_IDS.includes(stepId)
    // confidence 项阻断其所属步骤的下游（即归属步骤自身不被阻断）
    return item.stepId !== undefined && item.stepId !== stepId
  })
}

/** 应用一次确认/驳回操作，返回新的工作流确认集合（不修改入参） */
export function applyConfirmation(
  workflow: CampaignWorkflow,
  input: { itemId: string; behavior: 'confirm' | 'reject'; confirmedBy?: string; evidence?: string },
  now: number,
): CampaignWorkflow {
  const status = input.behavior === 'confirm' ? 'confirmed' : 'rejected'
  const patch = (item: ConfirmationItem): ConfirmationItem =>
    item.id === input.itemId
      ? {
          ...item,
          status,
          confirmedAt: now,
          confirmedBy: input.confirmedBy,
          evidence: input.evidence,
        }
      : item

  return {
    ...workflow,
    confirmations: (workflow.confirmations ?? []).map(patch),
    steps: workflow.steps.map((step) =>
      step.confirmations?.length
        ? { ...step, confirmations: step.confirmations.map(patch) }
        : step,
    ),
    updatedAt: now,
  }
}
