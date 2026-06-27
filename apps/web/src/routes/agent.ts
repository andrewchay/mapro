/**
 * Agent REST API
 *
 * 阶段 B：暴露会话/工作区 CRUD，供 Web Agent UI 使用。
 */

import { Router } from 'express'
import type {
  AppContext,
  AgentSessionManager,
  AgentWorkspaceManager,
  ChatToolConfigService,
} from '@ma-proma/server'
import {
  AgentSessionManager as AgentSessionManagerImpl,
  AgentWorkspaceManager as AgentWorkspaceManagerImpl,
  ChatToolConfigService as ChatToolConfigServiceImpl,
} from '@ma-proma/server'

export interface AgentRouterDeps {
  context: AppContext
}

export async function createAgentRouter(deps: AgentRouterDeps) {
  const router = Router()
  const chatToolConfigService = new ChatToolConfigServiceImpl({ context: deps.context })
  const workspaceManager = new AgentWorkspaceManagerImpl({
    context: deps.context,
    chatToolConfigService,
  })
  const sessionManager = new AgentSessionManagerImpl({
    context: deps.context,
    workspaceResolver: {
      getById: (id: string) => {
        const ws = workspaceManager.getAgentWorkspace(id)
        return ws ? { id: ws.id, slug: ws.slug, name: ws.name } : undefined
      },
    },
  })

  // 确保默认工作区存在
  await workspaceManager.ensureDefaultWorkspace()

  // =====================================================================
  // 会话
  // =====================================================================

  router.get('/sessions', (_req, res) => {
    try {
      const sessions = sessionManager.listAgentSessions()
      res.json({ success: true, sessions })
    } catch (error) {
      console.error('[Agent API] 会话列表获取失败:', error)
      res.status(500).json({ success: false, error: '获取会话列表失败' })
    }
  })

  router.post('/sessions', async (req, res) => {
    try {
      const { title, workspaceId } = req.body
      const channelId = process.env.MAPRO_AGENT_CHANNEL_ID || 'web-agent'
      const meta = sessionManager.createAgentSession(title, channelId, workspaceId)
      res.json({ success: true, session: meta })
    } catch (error) {
      console.error('[Agent API] 创建会话失败:', error)
      res.status(500).json({ success: false, error: '创建会话失败' })
    }
  })

  router.get('/sessions/:id', (req, res) => {
    try {
      const meta = sessionManager.getAgentSessionMeta(req.params.id)
      if (!meta) {
        res.status(404).json({ success: false, error: '会话不存在' })
        return
      }
      const messages = sessionManager.getAgentSessionMessages(req.params.id)
      res.json({ success: true, session: meta, messages })
    } catch (error) {
      console.error('[Agent API] 获取会话详情失败:', error)
      res.status(500).json({ success: false, error: '获取会话详情失败' })
    }
  })

  router.patch('/sessions/:id', (req, res) => {
    try {
      const { title, pinned, archived } = req.body
      const updates: Partial<typeof req.body> = {}
      if (title !== undefined) updates.title = title
      if (pinned !== undefined) updates.pinned = pinned
      if (archived !== undefined) updates.archived = archived

      sessionManager.updateAgentSessionMeta(req.params.id, updates)
      const meta = sessionManager.getAgentSessionMeta(req.params.id)
      res.json({ success: true, session: meta })
    } catch (error) {
      console.error('[Agent API] 更新会话失败:', error)
      res.status(500).json({ success: false, error: '更新会话失败' })
    }
  })

  router.delete('/sessions/:id', (req, res) => {
    try {
      sessionManager.deleteAgentSession(req.params.id)
      res.json({ success: true })
    } catch (error) {
      console.error('[Agent API] 删除会话失败:', error)
      res.status(500).json({ success: false, error: '删除会话失败' })
    }
  })

  // =====================================================================
  // 工作区
  // =====================================================================

  router.get('/workspaces', (_req, res) => {
    try {
      const workspaces = workspaceManager.listAgentWorkspacesByUpdatedAt()
      res.json({ success: true, workspaces })
    } catch (error) {
      console.error('[Agent API] 工作区列表获取失败:', error)
      res.status(500).json({ success: false, error: '获取工作区列表失败' })
    }
  })

  router.get('/workspaces/:slug/capabilities', (req, res) => {
    try {
      const capabilities = workspaceManager.getWorkspaceCapabilities(req.params.slug)
      res.json({ success: true, capabilities })
    } catch (error) {
      console.error('[Agent API] 获取工作区能力失败:', error)
      res.status(500).json({ success: false, error: '获取工作区能力失败' })
    }
  })

  return router
}
