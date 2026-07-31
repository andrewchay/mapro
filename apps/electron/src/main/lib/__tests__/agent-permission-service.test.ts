/**
 * AgentPermissionService 行为测试
 *
 * 覆盖 Web Bridge 站点信任机制：
 * - 默认逐次确认 Web Bridge 写操作
 * - 用户选择"信任此站点"后，同域名操作在本会话内自动放行
 * - 跨域名、Upload、safe 模式、会话清理等安全边界保持不变
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PermissionRequest } from '@ma-proma/shared'
import { AgentPermissionService, type PermissionResult } from '../agent-permission-service'

const SESSION_ID = 'session-web-bridge'
const XHS_PAGE_URL = 'https://www.xiaohongshu.com/explore/abc123'
const OTHER_PAGE_URL = 'https://www.douyin.com/video/xyz'

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'mapro-permission-test-'))
  process.env.MAPRO_TEST_CONFIG_DIR = testDir
})

afterEach(() => {
  delete process.env.MAPRO_TEST_CONFIG_DIR
  rmSync(testDir, { recursive: true, force: true })
})

/** 测试辅助：发起一次工具权限检查，返回结果 Promise 与请求捕获器 */
interface PermissionHarness {
  service: AgentPermissionService
  requests: PermissionRequest[]
  canUseTool: ReturnType<AgentPermissionService['createCanUseTool']>
}

function createHarness(currentPageUrl?: string): PermissionHarness {
  const service = new AgentPermissionService()
  const requests: PermissionRequest[] = []
  const canUseTool = service.createCanUseTool(
    SESSION_ID,
    (request) => requests.push(request),
    undefined,
    undefined,
    'auto',
    () => currentPageUrl,
  )
  return { service, requests, canUseTool }
}

function callTool(harness: PermissionHarness, toolName: string, input: Record<string, unknown> = {}): Promise<PermissionResult> {
  return harness.canUseTool(toolName, input, {
    signal: new AbortController().signal,
    toolUseID: `tool-${Math.random()}`,
  })
}

/** 响应最近一次权限请求 */
function respondLast(harness: PermissionHarness, behavior: 'allow' | 'deny', alwaysAllow: boolean): void {
  const last = harness.requests.at(-1)
  expect(last).toBeDefined()
  harness.service.respondToPermission(last!.requestId, behavior, alwaysAllow)
}

