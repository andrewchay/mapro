import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '../context/types.ts'
import { AgentSessionManager, type AgentWorkspaceResolver } from './agent-session-manager.ts'
import type { AgentMessage, SDKMessage } from '@ma-proma/shared'

function createTestContext(): AppContext {
  const configDir = mkdtempSync(join(tmpdir(), 'mapro-agent-session-manager-'))
  return {
    getConfigDir: () => configDir,
    getResourcesPath: () => join(configDir, 'resources'),
    isPackaged: () => false,
  }
}

function cleanupContext(context: AppContext): void {
  try {
    rmSync(context.getConfigDir(), { recursive: true, force: true })
  } catch {
    // 测试清理忽略错误
  }
}

describe('AgentSessionManager', () => {
  let context: AppContext
  let manager: AgentSessionManager

  beforeEach(() => {
    context = createTestContext()
    manager = new AgentSessionManager({ context })
  })

  afterEach(() => {
    cleanupContext(context)
  })

  describe('会话 CRUD', () => {
    test('创建会话后可在列表中查到', () => {
      const session = manager.createAgentSession('测试会话')
      expect(session.title).toBe('测试会话')
      expect(session.id).toBeTruthy()

      const list = manager.listAgentSessions()
      expect(list).toHaveLength(1)
      expect(list[0]!.id).toBe(session.id)
    })

    test('空列表返回空数组', () => {
      expect(manager.listAgentSessions()).toEqual([])
    })

    test('getAgentSessionMeta 返回元数据', () => {
      const session = manager.createAgentSession('查找测试')
      const found = manager.getAgentSessionMeta(session.id)
      expect(found).toBeTruthy()
      expect(found?.title).toBe('查找测试')
    })

    test('更新会话元数据并自动更新 updatedAt', async () => {
      const session = manager.createAgentSession('旧标题')
      const beforeUpdate = session.updatedAt

      await new Promise((resolve) => setTimeout(resolve, 5))

      const updated = manager.updateAgentSessionMeta(session.id, { title: '新标题' })
      expect(updated.title).toBe('新标题')
      expect(updated.updatedAt).toBeGreaterThan(beforeUpdate)

      const found = manager.getAgentSessionMeta(session.id)
      expect(found?.title).toBe('新标题')
    })

    test('更新不存在的会话抛出错误', () => {
      expect(() => manager.updateAgentSessionMeta('missing-id', { title: 'x' })).toThrow('Agent 会话不存在')
    })

    test('删除会话后消息文件一并清理', () => {
      const session = manager.createAgentSession('待删除')
      manager.appendAgentMessage(session.id, {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        createdAt: Date.now(),
      })

      manager.deleteAgentSession(session.id)

      expect(manager.listAgentSessions()).toHaveLength(0)
      expect(manager.getAgentSessionMessages(session.id)).toEqual([])
    })

    test('删除不存在的会话不抛错', () => {
      expect(() => manager.deleteAgentSession('missing-id')).not.toThrow()
    })

    test('列表按 updatedAt 降序排列', async () => {
      const first = manager.createAgentSession('第一条')
      // 确保两次创建的 updatedAt 可区分（Date.now() 同毫秒会导致 sort 不稳定）
      await new Promise((resolve) => setTimeout(resolve, 5))
      const second = manager.createAgentSession('第二条')

      const list = manager.listAgentSessions()
      expect(list[0]!.id).toBe(second.id)
      expect(list[1]!.id).toBe(first.id)
    })
  })

  describe('消息读写', () => {
    test('追加并读取 AgentMessage', () => {
      const session = manager.createAgentSession('消息测试')
      const message: AgentMessage = {
        id: 'msg-1',
        role: 'user',
        content: '你好',
        createdAt: Date.now(),
      }

      manager.appendAgentMessage(session.id, message)
      const messages = manager.getAgentSessionMessages(session.id)

      expect(messages).toHaveLength(1)
      expect(messages[0]!.content).toBe('你好')
    })

    test('追加消息自动更新会话 updatedAt 并解归档', () => {
      const session = manager.createAgentSession('归档测试')
      manager.updateAgentSessionMeta(session.id, { archived: true })

      manager.appendAgentMessage(session.id, {
        id: 'msg-1',
        role: 'user',
        content: '唤醒',
        createdAt: Date.now(),
      })

      const found = manager.getAgentSessionMeta(session.id)
      expect(found?.archived).toBe(false)
    })

    test('读取不存在会话的消息返回空数组', () => {
      expect(manager.getAgentSessionMessages('missing-id')).toEqual([])
    })

    test('追加并读取 SDKMessage', () => {
      const session = manager.createAgentSession('SDK 消息测试')
      const message: SDKMessage = {
        type: 'user',
        message: { content: [{ type: 'text', text: 'hello sdk' }] },
        parent_tool_use_id: null,
      } as SDKMessage

      manager.appendSDKMessages(session.id, [message])
      const messages = manager.getAgentSessionSDKMessages(session.id)

      expect(messages).toHaveLength(1)
      expect((messages[0] as { message?: { content?: Array<{ text?: string }> } }).message?.content?.[0]?.text).toBe(
        'hello sdk',
      )
    })

    test('SDKMessage 兼容旧 AgentMessage 格式', () => {
      const session = manager.createAgentSession('兼容测试')
      const legacy: AgentMessage = {
        id: 'legacy-1',
        role: 'user',
        content: 'legacy message',
        createdAt: 123456789,
      }

      manager.appendAgentMessage(session.id, legacy)
      const sdkMessages = manager.getAgentSessionSDKMessages(session.id)

      expect(sdkMessages).toHaveLength(1)
      expect(sdkMessages[0]!.type).toBe('user')
    })

    test('超大 SDKMessage 自动截断', () => {
      const session = manager.createAgentSession('截断测试')
      const hugeText = 'x'.repeat(300 * 1024)
      const message: SDKMessage = {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: hugeText }],
        },
        parent_tool_use_id: null,
      } as SDKMessage

      manager.appendSDKMessages(session.id, [message])
      const messages = manager.getAgentSessionSDKMessages(session.id)

      expect(messages).toHaveLength(1)
      const text = (messages[0] as { message?: { content?: Array<{ text?: string }> } }).message?.content?.[0]?.text
      expect(text!.length).toBeLessThan(300 * 1024)
      expect(text).toContain('内容已截断')
    })
  })

  describe('工作区集成', () => {
    test('创建带工作区会话时初始化子目录', () => {
      const resolver: AgentWorkspaceResolver = {
        getById: (id: string) =>
          id === 'ws-1' ? { id: 'ws-1', slug: 'test-workspace', name: '测试工作区' } : undefined,
      }
      const managerWithResolver = new AgentSessionManager({ context, workspaceResolver: resolver })

      const session = managerWithResolver.createAgentSession('工作区会话', undefined, 'ws-1')

      const messages = managerWithResolver.getAgentSessionMessages(session.id)
      expect(messages).toEqual([])
      // 工作区目录存在且包含 .claude/settings.json 与 .context
      const sessionDir = join(context.getConfigDir(), 'agent-workspaces', 'test-workspace', session.id)
      expect(existsSync(join(sessionDir, '.claude', 'settings.json'))).toBe(true)
      expect(existsSync(join(sessionDir, '.context'))).toBe(true)
    })

    test('删除带工作区会话时清理子目录', () => {
      const resolver: AgentWorkspaceResolver = {
        getById: (id: string) =>
          id === 'ws-1' ? { id: 'ws-1', slug: 'test-workspace', name: '测试工作区' } : undefined,
      }
      const managerWithResolver = new AgentSessionManager({ context, workspaceResolver: resolver })
      const session = managerWithResolver.createAgentSession('待删除工作区会话', undefined, 'ws-1')
      const sessionDir = join(context.getConfigDir(), 'agent-workspaces', 'test-workspace', session.id)

      expect(existsSync(sessionDir)).toBe(true)

      managerWithResolver.deleteAgentSession(session.id)

      expect(existsSync(sessionDir)).toBe(false)
    })
  })
})
