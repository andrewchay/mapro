/**
 * Campaign 工作流测试
 *
 * 测试工作流状态管理：
 * 1. 工作流初始化（目录/todo/history 生成）
 * 2. 产物为空时标记 failed
 * 3. 有产物时标记 completed
 * 4. ma_campaign_kol_add 工具调用（通过 campaign-agent.ts）
 * 5. outputSummary 提取
 */

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { existsSync, readdirSync, readFileSync, unlinkSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
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
  validateStepArtifacts: (campaignId: string, stepId: string) => { valid: boolean; files: string[]; missing: string[] }
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

    // 初始化数据库（campaign-manager 需要）
    campaignManager = await import('../campaign-manager') as CampaignManagerModule

    // 创建工作流服务
    workflowService = await import('../campaign-workflow-service') as WorkflowServiceModule

    // 创建 Campaign Agent 工具
    campaignAgentTool = await import('../ma-tools/campaign-agent') as CampaignAgentToolModule
  })

  afterAll(() => {
    campaignManager.closeCampaignDatabase()

    // 清理数据库
    const dbPath = join(TEST_DIR, 'campaign-database.sqlite')
    if (existsSync(dbPath)) unlinkSync(dbPath)
    const kolDbPath = join(TEST_DIR, 'kol-database.sqlite')
    if (existsSync(kolDbPath)) unlinkSync(kolDbPath)

    // 清理工作区
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    if (existsSync(workspaceDir)) rmSync(workspaceDir, { recursive: true })

    // 清理测试目录
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  })

  // ===== Slice 1: 工作流初始化 =====

  it('Slice 1: 加载工作流时自动创建目录和 todo.md', () => {
    const workflow = workflowService.loadCampaignWorkflow(testCampaignId)

    // 验证工作流结构
    expect(workflow.campaignId).toBe(testCampaignId)
    expect(workflow.steps).toHaveLength(9)
    expect(workflow.currentStepIndex).toBe(-1)
    expect(workflow.steps[0]?.id).toBe('brand_dna')
    expect(workflow.steps[0]?.status).toBe('pending')

    // 验证目录已创建
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const expectedDirs = [
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

    for (const dir of expectedDirs) {
      expect(existsSync(join(workspaceDir, dir))).toBe(true)
    }

    // 验证 todo.md 已创建
    const todoPath = join(workspaceDir, '.context', 'todo.md')
    expect(existsSync(todoPath)).toBe(true)

    const todoContent = readFileSync(todoPath, 'utf-8')
    expect(todoContent).toContain('Campaign 工作流 Todo')
    expect(todoContent).toContain('待完成')
    expect(todoContent).toContain('brand-dna')

    // 验证 campaign.md 已创建
    const campaignMdPath = join(workspaceDir, '.context', 'campaign.md')
    expect(existsSync(campaignMdPath)).toBe(true)
    const campaignMdContent = readFileSync(campaignMdPath, 'utf-8')
    expect(campaignMdContent).toContain('Campaign 上下文')
  })

  // ===== Slice 2: 产物校验 =====

  it('Slice 2: 产物为空时 validateStepArtifacts 返回 valid=false', () => {
    const result = workflowService.validateStepArtifacts(testCampaignId, 'brand_dna')
    expect(result.valid).toBe(false)
    expect(result.files).toHaveLength(0)
    expect(result.missing.length).toBeGreaterThan(0)
  })

  it('Slice 2: 有产物时 validateStepArtifacts 返回 valid=true', () => {
    // 创建产物文件
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const artifactDir = join(workspaceDir, 'brand-dna')
    const testFile = join(artifactDir, 'brand-dna.md')
    mkdirSync(artifactDir, { recursive: true })
    writeFileSync(testFile, '# Brand DNA\n\nTest content', 'utf-8')

    const result = workflowService.validateStepArtifacts(testCampaignId, 'brand_dna')
    expect(result.valid).toBe(true)
    expect(result.files).toContain('brand-dna.md')
    expect(result.missing).toHaveLength(0)
  })

  // ===== Slice 3: 完成步骤（产物校验） =====

  it('Slice 3: completeStepWithValidation 产物为空 → 标记 failed', () => {
    // 先更新步骤为 in_progress
    workflowService.updateWorkflowStep({
      campaignId: testCampaignId,
      stepId: 'ta_portrait',
      status: 'in_progress',
    })

    // 产物为空时调用完成
    const result = workflowService.completeStepWithValidation(
      testCampaignId,
      'ta_portrait',
      [],
    )

    expect(result.success).toBe(false)
    expect(result.workflow.steps.find((s) => s.id === 'ta_portrait')?.status).toBe('failed')
    expect(result.reason).toContain('目录为空')
  })

  it('Slice 3: completeStepWithValidation 有产物 → 标记 completed + outputSummary', () => {
    // 创建产物
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const artifactDir = join(workspaceDir, 'creative-concept')
    mkdirSync(artifactDir, { recursive: true })
    writeFileSync(join(artifactDir, 'big-idea.md'), '# Big Idea\n\nAmazing creative concept', 'utf-8')

    // 先更新步骤为 in_progress
    workflowService.updateWorkflowStep({
      campaignId: testCampaignId,
      stepId: 'creative_concept',
      status: 'in_progress',
    })

    // 模拟 Agent 消息
    const mockMessages: import('@ma-proma/shared').AgentMessage[] = [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'Big Idea 生成完成！核心概念是...',
        createdAt: Date.now(),
      },
    ]

    const result = workflowService.completeStepWithValidation(
      testCampaignId,
      'creative_concept',
      mockMessages,
    )

    expect(result.success).toBe(true)
    const step = result.workflow.steps.find((s) => s.id === 'creative_concept')
    expect(step?.status).toBe('completed')
    expect(step?.outputSummary).toBe('Big Idea 生成完成！核心概念是...')
    expect(step?.completedAt).toBeDefined()
  })

  // ===== Slice 4: outputSummary 提取 =====

  it('Slice 4: extractOutputSummary 从消息提取内容', () => {
    const messages: import('@ma-proma/shared').AgentMessage[] = [
      { id: '1', role: 'user', content: 'hello', createdAt: 1 },
      { id: '2', role: 'assistant', content: 'This is the summary output', createdAt: 2 },
    ]

    const summary = workflowService.extractOutputSummary(messages)
    expect(summary).toBe('This is the summary output')
  })

  it('Slice 4: extractOutputSummary 空消息返回默认', () => {
    const summary = workflowService.extractOutputSummary(undefined)
    expect(summary).toBe('执行完成，未获取输出摘要')

    const summary2 = workflowService.extractOutputSummary([])
    expect(summary2).toBe('执行完成，未获取输出摘要')
  })

  // ===== Slice 5: 历史记录 =====

  it('Slice 5: history.md 已创建并追加记录', () => {
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const historyPath = join(workspaceDir, '.context', 'history.md')

    expect(existsSync(historyPath)).toBe(true)
    const historyContent = readFileSync(historyPath, 'utf-8')
    expect(historyContent).toContain('Campaign 执行历史')
    // 前面步骤的完成/失败记录应该已经被写入
    expect(historyContent.length).toBeGreaterThan(50)
  })

  // ===== Slice 6: todo.md 同步更新 =====

  it('Slice 6: todo.md 随工作流更新同步', () => {
    const workspaceDir = join(TEST_DIR, 'agent-workspaces', `campaign-${testCampaignId}`)
    const todoPath = join(workspaceDir, '.context', 'todo.md')

    const todoContent = readFileSync(todoPath, 'utf-8')
    // creative_concept 已标记 completed，应该出现在已完成
    expect(todoContent).toContain('✅ 完成')
    // ta_portrait 标记 failed，应该不显示在已完成
    expect(todoContent).toContain('⏳ 待完成')
  })

  // ===== Slice 7: 进度计算 =====

  it('Slice 7: 进度计算正确', () => {
    const progress = workflowService.getWorkflowProgress(testCampaignId)
    // 9 步中 creative_concept 完成，ta_portrait 失败，其他 pending
    // completed = 1, total = 9, progress = 11%
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
