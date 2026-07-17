/**
 * MAPro Web 服务入口
 *
 * 阶段 A：
 * - Express 提供 Campaign REST API
 * - WebSocket 提供 Chat 流式通道
 * - 生产环境托管 apps/web-ui 的静态构建产物
 *
 * 阶段 B：
 * - 新增 Agent REST API 与 WebSocket 消息通道
 *
 * 阶段 C：
 * - 新增多用户 JWT 认证与 RBAC 授权
 * - 结构化 bootstrap 启动流程
 */

import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import express from 'express'
import type { Request, Response } from 'express'
import cors from 'cors'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  getApiToken,
  parseWebSocketToken,
  isLocalOrigin,
  isAllowedOrigin,
  createCorsOptions,
  API_TOKEN_COOKIE_NAME,
} from './security.ts'
import { loadChatConfig } from '@ma-proma/server'
import type { UserContext } from '@ma-proma/server'
import { createWebServerContext, createUserAppContext } from './context.ts'
import { createAuthRouter } from './routes/auth.ts'
import { createAuthMiddleware, resolveWebSocketToken } from './auth-middleware.ts'
import { createCampaignRouter } from './routes/campaign.ts'
import { createAgentRouter } from './routes/agent.ts'
import { createAttachmentsRouter } from './routes/attachments.ts'
import { createWorkspaceFilesRouter } from './routes/workspace-files.ts'
import { createSettingsRouter } from './routes/settings.ts'
import { createChannelsRouter } from './routes/channels.ts'
import { createWebSocketHandler, type AgentOrchestratorFactory } from './websocket/index.ts'
import { AgentOrchestrator } from './agent/agent-orchestrator.ts'
import {
  AgentSessionManager,
  AgentWorkspaceManager,
  ChatToolConfigService,
} from '@ma-proma/server'

