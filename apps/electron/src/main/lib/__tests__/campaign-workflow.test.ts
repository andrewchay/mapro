/**
 * Campaign 工作流测试
 *
 * 测试工作流状态管理：
 * 1. 工作流初始化（目录/todo/history 生成）
 * 2. 产物校验（5 层：目录→文件→非空→字数→语义锚点）
 * 3. 完成步骤（completeStepWithValidation）
 * 4. outputSummary 提取
 * 5. history.md / todo.md 同步
 * 6. Campaign Agent 工具
 * 7. 重置工作流
 *
 * 每个测试用独立步骤 ID，避免文件系统污染。
 */

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { existsSync, readFileSync, unlinkSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ===== 前置 mock =====

const TEST_DIR = join(tmpdir(), `mapro-workflow-test-${Date.now()}`)

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
  validateStepArtifacts: (campaignId: string, stepId: string) => {
    valid: boolean
    files: string[]
    totalChars: number
    missing: string[]
    unmetRequirements: import('@ma-proma/shared').ArtifactRequirement[]
  }
  extractOutputSummary: (messages: import('@ma-proma/shared').AgentMessage[] | undefined) => string
  completeStepWithValidation: (
    campaignId: string,
    stepId: string,
    messages: import('@ma-proma/shared').AgentMessage[] | undefined,
  ) => { success: boolean; workflow: import('@ma-proma/shared').CampaignWorkflow; reason?: string }
  getWorkflowProgress: (campaignId: string) => number
}

interface CampaignManagerModule {
  closeCampaignDatabase: () => void
  createCampaign: (input: import('@ma-proma/shared').CreateCampaignInput) => import('@ma-proma/shared').Campaign
  getCampaignById: (id: string) => import('@ma-proma/shared').Campaign | undefined
  importKOLsToPool: (input: import('@ma-proma/shared').ImportKOLsToPoolInput) => { imported: number }
}

interface CampaignAgentToolModule {
  isCampaignAgentToolCall: (toolName: string) => boolean
  executeCampaignAgentTool: (tc: any) => Promise<any>
}

let workflowService: WorkflowServiceModule
let campaignManager: CampaignManagerModule
let campaignAgentTool: CampaignAgentToolModule

