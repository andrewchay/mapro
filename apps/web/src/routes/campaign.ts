/**
 * Campaign REST API
 *
 * 阶段 A 范围：
 * - GET /api/campaigns        列表
 * - GET /api/campaigns/:id    详情
 * - POST /api/campaigns       创建（仅基础字段）
 */

import { Router } from 'express'
import { CampaignRepository, CampaignQueryService } from '@ma-proma/server'
import type { AppContext } from '@ma-proma/server'

export function createCampaignRouter(context: AppContext) {
  const router = Router()
  const repository = new CampaignRepository(context)
  const queryService = new CampaignQueryService(repository)

  router.get('/', (_req, res) => {
    try {
      const campaigns = queryService.listCampaigns()
      res.json({ success: true, campaigns })
    } catch (error) {
      console.error('[Campaign API] 列表获取失败:', error)
      res.status(500).json({ success: false, error: '获取 Campaign 列表失败' })
    }
  })

  router.get('/:id', (req, res) => {
    try {
      const campaign = queryService.getCampaignById(req.params.id)
      if (!campaign) {
        res.status(404).json({ success: false, error: 'Campaign 不存在' })
        return
      }
      res.json({ success: true, campaign })
    } catch (error) {
      console.error('[Campaign API] 详情获取失败:', error)
      res.status(500).json({ success: false, error: '获取 Campaign 详情失败' })
    }
  })

  router.get('/:id/content-tracking', (req, res) => {
    try {
      const tracking = repository.listContentTracking(req.params.id)
      res.json({ success: true, tracking })
    } catch (error) {
      console.error('[Campaign API] 内容追踪获取失败:', error)
      res.status(500).json({ success: false, error: '获取内容追踪失败' })
    }
  })

  router.get('/:id/kol-pool', (req, res) => {
    try {
      const pool = repository.getPoolKOLs(req.params.id)
      res.json({ success: true, pool })
    } catch (error) {
      console.error('[Campaign API] 候选池获取失败:', error)
      res.status(500).json({ success: false, error: '获取候选池失败' })
    }
  })

  router.post('/', (req, res) => {
    try {
      const { name, brand, platform, budget, durationMonths, targetCity, targetAudience } = req.body
      if (!name || !brand || !platform) {
        res.status(400).json({ success: false, error: '缺少必填字段：name, brand, platform' })
        return
      }

      const campaign = repository.createCampaign({
        name,
        brand,
        platform,
        budget: Number(budget ?? 0),
        durationMonths: Number(durationMonths ?? 1),
        targetCity: Array.isArray(targetCity) ? targetCity : [],
        targetAudience: String(targetAudience ?? ''),
      })

      res.status(201).json({ success: true, campaign })
    } catch (error) {
      console.error('[Campaign API] 创建失败:', error)
      res.status(500).json({ success: false, error: '创建 Campaign 失败' })
    }
  })

  return router
}
