/**
 * Attachments 用户隔离测试
 *
 * 验证不同用户的附件目录互相独立。
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
import { request } from '../test-utils/http-request.ts'

function createTestContext(dataDir: string): AppContext {
  return {
    getConfigDir: () => dataDir,
    getResourcesPath: () => dataDir,
    isPackaged: () => false,
  }
}

const users: Record<string, UserContext> = {
  'user-a': { userId: 'user-a', sessionId: 's1', tenantId: 'default', roles: [], permissions: [], isSystemAccount: false },
  'user-b': { userId: 'user-b', sessionId: 's2', tenantId: 'default', roles: [], permissions: [], isSystemAccount: false },
}

describe('Attachments 用户隔离', () => {
  let dataDir: string
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-attachments-isolation-'))
    const context = createTestContext(dataDir)
    const fileProvider: FileProvider = new LocalFileProvider()

    const app = express()
    app.use(express.json({ limit: '110mb' }))
    app.use((req, _res, next) => {
      const userKey = (req.headers['x-test-user'] as string | undefined) ?? 'user-a'
      const ctx = users[userKey] ?? users['user-a']
      ;(req as unknown as RequestWithUserContext).userContext = ctx
      next()
    })
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

  async function upload(userKey: string, filename: string): Promise<FileAttachment> {
    const data = Buffer.from(`content of ${filename}`).toString('base64')
    const res = await request(baseUrl, '/chat/test-conv', {
      method: 'POST',
      headers: { 'x-test-user': userKey },
      body: { filename, mediaType: 'text/plain', data },
    })
    expect(res.json.success).toBe(true)
    return res.json.attachment as FileAttachment
  }

  async function listAttachmentIds(userKey: string): Promise<string[]> {
    const res = await request(baseUrl, '/chat/test-conv', { headers: { 'x-test-user': userKey } })
    expect(res.json.success).toBe(true)
    return ((res.json.attachments as FileAttachment[]) || []).map((a) => a.id)
  }

  test('普通用户只能看到自己的附件', async () => {
    const attachmentA = await upload('user-a', 'a.txt')
    const attachmentB = await upload('user-b', 'b.txt')

    const idsA = await listAttachmentIds('user-a')
    expect(idsA).toContain(attachmentA.id)
    expect(idsA).not.toContain(attachmentB.id)

    const idsB = await listAttachmentIds('user-b')
    expect(idsB).toContain(attachmentB.id)
    expect(idsB).not.toContain(attachmentA.id)
  })

  test('普通用户无法下载他人的附件', async () => {
    const attachmentA = await upload('user-a', 'secret.txt')
    const parts = attachmentA.localPath.split('/')
    const fileId = parts[2]!

    const res = await request(baseUrl, `/chat/test-conv/${fileId}?mediaType=text/plain`, {
      headers: { 'x-test-user': 'user-b' },
    })
    expect(res.status).toBe(404)
  })
})
