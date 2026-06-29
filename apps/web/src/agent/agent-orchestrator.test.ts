/**
 * Web Agent Orchestrator 单元测试
 *
 * 验证权限服务集成、canUseTool 分派、以及响应方法。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext, ClaudeAgentQueryOptions, PermissionResult } from '@ma-proma/server'
import {
  AgentSessionManager,
  AgentWorkspaceManager,
  ChatToolConfigService,
  ClaudeAgentAdapter,
} from '@ma-proma/server'
import type { AgentStreamPayload, MAProEvent } from '@ma-proma/shared'
import { AgentOrchestrator } from './agent-orchestrator.ts'
import type { AgentOrchestratorDeps } from './agent-orchestrator.ts'

function createTestContext(): AppContext {
  const configDir = mkdtempSync(join(tmpdir(), 'mapro-web-agent-orchestrator-'))
  return {
    getConfigDir: () => configDir,
    getResourcesPath: () => join(configDir, 'resources'),
    isPackaged: () => false,
  }
}

function createFakeSdkCliPath(configDir: string): string {
  const subpkg = `claude-agent-sdk-${process.platform}-${process.arch}`
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const dir = join(configDir, 'node_modules', '@anthropic-ai', subpkg)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, binaryName)
  writeFileSync(path, '#!/bin/sh\necho fake')
  return path
}

class FakeAdapter {
  lastOptions: ClaudeAgentQueryOptions | undefined
  private hangResolve: (() => void) | null = null
  private hanging = false

  async *query(options: ClaudeAgentQueryOptions): AsyncGenerator<Record<string, unknown>> {
    this.lastOptions = options
    if (this.hanging) {
      await new Promise<void>((resolve) => {
        this.hangResolve = resolve
      })
    }
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }
  }

  hang(): void {
    this.hanging = true
  }

  release(): void {
    this.hangResolve?.()
    this.hangResolve = null
  }

  abort(_sessionId: string): void {
    // no-op
  }
}

interface TransportMessage {
  channel: string
  data: { sessionId: string; payload: AgentStreamPayload }
}

function createOrchestrator(deps: Partial<AgentOrchestratorDeps['config']> = {}): {
  context: AppContext
  orchestrator: AgentOrchestrator
  sessionManager: AgentSessionManager
  workspaceManager: AgentWorkspaceManager
  chatToolConfigService: ChatToolConfigService
} {
  const context = createTestContext()
  const chatToolConfigService = new ChatToolConfigService({ context })
  const workspaceManager = new AgentWorkspaceManager({
    context,
    chatToolConfigService,
  })
  const sessionManager = new AgentSessionManager({
    context,
    workspaceResolver: {
      getById: (id: string) => {
        const ws = workspaceManager.getAgentWorkspace(id)
        return ws ? { id: ws.id, slug: ws.slug, name: ws.name } : undefined
      },
    },
  })
  const orchestrator = new AgentOrchestrator({
    context,
    sessionManager,
    workspaceManager,
    chatToolConfigService,
    config: {
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'claude-test',
      channelId: 'web-test',
      sdkCliPath: createFakeSdkCliPath(context.getConfigDir()),
      permissionMode: 'auto',
      ...deps,
    },
  })
  return { context, orchestrator, sessionManager, workspaceManager, chatToolConfigService }
}

describe('AgentOrchestrator', () => {
  let context: AppContext
  let orchestrator: AgentOrchestrator
  let fakeAdapter: FakeAdapter
  let originalQuery: typeof ClaudeAgentAdapter.prototype.query

  beforeEach(() => {
    const env = createOrchestrator()
    context = env.context
    orchestrator = env.orchestrator
    fakeAdapter = new FakeAdapter()
    originalQuery = ClaudeAgentAdapter.prototype.query
    ClaudeAgentAdapter.prototype.query = function (options: ClaudeAgentQueryOptions) {
      return fakeAdapter.query(options)
    } as unknown as typeof ClaudeAgentAdapter.prototype.query
  })

  afterEach(() => {
    ClaudeAgentAdapter.prototype.query = originalQuery
    try {
      rmSync(context.getConfigDir(), { recursive: true, force: true })
    } catch {
      // 忽略清理错误
    }
  })

  test('handleSend 调用 adapter.query 并传入 canUseTool', async () => {
    const session = orchestrator['sessionManager'].createAgentSession('测试', 'web-test')
    let receivedEvent = false

    const detach = orchestrator.attachTransport(session.id, {
      send: (channel: string) => {
        if (channel === 'agent:stream:event') receivedEvent = true
      },
    })

    await orchestrator.handleSend(session.id, '你好')
    detach()

    expect(fakeAdapter.lastOptions).toBeDefined()
    expect(typeof fakeAdapter.lastOptions!.canUseTool).toBe('function')
    expect(fakeAdapter.lastOptions!.allowDangerouslySkipPermissions).toBe(false)
    expect(receivedEvent).toBe(true)
  })

  test('auto 模式下只读工具自动允许', async () => {
    const session = orchestrator['sessionManager'].createAgentSession('测试', 'web-test')
    await orchestrator.handleSend(session.id, '你好')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!
    const result = (await canUseTool('Read', { file_path: '/tmp/test.md' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-1',
    })) as PermissionResult

    expect(result.behavior).toBe('allow')
  })

  test('auto 模式下危险 Bash 触发权限请求事件', async () => {
    const session = orchestrator['sessionManager'].createAgentSession('测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = orchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await orchestrator.handleSend(session.id, '你好')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!
    const abortController = new AbortController()

    // 异步触发权限请求，但不等待它完成，避免测试挂起
    const pendingPromise = canUseTool('Bash', { command: 'rm -rf /' }, {
      signal: abortController.signal,
      toolUseID: 'tu-2',
    })

    // 等待事件循环，让 permission_request 事件发出
    await new Promise((resolve) => setTimeout(resolve, 10))

    const permissionEvents = events.filter(
      (e) =>
        e.channel === 'agent:stream:event' &&
        e.data.payload.kind === 'mapro_event' &&
        e.data.payload.event.type === 'permission_request',
    )

    expect(permissionEvents.length).toBeGreaterThan(0)

    abortController.abort()
    await pendingPromise.catch(() => {})
    detach()
  })

  test('respondPermission 解析 pending 权限请求', async () => {
    const session = orchestrator['sessionManager'].createAgentSession('测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = orchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await orchestrator.handleSend(session.id, '你好')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!
    const abortController = new AbortController()

    const pendingPromise = canUseTool('Bash', { command: 'git push' }, {
      signal: abortController.signal,
      toolUseID: 'tu-3',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const requestEvent = events.find(
      (e) =>
        e.channel === 'agent:stream:event' &&
        e.data.payload.kind === 'mapro_event' &&
        e.data.payload.event.type === 'permission_request',
    )
    expect(requestEvent).toBeDefined()

    const requestId =
      requestEvent!.data.payload.kind === 'mapro_event'
        ? (requestEvent!.data.payload.event as { type: 'permission_request'; request: { requestId: string } }).request.requestId
        : ''

    orchestrator.respondPermission(session.id, { requestId, behavior: 'allow', alwaysAllow: false })

    const result = (await pendingPromise) as PermissionResult
    expect(result.behavior).toBe('allow')
    detach()
  })

  test('AskUserQuestion 触发 ask_user_request 事件，respondAskUser 解析并注入 answers', async () => {
    const session = orchestrator['sessionManager'].createAgentSession('测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = orchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await orchestrator.handleSend(session.id, '你好')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!
    const abortController = new AbortController()

    const pendingPromise = canUseTool('AskUserQuestion', {
      questions: [{
        question: '你最喜欢哪种颜色？',
        header: '颜色偏好',
        options: [{ label: '红色' }, { label: '蓝色' }],
        multiSelect: false,
      }],
    }, {
      signal: abortController.signal,
      toolUseID: 'tu-ask',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const requestEvent = events.find(
      (e) =>
        e.channel === 'agent:stream:event' &&
        e.data.payload.kind === 'mapro_event' &&
        e.data.payload.event.type === 'ask_user_request',
    )
    expect(requestEvent).toBeDefined()

    const requestId =
      requestEvent!.data.payload.kind === 'mapro_event'
        ? (requestEvent!.data.payload.event as Extract<MAProEvent, { type: 'ask_user_request' }>).request.requestId
        : ''

    orchestrator.respondAskUser(session.id, { requestId, answers: { '你最喜欢哪种颜色？': '蓝色' } })

    const result = (await pendingPromise) as PermissionResult
    expect(result.behavior).toBe('allow')
    const allowResult = result as Extract<PermissionResult, { behavior: 'allow' }>
    expect(allowResult.updatedInput).toBeDefined()
    expect(allowResult.updatedInput!.answers).toEqual({
      '你最喜欢哪种颜色？': '蓝色',
    })
    detach()
  })

  test('alwaysAllow 加入会话白名单，后续同工具自动允许', async () => {
    const session = orchestrator['sessionManager'].createAgentSession('测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = orchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await orchestrator.handleSend(session.id, '你好')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!

    // 第一次：触发权限请求并选择"总是允许"
    const controller1 = new AbortController()
    const pending1 = canUseTool('Write', { file_path: '/tmp/test.md', content: 'hello' }, {
      signal: controller1.signal,
      toolUseID: 'tu-write-1',
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const requestEvent = events.find(
      (e) =>
        e.channel === 'agent:stream:event' &&
        e.data.payload.kind === 'mapro_event' &&
        e.data.payload.event.type === 'permission_request',
    )
    expect(requestEvent).toBeDefined()
    const requestId =
      requestEvent!.data.payload.kind === 'mapro_event'
        ? (requestEvent!.data.payload.event as { type: 'permission_request'; request: { requestId: string } }).request.requestId
        : ''

    orchestrator.respondPermission(session.id, { requestId, behavior: 'allow', alwaysAllow: true })
    const result1 = (await pending1) as PermissionResult
    expect(result1.behavior).toBe('allow')

    // 第二次：同工具应自动允许，不再发送请求
    const beforeCount = events.length
    const result2 = (await canUseTool('Write', { file_path: '/tmp/another.md', content: 'world' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-write-2',
    })) as PermissionResult
    expect(result2.behavior).toBe('allow')
    expect(events.length).toBe(beforeCount)

    detach()
  })

  test('handleStop 清理 pending 权限请求并释放 Promise', async () => {
    const session = orchestrator['sessionManager'].createAgentSession('测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = orchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await orchestrator.handleSend(session.id, '你好')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!
    const abortController = new AbortController()

    const pendingPromise = canUseTool('Bash', { command: 'git push' }, {
      signal: abortController.signal,
      toolUseID: 'tu-stop',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(events.some((e) =>
      e.channel === 'agent:stream:event' &&
      e.data.payload.kind === 'mapro_event' &&
      e.data.payload.event.type === 'permission_request',
    )).toBe(true)

    orchestrator.handleStop(session.id)

    const result = (await pendingPromise) as PermissionResult
    expect(result.behavior).toBe('deny')
    detach()
  })

  test('handleStop 清理 pending AskUser 请求并释放 Promise', async () => {
    const session = orchestrator['sessionManager'].createAgentSession('测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = orchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await orchestrator.handleSend(session.id, '你好')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!
    const abortController = new AbortController()

    const pendingPromise = canUseTool('AskUserQuestion', {
      questions: [{
        question: '是否继续？',
        header: '确认',
        options: [{ label: '是' }],
        multiSelect: false,
      }],
    }, {
      signal: abortController.signal,
      toolUseID: 'tu-ask-stop',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(events.some((e) =>
      e.channel === 'agent:stream:event' &&
      e.data.payload.kind === 'mapro_event' &&
      e.data.payload.event.type === 'ask_user_request',
    )).toBe(true)

    orchestrator.handleStop(session.id)

    const result = (await pendingPromise) as PermissionResult
    expect(result.behavior).toBe('deny')
    detach()
  })

  test('handleStop 清理 pending ExitPlanMode 请求并释放 Promise', async () => {
    const session = orchestrator['sessionManager'].createAgentSession('测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = orchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await orchestrator.handleSend(session.id, '你好')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!
    const abortController = new AbortController()

    // 先进入计划模式，再触发 ExitPlanMode 才会走到审批流程
    await canUseTool('EnterPlanMode', {}, {
      signal: abortController.signal,
      toolUseID: 'tu-enter-plan',
    })

    const pendingPromise = canUseTool('ExitPlanMode', {
      allowedPrompts: [{ prompt: '写文件' }],
    }, {
      signal: abortController.signal,
      toolUseID: 'tu-plan-stop',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(events.some((e) =>
      e.channel === 'agent:stream:event' &&
      e.data.payload.kind === 'mapro_event' &&
      e.data.payload.event.type === 'exit_plan_mode_request',
    )).toBe(true)

    orchestrator.handleStop(session.id)

    const result = (await pendingPromise) as PermissionResult
    expect(result.behavior).toBe('deny')
    detach()
  })

  test('plan 模式下 Write .md 自动允许，Bash 默认拒绝', async () => {
    const planEnv = createOrchestrator({ permissionMode: 'plan' })
    const planOrchestrator = planEnv.orchestrator
    const session = planEnv.sessionManager.createAgentSession('计划模式测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = planOrchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await planOrchestrator.handleSend(session.id, '制定计划')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!

    const writeResult = (await canUseTool('Write', { file_path: '/tmp/plan.md', content: '# Plan' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-plan-write',
    })) as PermissionResult
    expect(writeResult.behavior).toBe('allow')

    const bashResult = (await canUseTool('Bash', { command: 'ls -la' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-plan-bash',
    })) as PermissionResult
    expect(bashResult.behavior).toBe('deny')
    expect((bashResult as Extract<PermissionResult, { behavior: 'deny' }>).message).toContain('计划模式')

    detach()
  })

  test('plan 模式下 ExitPlanMode 审批通过切换到 bypassPermissions', async () => {
    const planEnv = createOrchestrator({ permissionMode: 'plan' })
    const planOrchestrator = planEnv.orchestrator
    const session = planEnv.sessionManager.createAgentSession('计划审批测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = planOrchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await planOrchestrator.handleSend(session.id, '制定计划')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!
    const abortController = new AbortController()

    const pendingPromise = canUseTool('ExitPlanMode', {
      allowedPrompts: [{ tool: 'Bash', prompt: '执行构建脚本' }],
    }, {
      signal: abortController.signal,
      toolUseID: 'tu-exit-plan',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const requestEvent = events.find(
      (e) =>
        e.channel === 'agent:stream:event' &&
        e.data.payload.kind === 'mapro_event' &&
        e.data.payload.event.type === 'exit_plan_mode_request',
    )
    expect(requestEvent).toBeDefined()

    const requestId =
      requestEvent!.data.payload.kind === 'mapro_event'
        ? (requestEvent!.data.payload.event as Extract<MAProEvent, { type: 'exit_plan_mode_request' }>).request.requestId
        : ''

    planOrchestrator.respondExitPlanMode(session.id, { requestId, action: 'approve_auto' })

    const result = (await pendingPromise) as PermissionResult
    expect(result.behavior).toBe('allow')

    // 切换后 Write 非 .md 也应允许
    const writeResult = (await canUseTool('Write', { file_path: '/tmp/output.txt', content: 'done' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-post-write',
    })) as PermissionResult
    expect(writeResult.behavior).toBe('allow')

    detach()
  })

  test('plan 模式下 ExitPlanMode approve_edit 切换到 auto 模式', async () => {
    const planEnv = createOrchestrator({ permissionMode: 'plan' })
    const planOrchestrator = planEnv.orchestrator
    const session = planEnv.sessionManager.createAgentSession('计划审批测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = planOrchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await planOrchestrator.handleSend(session.id, '制定计划')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!
    const abortController = new AbortController()

    const pendingPromise = canUseTool('ExitPlanMode', {
      allowedPrompts: [{ tool: 'Bash', prompt: '执行构建脚本' }],
    }, {
      signal: abortController.signal,
      toolUseID: 'tu-exit-plan-edit',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const requestEvent = events.find(
      (e) =>
        e.channel === 'agent:stream:event' &&
        e.data.payload.kind === 'mapro_event' &&
        e.data.payload.event.type === 'exit_plan_mode_request',
    )
    expect(requestEvent).toBeDefined()

    const requestId =
      requestEvent!.data.payload.kind === 'mapro_event'
        ? (requestEvent!.data.payload.event as Extract<MAProEvent, { type: 'exit_plan_mode_request' }>).request.requestId
        : ''

    planOrchestrator.respondExitPlanMode(session.id, { requestId, action: 'approve_edit' })

    const result = (await pendingPromise) as PermissionResult
    expect(result.behavior).toBe('allow')

    // 切换后危险 Bash 应触发权限请求（auto 模式不会自动放行）
    const beforeCount = events.length
    const bashAbortController = new AbortController()
    void canUseTool('Bash', { command: 'rm -rf /' }, {
      signal: bashAbortController.signal,
      toolUseID: 'tu-post-bash',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(events.slice(beforeCount).some((e) =>
      e.channel === 'agent:stream:event' &&
      e.data.payload.kind === 'mapro_event' &&
      e.data.payload.event.type === 'permission_request',
    )).toBe(true)

    bashAbortController.abort()

    detach()
  })

  test('plan 模式下 ExitPlanMode deny 拒绝计划并保持 plan 模式', async () => {
    const planEnv = createOrchestrator({ permissionMode: 'plan' })
    const planOrchestrator = planEnv.orchestrator
    const session = planEnv.sessionManager.createAgentSession('计划审批测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = planOrchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await planOrchestrator.handleSend(session.id, '制定计划')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!
    const abortController = new AbortController()

    const pendingPromise = canUseTool('ExitPlanMode', {
      allowedPrompts: [{ tool: 'Bash', prompt: '执行构建脚本' }],
    }, {
      signal: abortController.signal,
      toolUseID: 'tu-exit-plan-deny',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const requestEvent = events.find(
      (e) =>
        e.channel === 'agent:stream:event' &&
        e.data.payload.kind === 'mapro_event' &&
        e.data.payload.event.type === 'exit_plan_mode_request',
    )
    expect(requestEvent).toBeDefined()

    const requestId =
      requestEvent!.data.payload.kind === 'mapro_event'
        ? (requestEvent!.data.payload.event as Extract<MAProEvent, { type: 'exit_plan_mode_request' }>).request.requestId
        : ''

    planOrchestrator.respondExitPlanMode(session.id, { requestId, action: 'deny' })

    const result = (await pendingPromise) as PermissionResult
    expect(result.behavior).toBe('deny')

    // deny 后仍处于 plan 模式，Bash 继续被拒绝
    const bashResult = (await canUseTool('Bash', { command: 'ls -la' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-post-bash-deny',
    })) as PermissionResult
    expect(bashResult.behavior).toBe('deny')

    detach()
  })

  test('plan 模式下 ExitPlanMode feedback 拒绝计划并附带反馈内容', async () => {
    const planEnv = createOrchestrator({ permissionMode: 'plan' })
    const planOrchestrator = planEnv.orchestrator
    const session = planEnv.sessionManager.createAgentSession('计划审批测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = planOrchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })
    await planOrchestrator.handleSend(session.id, '制定计划')

    const canUseTool = fakeAdapter.lastOptions!.canUseTool!
    const abortController = new AbortController()

    const pendingPromise = canUseTool('ExitPlanMode', {
      allowedPrompts: [{ tool: 'Bash', prompt: '执行构建脚本' }],
    }, {
      signal: abortController.signal,
      toolUseID: 'tu-exit-plan-feedback',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const requestEvent = events.find(
      (e) =>
        e.channel === 'agent:stream:event' &&
        e.data.payload.kind === 'mapro_event' &&
        e.data.payload.event.type === 'exit_plan_mode_request',
    )
    expect(requestEvent).toBeDefined()

    const requestId =
      requestEvent!.data.payload.kind === 'mapro_event'
        ? (requestEvent!.data.payload.event as Extract<MAProEvent, { type: 'exit_plan_mode_request' }>).request.requestId
        : ''

    planOrchestrator.respondExitPlanMode(session.id, { requestId, action: 'feedback', feedback: '请补充测试步骤' })

    const result = (await pendingPromise) as PermissionResult
    expect(result.behavior).toBe('deny')
    expect((result as Extract<PermissionResult, { behavior: 'deny' }>).message).toContain('请补充测试步骤')

    detach()
  })

  test('handleSend 并发守卫：同一会话处理中再次发送返回错误', async () => {
    fakeAdapter.hang()
    const session = orchestrator['sessionManager'].createAgentSession('测试', 'web-test')
    const events: TransportMessage[] = []
    const detach = orchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data: data as TransportMessage['data'] })
      },
    })

    // 第一次发送会挂起在 adapter.query
    const firstPromise = orchestrator.handleSend(session.id, '你好')

    // 等待进入 query
    await new Promise((resolve) => setTimeout(resolve, 10))

    // 第二次发送应被拒绝
    await orchestrator.handleSend(session.id, '第二条')

    const errorEvent = events.find(
      (e) => e.channel === 'agent:stream:error' && e.data.sessionId === session.id,
    )
    expect(errorEvent).toBeDefined()
    expect(((errorEvent!.data as unknown) as { error: string }).error).toContain('正在处理中')

    // 清理挂起的第一次请求
    fakeAdapter.release()
    await firstPromise
    detach()
  })

  test('handleSend 在 SDK binary 缺失早退后释放并发锁', async () => {
    const missingEnv = createOrchestrator({
      sdkCliPath: join(context.getConfigDir(), 'missing-sdk', 'claude'),
    })
    const session = missingEnv.sessionManager.createAgentSession('缺失 SDK 测试', 'web-test')
    const events: Array<{ channel: string; data: unknown }> = []
    const detach = missingEnv.orchestrator.attachTransport(session.id, {
      send: (channel: string, data: unknown) => {
        events.push({ channel, data })
      },
    })

    await missingEnv.orchestrator.handleSend(session.id, '第一次')
    await missingEnv.orchestrator.handleSend(session.id, '第二次')

    const errorMessages = events
      .filter((event) => event.channel === 'agent:stream:error')
      .map((event) => (event.data as { error?: string }).error ?? '')

    expect(errorMessages.length).toBe(2)
    expect(errorMessages.every((message) => message.includes('SDK binary 不存在'))).toBe(true)
    expect(errorMessages.some((message) => message.includes('正在处理中'))).toBe(false)

    detach()
    rmSync(missingEnv.context.getConfigDir(), { recursive: true, force: true })
  })
})
