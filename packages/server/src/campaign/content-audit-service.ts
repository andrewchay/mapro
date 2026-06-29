/**
 * ContentAuditService - 内容审核服务
 *
 * 为 Campaign 提供 KOL 内容审核能力：
 * - 优先使用已配置的 ChatProvider（MAPRO_CHAT_PROVIDER / MAPRO_CHAT_API_KEY）调用 LLM
 * - 未配置 LLM 时使用本地规则打分，保证功能可用
 * - 审核结果持久化到 content_audits 表
 */

import { getAdapter, streamSSE } from '@ma-proma/core'
import type { ContentAudit, CreateContentAuditInput, ProviderType } from '@ma-proma/shared'
import type { ChatProviderConfig } from '../chat/types.ts'
import type { CampaignRepository } from './campaign-repository.ts'

export interface AuditScores {
  auditStatus: ContentAudit['auditStatus']
  complianceScore: number
  brandAlignmentScore: number
  qualityScore: number
  overallScore: number
  auditReport: string
  auditor: string
}

export class ContentAuditService {
  private config: ChatProviderConfig | null
  private repository: CampaignRepository

  constructor(config: ChatProviderConfig | null, repository: CampaignRepository) {
    this.config = config
    this.repository = repository
  }

  async audit(input: CreateContentAuditInput): Promise<ContentAudit> {
    const scores = await this.evaluate(input)
    return this.repository.createContentAudit({ ...input, ...scores })
  }

  async listAudits(campaignId: string): Promise<ContentAudit[]> {
    return this.repository.listContentAudits(campaignId)
  }

  private async evaluate(input: CreateContentAuditInput): Promise<AuditScores> {
    if (this.config) {
      try {
        return await this.evaluateWithLLM(input)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn('[ContentAuditService] LLM 审核失败，回退到规则打分:', message)
      }
    }
    return this.evaluateWithRules(input)
  }

  private async evaluateWithLLM(input: CreateContentAuditInput): Promise<AuditScores> {
    if (!this.config) {
      throw new Error('LLM 未配置')
    }

    const systemPrompt = buildSystemPrompt()
    const userPrompt = buildAuditPrompt(input)

    const adapter = getAdapter(this.config.provider as ProviderType)
    const request = adapter.buildStreamRequest({
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      modelId: this.config.modelId,
      history: [],
      userMessage: userPrompt,
      systemMessage: systemPrompt,
      readImageAttachments: () => [],
      thinkingEnabled: false,
    })

    const result = await streamSSE({ request, adapter, onEvent: () => {} })
    const audit = extractJSON(result.content) as Record<string, unknown>

    const overallScore = normalizeScore(audit.overall_score)
    const compliance = audit.compliance_check as Record<string, unknown> | undefined
    const brandAlignment = audit.brand_alignment as Record<string, unknown> | undefined
    const quality = audit.quality_assessment as Record<string, unknown> | undefined

    const complianceScore = normalizeScore(compliance?.score)
    const brandAlignmentScore = normalizeScore(brandAlignment?.score)
    const qualityScore = normalizeScore(quality?.score)

    return {
      auditStatus: determineStatus(overallScore),
      complianceScore,
      brandAlignmentScore,
      qualityScore,
      overallScore,
      auditReport: formatAuditReport(input, audit),
      auditor: 'ai',
    }
  }

  private evaluateWithRules(input: CreateContentAuditInput): AuditScores {
    const desc = input.contentDescription
    const brand = input.brand
    const length = desc.length

    // 合规性：检测常见风险词与长度
    const riskWords = ['最', '第一', '国家级', '纯天然', '无副作用', '绝对', '保证治愈', '限时']
    const riskCount = riskWords.reduce((sum, word) => sum + (desc.includes(word) ? 1 : 0), 0)
    const complianceScore = Math.max(0, 100 - riskCount * 15)

    // 品牌契合：品牌名出现次数与产品关联
    const brandCount = (desc.match(new RegExp(brand, 'g')) ?? []).length
    const brandAlignmentScore = Math.min(100, 40 + brandCount * 20 + (desc.includes(input.product) ? 20 : 0))

    // 内容质量：基于长度与结构
    const hasStructure = /[\n\r]/.test(desc) || /[一二三四五六七八九十]/.test(desc)
    const qualityScore = Math.min(100, Math.max(30, Math.round(length / 5) + (hasStructure ? 20 : 0)))

    const overallScore = Math.round((complianceScore + brandAlignmentScore + qualityScore) / 3)

    return {
      auditStatus: determineStatus(overallScore),
      complianceScore,
      brandAlignmentScore,
      qualityScore,
      overallScore,
      auditReport: buildFallbackReport(input, complianceScore, brandAlignmentScore, qualityScore, overallScore),
      auditor: 'rule',
    }
  }
}

