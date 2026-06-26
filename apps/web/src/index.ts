/**
 * MAPro Web 服务入口
 *
 * 阶段 A：
 * - Express 提供 Campaign REST API
 * - WebSocket 提供 Chat 流式通道
 */

import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { loadChatConfig } from '@ma-proma/server'
import { createWebAppContext } from './context.ts'
import { createCampaignRouter } from './routes/campaign.ts'
import { createWebSocketHandler } from './websocket/index.ts'

const app = express()
const context = createWebAppContext()
const chatConfig = loadChatConfig()

app.use(cors())
app.use(express.json())

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', chatEnabled: chatConfig !== null })
})

// Campaign API
app.use('/api/campaigns', createCampaignRouter(context))

const PORT = Number(process.env.MAPRO_WEB_PORT ?? 3000)
const WS_PORT = Number(process.env.MAPRO_WS_PORT ?? 8081)

const server = app.listen(PORT, () => {
  console.log(`[MAPro Web] HTTP 服务已启动：http://localhost:${PORT}`)
  console.log(`[MAPro Web] 数据目录：${context.getConfigDir()}`)
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
