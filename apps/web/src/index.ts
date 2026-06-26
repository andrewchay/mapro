/**
 * MAPro Web 服务入口
 *
 * 阶段 A：
 * - Express 提供 Campaign REST API
 * - WebSocket 提供 Chat 流式通道
 * - 生产环境托管 apps/web-ui 的静态构建产物
 */

import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { loadChatConfig } from '@ma-proma/server'
import { createWebServerContext } from './context.ts'
import { createCampaignRouter } from './routes/campaign.ts'
import { createWebSocketHandler, createWebSocketTransport } from './websocket/index.ts'

const app = express()
const { appContext } = createWebServerContext()
const chatConfig = loadChatConfig()

app.use(cors())
app.use(express.json())

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', chatEnabled: chatConfig !== null })
})

// Campaign API（异步初始化 Router）
const campaignRouter = await createCampaignRouter(appContext)
app.use('/api/campaigns', campaignRouter)

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
})

const wss = new WebSocketServer({ port: WS_PORT })
const handleMessage = createWebSocketHandler(chatConfig)

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
