/**
 * 渠道 REST API
 *
 * 提供渠道的增删改查、连接测试、模型拉取能力。
 */

import { Router } from 'express'
import type { Request, Response } from 'express'
import express from 'express'
import type { AppContext, SecretsStore } from '@ma-proma/server'
import type { FetchFn } from '@ma-proma/server'
import {
  listChannels,
  getChannelById,
  createChannel,
  updateChannel,
  deleteChannel,
  testChannel,
  testChannelDirect,
  fetchModels,
} from '@ma-proma/server'
import type {
  ChannelCreateInput,
  ChannelUpdateInput,
  FetchModelsInput,
  ProviderType,
  ChannelModel,
} from '@ma-proma/shared'
import { PROVIDER_DEFAULT_URLS } from '@ma-proma/shared'
import { validateChannelBaseUrl } from '@ma-proma/server'

export interface ChannelsRouterDeps {
  context: AppContext
  secretsStore: SecretsStore
  fetchFn?: FetchFn
}

const VALID_PROVIDERS = new Set<string>(Object.keys(PROVIDER_DEFAULT_URLS))

function isValidProvider(value: unknown): value is ProviderType {
  return typeof value === 'string' && VALID_PROVIDERS.has(value)
}

function isChannelModelArray(value: unknown): value is ChannelModel[] {
  if (!Array.isArray(value)) return false
  return value.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof (item as ChannelModel).id === 'string' &&
      typeof (item as ChannelModel).name === 'string' &&
      typeof (item as ChannelModel).enabled === 'boolean',
  )
}

function validateCreateInput(body: unknown): { valid: true; input: ChannelCreateInput } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: '请求体必须是 JSON 对象' }
  }

  const data = body as Record<string, unknown>

  if (typeof data.name !== 'string' || data.name.trim() === '') {
    return { valid: false, error: 'name 必填且不能为空字符串' }
  }

  if (!isValidProvider(data.provider)) {
    return { valid: false, error: `provider 必须是 ${Array.from(VALID_PROVIDERS).join('/')} 之一` }
  }

  if (typeof data.baseUrl !== 'string') {
    return { valid: false, error: 'baseUrl 必须是字符串' }
  }

  const safety = validateChannelBaseUrl(data.baseUrl)
  if (!safety.safe) {
    return { valid: false, error: `baseUrl ${safety.reason}` }
  }

  if (typeof data.apiKey !== 'string') {
    return { valid: false, error: 'apiKey 必须是字符串' }
  }

  if (!isChannelModelArray(data.models)) {
    return { valid: false, error: 'models 必须是 ChannelModel 数组' }
  }

  if (typeof data.enabled !== 'boolean') {
    return { valid: false, error: 'enabled 必须是布尔值' }
  }

  return {
    valid: true,
    input: {
      name: data.name.trim(),
      provider: data.provider,
      baseUrl: data.baseUrl.trim(),
      apiKey: data.apiKey,
      models: data.models,
      enabled: data.enabled,
    },
  }
}

function validateUpdateInput(body: unknown): { valid: true; input: ChannelUpdateInput } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: '请求体必须是 JSON 对象' }
  }

  const data = body as Record<string, unknown>
  const input: ChannelUpdateInput = {}

  if (data.name !== undefined) {
    if (typeof data.name !== 'string' || data.name.trim() === '') {
      return { valid: false, error: 'name 不能为空字符串' }
    }
    input.name = data.name.trim()
  }

  if (data.provider !== undefined) {
    if (!isValidProvider(data.provider)) {
      return { valid: false, error: `provider 必须是 ${Array.from(VALID_PROVIDERS).join('/')} 之一` }
    }
    input.provider = data.provider
  }

  if (data.baseUrl !== undefined) {
    if (typeof data.baseUrl !== 'string') {
      return { valid: false, error: 'baseUrl 必须是字符串' }
    }
    const safety = validateChannelBaseUrl(data.baseUrl)
    if (!safety.safe) {
      return { valid: false, error: `baseUrl ${safety.reason}` }
    }
    input.baseUrl = data.baseUrl.trim()
  }

  if (data.apiKey !== undefined) {
    if (typeof data.apiKey !== 'string') {
      return { valid: false, error: 'apiKey 必须是字符串' }
    }
    input.apiKey = data.apiKey
  }

  if (data.models !== undefined) {
    if (!isChannelModelArray(data.models)) {
      return { valid: false, error: 'models 必须是 ChannelModel 数组' }
    }
    input.models = data.models
  }

  if (data.enabled !== undefined) {
    if (typeof data.enabled !== 'boolean') {
      return { valid: false, error: 'enabled 必须是布尔值' }
    }
    input.enabled = data.enabled
  }

  return { valid: true, input }
}

