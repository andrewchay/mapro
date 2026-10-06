/**
 * Campaign 命令服务（写入/协调层）
 *
 * 阶段 B1 Slice 2：
 * - 协调 CampaignRepository 与 KOLDatabaseRepository
 * - 支持 KOL 候选池导入、可导入 KOL 列表查询
 * - 内容追踪创建时从 KOL 数据库读取报价估算 CPM/CPE
 */

import type {
  AddPaidDataInput,
  AdvanceWorkflowInput,
  AgentMessage,
  Campaign,
  CampaignBrief,
  CampaignKOLPoolItem,
  CampaignWorkflow,
  CampaignWorkflowStep,
  CampaignWorkflowStepId,
  ConfirmationItem,
  ConfirmWorkflowItemInput,
  ContentAudit,
  CreateContentAuditInput,
  CreateContentTrackingInput,
  ImportKOLsToPoolInput,
  KOLContentTracking,
  KOLSearchResult,
  SaveCampaignBriefInput,
  UpdateAnalysisInput,
  UpdateContentTrackingDataInput,
  UpdateWorkflowStepInput,
} from '@ma-proma/shared'
import type { CampaignRepository } from './campaign-repository.ts'
import type { KOLDatabaseRepository } from '../kol/kol-database-repository.ts'
import type { CampaignWorkflowService } from './campaign-workflow-service.ts'
import type { ArtifactValidationResult } from './campaign-artifact-validator.ts'
import type { ContentAuditService } from './content-audit-service.ts'

export interface CampaignCommandServiceOptions {
  /** 创建内容追踪时是否自动从 KOL 数据库读取报价估算 */
  estimatePriceFromKOLDatabase?: boolean
}

export class CampaignCommandService {
  private repository: CampaignRepository
  private kolRepository: KOLDatabaseRepository | null
  private workflowService: CampaignWorkflowService | null
  private contentAuditService: ContentAuditService | null
  private options: CampaignCommandServiceOptions

  constructor(
    repository: CampaignRepository,
    kolRepository: KOLDatabaseRepository | null = null,
    workflowService: CampaignWorkflowService | null = null,
    options: CampaignCommandServiceOptions = {},
    contentAuditService: ContentAuditService | null = null,
  ) {
    this.repository = repository
    this.kolRepository = kolRepository
    this.workflowService = workflowService
    this.contentAuditService = contentAuditService
    this.options = { estimatePriceFromKOLDatabase: true, ...options }
  }

  // =====================================================================
  // 工作流状态机（委托给 CampaignWorkflowService）
  // =====================================================================

  private ensureWorkflowService(): CampaignWorkflowService {
    if (!this.workflowService) {
      throw new Error('CampaignWorkflowService 未注入')
    }
    return this.workflowService
  }

  async loadWorkflow(campaignId: string): Promise<CampaignWorkflow> {
    return this.ensureWorkflowService().loadCampaignWorkflow(campaignId)
  }

  async updateWorkflowStep(input: UpdateWorkflowStepInput): Promise<CampaignWorkflow> {
    return this.ensureWorkflowService().updateWorkflowStep(input)
  }

  async advanceWorkflow(input: AdvanceWorkflowInput): Promise<CampaignWorkflow> {
    return this.ensureWorkflowService().advanceWorkflow(input)
  }

  async resetWorkflow(campaignId: string): Promise<CampaignWorkflow> {
    return this.ensureWorkflowService().resetWorkflow(campaignId)
  }

  async confirmWorkflowItem(input: ConfirmWorkflowItemInput): Promise<CampaignWorkflow> {
    return this.ensureWorkflowService().confirmWorkflowItem(input)
  }

  async listBlockingConfirmations(campaignId: string): Promise<ConfirmationItem[]> {
    return this.ensureWorkflowService().listBlockingConfirmations(campaignId)
  }

  async getCurrentWorkflowStep(campaignId: string): Promise<CampaignWorkflowStep | null> {
    return this.ensureWorkflowService().getCurrentStep(campaignId)
  }

  async getStepAgentPrompt(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    context?: Record<string, string>,
  ): Promise<string> {
    return this.ensureWorkflowService().getStepAgentPrompt(campaignId, stepId, context)
  }

  async getWorkflowProgress(campaignId: string): Promise<number> {
    return this.ensureWorkflowService().getWorkflowProgress(campaignId)
  }

  async isWorkflowComplete(campaignId: string): Promise<boolean> {
    return this.ensureWorkflowService().isWorkflowComplete(campaignId)
  }

  async validateStepArtifacts(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
  ): Promise<ArtifactValidationResult> {
    return this.ensureWorkflowService().validateStepArtifacts(campaignId, stepId)
  }

  async completeStepWithValidation(
    campaignId: string,
    stepId: CampaignWorkflowStepId,
    messages: AgentMessage[] | undefined,
  ): Promise<{ success: boolean; workflow: CampaignWorkflow; reason?: string }> {
    return this.ensureWorkflowService().completeStep(campaignId, stepId, messages)
  }

