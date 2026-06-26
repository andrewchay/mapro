/**
 * MAPro Web 阶段 A 冒烟测试
 *
 * 测试内容：
 * 1. 后端健康检查
 * 2. Campaign CRUD
 * 3. KOL 候选池 / 内容追踪只读 API
 * 4. Chat WebSocket 未配置提示
 */

import { spawn } from 'node:child_process'
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const TEST_PORT = 3999
const TEST_WS_PORT = 8999
const TEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'mapro-smoke-'))

let serverProcess: ReturnType<typeof spawn> | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function startServer(): Promise<void> {
  serverProcess = spawn('bun', ['run', '--filter=@ma-proma/web', 'start'], {
    env: {
      ...process.env,
      MAPRO_DATA_DIR: TEST_DATA_DIR,
      MAPRO_WEB_PORT: String(TEST_PORT),
      MAPRO_WS_PORT: String(TEST_WS_PORT),
    },
    stdio: 'pipe',
  })

  // 等待服务启动
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${TEST_PORT}/health`)
      if (res.ok) return
    } catch {
      // 继续等待
    }
    await sleep(500)
  }
  throw new Error('服务启动超时')
}

async function stopServer(): Promise<void> {
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    await sleep(1000)
    if (!serverProcess.killed) {
      serverProcess.kill('SIGKILL')
    }
  }
  rmSync(TEST_DATA_DIR, { recursive: true, force: true })
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`http://localhost:${TEST_PORT}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

async function testWebSocket(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${TEST_WS_PORT}`)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('WebSocket 测试超时'))
    }, 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'chat',
        payload: { conversationId: 'smoke', messages: [], userMessage: 'hello' },
      }))
    })

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (message.type === 'chat-stream-event' && message.data?.type === 'error') {
        clearTimeout(timeout)
        ws.close()
        resolve()
      }
    })

    ws.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

async function run(): Promise<void> {
  console.log('[Smoke Test] 启动服务...')
  await startServer()

  try {
    console.log('[Smoke Test] 1. 健康检查')
    const health = await fetch(`http://localhost:${TEST_PORT}/health`).then((r) => r.json())
    console.assert(health.status === 'ok', '健康检查失败')
    console.log('  ✅', health)

    console.log('[Smoke Test] 2. 创建 Campaign')
    const { campaign } = await fetchApi<{ campaign: { id: string; name: string } }>('/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: '冒烟测试 Campaign',
        brand: '测试品牌',
        platform: 'xiaohongshu',
        budget: 100000,
        durationMonths: 3,
      }),
    })
    console.assert(campaign.name === '冒烟测试 Campaign', '创建 Campaign 失败')
    console.log('  ✅', campaign.id)

    console.log('[Smoke Test] 3. 获取 Campaign 列表')
    const { campaigns } = await fetchApi<{ campaigns: { id: string }[] }>('/campaigns')
    console.assert(campaigns.length === 1, 'Campaign 列表数量不对')
    console.log('  ✅ 列表数量:', campaigns.length)

    console.log('[Smoke Test] 4. 获取 Campaign 详情')
    const { campaign: detail } = await fetchApi<{ campaign: { id: string } }>(`/campaigns/${campaign.id}`)
    console.assert(detail.id === campaign.id, 'Campaign 详情不匹配')
    console.log('  ✅')

    console.log('[Smoke Test] 5. 获取 KOL 候选池')
    const { pool } = await fetchApi<{ pool: unknown[] }>(`/campaigns/${campaign.id}/kol-pool`)
    console.assert(Array.isArray(pool), '候选池返回格式错误')
    console.log('  ✅ 数量:', pool.length)

    console.log('[Smoke Test] 6. 获取内容追踪')
    const { tracking } = await fetchApi<{ tracking: unknown[] }>(`/campaigns/${campaign.id}/content-tracking`)
    console.assert(Array.isArray(tracking), '内容追踪返回格式错误')
    console.log('  ✅ 数量:', tracking.length)

    console.log('[Smoke Test] 7. WebSocket Chat 未配置提示')
    await testWebSocket()
    console.log('  ✅')

    console.log('\n[Smoke Test] 全部通过 🎉')
  } finally {
    await stopServer()
  }
}

run().catch((error) => {
  console.error('\n[Smoke Test] 失败:', error)
  process.exit(1)
})
