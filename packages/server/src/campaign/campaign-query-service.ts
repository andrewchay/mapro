/**
 * Campaign 查询服务
 *
 * 阶段 B0：封装 CampaignRepository 的数据访问，所有方法改为异步，
 * 与未来 DbProvider 异步抽象保持一致。
 */

import type { Campaign, CampaignKOLPoolItem, KOLContentTracking } from '@ma-proma/shared'
import type { CampaignRepository } from './campaign-repository.ts'

export class CampaignQueryService {
  private repository: CampaignRepository

  constructor(repository: CampaignRepository) {
    this.repository = repository
  }

  async listCampaigns(): Promise<Campaign[]> {
    return this.repository.listCampaigns()
  }

  async getCampaignById(id: string): Promise<Campaign | null> {
    return this.repository.getCampaignById(id)
  }

  async listContentTracking(campaignId: string): Promise<KOLContentTracking[]> {
    return this.repository.listContentTracking(campaignId)
  }

  async getPoolKOLs(campaignId: string): Promise<CampaignKOLPoolItem[]> {
    return this.repository.getPoolKOLs(campaignId)
  }
}
