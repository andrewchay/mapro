/**
 * ContentAuditService - 内容审核服务
 *
 * 为 Campaign 提供 KOL 内容审核能力：
 * - 优先使用已配置的 ChatProvider（MAPRO_CHAT_PROVIDER / MAPRO_CHAT_API_KEY）调用 LLM
 * - 未配置 LLM 时使用本地规则打分，保证功能可用
 * - 审核结果持久化到 content_audits 表
 *
 * 评估体系基于大卫·奥格威「品牌形象 + 广告调查」双框架：
 * 五维评分 = 合规性(20%) + 品牌契合度(25%) + 内容质量(25%) + 品牌形象一致性(20%) + 数据可验证性(10%)
 */

import { getAdapter, streamSSE } from '@ma-proma/core'
import type { ContentAudit, CreateContentAuditInput, ProviderType } from '@ma-proma/shared'
import type { ChatProviderConfig } from '../chat/types.ts'
import type { CampaignRepository } from './campaign-repository.ts'

export interface AuditScores {
  auditStatus: ContentAudit['auditStatus']
  complianceScore: number        // 合规性 (20%)
  brandAlignmentScore: number    // 品牌契合度 (25%)
  qualityScore: number           // 内容质量 (25%)
  brandImageScore: number        // 品牌形象一致性 (20%) — 奥格威框架新增
  dataVerifiabilityScore: number // 数据可验证性 (10%) — 奥格威框架新增
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
    const brandImage = audit.brand_image as Record<string, unknown> | undefined
    const dataVerifiability = audit.data_verifiability as Record<string, unknown> | undefined

    const complianceScore = normalizeScore(compliance?.score)
    const brandAlignmentScore = normalizeScore(brandAlignment?.score)
    const qualityScore = normalizeScore(quality?.score)
    const brandImageScore = normalizeScore(brandImage?.score)
    const dataVerifiabilityScore = normalizeScore(dataVerifiability?.score)

    return {
      auditStatus: determineStatus(overallScore),
      complianceScore,
      brandAlignmentScore,
      qualityScore,
      brandImageScore,
      dataVerifiabilityScore,
      overallScore,
      auditReport: formatAuditReport(input, audit),
      auditor: 'ai',
    }
  }

  private evaluateWithRules(input: CreateContentAuditInput): AuditScores {
    const desc = input.contentDescription
    const brand = input.brand
    const length = desc.length

    // === 1. 合规性：检测常见风险词与长度 (20%) ===
    const riskWords = ['最', '第一', '国家级', '纯天然', '无副作用', '绝对', '保证治愈', '限时']
    const riskCount = riskWords.reduce((sum, word) => sum + (desc.includes(word) ? 1 : 0), 0)
    const complianceScore = Math.max(0, 100 - riskCount * 15)

    // === 2. 品牌契合：品牌名出现次数与产品关联 (25%) ===
    const brandCount = brand ? (desc.match(new RegExp(escapeRegExp(brand), 'g')) ?? []).length : 0
    const hasKeyMessage = input.keyMessage ? desc.includes(input.keyMessage.slice(0, 10)) : false
    const brandAlignmentScore = Math.min(100, 30 + brandCount * 15 + (desc.includes(input.product) ? 20 : 0) + (hasKeyMessage ? 25 : 0))

    // === 3. 内容质量：基于长度与结构 (25%) ===
    const hasStructure = /[\n\r]/.test(desc) || /[一二三四五六七八九十]/.test(desc)
    const hasDataEvidence = /\d+%?|\d+\.?\d*|第[一二三四五六七八九十\d]+|研究发现|数据显示|实验证明/.test(desc)
    const qualityScore = Math.min(100, Math.max(30, Math.round(length / 5) + (hasStructure ? 15 : 0) + (hasDataEvidence ? 20 : 0)))

    // === 4. 品牌形象一致性：调性/视觉/人格匹配 (20%) ===
    let brandImageScore = 60 // 基础分
    if (input.brandPersona) {
      const personaLower = input.brandPersona.toLowerCase()
      const descLower = desc.toLowerCase()
      if (personaLower.includes('专业') && /专家|医生|研发|科学|成分|功效/.test(descLower)) brandImageScore += 15
      if (personaLower.includes('潮流') && /时尚|种草|必入|神仙|yyds/.test(descLower)) brandImageScore += 15
      if (personaLower.includes('温暖') && /贴心|安心|守护|陪伴|温柔/.test(descLower)) brandImageScore += 15
      if (personaLower.includes('高端') && /奢华|精致|匠心|限量|尊贵/.test(descLower)) brandImageScore += 15
    }
    if (input.visualGuidelines) brandImageScore += 5
    brandImageScore = Math.min(100, brandImageScore)

    // === 5. 数据可验证性：前置洞察支撑 (10%) ===
    let dataVerifiabilityScore = 50
    if (input.dataSupport && input.dataSupport.length > 10) dataVerifiabilityScore += 25
    if (input.benchmarkData && input.benchmarkData.length > 10) dataVerifiabilityScore += 15
    if (hasDataEvidence) dataVerifiabilityScore += 10
    dataVerifiabilityScore = Math.min(100, dataVerifiabilityScore)

    // === 总分：加权计算 ===
    const overallScore = Math.round(
      complianceScore * 0.20 +
      brandAlignmentScore * 0.25 +
      qualityScore * 0.25 +
      brandImageScore * 0.20 +
      dataVerifiabilityScore * 0.10
    )

    return {
      auditStatus: determineStatus(overallScore),
      complianceScore,
      brandAlignmentScore,
      qualityScore,
      brandImageScore,
      dataVerifiabilityScore,
      overallScore,
      auditReport: buildFallbackReport(input, complianceScore, brandAlignmentScore, qualityScore, brandImageScore, dataVerifiabilityScore, overallScore),
      auditor: 'rule',
    }
  }
}