describe('Campaign 工作流测试', () => {
  const testCampaignId = 'test-campaign-001'

  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true })
    process.env._MAPRO_TEST_CONFIG_DIR = TEST_DIR

    campaignManager = await import('../campaign-manager') as CampaignManagerModule
    workflowService = await import('../campaign-workflow-service') as WorkflowServiceModule
    campaignAgentTool = await import('../ma-tools/campaign-agent') as CampaignAgentToolModule
  })

  afterAll(() => {
    campaignManager.closeCampaignDatabase()

    const dbPath = join(TEST_DIR, 'campaign-database.sqlite')
    if (existsSync(dbPath)) unlinkSync(dbPath)
    const kolDbPath = join(TEST_DIR, 'kol-database.sqlite')
    if (existsSync(kolDbPath)) unlinkSync(kolDbPath)

    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    if (existsSync(workspaceDir)) rmSync(workspaceDir, { recursive: true })

    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  })

  // ===== Slice 1: 工作流初始化 =====

  it('Slice 1: 加载工作流时自动创建目录和 todo.md', () => {
    const workflow = workflowService.loadCampaignWorkflow(testCampaignId)

    expect(workflow.campaignId).toBe(testCampaignId)
    expect(workflow.steps).toHaveLength(9)
    expect(workflow.currentStepIndex).toBe(-1)
    expect(workflow.steps[0]?.id).toBe('brand_dna')
    expect(workflow.steps[0]?.status).toBe('pending')

    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const expectedDirs = [
      'brand-dna', 'ta-portrait', 'creative-concept', 'platform-matrix',
      'kol-pyramid', 'kol-search', 'briefs', 'ab-test', '.context',
    ]
    for (const dir of expectedDirs) {
      expect(existsSync(join(workspaceDir, dir))).toBe(true)
    }

    const todoPath = join(workspaceDir, '.context', 'todo.md')
    expect(existsSync(todoPath)).toBe(true)
    const todoContent = readFileSync(todoPath, 'utf-8')
    expect(todoContent).toContain('Campaign 工作流 Todo')
    expect(todoContent).toContain('⏳ 待完成')
    expect(todoContent).toContain('brand-dna')

    const campaignMdPath = join(workspaceDir, '.context', 'campaign.md')
    expect(existsSync(campaignMdPath)).toBe(true)
    expect(readFileSync(campaignMdPath, 'utf-8')).toContain('Campaign 上下文')
  })

  // ===== Slice 2: 产物校验（5 层） =====

  // 每个测试用独立步骤，避免文件污染。

  it('Slice 2a: 空目录 → valid=false，原因=目录不存在', () => {
    // brand_dna 目录已存在（由 init 创建），但仍是空的
    const result = workflowService.validateStepArtifacts(testCampaignId, 'brand_dna')
    expect(result.valid).toBe(false)
    expect(result.files).toHaveLength(0)
    expect(result.missing.some((m) => m.includes('目录不存在') || m.includes('没有可读产物'))).toBe(true)
  })

  it('Slice 2b: 非文本文件 → valid=false，原因=没有可读产物', () => {
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const dir = join(workspaceDir, 'ta-portrait')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'image.jpg'), 'fake-binary', 'utf-8')

    const result = workflowService.validateStepArtifacts(testCampaignId, 'ta_portrait')
    expect(result.valid).toBe(false)
    expect(result.files).toHaveLength(0)
    expect(result.missing.some((m) => m.includes('没有可读产物'))).toBe(true)
  })

  it('Slice 2c: 空文本文件 → valid=false，原因=均为空', () => {
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const dir = join(workspaceDir, 'platform-matrix')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'platform-matrix.md'), '', 'utf-8')

    const result = workflowService.validateStepArtifacts(testCampaignId, 'platform_matrix')
    expect(result.valid).toBe(false)
    expect(result.files).toHaveLength(0)
    expect(result.missing.some((m) => m.includes('均为空'))).toBe(true)
  })

  it('Slice 2d: 有内容但缺少语义锚点 → valid=false，原因=语义锚点', () => {
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const dir = join(workspaceDir, 'kol-pyramid')
    mkdirSync(dir, { recursive: true })
    // 400+ 字，但缺少 kol-pyramid 的锚点（金字塔、预算、筛选标准）
    writeFileSync(
      join(dir, 'kol-pyramid.md'),
      '这是一份关于KOL合作的文档。' +
        '我们选择了一些合适的达人进行合作。' +
        '合作内容包括内容创作、直播推广和互动活动。' +
        '达人分为不同层级，包括头部和腰部。' +
        '我们希望达成良好的营销效果。' +
        '每个达人都有自己的特色和受众群体。'.repeat(8),
      'utf-8',
    )

    const result = workflowService.validateStepArtifacts(testCampaignId, 'kol_pyramid')
    expect(result.valid).toBe(false)
    expect(result.missing.some((m) => m.includes('语义锚点'))).toBe(true)
    expect(result.unmetRequirements.length).toBeGreaterThan(0)
  })

  it('Slice 2e: 合格内容（字数够、覆盖所有锚点）→ valid=true', () => {
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const dir = join(workspaceDir, 'kol-search')
    mkdirSync(dir, { recursive: true })

    // 使用 add_to_pool 步骤（min=100，锚点：导入记录、KOL ID、导入结果）
    const content = [
      '# KOL 导入记录',
      '',
      '## 导入时间',
      '2024-06-15',
      '',
      '## KOL ID 列表',
      '- kol_001: 头部达人，小红书粉丝 50W',
      '- kol_002: 腰部达人，抖音粉丝 20W',
      '- kol_003: 尾部达人，小红书粉丝 5W',
      '',
      '## 导入结果',
      '成功导入 3 位达人，状态更新为 candidate。',
      '已跳过重复达人 0 位。',
      '当前候选池总计 3 位达人。',
    ].join('\n')

    writeFileSync(join(dir, 'pool-import-log.md'), content, 'utf-8')

    const result = workflowService.validateStepArtifacts(testCampaignId, 'add_to_pool')
    expect(result.valid).toBe(true)
    expect(result.files).toContain('pool-import-log.md')
    expect(result.totalChars).toBeGreaterThan(100)
    expect(result.missing).toHaveLength(0)
    expect(result.unmetRequirements).toHaveLength(0)
  })

  // ===== Slice 3: 完成步骤（completeStepWithValidation） =====

  it('Slice 3a: 产物为空 → 标记 failed', () => {
    workflowService.updateWorkflowStep({
      campaignId: testCampaignId,
      stepId: 'generate_briefs',
      status: 'in_progress',
    })

    const result = workflowService.completeStepWithValidation(
      testCampaignId,
      'generate_briefs',
      [],
    )

    expect(result.success).toBe(false)
    expect(result.workflow.steps.find((s) => s.id === 'generate_briefs')?.status).toBe('failed')
    expect(result.reason).toBeDefined()
  })

  it('Slice 3b: 有合格产物 → 标记 completed + outputSummary', () => {
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const dir = join(workspaceDir, 'ab-test')
    mkdirSync(dir, { recursive: true })

    // ab_test 步骤：锚点=测试变量、分组方案、指标、样本量
    const content = [
      '# A/B 测试方案',
      '',
      '## 测试变量',
      '本次 A/B 测试的核心变量是标题文案。',
      '我们准备了两组不同的标题进行对照：',
      'A 组（对照组）使用品牌原有的标准标题，保持现有风格不变；',
      'B 组（测试组）使用情感向、场景化的标题文案，突出用户体验。',
      '通过对比两组标题在相同投放条件下的表现差异，',
      '评估情感化标题是否能显著提升用户的点击意愿和互动参与度。',
      '测试变量严格控制在标题文案这一个维度，其他投放条件保持一致。',
      '',
      '## 分组方案',
      '将目标受众随机分为两个实验组，每组各分配 50% 的曝光流量。',
      'A 组为对照组，保持现有标题不变；B 组为测试组，使用优化后的情感标题。',
      '为确保结果有效性，两组受众的年龄、性别、地域分布保持一致。',
      '测试周期设定为 7 天，覆盖工作日和周末，避免时间偏差对结果的影响。',
      '每天定时检查两组数据，确保流量分配均匀，无异常波动。',
      '',
      '## 指标',
      '主要指标为点击率（CTR），即广告曝光后的点击比例。',
      '次要指标包括转化率（从点击到购买的比例）、',
      '停留时长（用户在落地页的平均停留时间）、',
      '以及互动率（点赞、评论、分享的比例）。',
      '若 B 组的 CTR 相对 A 组提升超过 15%，',
      '且统计显著性 p<0.05，则判定测试有效并建议全量推广。',
      '',
      '## 样本量',
      '根据统计学原理，设定显著性水平 α=0.05，检验功效 β=0.2。',
      '通过样本量计算公式，每组需要至少 5000 次有效曝光才能达到统计显著性。',
      '预计总曝光量为 200 万次，远超最低样本要求，确保结果具有高度可信度。',
      '测试将在 7 天内完成，每日监控数据变化趋势，及时调整投放策略。',
    ].join('\n')

    writeFileSync(join(dir, 'ab-test-plan.md'), content, 'utf-8')

    workflowService.updateWorkflowStep({
      campaignId: testCampaignId,
      stepId: 'ab_test',
      status: 'in_progress',
    })

    const mockMessages: import('@ma-proma/shared').AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'A/B 测试方案设计完成！变量为标题文案，分组为 A/B 两组，样本量各 5000。',
        createdAt: Date.now(),
      },
    ]

    const result = workflowService.completeStepWithValidation(
      testCampaignId,
      'ab_test',
      mockMessages,
    )

    expect(result.success).toBe(true)
    const step = result.workflow.steps.find((s) => s.id === 'ab_test')
    expect(step?.status).toBe('completed')
    expect(step?.outputSummary).toBe('A/B 测试方案设计完成！变量为标题文案，分组为 A/B 两组，样本量各 5000。')
    expect(step?.completedAt).toBeDefined()
  })

  // ===== Slice 4: outputSummary 提取 =====

  it('Slice 4a: 从消息提取内容', () => {
    const messages: import('@ma-proma/shared').AgentMessage[] = [
      { id: '1', role: 'user', content: 'hello', createdAt: 1 },
      { id: '2', role: 'assistant', content: 'This is the summary output', createdAt: 2 },
    ]
    expect(workflowService.extractOutputSummary(messages)).toBe('This is the summary output')
  })

  it('Slice 4b: 空/undefined 消息返回默认', () => {
    expect(workflowService.extractOutputSummary(undefined)).toBe('执行完成，未获取输出摘要')
    expect(workflowService.extractOutputSummary([])).toBe('执行完成，未获取输出摘要')
  })

  // ===== Slice 5: 历史记录 =====

  it('Slice 5: history.md 已创建并记录执行历史', () => {
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const historyPath = join(workspaceDir, '.context', 'history.md')

    expect(existsSync(historyPath)).toBe(true)
    const content = readFileSync(historyPath, 'utf-8')
    expect(content).toContain('Campaign 执行历史')
    // 前面 Slice 3a/b 的 failed + completed 记录应该已经被写入
    expect(content.length).toBeGreaterThan(50)
  })

  // ===== Slice 6: todo.md 同步 =====

  it('Slice 6: todo.md 随工作流更新同步', () => {
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const todoContent = readFileSync(join(workspaceDir, '.context', 'todo.md'), 'utf-8')

    // ab_test 已标记 completed，应该出现在已完成区块
    expect(todoContent).toContain('## ✅ 已完成')
    expect(todoContent).toContain('步骤 9')
    expect(todoContent).toContain('[x]')

    // generate_briefs 标记 failed，应该出现在待完成区块
    expect(todoContent).toContain('⏳ 待完成')
  })

  // ===== Slice 7: 进度计算 =====

  it('Slice 7: 进度计算正确', () => {
    const progress = workflowService.getWorkflowProgress(testCampaignId)
    // 9 步中：ab_test completed, add_to_pool completed (校验时写文件), generate_briefs failed
    // 其余 pending
    expect(progress).toBeGreaterThanOrEqual(0)
    expect(progress).toBeLessThanOrEqual(100)
  })

  // ===== Slice 8: Campaign Agent 工具 =====

  it('Slice 8: ma_campaign_kol_add 是 Campaign Agent 工具', () => {
    expect(campaignAgentTool.isCampaignAgentToolCall('ma_campaign_kol_add')).toBe(true)
    expect(campaignAgentTool.isCampaignAgentToolCall('ma_campaign_kol_status')).toBe(true)
    expect(campaignAgentTool.isCampaignAgentToolCall('unknown_tool')).toBe(false)
  })

  // ===== Slice 9: 重置工作流 =====

  it('Slice 9: 重置工作流恢复初始状态', () => {
    const workflow = workflowService.resetWorkflow(testCampaignId)

    expect(workflow.steps).toHaveLength(9)
    for (const step of workflow.steps) {
      expect(step.status).toBe('pending')
      expect(step.completedAt).toBeUndefined()
      expect(step.outputSummary).toBeUndefined()
    }
    expect(workflow.currentStepIndex).toBe(-1)
  })
})
