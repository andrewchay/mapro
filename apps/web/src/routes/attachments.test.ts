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

  // ===== Content-Type 安全（存储型 XSS 防护回归） =====

  test('HTML 附件强制下载，即使 query 伪造 mediaType（存储型 XSS 防护）', async () => {
    const data = Buffer.from('<script>alert(1)</script>').toString('base64')
    const uploadRes = await fetch(`${baseUrl}/chat/xss-conv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'evil.html', mediaType: 'text/html', data }),
    })
    const uploadJson = (await uploadRes.json()) as { success: boolean; attachment: FileAttachment }
    const fileId = uploadJson.attachment.localPath.split('/')[2]!

    const downloadRes = await fetch(`${baseUrl}/chat/xss-conv/${fileId}?mediaType=text/html`)
    expect(downloadRes.status).toBe(200)
    expect(downloadRes.headers.get('content-disposition')).toContain('attachment')
    expect(downloadRes.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('query 参数无法覆盖元数据类型（text/plain 不会被伪造成 text/html 内联）', async () => {
    const data = Buffer.from('<script>alert(1)</script>').toString('base64')
    const uploadRes = await fetch(`${baseUrl}/chat/xss-conv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'notes.txt', mediaType: 'text/plain', data }),
    })
    const uploadJson = (await uploadRes.json()) as { success: boolean; attachment: FileAttachment }
    const fileId = uploadJson.attachment.localPath.split('/')[2]!

    // 攻击者尝试用 query 把纯文本附件伪造成 HTML 内联渲染
    const downloadRes = await fetch(`${baseUrl}/chat/xss-conv/${fileId}?mediaType=text/html`)
    expect(downloadRes.status).toBe(200)
    // Content-Type 来自上传元数据 text/plain，且内联时带 sandbox CSP 兜底
    expect(downloadRes.headers.get('content-type')).toContain('text/plain')
    expect(downloadRes.headers.get('content-security-policy')).toBe('sandbox')
  })

  test('图片附件保持内联预览（功能不回退）', async () => {
    // 1x1 PNG
    const data =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const uploadRes = await fetch(`${baseUrl}/chat/img-conv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'pixel.png', mediaType: 'image/png', data }),
    })
    const uploadJson = (await uploadRes.json()) as { success: boolean; attachment: FileAttachment }
    const fileId = uploadJson.attachment.localPath.split('/')[2]!

    const downloadRes = await fetch(`${baseUrl}/chat/img-conv/${fileId}`)
    expect(downloadRes.status).toBe(200)
    expect(downloadRes.headers.get('content-type')).toContain('image/png')
    expect(downloadRes.headers.get('content-disposition')).toBeNull()
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
