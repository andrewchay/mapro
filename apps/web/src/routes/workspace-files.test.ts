/**
 * 工作区文件 REST API 测试
 *
 * 验证上传、读取、删除、列表与路径穿越防护。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext, FileProvider, UserContext, WorkspaceFileEntry } from '@ma-proma/server'
import { LocalFileProvider } from '@ma-proma/server'
import type { RequestWithUserContext } from '../auth-middleware.ts'
import { createWorkspaceFilesRouter } from './workspace-files.ts'

function createTestContext(dataDir: string): AppContext {
  return {
    getConfigDir: () => dataDir,
    getResourcesPath: () => dataDir,
    isPackaged: () => false,
  }
}

describe('Workspace Files API', () => {
  let dataDir: string
  let context: AppContext
  let fileProvider: FileProvider
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-workspace-files-test-'))
    context = createTestContext(dataDir)
    fileProvider = new LocalFileProvider()

    const app = express()
    const systemContext: UserContext = { userId: 'system', sessionId: 'test', tenantId: 'default', roles: [], permissions: ['*'], isSystemAccount: true }
    app.use((req, _res, next) => {
      ;(req as unknown as RequestWithUserContext).userContext = systemContext
      next()
    })
    app.use(createWorkspaceFilesRouter({ context, fileProvider }))

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

  test('写入文本文件后落盘位置正确', async () => {
    const res = await fetch(`${baseUrl}/campaign/camp-1/market-analysis/market-analysis.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# 市场分析' }),
    })
    expect(res.status).toBe(200)

    const diskPath = join(dataDir, 'agent-workspaces', 'campaign-camp-1', 'market-analysis', 'market-analysis.md')
    expect(existsSync(diskPath)).toBe(true)
  })

  test('读取产物 .md 返回文本内容', async () => {
    const writeRes = await fetch(`${baseUrl}/campaign/camp-2/brand-dna/brand-dna.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '品牌 DNA 内容' }),
    })
    expect(writeRes.status).toBe(200)

    const readRes = await fetch(`${baseUrl}/campaign/camp-2/brand-dna/brand-dna.md`)
    expect(readRes.status).toBe(200)
    const json = (await readRes.json()) as { success: boolean; content: string }
    expect(json.success).toBe(true)
    expect(json.content).toBe('品牌 DNA 内容')
  })

  test('列出 Campaign 工作区文件（含目录不存在返回 []）', async () => {
    const listRes = await fetch(`${baseUrl}/campaign/missing-camp`)
    expect(listRes.status).toBe(200)
    const json = (await listRes.json()) as { success: boolean; files: WorkspaceFileEntry[] }
    expect(json.files).toEqual([])
  })

  test('递归列表返回相对路径', async () => {
    await fetch(`${baseUrl}/workspace/ws-1/dir/a.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'a' }),
    })

    const listRes = await fetch(`${baseUrl}/workspace/ws-1?recursive=true`)
    expect(listRes.status).toBe(200)
    const json = (await listRes.json()) as { success: boolean; files: WorkspaceFileEntry[] }
    const paths = json.files.map((f) => f.path)
    expect(paths).toContain('dir')
    expect(paths).toContain('dir/a.md')
    for (const file of json.files) {
      expect(file.path.startsWith(dataDir)).toBe(false)
    }
  })

  test('base64 上传文件', async () => {
    const data = Buffer.from('二进制内容 🎉').toString('base64')
    const res = await fetch(`${baseUrl}/campaign/camp-3/upload/assets/image.bin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'image.bin', mediaType: 'application/octet-stream', data }),
    })
    expect(res.status).toBe(200)

    const readRes = await fetch(`${baseUrl}/campaign/camp-3/assets/image.bin`)
    const json = (await readRes.json()) as { success: boolean; data: string }
    expect(Buffer.from(json.data, 'base64').toString('utf-8')).toBe('二进制内容 🎉')
  })

  test('路径穿越被拦截', async () => {
    const res = await fetch(`${baseUrl}/campaign/camp-1/../../../../etc/passwd`)
    // Express 先 normalize 路径，最终由服务层前缀检查拦截，状态码可能是 400 或 403
    expect([400, 403]).toContain(res.status)
  })

  test('中文/空格文件名可正常读写', async () => {
    const writeRes = await fetch(`${baseUrl}/workspace/ws-2/报告/2024 年度报告.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '年度总结' }),
    })
    expect(writeRes.status).toBe(200)

    const readRes = await fetch(`${encodeURI(baseUrl)}/workspace/ws-2/报告/2024%20年度报告.md`)
    expect(readRes.status).toBe(200)
    const json = (await readRes.json()) as { success: boolean; content: string }
    expect(json.content).toBe('年度总结')
  })

  test('删除 .context/todo.md 被禁止', async () => {
    const res = await fetch(`${baseUrl}/campaign/camp-1/.context/todo.md`, { method: 'DELETE' })
    expect(res.status).toBe(403)
  })

  test('删除普通文件成功', async () => {
    await fetch(`${baseUrl}/workspace/ws-3/delete-me.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'temp' }),
    })

    const delRes = await fetch(`${baseUrl}/workspace/ws-3/delete-me.md`, { method: 'DELETE' })
    expect(delRes.status).toBe(200)

    const readRes = await fetch(`${baseUrl}/workspace/ws-3/delete-me.md`)
    expect(readRes.status).toBe(404)
  })

  test('非法 scope 返回 403', async () => {
    const res = await fetch(`${baseUrl}/agent/some-id/file.md`)
    expect(res.status).toBe(403)
  })

  test('base64 格式读取返回 base64', async () => {
    await fetch(`${baseUrl}/workspace/ws-4/hello.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'base64 please' }),
    })
    const res = await fetch(`${baseUrl}/workspace/ws-4/hello.md?format=base64`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { success: boolean; data: string; encoding: string }
    expect(json.encoding).toBe('base64')
    expect(Buffer.from(json.data, 'base64').toString('utf-8')).toBe('base64 please')
  })
})
