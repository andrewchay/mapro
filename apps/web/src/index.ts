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
 */

import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import express from 'express'
import type { Request, Response } from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import {
  getApiToken,
  validateBearerToken,
  parseWebSocketToken,
  isValidWebSocketToken,
  isLocalOrigin,
  createCorsOptions,
} from './security.ts'
import { loadChatConfig } from '@ma-proma/server'
import { createWebServerContext } from './context.ts'
import { createCampaignRouter } from './routes/campaign.ts'
import { createAgentRouter } from './routes/agent.ts'
import { createAttachmentsRouter } from './routes/attachments.ts'
import { createWorkspaceFilesRouter } from './routes/workspace-files.ts'
import { createSettingsRouter } from './routes/settings.ts'
import { createChannelsRouter } from './routes/channels.ts'
import { createWebSocketHandler, createWebSocketTransport } from './websocket/index.ts'
import { AgentOrchestrator } from './agent/agent-orchestrator.ts'
import {
  AgentSessionManager,
  AgentWorkspaceManager,
  ChatToolConfigService,
} from '@ma-proma/server'

const app = express()
const { appContext, fileProvider, secretsStore, agentConfig } = createWebServerContext()
const chatConfig = loadChatConfig()

app.use(cors(createCorsOptions()))
// 注意：不再挂载全局 express.json()，各 Router 自行按需配置 body limit，
// 避免大附件 / 大头像请求被默认 limit 提前拦截。

// 安全：若配置了 MAPRO_API_TOKEN，则敏感 API 需要 Bearer Token 鉴权
function requireAuth(req: Request, res: Response, next: () => void): void {
  if (validateBearerToken(req.headers.authorization)) {
    next()
    return
  }
  res.status(401).json({ success: false, error: '未授权：需要有效的 Bearer Token' })
}

// 健康检查（公开）
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', chatEnabled: chatConfig !== null, agentEnabled: agentConfig !== null })
})

app.use('/api', requireAuth)

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

// Agent Orchestrator（WebSocket 使用）
let agentOrchestrator: AgentOrchestrator | undefined
if (agentConfig) {
  const chatToolConfigService = new ChatToolConfigService({ context: appContext })
  const workspaceManager = new AgentWorkspaceManager({
    context: appContext,
    chatToolConfigService,
  })
  const sessionManager = new AgentSessionManager({
    context: appContext,
    workspaceResolver: {
      getById: (id: string) => {
        const ws = workspaceManager.getAgentWorkspace(id)
        return ws ? { id: ws.id, slug: ws.slug, name: ws.name } : undefined
      },
    },
  })
  agentOrchestrator = new AgentOrchestrator({
    context: appContext,
    sessionManager,
    workspaceManager,
    chatToolConfigService,
    config: agentConfig,
  })
}

function serveIndexHtml(staticDir: string): void {
  app.use(express.static(staticDir))
  app.get('*', (_req, res) => {
    const indexPath = resolve(staticDir, 'index.html')
    try {
      let html = readFileSync(indexPath, 'utf-8')
      const apiToken = getApiToken()
      if (apiToken) {
        // 将 token 注入前端运行时，避免用户手动输入；此 token 本身已通过 Authorization 校验
        const tokenScript = `<script>window.MAPRO_API_TOKEN=${JSON.stringify(apiToken)}</script>`
        html = html.replace('</head>', `${tokenScript}</head>`)
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
  if (HOST === '0.0.0.0' && !getApiToken()) {
    console.warn(
      '[MAPro Web] 安全警告：服务已绑定到 0.0.0.0 但未设置 MAPRO_API_TOKEN，外部网络可直接访问 Chat/Agent API 与 WebSocket。生产环境请务必设置强随机 Token。',
    )
  }
})

const wss = new WebSocketServer({
  port: WS_PORT,
  host: HOST,
  verifyClient: ({ origin, req }, done) => {
    const token = parseWebSocketToken(req)
    if (!isValidWebSocketToken(token)) {
      console.log('[WebSocket] 拒绝未授权连接')
      done(false, 401, 'Unauthorized')
      return
    }
    // 未配置 token 时限制本地 origin，防止任意网页通过 WS 驱动 Chat/Agent
    if (!getApiToken() && origin && !isLocalOrigin(origin)) {
      console.log(`[WebSocket] 拒绝非本地 Origin: ${origin}`)
      done(false, 403, 'Forbidden Origin')
      return
    }
    done(true)
  },
})
const { handleMessage, handleClose } = createWebSocketHandler(chatConfig, agentOrchestrator, { context: appContext, fileProvider })

wss.on('connection', (ws) => {
  console.log('[WebSocket] 客户端已连接')

  ws.on('message', (message) => {
    handleMessage(ws, message.toString())
  })

  ws.on('close', () => {
    console.log('[WebSocket] 客户端已断开')
    handleClose(ws)
  })

  ws.on('error', (error) => {
    console.error('[WebSocket] 客户端错误:', error)
  })
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
  agentOrchestrator?.dispose()

  // WS 长连接可能让 server.close() 一直挂起，给一个 grace period 后强制退出
  setTimeout(() => {
    console.log('[MAPro Web] 已关闭，退出进程')
    process.exit(0)
  }, 1000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