describe('AgentPermissionService Web Bridge 站点信任', () => {
  test('given 未信任的站点 when WebBridgeClick then 弹出权限请求并携带站点上下文', async () => {
    const harness = createHarness(XHS_PAGE_URL)

    const pending = callTool(harness, 'WebBridgeClick', { ref: 'e12' })
    expect(harness.requests).toHaveLength(1)
    expect(harness.requests[0]!.contextUrl).toBe(XHS_PAGE_URL)

    respondLast(harness, 'allow', false)
    const result = await pending
    expect(result.behavior).toBe('allow')
  })

  test('given 用户信任站点 when 同域名点击/输入/导航 then 本会话内自动放行', async () => {
    const harness = createHarness(XHS_PAGE_URL)

    // 第一次点击：弹出请求，用户选择"信任此站点"
    const first = callTool(harness, 'WebBridgeClick', { ref: 'e12' })
    respondLast(harness, 'allow', true)
    await first
    expect(harness.requests).toHaveLength(1)

    // 后续同域名操作全部自动放行，不再打扰用户
    for (const [toolName, input] of [
      ['WebBridgeClick', { ref: 'e34' }],
      ['WebBridgeType', { ref: 'e34', text: 'hello' }],
      ['WebBridgeNavigate', { url: 'https://www.xiaohongshu.com/search?q=护肤' }],
      ['WebBridgeDownload', { url: 'https://www.xiaohongshu.com/file.csv' }],
    ] as const) {
      const result = await callTool(harness, toolName, input)
      expect(result.behavior).toBe('allow')
    }
    expect(harness.requests).toHaveLength(1)
  })

  test('given 已信任 A 站点 when 操作发生在 B 站点 then 仍需逐次确认', async () => {
    const service = new AgentPermissionService()
    const requests: PermissionRequest[] = []
    let currentUrl = XHS_PAGE_URL
    const canUseTool = service.createCanUseTool(
      SESSION_ID,
      (request) => requests.push(request),
      undefined,
      undefined,
      'auto',
      () => currentUrl,
    )

    // 在 xiaohongshu 上信任站点
    const p1 = canUseTool('WebBridgeClick', {}, { signal: new AbortController().signal, toolUseID: 't1' })
    service.respondToPermission(requests.at(-1)!.requestId, 'allow', true)
    await p1

    // 页面跳转到 douyin 后，信任不迁移，再次询问
    currentUrl = OTHER_PAGE_URL
    const p2 = canUseTool('WebBridgeClick', {}, { signal: new AbortController().signal, toolUseID: 't2' })
    expect(requests).toHaveLength(2)
    service.respondToPermission(requests.at(-1)!.requestId, 'allow', false)
    await p2

    // 回到 xiaohongshu 仍然免确认
    currentUrl = XHS_PAGE_URL
    const p3 = await canUseTool('WebBridgeClick', {}, { signal: new AbortController().signal, toolUseID: 't3' })
    expect(p3.behavior).toBe('allow')
    expect(requests).toHaveLength(2)
  })

  test('given 已信任站点 when WebBridgeUpload then 仍必须逐次确认', async () => {
    const harness = createHarness(XHS_PAGE_URL)

    const first = callTool(harness, 'WebBridgeClick', { ref: 'e12' })
    respondLast(harness, 'allow', true)
    await first

    // 即使站点已信任，Upload 依然弹出确认（上传必须经系统文件选择器）
    const upload = callTool(harness, 'WebBridgeUpload', { ref: 'e99' })
    expect(harness.requests).toHaveLength(2)
    respondLast(harness, 'allow', true) // alwaysAllow 对 Upload 不生效
    await upload

    const uploadAgain = callTool(harness, 'WebBridgeUpload', { ref: 'e99' })
    expect(harness.requests).toHaveLength(3)
    respondLast(harness, 'deny', false)
    const denied = await uploadAgain
    expect(denied.behavior).toBe('deny')
  })

  test('given 已信任站点 when safe 模式 then 写操作仍被拒绝', async () => {
    const harness = createHarness(XHS_PAGE_URL)

    const first = callTool(harness, 'WebBridgeClick', { ref: 'e12' })
    respondLast(harness, 'allow', true)
    await first

    // 切换 safe 模式后，站点信任不再生效
    const safeService = new AgentPermissionService()
    const safeRequests: PermissionRequest[] = []
    const safeCanUseTool = safeService.createCanUseTool(
      SESSION_ID,
      (request) => safeRequests.push(request),
      undefined,
      undefined,
      'safe',
      () => XHS_PAGE_URL,
    )
    const result = await safeCanUseTool('WebBridgeNavigate', { url: XHS_PAGE_URL }, {
      signal: new AbortController().signal,
      toolUseID: 't-safe',
    })
    expect(result.behavior).toBe('deny')
    expect(safeRequests).toHaveLength(0)
  })

  test('given 已信任站点 when 清理会话白名单 then 信任随之失效', async () => {
    const harness = createHarness(XHS_PAGE_URL)

    const first = callTool(harness, 'WebBridgeClick', { ref: 'e12' })
    respondLast(harness, 'allow', true)
    await first

    harness.service.clearSessionWhitelist(SESSION_ID)

    const again = callTool(harness, 'WebBridgeClick', { ref: 'e12' })
    expect(harness.requests).toHaveLength(2) // 重新弹出确认
    respondLast(harness, 'allow', false)
    await again
  })

  test('given 无法解析站点域名 when WebBridgeClick then 回退逐次确认', async () => {
    const harness = createHarness(undefined) // 无当前页面

    const pending = callTool(harness, 'WebBridgeClick', { ref: 'e12' })
    expect(harness.requests).toHaveLength(1)
    // alwaysAllow 无法记录站点信任（无域名），下次仍会询问
    respondLast(harness, 'allow', true)
    await pending

    const again = callTool(harness, 'WebBridgeClick', { ref: 'e12' })
    expect(harness.requests).toHaveLength(2)
    respondLast(harness, 'allow', false)
    await again
  })

  test('given Worker 子代理 when 站点已信任 then 自动批准不打断执行', async () => {
    const service = new AgentPermissionService()
    const requests: PermissionRequest[] = []
    const canUseTool = service.createCanUseTool(
      SESSION_ID,
      (request) => requests.push(request),
      undefined,
      undefined,
      'auto',
      () => XHS_PAGE_URL,
    )

    // 主 Agent 先信任站点
    const first = canUseTool('WebBridgeClick', {}, { signal: new AbortController().signal, toolUseID: 't1' })
    service.respondToPermission(requests.at(-1)!.requestId, 'allow', true)
    await first

    // Worker 在同站点操作直接放行
    const workerResult = await canUseTool('WebBridgeType', { text: 'hi' }, {
      signal: new AbortController().signal,
      toolUseID: 't2',
      agentID: 'worker-1',
    })
    expect(workerResult.behavior).toBe('allow')
    expect(requests).toHaveLength(1)
  })
})