function validateFetchModelsInput(body: unknown): { valid: true; input: FetchModelsInput } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: '请求体必须是 JSON 对象' }
  }

  const data = body as Record<string, unknown>

  if (!isValidProvider(data.provider)) {
    return { valid: false, error: `provider 必须是 ${Array.from(VALID_PROVIDERS).join('/')} 之一` }
  }

  if (typeof data.baseUrl !== 'string') {
    return { valid: false, error: 'baseUrl 必须是字符串' }
  }

  if (typeof data.apiKey !== 'string') {
    return { valid: false, error: 'apiKey 必须是字符串' }
  }

  return {
    valid: true,
    input: {
      provider: data.provider,
      baseUrl: data.baseUrl.trim(),
      apiKey: data.apiKey,
    },
  }
}

export function createChannelsRouter(deps: ChannelsRouterDeps): Router {
  const router = Router()
  const { context, secretsStore } = deps
  const fetchFn: FetchFn = deps.fetchFn ?? (globalThis.fetch as FetchFn)

  router.use(express.json({ limit: '2mb' }))

  // GET /api/channels
  router.get('/', (_req: Request, res: Response) => {
    try {
      const channels = listChannels(context, secretsStore)
      res.json({ success: true, channels })
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取渠道列表失败'
      console.error('[Channels API] 获取渠道列表失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // POST /api/channels
  router.post('/', (req: Request, res: Response) => {
    try {
      const validation = validateCreateInput(req.body)
      if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error })
        return
      }

      const channel = createChannel(context, secretsStore, validation.input)
      res.status(201).json({ success: true, channel })
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建渠道失败'
      console.error('[Channels API] 创建渠道失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // GET /api/channels/:id
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id
      if (!id) {
        res.status(400).json({ success: false, error: '缺少渠道 ID' })
        return
      }
      const channel = getChannelById(context, secretsStore, id)
      if (!channel) {
        res.status(404).json({ success: false, error: '渠道不存在' })
        return
      }
      res.json({ success: true, channel })
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取渠道失败'
      console.error('[Channels API] 获取渠道失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // PATCH /api/channels/:id
  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id
      if (!id) {
        res.status(400).json({ success: false, error: '缺少渠道 ID' })
        return
      }

      const validation = validateUpdateInput(req.body)
      if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error })
        return
      }

      const channel = updateChannel(context, secretsStore, id, validation.input)
      res.json({ success: true, channel })
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新渠道失败'
      console.error('[Channels API] 更新渠道失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // DELETE /api/channels/:id
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id
      if (!id) {
        res.status(400).json({ success: false, error: '缺少渠道 ID' })
        return
      }
      deleteChannel(context, secretsStore, id)
      res.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除渠道失败'
      console.error('[Channels API] 删除渠道失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // POST /api/channels/:id/test
  router.post('/:id/test', async (req: Request, res: Response) => {
    try {
      const id = req.params.id
      if (!id) {
        res.status(400).json({ success: false, error: '缺少渠道 ID' })
        return
      }
      const result = await testChannel(context, secretsStore, fetchFn, id)
      res.json({ success: true, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : '测试连接失败'
      console.error('[Channels API] 测试连接失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // POST /api/channels/fetch-models
  router.post('/fetch-models', async (req: Request, res: Response) => {
    try {
      const validation = validateFetchModelsInput(req.body)
      if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error })
        return
      }

      const result = await fetchModels(context, secretsStore, fetchFn, validation.input)
      res.json({ success: true, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : '拉取模型失败'
      console.error('[Channels API] 拉取模型失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  // POST /api/channels/test-direct
  router.post('/test-direct', async (req: Request, res: Response) => {
    try {
      const validation = validateFetchModelsInput(req.body)
      if (!validation.valid) {
        res.status(400).json({ success: false, error: validation.error })
        return
      }

      const result = await testChannelDirect(context, secretsStore, fetchFn, validation.input)
      res.json({ success: true, result })
    } catch (error) {
      const message = error instanceof Error ? error.message : '直接测试连接失败'
      console.error('[Channels API] 直接测试连接失败:', error)
      res.status(500).json({ success: false, error: message })
    }
  })

  return router
}
