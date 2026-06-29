/**
 * Agent REST API
 *
 * 阶段 B：暴露会话/工作区 CRUD，供 Web Agent UI 使用。
 * 阶段 C1：按请求用户构造隔离的 sessionManager / workspaceManager / chatToolConfigService，
 *         数据落盘到 ~/.mapro/users/{userId}/ 下。
 */

import express, { Router } from 'express'
import { AsyncLocalStorage } from 'node:async_hooks'
import type {
  AppContext,
  UserContext,
  AgentSessionManager,
  AgentWorkspaceManager,
  ChatToolConfigService,
} from '@ma-proma/server'
import {
  AgentSessionManager as AgentSessionManagerImpl,
  AgentWorkspaceManager as AgentWorkspaceManagerImpl,
  ChatToolConfigService as ChatToolConfigServiceImpl,
} from '@ma-proma/server'
import type { RequestWithUserContext } from '../auth-middleware.ts'
import { createUserAppContext } from '../context.ts'

export interface AgentRouterDeps {
  context: AppContext
}

const requestContext = new AsyncLocalStorage<UserContext>()

function createRequestProxy<T extends object>(factory: (userContext: UserContext) => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const userContext = requestContext.getStore()
      if (!userContext) {
        throw new Error('Agent 服务需要在请求上下文中使用')
      }
      const instance = factory(userContext)
      const value = (instance as Record<string | symbol, unknown>)[prop as string]
      if (typeof value === 'function') {
        return value.bind(instance)
      }
      return value
    },
  })
}

export async function createAgentRouter(deps: AgentRouterDeps) {
  const router = Router()
  router.use(express.json({ limit: '2mb' }))

  // 把 userContext 绑定到当前请求，后续服务代理会按用户创建实例
  router.use((req: RequestWithUserContext, _res, next) => {
    if (!req.userContext) {
      next(new Error('Agent 路由缺少 userContext，请确认 authMiddleware 已挂载'))
      return
    }
    requestContext.run(req.userContext, () => next())
  })

  const baseContext = deps.context

  const chatToolConfigService = createRequestProxy((userContext) => {
    const userAppContext = userContext.isSystemAccount ? baseContext : createUserAppContext(baseContext, userContext.userId)
    return new ChatToolConfigServiceImpl({ context: userAppContext })
  })

  const workspaceManager = createRequestProxy((userContext) => {
    const userAppContext = userContext.isSystemAccount ? baseContext : createUserAppContext(baseContext, userContext.userId)
    return new AgentWorkspaceManagerImpl({
      context: userAppContext,
      chatToolConfigService: new ChatToolConfigServiceImpl({ context: userAppContext }),
    })
  })

  const sessionManager = createRequestProxy((userContext) => {
    const userAppContext = userContext.isSystemAccount ? baseContext : createUserAppContext(baseContext, userContext.userId)
    const userWorkspaceManager = new AgentWorkspaceManagerImpl({
      context: userAppContext,
      chatToolConfigService: new ChatToolConfigServiceImpl({ context: userAppContext }),
    })
    return new AgentSessionManagerImpl({
      context: userAppContext,
      workspaceResolver: {
        getById: (id: string) => {
          const ws = userWorkspaceManager.getAgentWorkspace(id)
          return ws ? { id: ws.id, slug: ws.slug, name: ws.name } : undefined
        },
      },
    })
  })

  async function ensureDefaultWorkspace(): Promise<void> {
    await workspaceManager.ensureDefaultWorkspace()
  }

  // =====================================================================
  // 会话
  // =====================================================================

  router.get('/sessions', async (_req, res) => {
    try {
      await ensureDefaultWorkspace()
      const sessions = sessionManager.listAgentSessions()
      res.json({ success: true, sessions })
    } catch (error) {
      console.error('[Agent API] 会话列表获取失败:', error)
      res.status(500).json({ success: false, error: '获取会话列表失败' })
    }
  })

  router.post('/sessions', async (req, res) => {
    try {
      await ensureDefaultWorkspace()
      const { title, workspaceId } = req.body
      const channelId = process.env.MAPRO_AGENT_CHANNEL_ID || 'web-agent'
      const meta = sessionManager.createAgentSession(title, channelId, workspaceId)
      res.json({ success: true, session: meta })
    } catch (error) {
      console.error('[Agent API] 创建会话失败:', error)
      res.status(500).json({ success: false, error: '创建会话失败' })
    }
  })

  router.get('/sessions/:id', async (req, res) => {
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

  router.patch('/sessions/:id', async (req, res) => {
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
      res.status(allowsStatusFromError(error)).json({ success: false, error: '更新会话失败' })
    }
  })

  router.delete('/sessions/:id', async (req, res) => {
    try {
      sessionManager.deleteAgentSession(req.params.id)
      res.json({ success: true })
    } catch (error) {
      console.error('[Agent API] 删除会话失败:', error)
      res.status(allowsStatusFromError(error)).json({ success: false, error: '删除会话失败' })
    }
  })

  // =====================================================================
  // 工作区
  // =====================================================================

  router.get('/workspaces', async (_req, res) => {
    try {
      await ensureDefaultWorkspace()
      const workspaces = workspaceManager.listAgentWorkspacesByUpdatedAt()
      res.json({ success: true, workspaces })
    } catch (error) {
      console.error('[Agent API] 工作区列表获取失败:', error)
      res.status(500).json({ success: false, error: '获取工作区列表失败' })
    }
  })

  router.get('/workspaces/:slug/capabilities', async (req, res) => {
    try {
      const capabilities = workspaceManager.getWorkspaceCapabilities(req.params.slug)
      res.json({ success: true, capabilities })
    } catch (error) {
      console.error('[Agent API] 获取工作区能力失败:', error)
      res.status(allowsStatusFromError(error)).json({ success: false, error: '获取工作区能力失败' })
    }
  })

  return router
}

function allowsStatusFromError(error: unknown): number {
  if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }
  return 500
}