async function bootstrap(): Promise<void> {
  const app = express()

  // 反向代理场景下正确识别 req.secure，确保 Secure cookie 与 HSTS 头生效
  if (process.env.MAPRO_TRUST_PROXY === '1' || process.env.NODE_ENV === 'production') {
    app.set('trust proxy', true)
  }

  // 基础安全头
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    next()
  })

  // 1. 初始化上下文与核心服务
  const { appContext, fileProvider, secretsStore, agentConfig, authService, permissionService } =
    await createWebServerContext()
  const chatConfig = loadChatConfig()
  const apiToken = getApiToken()
  const authMiddleware = createAuthMiddleware({ authService, permissionService, apiToken })

  app.use(cors(createCorsOptions()))
  // 注意：不再挂载全局 express.json()，各 Router 自行按需配置 body limit，
  // 避免大附件 / 大头像请求被默认 limit 提前拦截。

  // 健康检查（公开）
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', chatEnabled: chatConfig !== null, agentEnabled: agentConfig !== null })
  })

  // 认证路由（公开部分：setup / login / refresh / logout；/me 受保护）
  const authRouter = createAuthRouter({ authService, permissionService })
  app.use('/auth', authRouter)

  // API 层统一认证
  app.use('/api', authMiddleware)

  // Campaign API（异步初始化 Router）
  const campaignRouter = await createCampaignRouter(appContext, chatConfig)
  app.use('/api/campaigns', campaignRouter)

  // Agent API（异步初始化 Router）
  const agentRouter = await createAgentRouter({ context: appContext })
  app.use('/api/agent', agentRouter)

  // 文件附件 API
  const attachmentsRouter = createAttachmentsRouter({ context: appContext, fileProvider })
  app.use('/api/attachments', attachmentsRouter)

  // 工作区文件 API
  const workspaceFilesRouter = createWorkspaceFilesRouter({ context: appContext, fileProvider })
  app.use('/api/workspace-files', workspaceFilesRouter)

  // 设置与用户档案 API
  const settingsRouter = createSettingsRouter(appContext)
  app.use('/api', settingsRouter)

  // 渠道 API
  const channelsRouter = createChannelsRouter({ context: appContext, secretsStore })
  app.use('/api/channels', channelsRouter)

  // Agent Orchestrator 按用户隔离（WebSocket 使用）
  const agentOrchestratorPromises = new Map<string, Promise<AgentOrchestrator>>()

  function getUserAppContext(userContext: UserContext): typeof appContext {
    return userContext.isSystemAccount ? appContext : createUserAppContext(appContext, userContext.userId)
  }

  async function createUserAgentOrchestrator(userContext: UserContext): Promise<AgentOrchestrator> {
    const userAppContext = getUserAppContext(userContext)
    const chatToolConfigService = new ChatToolConfigService({ context: userAppContext })
    const workspaceManager = new AgentWorkspaceManager({
      context: userAppContext,
      chatToolConfigService,
    })
    await workspaceManager.ensureDefaultWorkspace()
    const sessionManager = new AgentSessionManager({
      context: userAppContext,
      workspaceResolver: {
        getById: (id: string) => {
          const ws = workspaceManager.getAgentWorkspace(id)
          return ws ? { id: ws.id, slug: ws.slug, name: ws.name } : undefined
        },
      },
    })
    return new AgentOrchestrator({
      context: userAppContext,
      sessionManager,
      workspaceManager,
      chatToolConfigService,
      config: agentConfig!,
    })
  }

  async function getAgentOrchestrator(userContext: UserContext): Promise<AgentOrchestrator | undefined> {
    if (!agentConfig) return undefined
    const key = `${userContext.tenantId}:${userContext.userId}`
    let promise = agentOrchestratorPromises.get(key)
    if (!promise) {
      promise = createUserAgentOrchestrator(userContext)
      agentOrchestratorPromises.set(key, promise)
    }
    return promise
  }

  function serveIndexHtml(staticDir: string): void {
    // index: false 让根路径也落到下方的 fallback 路由，从而可以统一设置 httpOnly Cookie
    app.use(express.static(staticDir, { index: false }))
    app.get('*', (req, res) => {
      const indexPath = resolve(staticDir, 'index.html')
      try {
        const html = readFileSync(indexPath, 'utf-8')
        const token = getApiToken()
        if (token) {
          // 服务账号 Token 通过 httpOnly Cookie 自动携带，避免暴露在页面全局变量中
          res.cookie(API_TOKEN_COOKIE_NAME, token, {
            httpOnly: true,
            sameSite: 'strict',
            secure: req.secure,
            path: '/',
          })
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.send(html)
      } catch {
        res.status(500).send('无法加载前端页面')
      }
    })
  }

  // 生产环境：托管前端静态资源
  const staticDir = process.env.MAPRO_WEB_UI_DIR
  if (staticDir && existsSync(staticDir)) {
    serveIndexHtml(staticDir)
  } else {
    const defaultStaticDir = resolve(process.cwd(), '../web-ui/dist')
    if (existsSync(defaultStaticDir)) {
      serveIndexHtml(defaultStaticDir)
    }
  }

  const PORT = Number(process.env.MAPRO_WEB_PORT ?? 3000)
  const WS_PORT = Number(process.env.MAPRO_WS_PORT ?? 8081)
  // 安全：默认只监听 127.0.0.1，远程访问需显式设置 MAPRO_WEB_HOST=0.0.0.0
  const HOST = process.env.MAPRO_WEB_HOST ?? '127.0.0.1'

  const server = app.listen(PORT, HOST, () => {
    console.log(`[MAPro Web] HTTP 服务已启动：http://${HOST}:${PORT}`)
    console.log(`[MAPro Web] 数据目录：${appContext.getConfigDir()}`)
    console.log(`[MAPro Web] Chat 状态：${chatConfig ? `已启用 (${chatConfig.provider})` : '未配置'}`)
    console.log(`[MAPro Web] Agent 状态：${agentConfig ? `已启用 (${agentConfig.provider})` : '未配置'}`)
    if (HOST === '0.0.0.0' && !getApiToken() && process.env.MAPRO_AUTH_DISABLED !== '1') {
      console.warn(
        '[MAPro Web] 安全警告：服务已绑定到 0.0.0.0 但未启用认证降级或配置服务账号 Token，请确保已启用 JWT 认证或前置反向代理。',
      )
    }
  })

  const wss = new WebSocketServer({
    port: WS_PORT,
    host: HOST,
    verifyClient: async ({ origin, req }, done) => {
      const token = parseWebSocketToken(req)
      const userContext = await resolveWebSocketToken(token, { authService, permissionService, apiToken })
      if (!userContext) {
        console.log('[WebSocket] 拒绝未授权连接')
        done(false, 401, 'Unauthorized')
        return
      }
      // 将用户上下文附加到 WebSocket 升级请求，供后续 handler 使用
      ;(req as Request & { userContext?: typeof userContext }).userContext = userContext

      // 无论是否配置 token 都校验 Origin：token 可经 httpOnly cookie 自动携带，
      // DNS rebinding 场景下同站 cookie 会随 WS 握手发送（CSWSH 防护）
      if (process.env.MAPRO_AUTH_DISABLED !== '1' && origin && !isLocalOrigin(origin) && !isAllowedOrigin(origin)) {
        console.log(`[WebSocket] 拒绝非白名单 Origin: ${origin}`)
        done(false, 403, 'Forbidden Origin')
        return
      }
      done(true)
    },
  })
  const { handleMessage, handleClose } = createWebSocketHandler(chatConfig, getAgentOrchestrator, { context: appContext, fileProvider })

  // 心跳保活：30s 一轮 ping，未响应的连接下一轮直接 terminate，
  // 防止客户端断网未发 close frame 的半开连接常驻（transports/detach 泄漏）
  const WS_PING_INTERVAL_MS = 30_000
  const aliveSockets = new WeakSet<WebSocket>()
  const pingInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (!aliveSockets.has(ws)) {
        console.log('[WebSocket] 心跳超时，终止半开连接')
        ws.terminate()
        continue
      }
      aliveSockets.delete(ws)
      ws.ping()
    }
  }, WS_PING_INTERVAL_MS)
  wss.on('close', () => clearInterval(pingInterval))

  wss.on('connection', async (ws, req) => {
    console.log('[WebSocket] 客户端已连接')
    aliveSockets.add(ws)
    ws.on('pong', () => aliveSockets.add(ws))

    const userContext = (req as Request & { userContext?: UserContext }).userContext
    if (!userContext) {
      console.error('[WebSocket] 连接缺少 userContext，断开')
      ws.close()
      return
    }

    ws.on('close', () => {
      console.log('[WebSocket] 客户端已断开')
      handleClose(ws)
    })

    ws.on('error', (error) => {
      console.error('[WebSocket] 客户端错误:', error)
    })

    try {
      const agentOrchestrator = await getAgentOrchestrator(userContext)
      ws.on('message', (message) => {
        handleMessage(ws, message.toString(), agentOrchestrator, userContext)
      })
    } catch (error) {
      console.error('[WebSocket] 创建 Agent Orchestrator 失败:', error)
      ws.close()
    }
  })

  console.log(`[MAPro Web] WebSocket 服务已启动：ws://localhost:${WS_PORT}`)

  // 优雅关闭：Docker 停容器时发 SIGTERM，需停止接受新连接并清理资源
  // WS 连接关闭会触发各客户端的 handleClose → detachTransport，从而中断 Agent 推送
  let shuttingDown = false
  function shutdown(signal: string): void {
    if (shuttingDown) {
      console.log(`[MAPro Web] 再次收到 ${signal}，强制退出`)
      process.exit(1)
    }
    shuttingDown = true
    console.log(`[MAPro Web] 收到 ${signal}，开始优雅关闭…`)

    // 停止接受新连接：先关 WebSocket，再关 HTTP
    wss.close()
    server.close()

    // 释放 Agent 编排器资源（审计日志落盘）
    for (const promise of agentOrchestratorPromises.values()) {
      promise.then((orchestrator) => orchestrator.dispose()).catch(() => {
        // 忽略已失败 orchestrator 的 dispose
      })
    }

    // WS 长连接可能让 server.close() 一直挂起，给一个 grace period 后强制退出
    setTimeout(() => {
      console.log('[MAPro Web] 已关闭，退出进程')
      process.exit(0)
    }, 1000)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

bootstrap().catch((error) => {
  console.error('[MAPro Web] 启动失败:', error instanceof Error ? error.message : error)
  process.exit(1)
})
