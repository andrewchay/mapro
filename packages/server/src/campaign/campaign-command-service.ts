/**
 * Campaign 命令服务（写入/协调层）
 *
 * 阶段 B1：封装 Brief / 内容追踪 / 性能分析的写入操作，
 * 供 Web REST API 和 Electron IPC 共享调用。
 */

import type {
  AddPaidDataInput,
  CampaignBrief,
  CampaignKOLPoolItem,
  CreateContentTrackingInput,
  KOLContentTracking,
  SaveCampaignBriefInput,
  UpdateAnalysisInput,
  UpdateContentTrackingDataInput,
} from '@ma-proma/shared'
import type { CampaignRepository } from './campaign-repository.ts'

export class CampaignCommandService {
  private repository: CampaignRepository

  constructor(repository: CampaignRepository) {
    this.repository = repository
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
    return this.repository.createContentTracking(input)
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