  // =====================================================================
  // KOL 候选池导入
  // =====================================================================

  async importKOLsToPool(input: ImportKOLsToPoolInput): Promise<{ imported: number }> {
    if (!this.kolRepository) {
      throw new Error('KOL 数据库未配置，无法导入候选池')
    }

    let imported = 0
    for (const kolId of input.kolIds) {
      const kol = await this.kolRepository.getKOLById(kolId)
      if (!kol) continue

      const existing = await this.repository.getPoolKOLs(input.campaignId)
      if (existing.some((item) => item.kolId === kolId)) continue

      await this.repository.addPoolKOL({
        campaignId: input.campaignId,
        kolId,
        name: kol.name,
        platform: kol.platform,
        followers: kol.followers,
        engagement: kol.engagement,
        category: kol.category,
        price: kol.price,
        city: kol.city,
      })
      imported++
    }

    return { imported }
  }

  async listAvailableKOLs(filters?: {
    platform?: string
    category?: string
    keywords?: string[]
    limit?: number
  }): Promise<KOLSearchResult> {
    if (!this.kolRepository) {
      return { kols: [], total: 0 }
    }
    return this.kolRepository.listAvailableKOLs(filters)
  }

  // =====================================================================
  // Campaign 阶段推进
  // =====================================================================

  async advanceCampaignPhase(id: string): Promise<Campaign | null> {
    const campaign = await this.repository.getCampaignById(id)
    if (!campaign) return null

    const nextPhase = campaign.currentPhase + 1
    if (nextPhase > 3) return null

    const phaseStatusMap: Record<number, Campaign['status']> = {
      1: 'strategy',
      2: 'kol_selection',
      3: 'content_production',
    }

    return this.repository.updateCampaign(id, {
      currentPhase: nextPhase,
      status: phaseStatusMap[nextPhase] ?? campaign.status,
    })
  }

  // =====================================================================
  // Brief
  // =====================================================================

  async getBrief(campaignId: string, kolId: string): Promise<CampaignBrief | null> {
    return this.repository.getBrief(campaignId, kolId)
  }

  async saveBrief(input: SaveCampaignBriefInput): Promise<CampaignBrief> {
    return this.repository.saveBrief(input)
  }

  generateBriefTemplate(campaign: Parameters<CampaignRepository['generateBriefTemplate']>[0], kol: CampaignKOLPoolItem): string {
    return this.repository.generateBriefTemplate(campaign, kol)
  }

  // =====================================================================
  // 内容追踪
  // =====================================================================

  async createContentTracking(input: CreateContentTrackingInput): Promise<KOLContentTracking> {
    let paidSpend = input.paidSpend
    if (this.options.estimatePriceFromKOLDatabase && this.kolRepository && (paidSpend === undefined || paidSpend === 0)) {
      const kol = await this.kolRepository.getKOLById(input.kolId)
      if (kol) {
        paidSpend = this.kolRepository.parsePrice(kol.price)
      }
    }

    return this.repository.createContentTracking({
      ...input,
      paidSpend,
    })
  }

  async updateContentTrackingData(input: UpdateContentTrackingDataInput): Promise<KOLContentTracking | null> {
    return this.repository.updateContentTrackingData(input)
  }

  async addPaidData(input: AddPaidDataInput): Promise<KOLContentTracking | null> {
    return this.repository.addPaidData(input)
  }

  async updateContentTrackingAnalysis(input: UpdateAnalysisInput): Promise<KOLContentTracking | null> {
    return this.repository.updateContentTrackingAnalysis(input)
  }

  async deleteContentTracking(id: string): Promise<boolean> {
    return this.repository.deleteContentTracking(id)
  }

  // =====================================================================
  // 内容审核
  // =====================================================================

  async createContentAudit(input: CreateContentAuditInput): Promise<ContentAudit> {
    if (!this.contentAuditService) {
      throw new Error('ContentAuditService 未注入，无法执行内容审核')
    }
    return this.contentAuditService.audit(input)
  }

  async listContentAudits(campaignId: string): Promise<ContentAudit[]> {
    if (!this.contentAuditService) {
      return this.repository.listContentAudits(campaignId)
    }
    return this.contentAuditService.listAudits(campaignId)
  }

  // =====================================================================
  // 性能分析（纯本地计算，不涉及 LLM）
  // =====================================================================

  async analyzeContentPerformance(
    platform: string,
    priceTier: string,
    followersRange: string,
    ctr: number,
    engagementRate: number,
    cpm: number,
    cpe: number,
  ): Promise<{ grade: 'excellent' | 'good' | 'normal' | 'poor'; comparison: Record<string, unknown> }> {
    return this.repository.analyzeContentPerformance(platform, priceTier, followersRange, ctr, engagementRate, cpm, cpe)
  }
}
