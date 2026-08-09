/**
 * Campaign 产物校验引擎（基于 FileProvider 抽象）
 *
 * 阶段 B2 Slice 2：
 * - 从 Electron 主进程迁移产物校验逻辑。
 * - 5 层校验：目录存在 → 可读文本文件 → 文件非空 → 总字数 ≥ minArtifactLength → 语义锚点覆盖。
 * - 支持 Agent 输出兜底落盘（materializeAssistantOutputIfNeeded）。
 */

import { join } from 'node:path'
import type { AgentMessage, ArtifactRequirement, CampaignWorkflowStep, CampaignWorkflowStepId } from '@ma-proma/shared'
import type { AppContext } from '../context/types.ts'
import type { FileProvider } from '../files/types.ts'
import { getAgentWorkspacePath } from '../context/config-paths.ts'
import { STEP_DIR_MAP } from './campaign-workflow-service.ts'

export interface ArtifactValidationResult {
  valid: boolean
  files: string[]
  totalChars: number
  missing: string[]
  unmetRequirements: ArtifactRequirement[]
}

export class CampaignArtifactValidator {
  private context: AppContext
  private files: FileProvider

  constructor(context: AppContext, files: FileProvider) {
    this.context = context
    this.files = files
  }

  async validateStepArtifacts(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    step?: Pick<CampaignWorkflowStep, 'minArtifactLength' | 'artifactRequirements' | 'requiredFiles'>,
  ): Promise<ArtifactValidationResult> {
    const dirName = STEP_DIR_MAP[stepId]
    if (!dirName) {
      throw new Error(`未知步骤 ID: ${stepId}`)
    }
    const dirPath = join(this.getWorkspacePath(campaignId), dirName)
    const workspaceRoot = this.getWorkspacePath(campaignId)

    const missing: string[] = []
    const unmetRequirements: ArtifactRequirement[] = []

    // 1. 检查目录存在
    const dirExists = await this.files.exists(dirPath)
    if (!dirExists) {
      missing.push(`${dirName}/ 目录不存在`)
    }

    // 2. 读取目标目录文本文件（递归）
    let scan = await this.readTextFiles(dirPath)

    // 3. 如果目标目录为空，尝试在工作区根目录搜索相关文件（fallback）
    if (scan.files.length === 0) {
      const rootScan = await this.readTextFiles(workspaceRoot)
      const stepKeywords = [dirName, stepId.replace('_', '-')]
      const relatedFiles = rootScan.files.filter((f) =>
        stepKeywords.some((kw) => f.toLowerCase().includes(kw.toLowerCase())),
      )
      if (relatedFiles.length > 0) {
        scan = {
          files: relatedFiles,
          totalChars: rootScan.totalChars,
          combinedContent: rootScan.combinedContent,
        }
      }
    }

    // 4. 检查是否有文本文件
    if (scan.files.length === 0) {
      missing.push(`${dirName}/ 目录中没有可读产物（文本文件）`)
    }

    // 5. 检查必需文件是否存在
    const requiredFiles = step?.requiredFiles ?? []
    for (const requiredFile of requiredFiles) {
      const exists = scan.files.some((f) => f.toLowerCase() === requiredFile.toLowerCase())
      if (!exists) {
        missing.push(`${dirName}/ 缺少必需产物文件: ${requiredFile}`)
      }
    }

    // 6. 检查文件非空
    if (scan.totalChars === 0) {
      missing.push(`${dirName}/ 目录中文件均为空`)
    }

    // 7. 检查字数
    const minLength = step?.minArtifactLength ?? 300
    if (scan.totalChars < minLength) {
      missing.push(`${dirName}/ 总字数 ${scan.totalChars} 低于最低要求 ${minLength} 字`)
    }

    // 8. 检查语义锚点（软校验：缺失仅作质量提醒，不进入 missing，不判定产物失败）
    const requirements = step?.artifactRequirements ?? []
    for (const req of requirements) {
      if (!this.checkRequirement(scan.combinedContent, req)) {
        unmetRequirements.push(req)
      }
    }

    return {
      valid: missing.length === 0,
      files: scan.files,
      totalChars: scan.totalChars,
      missing,
      unmetRequirements,
    }
  }

  async extractOutputSummary(messages: AgentMessage[] | undefined): Promise<string> {
    if (!messages || messages.length === 0) return '执行完成，未获取输出摘要'

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (!msg) continue
      const text = typeof msg.content === 'string' ? msg.content : ''
      if (text.trim()) {
        return text.trim().slice(0, 200)
      }
    }

    return '执行完成'
  }

  /**
   * 兜底产物落盘：如果 Agent 只在对话里输出内容、没有写入文件，则将输出保存为该步骤产物。
   */
  async materializeAssistantOutputIfNeeded(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    stepTitle: string,
    messages: AgentMessage[] | undefined,
  ): Promise<void> {
    const dirName = STEP_DIR_MAP[stepId]
    const dirPath = join(this.getWorkspacePath(campaignId), dirName)
    const existing = await this.readTextFiles(dirPath)

    if (existing.files.length > 0 && existing.totalChars > 0) return

    const output = this.extractAssistantOutput(messages)
    if (!output) return

    await this.files.mkdir(dirPath)
    const content = `# ${stepTitle}\n\n${output}\n`
    await this.files.writeTextFile(join(dirPath, 'agent-output.md'), content)
  }

  // -----------------------------------------------------------------
  // 内部工具
  // -----------------------------------------------------------------

  private getWorkspacePath(campaignId: string): string {
    return getAgentWorkspacePath(this.context, `campaign-${campaignId}`)
  }

  private checkRequirement(content: string, req: ArtifactRequirement): boolean {
    const lower = content.toLowerCase()
    return req.aliases.some((alias) => lower.includes(alias.toLowerCase()))
  }

  private isTextFile(filename: string): boolean {
    if (filename.startsWith('.')) return false
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (!ext) return true
    const textExts = ['md', 'txt', 'json', 'yaml', 'yml', 'csv', 'tsv', 'xml', 'html', 'css', 'js', 'ts']
    return textExts.includes(ext)
  }

  private async readTextFiles(dirPath: string): Promise<{ files: string[]; totalChars: number; combinedContent: string }> {
    const files: string[] = []
    let totalChars = 0
    let combinedContent = ''

    const dirExists = await this.files.exists(dirPath)
    if (!dirExists) return { files, totalChars, combinedContent }

    const walk = async (currentDir: string, prefix: string = ''): Promise<void> => {
      const entries = await this.files.listDirectory(currentDir)
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

        if (entry.isDirectory) {
          await walk(entry.path, relativePath)
        } else if (this.isTextFile(entry.name)) {
          try {
            const content = await this.files.readTextFile(entry.path)
            const trimmed = content.trim()
            if (trimmed.length > 0) {
              files.push(relativePath)
              totalChars += trimmed.length
              combinedContent += content + '\n'
            }
          } catch (err) {
            console.error(`[CampaignArtifactValidator] 读取文件失败: ${entry.path}`, err)
          }
        }
      }
    }

    await walk(dirPath)
    return { files, totalChars, combinedContent }
  }

  private extractAssistantOutput(messages: AgentMessage[] | undefined): string {
    if (!messages || messages.length === 0) return ''

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg?.role !== 'assistant') continue
      const text = typeof msg.content === 'string' ? msg.content : ''
      if (text.trim()) {
        return text.trim()
      }
    }

    return ''
  }
}
