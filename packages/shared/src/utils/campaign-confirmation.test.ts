import { test, expect, describe } from 'bun:test'
import type { CampaignWorkflow } from '../types/campaign'
import {
  M0_ALIGNMENT_ITEM_ID,
  parseConfidenceGate,
  hasAssumptionMarkers,
  buildM0Confirmation,
  evaluateStepConfirmations,
  mergeConfirmations,
  collectBlockingConfirmations,
  findBlockersForStep,
  applyConfirmation,
} from './campaign-confirmation'

describe('parseConfidenceGate', () => {
  test('解析合法 confidence_gate 块', () => {
    const text = [
      '# 品牌屋',
      '内容……',
      '```json',
      '{ "confidence": "assumption", "gateId": "brand_house", "message": "品牌定位为假设", "blocksStepId": "creative_concept" }',
      '```',
    ].join('\n')
    const gate = parseConfidenceGate(text)
    expect(gate).not.toBeNull()
    expect(gate?.confidence).toBe('assumption')
    expect(gate?.gateId).toBe('brand_house')
    expect(gate?.blocksStepId).toBe('creative_concept')
  })

  test('非法 JSON 或缺失字段时返回 null（降级不阻断）', () => {
    expect(parseConfidenceGate('```json\n{ bad json }\n```')).toBeNull()
    expect(parseConfidenceGate('```json\n{ "confidence": "unknown" }\n```')).toBeNull()
    expect(parseConfidenceGate('没有门块')).toBeNull()
  })
})

describe('hasAssumptionMarkers', () => {
  test('识别各类未确认标注', () => {
    expect(hasAssumptionMarkers('这是[假设]的结论')).toBe(true)
    expect(hasAssumptionMarkers('标注为[待验证]')).toBe(true)
    expect(hasAssumptionMarkers('全部[已验证]')).toBe(false)
  })
})

describe('buildM0Confirmation', () => {
  test('未决时返回单一工作流级 M0 项', () => {
    const items = buildM0Confirmation(true)
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe(M0_ALIGNMENT_ITEM_ID)
    expect(items[0]!.source).toBe('m0')
    expect(items[0]!.blocking).toBe(true)
  })

  test('已对齐时不产生项', () => {
    expect(buildM0Confirmation(false)).toHaveLength(0)
  })
})

describe('evaluateStepConfirmations', () => {
  const step = { id: 'user_analysis' as const, title: '用户分析' }

  test('不再产出 M0 项（由 buildM0Confirmation 统一负责）', () => {
    const items = evaluateStepConfirmations(step, '正文')
    expect(items).toHaveLength(0)
  })

  test('结构化 assumption 门生成置信项', () => {
    const text = '```json\n{ "confidence": "assumption", "gateId": "ci", "message": "洞察未验证" }\n```'
    const items = evaluateStepConfirmations(step, text)
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe('confidence:ci')
    expect(items[0]!.source).toBe('confidence_gate')
  })

  test('无结构化门但含 [假设] 时退化为关键词检测', () => {
    const items = evaluateStepConfirmations(step, '这里有个[假设]')
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe('confidence:user_analysis')
  })

  test('verified 门与无标注文本均不产生项', () => {
    const verified = '```json\n{ "confidence": "verified", "gateId": "ci", "message": "ok" }\n```'
    expect(evaluateStepConfirmations(step, verified)).toHaveLength(0)
    expect(evaluateStepConfirmations(step, '干净正文')).toHaveLength(0)
  })
})

describe('mergeConfirmations', () => {
  test('已确认项不被覆盖回 pending，新项以 pending 加入', () => {
    const existing = [
      { id: 'confidence:ci', label: '旧', reason: 'r', status: 'confirmed' as const, source: 'confidence_gate' as const, blocking: true, confirmedAt: 111, confirmedBy: 'u1' },
    ]
    const evaluated = [
      { id: 'confidence:ci', label: '新', reason: 'r2', status: 'pending' as const, source: 'confidence_gate' as const, blocking: true },
      { id: 'confidence:other', label: '另一个', reason: 'r3', status: 'pending' as const, source: 'confidence_gate' as const, blocking: true },
    ]
    const merged = mergeConfirmations(existing, evaluated)
    expect(merged.find((i) => i.id === 'confidence:ci')?.status).toBe('confirmed')
    expect(merged.find((i) => i.id === 'confidence:ci')?.confirmedAt).toBe(111)
    expect(merged.find((i) => i.id === 'confidence:other')?.status).toBe('pending')
  })

  test('判定不再触发的项被移除', () => {
    const existing = [
      { id: 'confidence:gone', label: 'g', reason: 'r', status: 'confirmed' as const, source: 'confidence_gate' as const, blocking: true },
    ]
    expect(mergeConfirmations(existing, [])).toHaveLength(0)
  })
})

describe('阻断判定', () => {
  const workflow: CampaignWorkflow = {
    campaignId: 'c1',
    currentStepIndex: 0,
    createdAt: 0,
    updatedAt: 0,
    confirmations: [
      { id: M0_ALIGNMENT_ITEM_ID, label: 'M0', reason: 'r', status: 'pending', source: 'm0', blocking: true },
    ],
    steps: [
      { id: 'market_analysis', title: '市场', description: '', status: 'pending', agentPrompt: '', toolName: '', confirmations: [] },
      {
        id: 'goal_setting',
        title: '目标',
        description: '',
        status: 'pending',
        agentPrompt: '',
        toolName: '',
        confirmations: [
          { id: 'confidence:ci', label: 'ci', reason: 'r', status: 'pending', source: 'confidence_gate', blocking: true, stepId: 'user_analysis' },
        ],
      },
    ],
  }

  test('collectBlockingConfirmations 收集所有未确认阻断项', () => {
    expect(collectBlockingConfirmations(workflow)).toHaveLength(2)
  })

  test('M0 门阻断研究/目标步骤，置信门阻断非归属步骤', () => {
    const m0Blockers = findBlockersForStep(workflow, 'user_analysis')
    expect(m0Blockers.some((i) => i.source === 'm0')).toBe(true)

    const confBlockers = findBlockersForStep(workflow, 'creative_concept')
    expect(confBlockers.some((i) => i.id === 'confidence:ci')).toBe(true)

    // 置信项归属步骤自身不被它阻断
    const selfBlockers = findBlockersForStep(workflow, 'user_analysis')
    expect(selfBlockers.some((i) => i.id === 'confidence:ci')).toBe(false)
  })

  test('确认后不再阻断', () => {
    const confirmed = applyConfirmation(workflow, { itemId: M0_ALIGNMENT_ITEM_ID, behavior: 'confirm', confirmedBy: 'u1' }, 999)
    expect(collectBlockingConfirmations(confirmed)).toHaveLength(1)
    expect(findBlockersForStep(confirmed, 'user_analysis')).toHaveLength(0)
    expect(confirmed.confirmations?.[0]?.confirmedAt).toBe(999)
  })

  test('applyConfirmation 不修改入参', () => {
    applyConfirmation(workflow, { itemId: M0_ALIGNMENT_ITEM_ID, behavior: 'confirm' }, 999)
    expect(workflow.confirmations?.[0]?.status).toBe('pending')
  })
})
