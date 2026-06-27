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
import { existsSync } from 'node:fs'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { loadChatConfig } from '@ma-proma/server'
import { createWebServerContext } from './context.ts'
import { createCampaignRouter } from './routes/campaign.ts'
import { createAgentRouter } from './routes/agent.ts'
import { createWebSocketHandler, createWebSocketTransport } from './websocket/index.ts'
import { AgentOrchestrator } from './agent/agent-orchestrator.ts'
import {
  AgentSessionManager,
  AgentWorkspaceManager,
  ChatToolConfigService,
} from '@ma-proma/server'

const app = express()
const { appContext, agentConfig } = createWebServerContext()
const chatConfig = loadChatConfig()

app.use(cors())
app.use(express.json())

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', chatEnabled: chatConfig !== null, agentEnabled: agentConfig !== null })
})

// Campaign API（异步初始化 Router）
const campaignRouter = await createCampaignRouter(appContext)
app.use('/api/campaigns', campaignRouter)

// Agent API（异步初始化 Router）
const agentRouter = await createAgentRouter({ context: appContext })
app.use('/api/agent', agentRouter)

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

// 生产环境：托管前端静态资源
const staticDir = process.env.MAPRO_WEB_UI_DIR
if (staticDir && existsSync(staticDir)) {
  app.use(express.static(staticDir))
  app.get('*', (_req, res) => {
    res.sendFile(resolve(staticDir, 'index.html'))
  })
} else {
  const defaultStaticDir = resolve(process.cwd(), '../web-ui/dist')
  if (existsSync(defaultStaticDir)) {
    app.use(express.static(defaultStaticDir))
    app.get('*', (_req, res) => {
      res.sendFile(resolve(defaultStaticDir, 'index.html'))
    })
  }
}

const PORT = Number(process.env.MAPRO_WEB_PORT ?? 3000)
const WS_PORT = Number(process.env.MAPRO_WS_PORT ?? 8081)

app.listen(PORT, () => {
  console.log(`[MAPro Web] HTTP 服务已启动：http://localhost:${PORT}`)
  console.log(`[MAPro Web] 数据目录：${appContext.getConfigDir()}`)
  console.log(`[MAPro Web] Chat 状态：${chatConfig ? `已启用 (${chatConfig.provider})` : '未配置'}`)
  console.log(`[MAPro Web] Agent 状态：${agentConfig ? `已启用 (${agentConfig.provider})` : '未配置'}`)
})

const wss = new WebSocketServer({ port: WS_PORT })
const handleMessage = createWebSocketHandler(chatConfig, agentOrchestrator)

wss.on('connection', (ws) => {
  console.log('[WebSocket] 客户端已连接')

  ws.on('message', (message) => {
    handleMessage(ws, message.toString())
  })

  ws.on('close', () => {
    console.log('[WebSocket] 客户端已断开')
  })

  ws.on('error', (error) => {
    console.error('[WebSocket] 客户端错误:', error)
  })
})

console.log(`[MAPro Web] WebSocket 服务已启动：ws://localhost:${WS_PORT}`)