// -----------------------------------------------------------------
// Prompt & Report Builders
// -----------------------------------------------------------------

function buildSystemPrompt(): string {
  return `你是一位资深的内容审核专家，曾在大型 MCN 机构和品牌方担任内容风控总监。你的评估体系基于大卫·奥格威的「品牌形象 + 广告调查」双框架。

请基于品牌需求和平台特性，对达人提交的内容进行五维度审核评估。

**审核维度：**

1. **合规性检查（20%）**：广告法合规、平台规范、虚假宣传风险、违禁词检测、品牌安全
   - 一票否决项：出现「最」「第一」「国家级」等绝对化用语；涉及虚假宣传；品牌名错误；敏感话题

2. **品牌契合度（25%）**：品牌信息准确性、核心承诺（Key Message）传达、产品卖点场景化呈现、CTA 明确性
   - 核心原则：「承诺，大大的承诺，是广告的灵魂」——内容必须包含一个清晰、可感知、可验证的产品承诺

3. **内容质量（25%）**：创意原创性、信息密度与事实支撑、互动设计、叙事结构
   - 核心原则：「好广告是不引公众注意它自己就把产品推销掉的作品」——内容不应让观众感叹"博主好会拍"，而应是"产品我想试试"
   - 核心原则：「消费者不是低能儿」——提供具体事实/数据/使用场景，拒绝空洞形容词

4. **品牌形象一致性（20%）**：调性一致性、视觉合规性、品牌人格匹配
   - 核心原则：「品牌形象是一项长期投资，而非一次性活动」——所有内容的调性、视觉、语言风格必须与品牌人格一致
   - 检查语言风格是否与品牌人格匹配（高端品牌=克制优雅；年轻化品牌=活泼网感）
   - 检查达人表达方式是否与品牌「角色设定」一致

5. **数据可验证性（10%）**：前置洞察支撑、A/B 测试就绪度、历史 Benchmark 对标
   - 核心原则：「调查是广告创作的基础，而非创意的敌人」——创意必须有数据支撑
   - 检查内容中的事实/数据是否有来源支撑
   - 检查创意是否可拆解为可测试变量

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
  "brand_image": {
    "score": 82,
    "tone_match": "调性匹配度说明",
    "visual_compliance": "视觉合规性说明",
    "persona_alignment": "品牌人格匹配度说明"
  },
  "data_verifiability": {
    "score": 75,
    "insight_support": "前置洞察支撑说明",
    "test_ready": "A/B测试就绪度说明",
    "benchmark_comparison": "历史Benchmark对标说明"
  },
  "revision_suggestions": ["具体修改建议1", "修改建议2"],
  "overall_score": 85,
  "final_verdict": "通过，建议微调"
}

**评分权重与标准：**
- 合规性 20% + 品牌契合度 25% + 内容质量 25% + 品牌形象一致性 20% + 数据可验证性 10% = 总分
- 90-100：优秀，可直接发布
- 70-89：良好，需微调后发布
- 50-69：一般，需修改后重新审核
- 0-49：不合格，需大幅修改或拒绝

**关键一票否决项（触发即判定为不合格）：**
- 出现广告法明令禁止的绝对化用语
- 涉及虚假宣传（如普通食品宣称治疗功效）
- 品牌名/Logo 错误、变形或负面呈现
- 达人与品牌调性严重冲突
- 内容涉及政治/宗教/种族等敏感话题
- 抄袭或高度相似于竞品/过往内容`
}

