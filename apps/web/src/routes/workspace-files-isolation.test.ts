/**
 * Workspace Files 用户隔离测试
 *
 * 验证不同用户的工作区文件目录互相独立，且普通用户文件落在 users/{userId}/agent-workspaces/ 下。
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

describe('Workspace Files 用户隔离', () => {
  let dataDir: string
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-workspace-files-isolation-'))
    const context = createTestContext(dataDir)
    const fileProvider: FileProvider = new LocalFileProvider()

    const app = express()
    app.use((req, _res, next) => {
      const userKey = (req.headers['x-test-user'] as string | undefined) ?? 'user-a'
      const ctx = users[userKey] ?? users['user-a']
      ;(req as unknown as RequestWithUserContext).userContext = ctx
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

  async function writeText(userKey: string, scope: string, id: string, relativePath: string, content: string): Promise<void> {
    const res = await request(baseUrl, `/${scope}/${id}/${relativePath}`, {
      method: 'POST',
      headers: { 'x-test-user': userKey },
      body: { content },
    })
    expect(res.json.success).toBe(true)
  }

  async function listFiles(userKey: string, scope: string, id: string): Promise<WorkspaceFileEntry[]> {
    const res = await request(baseUrl, `/${scope}/${id}?recursive=true`, { headers: { 'x-test-user': userKey } })
    expect(res.json.success).toBe(true)
    return (res.json.files as WorkspaceFileEntry[]) || []
  }

  async function readText(userKey: string, scope: string, id: string, relativePath: string): Promise<{ status: number; content?: string }> {
    const res = await request(baseUrl, `/${scope}/${id}/${relativePath}`, { headers: { 'x-test-user': userKey } })
    if (res.status !== 200) return { status: res.status }
    return { status: res.status, content: (res.json.content as string) }
  }

  test('普通用户只能看到自己的工作区文件', async () => {
    await writeText('user-a', 'campaign', 'camp-a', 'analysis/a.md', 'A analysis')
    await writeText('user-b', 'campaign', 'camp-b', 'analysis/b.md', 'B analysis')

    const pathsA = (await listFiles('user-a', 'campaign', 'camp-a')).map((f) => f.path)
    expect(pathsA).toContain('analysis/a.md')
    expect(pathsA).not.toContain('analysis/b.md')

    const pathsB = (await listFiles('user-b', 'campaign', 'camp-b')).map((f) => f.path)
    expect(pathsB).toContain('analysis/b.md')
    expect(pathsB).not.toContain('analysis/a.md')
  })

  test('普通用户无法读取他人的工作区文件', async () => {
    await writeText('user-a', 'campaign', 'camp-secret', 'secret.md', 'secret content')

    const res = await readText('user-b', 'campaign', 'camp-secret', 'secret.md')
    expect(res.status).toBe(404)
  })

  test('普通用户文件落在 users/{userId}/agent-workspaces/ 下', async () => {
    await writeText('user-a', 'workspace', 'ws-1', 'notes.md', 'user a note')

    const diskPath = join(dataDir, 'users', 'user-a', 'agent-workspaces', 'ws-1', 'notes.md')
    expect(existsSync(diskPath)).toBe(true)
  })
})