function buildSystemPrompt(): string {
  return `你是一位资深的内容审核专家，曾在大型 MCN 机构和品牌方担任内容风控总监。

请基于品牌需求和平台特性，对达人提交的内容进行多维度审核评估。

**审核维度：**
1. **合规性检查**：广告法合规、平台规范、虚假宣传风险、违禁词检测
2. **品牌契合度**：品牌信息准确性、产品卖点传达、品牌调性一致性
3. **内容质量**：创意水平、用户吸引力、内容结构、互动引导

**输出格式（严格 JSON）：**
{
  "audit_summary": "审核结论：通过/需修改/不通过",
  "compliance_check": {
    "score": 85,
    "issues": ["问题1", "问题2"],
    "suggestions": ["建议1"]
  },
  "brand_alignment": {
    "score": 90,
    "matches": ["符合点1"],
    "mismatches": ["不符合点1"]
  },
  "quality_assessment": {
    "score": 88,
    "strengths": ["优点1"],
    "weaknesses": ["不足1"]
  },
  "revision_suggestions": ["具体修改建议1", "修改建议2"],
  "overall_score": 88,
  "final_verdict": "通过，建议微调"
}

评分标准（0-100分）：
- 90-100：优秀，可直接发布
- 70-89：良好，需微调后发布
- 50-69：一般，需修改后重新审核
- 0-49：不合格，需大幅修改或拒绝`
}

function buildAuditPrompt(input: CreateContentAuditInput): string {
  const parts: string[] = [
    `请对以下内容进行审核评估：`,
    ``,
    `品牌：${input.brand}`,
    `产品：${input.product}`,
    `平台：${input.platform}`,
    `内容类型：${input.contentType}`,
  ]

  if (input.kolId) parts.push(`达人ID：${input.kolId}`)
  if (input.contentUrl) parts.push(`内容链接：${input.contentUrl}`)

  parts.push(``)
  parts.push(`内容描述/脚本：`)
  parts.push('```')
  parts.push(input.contentDescription)
  parts.push('```')
  parts.push(``)
  parts.push(`请从合规性、品牌契合度、内容质量三个维度进行详细审核，给出评分和具体修改建议。`)

  return parts.join('\n')
}