function buildAuditPrompt(input: CreateContentAuditInput): string {
  const parts: string[] = [
    `请对以下内容进行五维度审核评估：`,
    ``,
    `## 基础信息`,
    `品牌：${input.brand}`,
    `产品：${input.product}`,
    `平台：${input.platform}`,
    `内容类型：${input.contentType}`,
  ]

  if (input.kolId) parts.push(`达人ID：${input.kolId}`)
  if (input.contentUrl) parts.push(`内容链接：${input.contentUrl}`)

  if (input.brandPersona || input.visualGuidelines || input.keyMessage || input.targetAudience) {
    parts.push(``)
    parts.push(`## 品牌规范（用于评估品牌形象一致性）`)
    if (input.brandPersona) parts.push(`品牌人格：${input.brandPersona}`)
    if (input.visualGuidelines) parts.push(`视觉规范：${input.visualGuidelines}`)
    if (input.keyMessage) parts.push(`核心传播信息（Key Message）：${input.keyMessage}`)
    if (input.targetAudience) parts.push(`目标受众：${input.targetAudience}`)
  }

  if (input.sellingPoints || input.dataSupport || input.benchmarkData) {
    parts.push(``)
    parts.push(`## 数据支撑（用于评估数据可验证性）`)
    if (input.sellingPoints) parts.push(`核心卖点：${input.sellingPoints}`)
    if (input.dataSupport) parts.push(`数据支撑/洞察来源：${input.dataSupport}`)
    if (input.benchmarkData) parts.push(`历史Benchmark：${input.benchmarkData}`)
  }

  parts.push(``)
  parts.push(`## 内容描述/脚本`)
  parts.push('```')
  parts.push(input.contentDescription)
  parts.push('```')
  parts.push(``)
  parts.push(`请从**合规性、品牌契合度、内容质量、品牌形象一致性、数据可验证性**五个维度进行详细审核，给出评分和具体修改建议。`)
  parts.push(`特别注意奥格威的两条核心原则：①「承诺是广告的灵魂」——检查是否有清晰的产品承诺；②「消费者不是低能儿」——检查是否提供了事实/数据而非空洞形容词。`)

  return parts.join('\n')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

  const brandImage = audit.brand_image as Record<string, unknown> | undefined
  if (brandImage) {
    parts.push(`## 🎨 品牌形象一致性`)
    if (brandImage.score !== undefined) parts.push(`**评分**：${brandImage.score}/100`)
    const toneMatch = brandImage.tone_match as string | undefined
    if (toneMatch) parts.push(`**调性匹配**：${toneMatch}`)
    const visualCompliance = brandImage.visual_compliance as string | undefined
    if (visualCompliance) parts.push(`**视觉合规**：${visualCompliance}`)
    const personaAlignment = brandImage.persona_alignment as string | undefined
    if (personaAlignment) parts.push(`**人格匹配**：${personaAlignment}`)
    parts.push('')
  }

  const dataVerifiability = audit.data_verifiability as Record<string, unknown> | undefined
  if (dataVerifiability) {
    parts.push(`## 📊 数据可验证性`)
    if (dataVerifiability.score !== undefined) parts.push(`**评分**：${dataVerifiability.score}/100`)
    const insightSupport = dataVerifiability.insight_support as string | undefined
    if (insightSupport) parts.push(`**洞察支撑**：${insightSupport}`)
    const testReady = dataVerifiability.test_ready as string | undefined
    if (testReady) parts.push(`**测试就绪**：${testReady}`)
    const benchmarkComparison = dataVerifiability.benchmark_comparison as string | undefined
    if (benchmarkComparison) parts.push(`**Benchmark对标**：${benchmarkComparison}`)
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
  brandImageScore: number,
  dataVerifiabilityScore: number,
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
    '## 🎨 品牌形象一致性',
    `**评分**：${brandImageScore}/100`,
    brandImageScore >= 70 ? '  - ✅ 调性/视觉/人格匹配度良好。' : '  - ⚠️ 调性匹配度不足，建议对照品牌人格卡片调整语言风格。',
    '',
    '## 📊 数据可验证性',
    `**评分**：${dataVerifiabilityScore}/100`,
    dataVerifiabilityScore >= 70 ? '  - ✅ 有数据支撑和Benchmark参考。' : '  - 🔧 数据支撑不足，建议在Brief中补充洞察来源和历史Benchmark。',
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
