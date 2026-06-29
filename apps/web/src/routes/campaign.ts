/**
 * Campaign REST API
 *
 * 阶段 B1：补齐 Brief / 内容追踪 / 性能分析的写入能力，
 * 让 Web 端与 Electron 端共享同一 Campaign 业务逻辑。
 *
 * 当前范围：
 * - Campaign 列表/详情/创建
 * - KOL 候选池只读
 * - Brief 获取/保存/自动生成模板
 * - 内容追踪 CRUD + 投流数据 + 分析结果
 * - 内容性能本地分析（基于数据标准基准）
 */

import express, { Router } from 'express'
import type { CampaignWorkflowStepId } from '@ma-proma/shared'
import {
  CampaignRepository,
  CampaignQueryService,
  CampaignCommandService,
  CampaignWorkflowService,
  CampaignArtifactValidator,
  ContentAuditService,
  KOLDatabaseRepository,
  LocalFileProvider,
  createDbProvider,
  WorkspaceFileService,
  STEP_DIR_MAP,
  getCampaignDbPath,
  getKolDbPath,
} from '@ma-proma/server'
import type { AppContext, WorkspaceFileEntry, ChatProviderConfig } from '@ma-proma/server'

export async function createCampaignRouter(context: AppContext, chatConfig?: ChatProviderConfig | null) {
  const router = Router()
  // 主进程不再挂载全局 express.json()，Campaign 路由自行配置 body 解析
  router.use(express.json({ limit: '1mb' }))
  const dbPath = getCampaignDbPath(context)
  const db = createDbProvider({ sqlitePath: dbPath, postgresDbNameSuffix: 'campaign' })
  const repository = new CampaignRepository(db)
  await repository.initSchema()

  const kolDbPath = getKolDbPath(context)
  const kolDb = createDbProvider({ sqlitePath: kolDbPath, postgresDbNameSuffix: 'kol' })
  const kolRepository = new KOLDatabaseRepository(kolDb, { seedMockData: process.env.MAPRO_SEED_MOCK_KOLS === '1' })
  await kolRepository.initSchema()

  const queryService = new CampaignQueryService(repository)
  const fileProvider = new LocalFileProvider()
  const validator = new CampaignArtifactValidator(context, fileProvider)
  const workflowService = new CampaignWorkflowService(context, fileProvider, validator)
  const contentAuditService = new ContentAuditService(chatConfig ?? null, repository)
  const commandService = new CampaignCommandService(repository, kolRepository, workflowService, {}, contentAuditService)
  const workspaceFileService = new WorkspaceFileService(context, fileProvider)

  // =====================================================================
  // Campaign 基础
  // =====================================================================

  router.get('/', async (_req, res) => {
    try {
      const campaigns = await queryService.listCampaigns()
      res.json({ success: true, campaigns })
    } catch (error) {
      console.error('[Campaign API] 列表获取失败:', error)
      res.status(500).json({ success: false, error: '获取 Campaign 列表失败' })
    }
  })

  // 注意：该路由必须在 /:id 之前注册，避免被当作 Campaign ID 处理
  router.get('/available-kols', async (req, res) => {
    try {
      const { platform, category, keywords, limit } = req.query
      const result = await commandService.listAvailableKOLs({
        platform: platform ? String(platform) : undefined,
        category: category ? String(category) : undefined,
        keywords: keywords ? String(keywords).split(',').filter(Boolean) : undefined,
        limit: limit ? Number(limit) : undefined,
      })
      res.json({ success: true, ...result })
    } catch (error) {
      console.error('[Campaign API] 可导入 KOL 列表获取失败:', error)
      res.status(500).json({ success: false, error: '获取可导入 KOL 列表失败' })
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

  router.patch('/:id', async (req, res) => {
    try {
      const allowedFields = ['name', 'brand', 'platform', 'budget', 'durationMonths', 'targetCity', 'targetAudience', 'currentPhase', 'phasePlans', 'creativePlan', 'status'] as const
      const updates: Record<string, unknown> = {}
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) {
          updates[key] = req.body[key]
        }
      }

      const campaign = await repository.updateCampaign(req.params.id, updates)
      if (!campaign) {
        res.status(404).json({ success: false, error: 'Campaign 不存在' })
        return
      }
      res.json({ success: true, campaign })
    } catch (error) {
      console.error('[Campaign API] 更新失败:', error)
      res.status(500).json({ success: false, error: '更新 Campaign 失败' })
    }
  })

  router.post('/:id/advance-phase', async (req, res) => {
    try {
      const campaign = await commandService.advanceCampaignPhase(req.params.id)
      if (!campaign) {
        res.status(400).json({ success: false, error: 'Campaign 不存在或已处于最后阶段' })
        return
      }
      res.json({ success: true, campaign })
    } catch (error) {
      console.error('[Campaign API] 阶段推进失败:', error)
      res.status(500).json({ success: false, error: '推进 Campaign 阶段失败' })
    }
  })

  // =====================================================================
  // KOL 候选池（只读；导入写入放到 B1 Slice 2）
  // =====================================================================

  router.get('/:id/kol-pool', async (req, res) => {
    try {
      const pool = await queryService.getPoolKOLs(req.params.id)
      res.json({ success: true, pool })
    } catch (error) {
      console.error('[Campaign API] 候选池获取失败:', error)
      res.status(500).json({ success: false, error: '获取候选池失败' })
    }
  })

  router.post('/:id/kol-pool', async (req, res) => {
    try {
      const { kolIds } = req.body
      if (!Array.isArray(kolIds) || kolIds.length === 0) {
        res.status(400).json({ success: false, error: '缺少必填字段：kolIds（数组）' })
        return
      }

      const result = await commandService.importKOLsToPool({
        campaignId: req.params.id,
        kolIds,
      })
      res.json({ success: true, ...result })
    } catch (error) {
      console.error('[Campaign API] KOL 导入失败:', error)
      res.status(500).json({ success: false, error: '导入 KOL 到候选池失败' })
    }
  })

  // =====================================================================
  // KOL Brief
  // =====================================================================

  router.get('/:id/briefs/:kolId', async (req, res) => {
    try {
      const brief = await commandService.getBrief(req.params.id, req.params.kolId)
      if (!brief) {
        res.status(404).json({ success: false, error: 'Brief 不存在' })
        return
      }
      res.json({ success: true, brief })
    } catch (error) {
      console.error('[Campaign API] Brief 获取失败:', error)
      res.status(500).json({ success: false, error: '获取 Brief 失败' })
    }
  })

  router.post('/:id/briefs', async (req, res) => {
    try {
      const { kolId, kolName, content, aiGenerated, autoGenerate } = req.body
      if (!kolId || !kolName) {
        res.status(400).json({ success: false, error: '缺少必填字段：kolId, kolName' })
        return
      }

      let finalContent = content
      if (!finalContent || autoGenerate) {
        const campaign = await queryService.getCampaignById(req.params.id)
        if (!campaign) {
          res.status(404).json({ success: false, error: 'Campaign 不存在' })
          return
        }
        const pool = await queryService.getPoolKOLs(req.params.id)
        const kol = pool.find((item) => item.kolId === kolId)
        if (!kol) {
          res.status(404).json({ success: false, error: 'KOL 不在候选池中' })
          return
        }
        finalContent = commandService.generateBriefTemplate(campaign, kol)
      }

      const brief = await commandService.saveBrief({
        campaignId: req.params.id,
        kolId,
        kolName,
        content: finalContent,
        aiGenerated: aiGenerated ?? false,
      })

      res.status(201).json({ success: true, brief })
    } catch (error) {
      console.error('[Campaign API] Brief 保存失败:', error)
      res.status(500).json({ success: false, error: '保存 Brief 失败' })
    }
  })

  // =====================================================================
  // 内容数据追踪
  // =====================================================================

  router.get('/:id/content-tracking', async (req, res) => {
    try {
      const tracking = await queryService.listContentTracking(req.params.id)
      res.json({ success: true, tracking })
    } catch (error) {
      console.error('[Campaign API] 内容追踪获取失败:', error)
      res.status(500).json({ success: false, error: '获取内容追踪失败' })
    }
  })

  router.post('/:id/content-tracking', async (req, res) => {
    try {
      const input = req.body
      if (!input.kolId || !input.kolName || !input.platform) {
        res.status(400).json({ success: false, error: '缺少必填字段：kolId, kolName, platform' })
        return
      }

      const tracking = await commandService.createContentTracking({
        ...input,
        campaignId: req.params.id,
      })
      res.status(201).json({ success: true, tracking })
    } catch (error) {
      console.error('[Campaign API] 内容追踪创建失败:', error)
      res.status(500).json({ success: false, error: '创建内容追踪失败' })
    }
  })

  router.patch('/content-tracking/:trackingId/data', async (req, res) => {
    try {
      const tracking = await commandService.updateContentTrackingData({
        id: req.params.trackingId,
        ...req.body,
      })
      if (!tracking) {
        res.status(404).json({ success: false, error: '内容追踪记录不存在' })
        return
      }
      res.json({ success: true, tracking })
    } catch (error) {
      console.error('[Campaign API] 内容追踪数据更新失败:', error)
      res.status(500).json({ success: false, error: '更新内容追踪数据失败' })
    }
  })

  router.patch('/content-tracking/:trackingId/paid', async (req, res) => {
    try {
      const tracking = await commandService.addPaidData({
        id: req.params.trackingId,
        ...req.body,
      })
      if (!tracking) {
        res.status(404).json({ success: false, error: '内容追踪记录不存在' })
        return
      }
      res.json({ success: true, tracking })
    } catch (error) {
      console.error('[Campaign API] 投流数据更新失败:', error)
      res.status(500).json({ success: false, error: '更新投流数据失败' })
    }
  })

  router.patch('/content-tracking/:trackingId/analysis', async (req, res) => {
    try {
      const tracking = await commandService.updateContentTrackingAnalysis({
        id: req.params.trackingId,
        ...req.body,
      })
      if (!tracking) {
        res.status(404).json({ success: false, error: '内容追踪记录不存在' })
        return
      }
      res.json({ success: true, tracking })
    } catch (error) {
      console.error('[Campaign API] 分析结果更新失败:', error)
      res.status(500).json({ success: false, error: '更新分析结果失败' })
    }
  })

  router.delete('/content-tracking/:trackingId', async (req, res) => {
    try {
      const deleted = await commandService.deleteContentTracking(req.params.trackingId)
      if (!deleted) {
        res.status(404).json({ success: false, error: '内容追踪记录不存在' })
        return
      }
      res.json({ success: true })
    } catch (error) {
      console.error('[Campaign API] 内容追踪删除失败:', error)
      res.status(500).json({ success: false, error: '删除内容追踪失败' })
    }
  })

  router.post('/content-tracking/analyze', async (req, res) => {
    try {
      const { platform, priceTier, followersRange, ctr, engagementRate, cpm, cpe } = req.body
      if (!platform || !priceTier || !followersRange) {
        res.status(400).json({ success: false, error: '缺少必填字段：platform, priceTier, followersRange' })
        return
      }

      const result = await commandService.analyzeContentPerformance(
        platform,
        priceTier,
        followersRange,
        Number(ctr ?? 0),
        Number(engagementRate ?? 0),
        Number(cpm ?? 0),
        Number(cpe ?? 0),
      )

      res.json({ success: true, result })
    } catch (error) {
      console.error('[Campaign API] 内容性能分析失败:', error)
      res.status(500).json({ success: false, error: '内容性能分析失败' })
    }
  })

  // =====================================================================
  // 内容审核
  // =====================================================================

  router.get('/:id/content-audits', async (req, res) => {
    try {
      const audits = await commandService.listContentAudits(req.params.id)
      res.json({ success: true, audits })
    } catch (error) {
      console.error('[Campaign API] 内容审核列表获取失败:', error)
      res.status(500).json({ success: false, error: '获取内容审核列表失败' })
    }
  })

  router.post('/:id/content-audits', async (req, res) => {
    try {
      const { kolId, kolName, brand, product, platform, contentType, contentDescription, contentUrl } = req.body
      if (!kolId || !kolName || !brand || !product || !contentDescription) {
        res.status(400).json({ success: false, error: '缺少必填字段：kolId, kolName, brand, product, contentDescription' })
        return
      }

      const audit = await commandService.createContentAudit({
        campaignId: req.params.id,
        kolId,
        kolName,
        brand,
        product,
        platform: platform ?? 'xiaohongshu',
        contentType: contentType ?? '图文',
        contentDescription,
        contentUrl,
      })

      res.status(201).json({ success: true, audit })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Campaign API] 内容审核失败:', error)
      if (message.includes('未注入')) {
        res.status(503).json({ success: false, error: message })
        return
      }
      res.status(500).json({ success: false, error: '内容审核失败' })
    }
  })

  // =====================================================================
  // 工作流（阶段 B2）
  // =====================================================================

  router.get('/:id/workflow', async (req, res) => {
    try {
      const workflow = await commandService.loadWorkflow(req.params.id)
      res.json({ success: true, workflow })
    } catch (error) {
      console.error('[Campaign API] 工作流加载失败:', error)
      res.status(500).json({ success: false, error: '加载工作流失败' })
    }
  })

  router.patch('/:id/workflow/steps/:stepId', async (req, res) => {
    try {
      const workflow = await commandService.updateWorkflowStep({
        campaignId: req.params.id,
        stepId: req.params.stepId,
        ...req.body,
      })
      res.json({ success: true, workflow })
    } catch (error) {
      console.error('[Campaign API] 工作流步骤更新失败:', error)
      res.status(500).json({ success: false, error: '更新工作流步骤失败' })
    }
  })

  router.post('/:id/workflow/advance', async (req, res) => {
    try {
      const { stepId, nextStepId } = req.body
      if (!stepId || !nextStepId) {
        res.status(400).json({ success: false, error: '缺少 stepId 或 nextStepId' })
        return
      }
      const workflow = await commandService.advanceWorkflow({
        campaignId: req.params.id,
        stepId,
        nextStepId,
      })
      res.json({ success: true, workflow })
    } catch (error) {
      console.error('[Campaign API] 工作流推进失败:', error)
      res.status(500).json({ success: false, error: '推进工作流失败' })
    }
  })

  router.post('/:id/workflow/reset', async (req, res) => {
    try {
      const workflow = await commandService.resetWorkflow(req.params.id)
      res.json({ success: true, workflow })
    } catch (error) {
      console.error('[Campaign API] 工作流重置失败:', error)
      res.status(500).json({ success: false, error: '重置工作流失败' })
    }
  })

  router.get('/:id/workflow/current-step', async (req, res) => {
    try {
      const step = await commandService.getCurrentWorkflowStep(req.params.id)
      res.json({ success: true, step })
    } catch (error) {
      console.error('[Campaign API] 当前步骤获取失败:', error)
      res.status(500).json({ success: false, error: '获取当前步骤失败' })
    }
  })

  router.post('/:id/workflow/steps/:stepId/validate', async (req, res) => {
    try {
      const stepId = req.params.stepId as CampaignWorkflowStepId
      const result = await commandService.validateStepArtifacts(req.params.id, stepId)
      res.json({ success: true, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Campaign API] 产物校验失败:', error)
      if (message.includes('步骤不存在') || message.includes('未知步骤')) {
        res.status(400).json({ success: false, error: message })
        return
      }
      res.status(500).json({ success: false, error: '产物校验失败' })
    }
  })

  router.post('/:id/workflow/steps/:stepId/complete', async (req, res) => {
    try {
      const stepId = req.params.stepId as CampaignWorkflowStepId
      const { messages } = req.body
      const result = await commandService.completeStepWithValidation(req.params.id, stepId, messages)
      res.json({ success: true, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Campaign API] 步骤完成失败:', error)
      if (message.includes('步骤不存在') || message.includes('未知步骤')) {
        res.status(400).json({ success: false, error: message })
        return
      }
      res.status(500).json({ success: false, error: '步骤完成失败' })
    }
  })

  // =====================================================================
  // 工作流产物预览
  // =====================================================================

  router.get('/:id/workflow/artifacts/:stepId', async (req, res) => {
    try {
      const { id, stepId } = req.params
      const dirName = STEP_DIR_MAP[stepId as CampaignWorkflowStepId]
      if (!dirName) {
        res.status(400).json({ success: false, error: '未知步骤 ID' })
        return
      }
      const files = await workspaceFileService.listFiles('campaign', id, dirName, true)
      res.json({ success: true, files })
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取产物列表失败'
      console.error('[Campaign API] 产物列表获取失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  router.get('/:id/workflow/artifacts/:stepId/*', async (req, res) => {
    try {
      const { id, stepId } = req.params
      const dirName = STEP_DIR_MAP[stepId as CampaignWorkflowStepId]
      if (!dirName) {
        res.status(400).json({ success: false, error: '未知步骤 ID' })
        return
      }
      const filePath = normalizeRelativePath((req.params as Record<string, string>)['0'])
      const relativePath = `${dirName}/${filePath}`
      const format = req.query.format === 'base64' ? 'base64' : 'text'

      if (format === 'base64') {
        const data = await workspaceFileService.readFileAsBase64('campaign', id, relativePath)
        res.json({ success: true, data, encoding: 'base64' })
        return
      }
      const content = await workspaceFileService.readTextFile('campaign', id, relativePath)
      res.json({ success: true, content })
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取产物失败'
      console.error('[Campaign API] 产物读取失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  return router
}

function normalizeRelativePath(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/^\/+/, '')
}
