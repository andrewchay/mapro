/**
 * 渠道 REST API 测试
 *
 * 验证渠道 CRUD、API Key 加密、连接测试与模型拉取。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '@ma-proma/server'
import { ServerSecretsStore } from '@ma-proma/server'
import type { SecretsStore, FetchFn } from '@ma-proma/server'
import { createChannelsRouter } from './channels.ts'
import type { Channel, ChannelTestResult, FetchModelsResult } from '@ma-proma/shared'

function createTestContext(dataDir: string): AppContext {
  return {
    getConfigDir: () => dataDir,
    getResourcesPath: () => dataDir,
    isPackaged: () => false,
  }
}

function createMockFetch(responses: Map<string, Response>): FetchFn {
  return ((url: string) => Promise.resolve(responses.get(url) ?? new Response('not found', { status: 404 }))) as FetchFn
}

describe('Channels API', () => {
  let dataDir: string
  let context: AppContext
  let secretsStore: SecretsStore
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-channels-test-'))
    context = createTestContext(dataDir)
    secretsStore = new ServerSecretsStore('test-master-key-for-channels')

    const app = express()
    app.use(createChannelsRouter({ context, secretsStore }))

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}`
        }
        resolve()
      })
      server.on('error', reject)
    })
  })

  afterAll(() => {
    server?.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  test('默认列表包含 DeepSeek 预设渠道', async () => {
    const res = await fetch(`${baseUrl}/`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; channels: Channel[] }
    expect(json.success).toBe(true)
    expect(json.channels.length).toBe(1)
    expect(json.channels[0]?.provider).toBe('deepseek')
    expect(json.channels[0]?.name).toBe('DeepSeek')
  })

  test('创建渠道并加密 API Key', async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'My OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-secret',
        models: [{ id: 'gpt-4o', name: 'GPT-4o', enabled: true }],
        enabled: true,
      }),
    })

    expect(res.status).toBe(201)
    const json = (await res.json()) as { success: boolean; channel: Channel }
    expect(json.success).toBe(true)
    expect(json.channel.name).toBe('My OpenAI')
    expect(json.channel.apiKey).not.toBe('sk-secret')
    expect(json.channel.apiKey.startsWith('enc:')).toBe(true)

    const raw = JSON.parse(readFileSync(join(dataDir, 'channels.json'), 'utf-8')) as { channels: Channel[] }
    const stored = raw.channels.find((c) => c.id === json.channel.id)
    expect(stored?.apiKey.startsWith('enc:')).toBe(true)
  })

  test('获取单个渠道', async () => {
    const createRes = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Get Me',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'key',
        models: [],
        enabled: false,
      }),
    })
    const createJson = (await createRes.json()) as { success: boolean; channel: Channel }
    const id = createJson.channel.id

    const res = await fetch(`${baseUrl}/${id}`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; channel: Channel }
    expect(json.channel.id).toBe(id)
  })

  test('更新渠道不传入 apiKey 时保留旧值', async () => {
    const createRes = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Update Me',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'old-key',
        models: [],
        enabled: true,
      }),
    })
    const createJson = (await createRes.json()) as { success: boolean; channel: Channel }
    const id = createJson.channel.id
    const oldEncrypted = createJson.channel.apiKey

    const res = await fetch(`${baseUrl}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; channel: Channel }
    expect(json.channel.name).toBe('Updated Name')
    expect(json.channel.apiKey).toBe(oldEncrypted)
  })

  test('删除渠道后列表为空', async () => {
    const createRes = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Delete Me',
        provider: 'qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: 'key',
        models: [],
        enabled: false,
      }),
    })
    const createJson = (await createRes.json()) as { success: boolean; channel: Channel }
    const id = createJson.channel.id

    const deleteRes = await fetch(`${baseUrl}/${id}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)

    const getRes = await fetch(`${baseUrl}/${id}`)
    expect(getRes.status).toBe(404)
  })

  test('非法 provider 返回 400', async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad',
        provider: 'unknown',
        baseUrl: 'https://example.com',
        apiKey: 'key',
        models: [],
        enabled: false,
      }),
    })
    expect(res.status).toBe(400)
  })

  test('fetch-models 拉取 OpenAI 兼容模型', async () => {
    const responses = new Map<string, Response>([
      [
        'https://api.openai.com/v1/models',
        new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }] }), { status: 200 }),
      ],
    ])

    const app = express()
    app.use(createChannelsRouter({ context, secretsStore, fetchFn: createMockFetch(responses) }))

    const testServer = app.listen(0)
    const address = testServer.address()
    const testBaseUrl = address && typeof address === 'object' ? `http://localhost:${address.port}` : baseUrl

    const res = await fetch(`${testBaseUrl}/fetch-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
      }),
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; result: FetchModelsResult }
    expect(json.success).toBe(true)
    expect(json.result.models.length).toBe(2)
    expect(json.result.models[0]?.id).toBe('gpt-3.5-turbo')

    testServer.close()
  })

  test('test-direct 直接测试 Anthropic 兼容连接', async () => {
    const responses = new Map<string, Response>([
      [
        'https://api.deepseek.com/anthropic/messages',
        new Response('{}', { status: 401 }),
      ],
    ])

    const app = express()
    app.use(createChannelsRouter({ context, secretsStore, fetchFn: createMockFetch(responses) }))

    const testServer = app.listen(0)
    const address = testServer.address()
    const testBaseUrl = address && typeof address === 'object' ? `http://localhost:${address.port}` : baseUrl

    const res = await fetch(`${testBaseUrl}/test-direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'bad-key',
      }),
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; result: ChannelTestResult }
    expect(json.result.success).toBe(false)
    expect(json.result.message).toContain('API Key 无效')

    testServer.close()
  })
})
