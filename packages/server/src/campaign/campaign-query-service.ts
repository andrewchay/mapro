/**
 * Campaign 查询服务
 *
 * 阶段 A 只读查询层，封装 CampaignRepository 的数据访问，
 * 为未来添加缓存、权限校验、数据聚合留下扩展点。
 */

import type { Campaign, CampaignKOLPoolItem, KOLContentTracking } from '@ma-proma/shared'
import type { CampaignRepository } from './campaign-repository.ts'

export class CampaignQueryService {
  private repository: CampaignRepository

  constructor(repository: CampaignRepository) {
    this.repository = repository
  }

  listCampaigns(): Campaign[] {
    return this.repository.listCampaigns()
  }

  getCampaignById(id: string): Campaign | null {
    return this.repository.getCampaignById(id)
  }

  listContentTracking(campaignId: string): KOLContentTracking[] {
    return this.repository.listContentTracking(campaignId)
  }

  getPoolKOLs(campaignId: string): CampaignKOLPoolItem[] {
    return this.repository.getPoolKOLs(campaignId)
  }
}
