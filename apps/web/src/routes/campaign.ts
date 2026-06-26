/**
 * Campaign REST API
 *
 * 阶段 B0：使用 DbProvider 抽象初始化 Repository，
 * 让 Web 端与 Electron 端可共享同一 CampaignRepository。
 *
 * 当前范围：
 * - GET /api/campaigns        列表
 * - GET /api/campaigns/:id    详情
 * - POST /api/campaigns       创建（仅基础字段）
 * - GET /api/campaigns/:id/content-tracking  内容追踪
 * - GET /api/campaigns/:id/kol-pool          KOL 候选池
 */

import { Router } from 'express'
import { CampaignRepository, CampaignQueryService, SqliteDbProvider, getCampaignDbPath } from '@ma-proma/server'
import type { AppContext } from '@ma-proma/server'

export async function createCampaignRouter(context: AppContext) {
  const router = Router()
  const dbPath = getCampaignDbPath(context)
  const db = new SqliteDbProvider(dbPath)
  const repository = new CampaignRepository(db)
  await repository.initSchema()
  const queryService = new CampaignQueryService(repository)

  router.get('/', async (_req, res) => {
    try {
      const campaigns = await queryService.listCampaigns()
      res.json({ success: true, campaigns })
    } catch (error) {
      console.error('[Campaign API] 列表获取失败:', error)
      res.status(500).json({ success: false, error: '获取 Campaign 列表失败' })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const campaign = await queryService.getCampaignById(req.params.id)
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

  router.get('/:id/content-tracking', async (req, res) => {
    try {
      const tracking = await queryService.listContentTracking(req.params.id)
      res.json({ success: true, tracking })
    } catch (error) {
      console.error('[Campaign API] 内容追踪获取失败:', error)
      res.status(500).json({ success: false, error: '获取内容追踪失败' })
    }
  })

  router.get('/:id/kol-pool', async (req, res) => {
    try {
      const pool = await queryService.getPoolKOLs(req.params.id)
      res.json({ success: true, pool })
    } catch (error) {
      console.error('[Campaign API] 候选池获取失败:', error)
      res.status(500).json({ success: false, error: '获取候选池失败' })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const { name, brand, platform, budget, durationMonths, targetCity, targetAudience } = req.body
      if (!name || !brand || !platform) {
        res.status(400).json({ success: false, error: '缺少必填字段：name, brand, platform' })
        return
      }

      const campaign = await repository.createCampaign({
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
