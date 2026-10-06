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

  /** 确认 M0 对齐门，使工作流可推进（新 Campaign 默认 M0 未决） */
  async function confirmM0(campaignId: string) {
    const workflow = await service.loadCampaignWorkflow(campaignId)
    const m0 = (workflow.confirmations ?? []).find((i) => i.source === 'm0')
    if (m0) {
      await service.confirmWorkflowItem({ campaignId, itemId: m0.id, behavior: 'confirm' })
    }
  }

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
    await confirmM0('test-1')
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
    await confirmM0('test-1')
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
    await confirmM0('test-1')
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
    await confirmM0('test-1')
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

describe('CampaignWorkflowService · 确认状态（M0 门 + confidence_gate）', () => {
  let context: AppContext
  let files: InMemoryFileProvider
  let service: CampaignWorkflowService

  beforeEach(() => {
    context = createTestContext()
    files = new InMemoryFileProvider()
    service = new CampaignWorkflowService(context, files)
  })

  afterEach(() => {
    const dir = context.getConfigDir()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  /** 写入某步骤产物文件 */
  async function writeArtifact(campaignId: string, dirName: string, file: string, content: string) {
    const path = join(context.getConfigDir(), 'agent-workspaces', `campaign-${campaignId}`, dirName, file)
    await files.writeTextFile(path, content)
  }

  test('新建工作流因 M0 未对齐而默认存在阻断项', async () => {
    const workflow = await service.loadCampaignWorkflow('conf-empty')
    expect(workflow.confirmations ?? []).toHaveLength(1)
    expect((workflow.confirmations ?? [])[0]?.source).toBe('m0')
    expect(await service.listBlockingConfirmations('conf-empty')).toHaveLength(1)
  })

  test('无 M0 未决迹象时不产生 M0 阻断项', async () => {
    // brand-dna 产物存在且不含 [假设]+M0 组合 → 视为已对齐
    await writeArtifact(
      'conf-aligned',
      'brand-dna',
      'brand-dna.md',
      '# 品牌DNA\nM0 对齐卡已确认，五类形态假设均[已验证]。',
    )
    const workflow = await service.loadCampaignWorkflow('conf-aligned')
    const m0Items = (workflow.confirmations ?? []).filter((i) => i.source === 'm0')
    expect(m0Items).toHaveLength(0)
  })

  test('M0 缺失时，推进到研究步骤被阻断', async () => {
    await service.loadCampaignWorkflow('conf-m0')
    // 未写入任何 M0/品牌产物 → 视为未决
    await expect(
      service.advanceWorkflow({
        campaignId: 'conf-m0',
        stepId: 'market_analysis',
        nextStepId: 'competitor_analysis',
      }),
    ).rejects.toThrow(/确认门/)
  })

  test('确认 M0 后可正常推进', async () => {
    await service.loadCampaignWorkflow('conf-m0-ok')
    const blockers = await service.listBlockingConfirmations('conf-m0-ok')
    expect(blockers.length).toBeGreaterThan(0)
    await service.confirmWorkflowItem({
      campaignId: 'conf-m0-ok',
      itemId: blockers[0]!.id,
      behavior: 'confirm',
      confirmedBy: 'tester',
    })
    expect(await service.listBlockingConfirmations('conf-m0-ok')).toHaveLength(0)
    const workflow = await service.advanceWorkflow({
      campaignId: 'conf-m0-ok',
      stepId: 'market_analysis',
      nextStepId: 'competitor_analysis',
    })
    expect(workflow.steps[0]?.status).toBe('completed')
  })

  test('产物含 [假设] 标注时产生置信门，确认后放行', async () => {
    await service.loadCampaignWorkflow('conf-gate')
    await writeArtifact('conf-gate', 'user-analysis', 'consumer-insight.md', '# 洞察\n该结论为[假设]，待验证。')
    const workflow = await service.loadCampaignWorkflow('conf-gate')
    const gate = (workflow.steps.find((s) => s.id === 'user_analysis')?.confirmations ?? []).find(
      (i) => i.source === 'confidence_gate',
    )
    expect(gate).toBeDefined()
    expect(gate?.blocking).toBe(true)

    await service.confirmWorkflowItem({ campaignId: 'conf-gate', itemId: gate!.id, behavior: 'confirm' })
    const after = await service.loadCampaignWorkflow('conf-gate')
    const gateAfter = (after.steps.find((s) => s.id === 'user_analysis')?.confirmations ?? []).find(
      (i) => i.id === gate!.id,
    )
    expect(gateAfter?.status).toBe('confirmed')
  })

  test('确认状态持久化：重新实例化服务后仍为 confirmed', async () => {
    await service.loadCampaignWorkflow('conf-persist')
    const blockers = await service.listBlockingConfirmations('conf-persist')
    await service.confirmWorkflowItem({ campaignId: 'conf-persist', itemId: blockers[0]!.id, behavior: 'confirm' })

    const service2 = new CampaignWorkflowService(context, files)
    const reloaded = await service2.loadCampaignWorkflow('conf-persist')
    const item = (reloaded.confirmations ?? []).find((i) => i.id === blockers[0]!.id)
    expect(item?.status).toBe('confirmed')
    expect(item?.confirmedAt).toBeGreaterThan(0)
  })

  test('确认不存在的项会抛出错误', async () => {
    await service.loadCampaignWorkflow('conf-missing')
    await expect(
      service.confirmWorkflowItem({ campaignId: 'conf-missing', itemId: 'not_exist', behavior: 'confirm' }),
    ).rejects.toThrow(/确认项不存在/)
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

  test('缺少语义锚点 → 软校验（产物通过但记录提醒）', async () => {
    const workflow = await workflowService.loadCampaignWorkflow('test-2')
    const step = workflow.steps.find((s) => s.id === 'market_analysis')!
    writeArtifact(
      'test-2',
      'market-analysis',
      'market-analysis.md',
      '这是一段没有关键词的内容，字数应该够三百字。'.repeat(20),
    )
    const result = await validator.validateStepArtifacts('test-2', 'market_analysis', step)
    expect(result.valid).toBe(true)
    expect(result.missing.some((m) => m.includes('语义锚点'))).toBe(false)
    expect(result.unmetRequirements.length).toBeGreaterThan(0)
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

  // 回归护栏：按【修复后 skill 落盘规范】构造市场/用户/品牌DNA/品牌核实四步合格产物，
  // 必须全部通过校验（对应真实缺陷：market-analysis 无工具产物字数不足、user-analysis 缺
  // requiredFiles、brand-dna 缺产品服务/产品现状锚点、brand-fact-check 缺必备文件）。
  test('回归：四步合格产物（市场/用户/品牌DNA/品牌核实）全部通过校验', async () => {
    const workflow = await workflowService.loadCampaignWorkflow('test-4step')

    const market = [
      '# 市场分析',
      '## 市场规模',
      '市场规模：本品类市场规模达到 120 亿元，年增速 22%，渗透率持续提升，市场容量不断扩张，大盘整体稳健增长，细分赛道中高端占比持续抬升，未来三年有望保持双位数增长。',
      '## 品类趋势',
      '品类趋势：当前处于上升周期，用户偏好明显向品质化、健康化转移，趋势机会不断涌现，平台流量红利叠加政策驱动，品牌应抓住窗口期建立先发优势，跟上偏好变化节奏。',
      '## 品类痛点',
      '品类痛点：用户当前未被满足的需求是更便捷、更透明的解决方案，行业普遍存在信息不对称问题，存在明显的空白切入点，亟需通过产品创新与服务升级解决实际痛点。',
      '## 数据来源',
      '艾瑞咨询、36氪、蝉妈妈（部分为推算/待核实）。',
    ].join('\n\n')
    writeArtifact('test-4step', 'market-analysis', 'market-analysis.md', market)

    const taPortrait = [
      '## 人口统计',
      '年龄 25-35 岁，性别以女性为主（70%），月收入 1-3 万，一二线城市，地域华东华南，学历本科以上，职业为白领。',
      '## 兴趣偏好',
      '兴趣集中在品质生活、美食探店，偏好精致生活方式，消费观为愿意为体验付费。',
      '## 痛点需求',
      '痛点：忙没时间做功课、怕踩雷；需求是高效可靠的决策方案，购买动机为悦己与分享。',
    ].join('\n\n')
    const searchHabits = [
      '## 搜索平台',
      '主要在小红书、抖音、B站、百度搜索。',
      '## 搜索场景',
      '种草前搜索攻略、决策中搜索测评、使用后搜索售后。',
      '## 搜索关键词',
      '核心词、长尾词、竞品词。',
    ].join('\n\n')
    const consumerInsight = [
      '## 消费者洞察',
      'Observation：用户在平台高频收藏“高级感”“不踩雷”笔记；Insight：她们不缺商品，缺“体面又省心”的身份安全感。',
      '## 传播切入点',
      '以“每天多睡 20 分钟也能选对”作为内容主轴。',
    ].join('\n\n')
    writeArtifact('test-4step', 'user-analysis', 'ta-portrait.md', taPortrait)
    writeArtifact('test-4step', 'user-analysis', 'search-habits.md', searchHabits)
    writeArtifact('test-4step', 'user-analysis', 'consumer-insight.md', consumerInsight)

    const brandDna = [
      '# 品牌DNA',
      '## 品牌历史',
      '品牌创立于 2015 年，从区域市场逐步走向全国，历经多轮产品迭代与渠道扩张，积累了一定的品牌传承与口碑沉淀，形成以品质为核心的经营理念。',
      '## 产品/服务',
      '核心产品线覆盖多款差异化产品，功能卖点突出，价格带覆盖中端与高端，产品线结构合理，主打品质与体验，产品服务经过多轮迭代持续优化。',
      '## 品牌核心价值',
      '核心价值是让用户省心的品质选择，附加价值是悦己与分享。',
      '## 产品现状',
      '产品力处于行业中上，供应链稳定可控，价格带与目标客群匹配，SKU 数量适中，产品诊断显示供应链效率仍有提升空间。',
      '## 差异化优势',
      '相比竞品，独特性在于更透明的信息与更省心的服务闭环。',
      '## 品牌阶段 / 核心问题 / 核心目标',
      '品牌处于成长期，核心问题是品牌认知不足，核心目标是破圈拉新，首要提升认知度与复购。',
    ].join('\n\n')
    writeArtifact('test-4step', 'brand-dna', 'brand-dna.md', brandDna)

    const brandFactCheck = [
      '# 品牌信息核实',
      '## 核实结论',
      '经公开网络搜索对品牌DNA 提取的关键信息逐条核对：品牌创立时间、发展历程、核心产品线等基本信息基本确认属实；而部分价格带区间、供应链合作方、门店数量等经营细节无法通过公开渠道完全确认，需向品牌方进一步求证补充。',
      '## 搜索来源',
      '本次核实使用的搜索查询来源包括：品牌官方网站（About 页与产品页）、百度百科品牌词条、36氪与界面新闻的相关报道、企查查工商信息、社交媒体官方账号简介等，均已列出查询词与参考链接。',
      '## 差异项',
      '搜索与品牌DNA 产物逐条对比后发现以下差异项：一是品牌创立时间在官方与第三方报道中存在一处口径不一致，属于明显矛盾点；二是价格带区间与公开价格信息略有偏差，区间上沿或下沿不一致；三是供应链合作方名称拼写存在出入，需逐一与品牌方核实。',
      '## 风险提示',
      '由于多维度关键信息存在无法核实或口径差异，明确提示：用户提供的信息可能存在误差，建议在后续步骤中补充或修正，尤其是创立时间、价格带与供应链等会直接影响品牌定位与传播断言的事实性信息。',
    ].join('\n\n')
    writeArtifact('test-4step', 'brand-fact-check', 'brand-fact-check.md', brandFactCheck)

    for (const stepId of ['market_analysis', 'user_analysis', 'brand_dna', 'brand_fact_check'] as const) {
      const step = workflow.steps.find((s) => s.id === stepId)!
      const result = await validator.validateStepArtifacts('test-4step', stepId, step)
      expect(result.valid).toBe(true)
    }
  })
})
