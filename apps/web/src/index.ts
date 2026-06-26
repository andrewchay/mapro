/**
 * MAPro Web 服务入口
 *
 * 阶段 A：最小 Express 服务，仅提供 Campaign 只读/创建 API。
 */

import express from 'express'
import cors from 'cors'
import { createWebAppContext } from './context.ts'
import { createCampaignRouter } from './routes/campaign.ts'

const app = express()
const context = createWebAppContext()

app.use(cors())
app.use(express.json())

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Campaign API
app.use('/api/campaigns', createCampaignRouter(context))

const PORT = Number(process.env.MAPRO_WEB_PORT ?? 3000)

app.listen(PORT, () => {
  console.log(`[MAPro Web] 服务已启动：http://localhost:${PORT}`)
  console.log(`[MAPro Web] 数据目录：${context.getConfigDir()}`)
})