function normalizeScore(value: unknown): number {
  if (typeof value === 'number') return Math.max(0, Math.min(100, Math.round(value)))
  const parsed = Number(value)
  if (Number.isNaN(parsed)) return 0
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function determineStatus(overallScore: number): ContentAudit['auditStatus'] {
  if (overallScore >= 70) return 'passed'
  if (overallScore >= 50) return 'pending'
  return 'failed'
}

function formatAuditReport(input: CreateContentAuditInput, audit: Record<string, unknown>): string {
  const parts: string[] = []
  parts.push(`# ${input.brand} · ${input.product} — ${input.platform} ${input.contentType} 内容审核报告`)
  if (input.kolId) parts.push(`*达人ID：${input.kolId}*`)
  parts.push('')

  const summary = audit.audit_summary as string | undefined
  const overallScore = audit.overall_score as number | undefined
  const finalVerdict = audit.final_verdict as string | undefined

  parts.push(`## 📋 审核结论`)
  if (summary) parts.push(`**审核结果**：${summary}`)
  if (overallScore !== undefined) parts.push(`**综合评分**：${overallScore}/100`)
  if (finalVerdict) parts.push(`**最终判定**：${finalVerdict}`)
  parts.push('')

  const compliance = audit.compliance_check as Record<string, unknown> | undefined
  if (compliance) {
    parts.push(`## ⚖️ 合规性检查`)
    if (compliance.score !== undefined) parts.push(`**评分**：${compliance.score}/100`)
    const issues = compliance.issues as string[] | undefined
    if (issues && issues.length > 0) {
      parts.push(`**问题清单**：`)
      for (const issue of issues) parts.push(`  - ❌ ${issue}`)
    }
    const suggestions = compliance.suggestions as string[] | undefined
    if (suggestions && suggestions.length > 0) {
      parts.push(`**改进建议**：`)
      for (const s of suggestions) parts.push(`  - 💡 ${s}`)
    }
    parts.push('')
  }

  const brandAlignment = audit.brand_alignment as Record<string, unknown> | undefined
  if (brandAlignment) {
    parts.push(`## 🏷️ 品牌契合度`)
    if (brandAlignment.score !== undefined) parts.push(`**评分**：${brandAlignment.score}/100`)
    const matches = brandAlignment.matches as string[] | undefined
    if (matches && matches.length > 0) {
      parts.push(`**契合点**：`)
      for (const m of matches) parts.push(`  - ✅ ${m}`)
    }
    const mismatches = brandAlignment.mismatches as string[] | undefined
    if (mismatches && mismatches.length > 0) {
      parts.push(`**不符合点**：`)
      for (const m of mismatches) parts.push(`  - ⚠️ ${m}`)
    }
    parts.push('')
  }

  const quality = audit.quality_assessment as Record<string, unknown> | undefined
  if (quality) {
    parts.push(`## ✨ 内容质量评估`)
    if (quality.score !== undefined) parts.push(`**评分**：${quality.score}/100`)
    const strengths = quality.strengths as string[] | undefined
    if (strengths && strengths.length > 0) {
      parts.push(`**优点**：`)
      for (const s of strengths) parts.push(`  - ⭐ ${s}`)
    }
    const weaknesses = quality.weaknesses as string[] | undefined
    if (weaknesses && weaknesses.length > 0) {
      parts.push(`**不足**：`)
      for (const w of weaknesses) parts.push(`  - 🔧 ${w}`)
    }
    parts.push('')
  }

  const revisions = audit.revision_suggestions as string[] | undefined
  if (revisions && revisions.length > 0) {
    parts.push(`## 📝 具体修改建议`)
    for (let i = 0; i < revisions.length; i++) {
      parts.push(`${i + 1}. ${revisions[i]}`)
    }
    parts.push('')
  }

  parts.push(`---`)
  parts.push(`**评分参考**：`)
  parts.push(`- 90-100分：优秀，可直接发布`)
  parts.push(`- 70-89分：良好，需微调后发布`)
  parts.push(`- 50-69分：一般，需修改后重新审核`)
  parts.push(`- 0-49分：不合格，需大幅修改或拒绝`)
  parts.push('')

  return parts.join('\n')
}

function buildFallbackReport(
  input: CreateContentAuditInput,
  complianceScore: number,
  brandAlignmentScore: number,
  qualityScore: number,
  overallScore: number,
): string {
  const lines = [
    `# ${input.brand} · ${input.product} — ${input.platform} ${input.contentType} 内容审核报告`,
    '',
    '## 📋 审核结论',
    `**审核结果**：${determineStatus(overallScore) === 'passed' ? '通过' : determineStatus(overallScore) === 'pending' ? '需修改' : '不通过'}`,
    `**综合评分**：${overallScore}/100`,
    '',
    '## ⚖️ 合规性检查',
    `**评分**：${complianceScore}/100`,
    complianceScore < 70 ? '  - ❌ 检测到潜在风险表述，请检查广告法合规用词。' : '  - ✅ 未发现明显合规风险。',
    '',
    '## 🏷️ 品牌契合度',
    `**评分**：${brandAlignmentScore}/100`,
    brandAlignmentScore >= 70 ? '  - ✅ 品牌/产品露出较为充分。' : '  - ⚠️ 品牌信息传达不足，建议增加品牌名与产品卖点露出。',
    '',
    '## ✨ 内容质量评估',
    `**评分**：${qualityScore}/100`,
    qualityScore >= 70 ? '  - ✅ 内容长度与结构良好。' : '  - 🔧 内容偏短或结构不够清晰，建议补充使用场景与互动引导。',
    '',
    '---',
    '**评分参考**：',
    '- 90-100分：优秀，可直接发布',
    '- 70-89分：良好，需微调后发布',
    '- 50-69分：一般，需修改后重新审核',
    '- 0-49分：不合格，需大幅修改或拒绝',
    '',
  ]
  return lines.join('\n')
}

function extractJSON(text: string): unknown {
  const trimmed = text.trim()

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // continue
    }
  }

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]!.trim())
    } catch {
      // continue
    }
  }

  const objectStart = trimmed.indexOf('{')
  const objectEnd = trimmed.lastIndexOf('}')
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    try {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1))
    } catch {
      // continue
    }
  }

  throw new Error('无法从响应中提取有效 JSON')
}
