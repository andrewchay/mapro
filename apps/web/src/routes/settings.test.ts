/**
 * 设置与用户档案 API 测试
 *
 * 验证默认返回值、PATCH 合并、白名单校验与字段保留。
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '@ma-proma/server'
import { createSettingsRouter } from './settings.ts'

type SettingsResponse = { success: boolean; settings?: Record<string, unknown>; errors?: Record<string, string> }
type ProfileResponse = { success: boolean; profile?: Record<string, unknown> }

function createTestContext(dataDir: string): AppContext {
  return {
    getConfigDir: () => dataDir,
    getResourcesPath: () => dataDir,
    isPackaged: () => false,
  }
}

describe('Settings API', () => {
  let dataDir: string
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mapro-settings-test-'))
    const context = createTestContext(dataDir)

    const app = express()
    app.use(createSettingsRouter(context))

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

  test('默认 settings 返回 dark 主题与默认字段', async () => {
    const res = await fetch(`${baseUrl}/settings`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as SettingsResponse
    expect(json.success).toBe(true)
    expect(json.settings?.themeMode).toBe('dark')
    expect(json.settings?.themeStyle).toBeUndefined()
    expect(json.settings?.notificationsEnabled).toBe(true)
  })

  test('PATCH themeMode 成功并返回合并后对象', async () => {
    const res = await fetch(`${baseUrl}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeMode: 'light' }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as SettingsResponse
    expect(json.success).toBe(true)
    expect(json.settings?.themeMode).toBe('light')
    expect(json.settings?.notificationsEnabled).toBe(true)
  })

  test('PATCH 未知字段被忽略，不丢失已有字段', async () => {
    const res = await fetch(`${baseUrl}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unknownField: 'ignored', themeStyle: 'ocean-light' }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as SettingsResponse
    expect(json.success).toBe(true)
    expect(json.settings?.themeStyle).toBe('ocean-light')
    expect(json.settings?.unknownField).toBeUndefined()
  })

  test('PATCH 非法 themeMode 返回 400', async () => {
    const res = await fetch(`${baseUrl}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themeMode: 'invalid' }),
    })
    expect(res.status).toBe(400)
    const json = (await res.json()) as SettingsResponse
    expect(json.errors?.themeMode).toContain('light/dark/system/special')
  })

  test('PATCH 保留 Electron 桌面端字段', async () => {
    const settingsPath = join(dataDir, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ voiceDictation: { enabled: true }, mainWindowState: { width: 1200 } }), 'utf-8')

    const res = await fetch(`${baseUrl}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archiveAfterDays: 30 }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as SettingsResponse
    expect(json.settings?.archiveAfterDays).toBe(30)

    // 读取原始文件确认桌面字段保留
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    expect(raw.voiceDictation).toEqual({ enabled: true })
    expect(raw.mainWindowState).toEqual({ width: 1200 })
    expect(raw.archiveAfterDays).toBe(30)
  })

  test('PATCH Agent 默认设置成功并持久化', async () => {
    const res = await fetch(`${baseUrl}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultAgentChannelId: 'ch-1',
        defaultAgentModelId: 'model-x',
        defaultAgentWorkspaceId: 'ws-1',
        defaultAgentPermissionMode: 'plan',
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as SettingsResponse
    expect(json.settings?.defaultAgentChannelId).toBe('ch-1')
    expect(json.settings?.defaultAgentModelId).toBe('model-x')
    expect(json.settings?.defaultAgentWorkspaceId).toBe('ws-1')
    expect(json.settings?.defaultAgentPermissionMode).toBe('plan')

    const settingsPath = join(dataDir, 'settings.json')
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    expect(raw.defaultAgentChannelId).toBe('ch-1')
    expect(raw.defaultAgentModelId).toBe('model-x')
  })

  test('PATCH Agent 默认设置可清空为 undefined', async () => {
    const settingsPath = join(dataDir, 'settings.json')
    writeFileSync(
      settingsPath,
      JSON.stringify({
        defaultAgentChannelId: 'ch-1',
        defaultAgentModelId: 'model-x',
        defaultAgentWorkspaceId: 'ws-1',
        defaultAgentPermissionMode: 'plan',
      }),
      'utf-8',
    )

    const res = await fetch(`${baseUrl}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultAgentChannelId: null,
        defaultAgentModelId: '',
        defaultAgentWorkspaceId: null,
        defaultAgentPermissionMode: null,
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as SettingsResponse
    expect(json.settings?.defaultAgentChannelId).toBeUndefined()
    expect(json.settings?.defaultAgentModelId).toBeUndefined()
    expect(json.settings?.defaultAgentWorkspaceId).toBeUndefined()
    expect(json.settings?.defaultAgentPermissionMode).toBeUndefined()
  })

  test('PATCH 非法 defaultAgentPermissionMode 返回 400', async () => {
    const res = await fetch(`${baseUrl}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultAgentPermissionMode: 'unsafe' }),
    })
    expect(res.status).toBe(400)
    const json = (await res.json()) as SettingsResponse
    expect(json.errors?.defaultAgentPermissionMode).toContain('auto/bypassPermissions/plan')
  })

  test('默认 user-profile 返回默认用户名与头像', async () => {
    const res = await fetch(`${baseUrl}/user-profile`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as ProfileResponse
    expect(json.success).toBe(true)
    expect(json.profile?.userName).toBe('用户')
    expect(json.profile?.avatar).toBe('🧑‍💻')
  })

  test('PATCH user-profile 更新用户名，空字符串回退默认值', async () => {
    const res1 = await fetch(`${baseUrl}/user-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: 'Alice' }),
    })
    expect(res1.status).toBe(200)
    const json1 = (await res1.json()) as ProfileResponse
    expect(json1.profile?.userName).toBe('Alice')

    const res2 = await fetch(`${baseUrl}/user-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: '' }),
    })
    const json2 = (await res2.json()) as ProfileResponse
    expect(json2.profile?.userName).toBe('用户')
  })
})
