/**
 * CampaignWorkflowService 单元测试
 *
 * 使用内存 FileProvider 验证工作流状态机与 Workspace 文件同步。
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FileEntry, FileProvider, PickedFile } from '../files/types.ts'
import type { CampaignWorkflowStepId } from '@ma-proma/shared'
import type { AppContext } from '../context/types.ts'
import { CampaignWorkflowService } from './campaign-workflow-service.ts'
import { CampaignArtifactValidator } from './campaign-artifact-validator.ts'

class InMemoryFileProvider implements FileProvider {
  private files = new Map<string, string>()
  private dirs = new Set<string>()

  async pickFile(): Promise<PickedFile[]> {
    return []
  }

  async pickFolder(): Promise<string | null> {
    return null
  }

  async readTextFile(path: string): Promise<string> {
    const content = this.files.get(path)
    if (content === undefined) throw new Error(`文件不存在: ${path}`)
    return content
  }

  async readFileAsBase64(): Promise<string> {
    throw new Error('未实现')
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    this.files.set(path, content)
    this.ensureDir(join(path, '..'))
  }

  async listDirectory(path: string): Promise<FileEntry[]> {
    const prefix = path.endsWith('/') ? path : `${path}/`
    const entries = new Map<string, FileEntry>()
    const now = Date.now()

    for (const [filePath, content] of this.files.entries()) {
      if (!filePath.startsWith(prefix)) continue
      const relative = filePath.slice(prefix.length)
      if (!relative || relative.includes('/')) continue
      entries.set(relative, {
        name: relative,
        path: filePath,
        isDirectory: false,
        size: content.length,
        modifiedAt: now,
      })
    }

    for (const dir of this.dirs) {
      if (!dir.startsWith(prefix)) continue
      const relative = dir.slice(prefix.length)
      if (!relative || relative.includes('/')) continue
      entries.set(relative, {
        name: relative,
        path: dir,
        isDirectory: true,
        size: 0,
        modifiedAt: now,
      })
    }

    return Array.from(entries.values())
  }

  async listDirectoryRecursive(path: string): Promise<FileEntry[]> {
    const result: FileEntry[] = []
    const direct = await this.listDirectory(path)
    for (const entry of direct) {
      result.push(entry)
      if (entry.isDirectory) {
        result.push(...(await this.listDirectoryRecursive(entry.path)))
      }
    }
    return result
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path)
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path)
    this.ensureDir(join(path, '..'))
  }

  async remove(): Promise<void> {
    // 测试内不需要
  }

  async openExternal(): Promise<void> {
    throw new Error('未实现')
  }

  private ensureDir(path: string): void {
    this.dirs.add(path)
  }
}

function createTestContext(): AppContext {
  const dir = mkdtempSync(join(tmpdir(), 'mapro-campaign-workflow-'))
  return {
    getConfigDir: () => dir,
    getResourcesPath: () => join(dir, 'resources'),
    isPackaged: () => false,
  }
}

describe('CampaignWorkflowService', () => {
  let context: AppContext
  let files: InMemoryFileProvider
  let service: CampaignWorkflowService

  beforeEach(() => {
    context = createTestContext()
    files = new InMemoryFileProvider()
    service = new CampaignWorkflowService(context, files)
  })

  afterEach(() => {
    // 每次测试结束后清理临时目录
    const dir = context.getConfigDir()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 内存 FileProvider 可能未真实创建目录，忽略
    }
  })

  test('首次加载时创建默认 14 步工作流', async () => {
    const workflow = await service.loadCampaignWorkflow('test-1')
    expect(workflow.campaignId).toBe('test-1')
    expect(workflow.steps).toHaveLength(14)
    expect(workflow.currentStepIndex).toBe(-1)
    expect(workflow.steps[0]?.id).toBe('market_analysis')
    expect(workflow.steps[workflow.steps.length - 1]?.id).toBe('ab_test')
  })

  test('加载后自动同步 todo.md 与 campaign.md', async () => {
    await service.loadCampaignWorkflow('test-1')
    const baseDir = join(context.getConfigDir(), 'agent-workspaces', 'campaign-test-1')
    const todoExists = await files.exists(join(baseDir, '.context', 'todo.md'))
    const campaignMdExists = await files.exists(join(baseDir, '.context', 'campaign.md'))
    expect(todoExists).toBe(true)
    expect(campaignMdExists).toBe(true)
  })

  test('推进工作流会更新当前步骤与下一步骤状态', async () => {
    const workflow = await service.advanceWorkflow({
      campaignId: 'test-1',
      stepId: 'market_analysis',
      nextStepId: 'competitor_analysis',
    })
    expect(workflow.steps[0]?.status).toBe('completed')
    expect(workflow.steps[0]?.completedAt).toBeGreaterThan(0)
    expect(workflow.steps[1]?.status).toBe('in_progress')
    expect(workflow.currentStepIndex).toBe(1)
  })

  test('更新步骤状态为 in_progress 会设置当前步骤索引', async () => {
    const workflow = await service.updateWorkflowStep({
      campaignId: 'test-1',
      stepId: 'competitor_analysis',
      status: 'in_progress',
    })
    expect(workflow.currentStepIndex).toBe(1)
    expect(workflow.steps[1]?.status).toBe('in_progress')
  })

  test('重置工作流会清空所有状态', async () => {
    await service.advanceWorkflow({
      campaignId: 'test-1',
      stepId: 'market_analysis',
      nextStepId: 'competitor_analysis',
    })
    const reset = await service.resetWorkflow('test-1')
    expect(reset.currentStepIndex).toBe(-1)
    expect(reset.steps.every((s) => s.status === 'pending')).toBe(true)
  })

  test('查询当前步骤与完成进度', async () => {
    await service.advanceWorkflow({
      campaignId: 'test-1',
      stepId: 'market_analysis',
      nextStepId: 'competitor_analysis',
    })
    const current = await service.getCurrentStep('test-1')
    expect(current?.id).toBe('competitor_analysis')

    const progress = await service.getWorkflowProgress('test-1')
    expect(progress).toBeGreaterThan(0)

    const completed = await service.getCompletedSteps('test-1')
    expect(completed).toHaveLength(1)
  })

  test('获取步骤 Agent Prompt 支持上下文替换', async () => {
    const prompt = await service.getStepAgentPrompt('test-1', 'kol_pyramid', { budget: '100000' })
    expect(prompt).toContain('100000')
    expect(prompt).not.toContain('{budget}')
  })

  test('持久化后重新加载保持状态', async () => {
    await service.advanceWorkflow({
      campaignId: 'test-1',
      stepId: 'market_analysis',
      nextStepId: 'competitor_analysis',
    })

    const service2 = new CampaignWorkflowService(context, files)
    const workflow = await service2.loadCampaignWorkflow('test-1')
    expect(workflow.steps[0]?.status).toBe('completed')
    expect(workflow.steps[1]?.status).toBe('in_progress')
  })

  test('并发更新步骤串行执行（互斥锁防 lost update）', async () => {
    await service.loadCampaignWorkflow('test-concurrent')

    // 三个步骤并发标记完成：无锁时各自读到相同基态会互相覆盖，有锁后串行累积
    await Promise.all([
      service.updateWorkflowStep({ campaignId: 'test-concurrent', stepId: 'market_analysis', status: 'completed' }),
      service.updateWorkflowStep({ campaignId: 'test-concurrent', stepId: 'competitor_analysis', status: 'completed' }),
      service.updateWorkflowStep({ campaignId: 'test-concurrent', stepId: 'user_analysis', status: 'completed' }),
    ])

    const workflow = await service.loadCampaignWorkflow('test-concurrent')
    expect(workflow.steps.find((s) => s.id === 'market_analysis')?.status).toBe('completed')
    expect(workflow.steps.find((s) => s.id === 'competitor_analysis')?.status).toBe('completed')
    expect(workflow.steps.find((s) => s.id === 'user_analysis')?.status).toBe('completed')
  })

  test('校验不存在的步骤会抛出错误', async () => {
    const validator = new CampaignArtifactValidator(context, files)
    const serviceWithValidator = new CampaignWorkflowService(context, files, validator)
    await expect(serviceWithValidator.validateStepArtifacts('test-1', 'not_a_step' as CampaignWorkflowStepId)).rejects.toThrow('步骤不存在')
  })
})


describe('CampaignArtifactValidator', () => {
  let context: AppContext
  let files: InMemoryFileProvider
  let validator: CampaignArtifactValidator
  let workflowService: CampaignWorkflowService

  beforeEach(() => {
    context = createTestContext()
    files = new InMemoryFileProvider()
    validator = new CampaignArtifactValidator(context, files)
    workflowService = new CampaignWorkflowService(context, files, validator)
  })

  afterEach(() => {
    const dir = context.getConfigDir()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  function writeArtifact(campaignId: string, stepDir: string, filename: string, content: string): void {
    const baseDir = join(context.getConfigDir(), 'agent-workspaces', `campaign-${campaignId}`, stepDir)
    const path = join(baseDir, filename)
    files.writeTextFile(path, content)
  }

  test('空目录 → 校验失败', async () => {
    const workflow = await workflowService.loadCampaignWorkflow('test-2')
    const step = workflow.steps.find((s) => s.id === 'market_analysis')!
    const result = await validator.validateStepArtifacts('test-2', 'market_analysis', step)
    expect(result.valid).toBe(false)
    expect(result.missing.some((m) => m.includes('没有可读产物'))).toBe(true)
  })

  test('缺少语义锚点 → 校验失败', async () => {
    const workflow = await workflowService.loadCampaignWorkflow('test-2')
    const step = workflow.steps.find((s) => s.id === 'market_analysis')!
    writeArtifact(
      'test-2',
      'market-analysis',
      'market-analysis.md',
      '这是一段没有关键词的内容，字数应该够三百字。'.repeat(20),
    )
    const result = await validator.validateStepArtifacts('test-2', 'market_analysis', step)
    expect(result.valid).toBe(false)
    expect(result.missing.some((m) => m.includes('语义锚点'))).toBe(true)
  })

  test('缺少必需产物文件 → 校验失败', async () => {
    const workflow = await workflowService.loadCampaignWorkflow('test-2')
    const step = workflow.steps.find((s) => s.id === 'user_analysis')!
    // 只写 ta-portrait.md，不写 search-habits.md
    writeArtifact(
      'test-2',
      'user-analysis',
      'ta-portrait.md',
      '人口统计、兴趣偏好、痛点需求、搜索习惯等内容的用户分析文档。'.repeat(20),
    )
    const result = await validator.validateStepArtifacts('test-2', 'user_analysis', step)
    expect(result.valid).toBe(false)
    expect(result.missing.some((m) => m.includes('search-habits.md'))).toBe(true)
  })

  test('合格内容 → 校验通过', async () => {
    const workflow = await workflowService.loadCampaignWorkflow('test-2')
    const step = workflow.steps.find((s) => s.id === 'market_analysis')!
    const content = [
      '市场规模：本品类市场规模达到 100 亿元，年增速 20%，市场容量持续扩大，大盘表现稳健，未来三年有望继续保持双位数增长。',
      '品类趋势：当前处于上升周期，用户偏好明显向高端化转移，趋势机会不断涌现，品牌应抓住窗口期建立先发优势。',
      '品类痛点：用户当前未被满足的需求是更高效的解决方案，存在明显的空白切入机会，亟需通过产品创新与服务升级解决实际问题。',
      '补充说明：随着消费者认知提升，品类渗透率有望进一步提高，为品牌提供增长空间，同时也对营销精准度提出更高要求。',
      '数据来源：艾瑞咨询、36氪、蝉妈妈。',
    ].join('\n\n')
    writeArtifact('test-2', 'market-analysis', 'market-analysis.md', content.repeat(2))
    const result = await validator.validateStepArtifacts('test-2', 'market_analysis', step)
    expect(result.valid).toBe(true)
    expect(result.totalChars).toBeGreaterThan(0)
  })

  test('Agent 输出兜底落盘', async () => {
    const messages = [{ id: '1', role: 'assistant' as const, content: '市场规模 100 亿，品类趋势上升，品类痛点未被满足。', createdAt: Date.now() }]
    await validator.materializeAssistantOutputIfNeeded('test-2', 'market_analysis', '市场分析', messages)
    const baseDir = join(context.getConfigDir(), 'agent-workspaces', 'campaign-test-2', 'market-analysis')
    const exists = await files.exists(join(baseDir, 'agent-output.md'))
    expect(exists).toBe(true)
  })

  test('completeStep 产物为空时标记 failed', async () => {
    const result = await workflowService.completeStep('test-2', 'market_analysis', [])
    expect(result.success).toBe(false)
    expect(result.workflow.steps[0]?.status).toBe('failed')
  })

  test('completeStep 有合格产物时标记 completed', async () => {
    const content = [
      '市场规模：本品类市场规模达到 100 亿元，年增速 20%，市场容量持续扩大，大盘表现稳健，未来三年有望继续保持双位数增长。',
      '品类趋势：当前处于上升周期，用户偏好明显向高端化转移，趋势机会不断涌现，品牌应抓住窗口期建立先发优势。',
      '品类痛点：用户当前未被满足的需求是更高效的解决方案，存在明显的空白切入机会，亟需通过产品创新与服务升级解决实际问题。',
      '补充说明：随着消费者认知提升，品类渗透率有望进一步提高，为品牌提供增长空间，同时也对营销精准度提出更高要求。',
      '数据来源：艾瑞咨询、36氪、蝉妈妈。',
    ].join('\n\n')
    writeArtifact('test-2', 'market-analysis', 'market-analysis.md', content.repeat(2))
    const messages = [{ id: '2', role: 'assistant' as const, content: '市场分析完成', createdAt: Date.now() }]
    const result = await workflowService.completeStep('test-2', 'market_analysis', messages)
    expect(result.success).toBe(true)
    expect(result.workflow.steps[0]?.status).toBe('completed')
  })
})
