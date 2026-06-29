/**
 * 文件附件 API 测试
 *
 * 验证上传、下载、删除、列表与路径穿越防护。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext, FileProvider, UserContext } from '@ma-proma/server'
import { LocalFileProvider } from '@ma-proma/server'
import type { RequestWithUserContext } from '../auth-middleware.ts'
import { createAttachmentsRouter } from './attachments.ts'
import type { FileAttachment } from '@ma-proma/shared'

function createTestContext(dataDir: string): AppContext {
  return {
    getConfigDir: () => dataDir,
    getResourcesPath: () => dataDir,
    isPackaged: () => false,
  }
}

describe('Attachments API', () => {
  let dataDir: string
  let context: AppContext
  let fileProvider: FileProvider
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-attachments-test-'))
    context = createTestContext(dataDir)
    fileProvider = new LocalFileProvider()

    const app = express()
    const systemContext: UserContext = { userId: 'system', sessionId: 'test', tenantId: 'default', roles: [], permissions: ['*'], isSystemAccount: true }
    app.use((req, _res, next) => {
      ;(req as unknown as RequestWithUserContext).userContext = systemContext
      next()
    })
    app.use(express.json({ limit: '110mb' }))
    app.use(createAttachmentsRouter({ context, fileProvider }))

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

  test('上传并返回 FileAttachment', async () => {
    const data = Buffer.from('hello world').toString('base64')
    const res = await fetch(`${baseUrl}/chat/test-conv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'hello.txt', mediaType: 'text/plain', data }),
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; attachment: FileAttachment }
    expect(json.success).toBe(true)
    expect(json.attachment.filename).toBe('hello.txt')
    expect(json.attachment.mediaType).toBe('text/plain')
    expect(json.attachment.size).toBe(11)
    expect(json.attachment.localPath).toMatch(/^chat\/test-conv\/[\w-]+\.txt$/)
  })

  test('上传缺少必填字段返回 400', async () => {
    const res = await fetch(`${baseUrl}/chat/test-conv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  test('下载附件返回正确内容与 MIME', async () => {
    const data = Buffer.from('download me').toString('base64')
    const uploadRes = await fetch(`${baseUrl}/chat/test-conv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'download.txt', mediaType: 'text/plain', data }),
    })
    const uploadJson = (await uploadRes.json()) as { success: boolean; attachment: FileAttachment }
    const parts = uploadJson.attachment.localPath.split('/')
    const fileId = parts[2]!

    const downloadRes = await fetch(`${baseUrl}/chat/test-conv/${fileId}?mediaType=text/plain`)
    expect(downloadRes.status).toBe(200)
    expect(downloadRes.headers.get('content-type')).toContain('text/plain')
    const text = await downloadRes.text()
    expect(text).toBe('download me')
  })

  test('删除附件后再次下载返回 404', async () => {
    const data = Buffer.from('delete me').toString('base64')
    const uploadRes = await fetch(`${baseUrl}/chat/test-conv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'delete.txt', mediaType: 'text/plain', data }),
    })
    const uploadJson = (await uploadRes.json()) as { success: boolean; attachment: FileAttachment }
    const parts = uploadJson.attachment.localPath.split('/')
    const fileId = parts[2]!

    const deleteRes = await fetch(`${baseUrl}/chat/test-conv/${fileId}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)

    const downloadRes = await fetch(`${baseUrl}/chat/test-conv/${fileId}?mediaType=text/plain`)
    expect(downloadRes.status).toBe(404)
  })

  test('非法 fileId 返回 400', async () => {
    const res = await fetch(`${baseUrl}/chat/test-conv/..%2Fpasswd?mediaType=text/plain`)
    expect(res.status).toBe(400)
  })

  test('列表附件返回元信息', async () => {
    const data = Buffer.from('list me').toString('base64')
    await fetch(`${baseUrl}/chat/list-conv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'list.txt', mediaType: 'text/plain', data }),
    })

    const listRes = await fetch(`${baseUrl}/chat/list-conv`)
    expect(listRes.status).toBe(200)
    const listJson = (await listRes.json()) as { success: boolean; attachments: FileAttachment[] }
    expect(listJson.success).toBe(true)
    expect(listJson.attachments.length).toBeGreaterThanOrEqual(1)
    expect(listJson.attachments.some((a) => a.filename === 'list.txt')).toBe(true)
  })
})
