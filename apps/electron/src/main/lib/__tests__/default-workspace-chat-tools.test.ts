/**
 * 默认营销工作区 Chat 工具预配置测试（B3）
 *
 * 验证 ensureDefaultWorkspace() 首次创建默认营销工作区时：
 * 1. 落地 ~/.mapro/chat-tools.json
 * 2. KOL Data MCP（ma-kol-data-mcp）默认启用
 * 3. 其他 MA 工具默认启用，非 MA 工具（nano-banana）默认关闭
 * 4. 老用户已有 chat-tools.json 时保留自定义开关并补齐缺失工具
 * 5. 默认工作区已存在时不重复覆盖 chat-tools.json（幂等）
 *
 * 通过 _MAPRO_TEST_CONFIG_DIR 环境变量注入独立临时目录，避免污染真实配置。
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ===== 测试环境 =====

const TEST_DIR = join(tmpdir(), `mapro-b3-test-${Date.now()}`)

interface WorkspaceManagerModule {
  ensureDefaultWorkspace: () => import('@ma-proma/shared').AgentWorkspace
  listAgentWorkspaces: () => import('@ma-proma/shared').AgentWorkspace[]
}

interface ChatToolConfigModule {
  getChatToolsConfig: () => import('@ma-proma/shared').ChatToolsFileConfig
}

let workspaceManager: WorkspaceManagerModule
let chatToolConfig: ChatToolConfigModule

describe('B3: 默认营销工作区预配置 KOL Data MCP', () => {
  beforeAll(async () => {
    mkdirSync(TEST_DIR, { recursive: true })
    process.env._MAPRO_TEST_CONFIG_DIR = TEST_DIR

    workspaceManager = (await import('../agent-workspace-manager')) as WorkspaceManagerModule
    chatToolConfig = (await import('../chat-tool-config')) as ChatToolConfigModule
  })

  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  })

  /** 读取测试目录下的 chat-tools.json */
  function readChatToolsFile(): import('@ma-proma/shared').ChatToolsFileConfig {
    const raw = readFileSync(join(TEST_DIR, 'chat-tools.json'), 'utf-8')
    return JSON.parse(raw)
  }

  // ===== Slice 1: 首次创建默认工作区时落地 chat-tools.json =====

  it('Slice 1: 首次创建默认工作区时生成 chat-tools.json，KOL Data MCP 默认启用', () => {
    // 测试目录初始为空（无 agent-workspaces.json，无 chat-tools.json）
    expect(existsSync(join(TEST_DIR, 'chat-tools.json'))).toBe(false)

    const ws = workspaceManager.ensureDefaultWorkspace()

    // 默认营销工作区被创建
    expect(ws.slug).toBe('default')
    expect(ws.name).toBe('默认营销工作区')
    const workspaces = workspaceManager.listAgentWorkspaces()
    expect(workspaces.some((w) => w.slug === 'default')).toBe(true)

    // chat-tools.json 已落地
    expect(existsSync(join(TEST_DIR, 'chat-tools.json'))).toBe(true)

    // KOL Data MCP 默认启用（B3 核心目标）
    const config = readChatToolsFile()
    expect(config.toolStates['ma-kol-data-mcp']?.enabled).toBe(true)
  })

  // ===== Slice 2: 全部 MA 工具默认开关正确 =====

  it('Slice 2: chat-tools.json 中 MA 工具默认启用，nano-banana 默认关闭', () => {
    const config = readChatToolsFile()

    // B3 重点：KOL Data MCP 默认启用
    expect(config.toolStates['ma-kol-data-mcp']?.enabled).toBe(true)

    // 其余 MA 营销工具同样默认启用
    const expectedEnabledMaTools = [
      'ma-strategy-iq',
      'ma-match-ai',
      'ma-connect-bot',
      'ma-creative-pilot',
      'ma-kol-search',
      'ma-campaign-optimizer',
      'ma-script-studio',
      'ma-content-audit',
      'ma-campaign-tester',
      'ma-campaign-agent',
      'ma-kol-crm',
      'ma-kol-portal',
      'ma-budget-forecast',
      'ma-content-tracker',
      'ma-phase-reviewer',
    ]
    for (const toolId of expectedEnabledMaTools) {
      expect(config.toolStates[toolId]?.enabled, `${toolId} 应默认启用`).toBe(true)
    }

    // 非 MA 工具：通用工具默认启用，nano-banana 默认关闭
    expect(config.toolStates['memory']?.enabled).toBe(true)
    expect(config.toolStates['web-search']?.enabled).toBe(true)
    expect(config.toolStates['nano-banana']?.enabled).toBe(false)

    // 凭据与自定义工具初始为空
    expect(config.toolCredentials).toEqual({})
    expect(config.customTools).toEqual([])
  })

  // ===== Slice 3: 老用户 chat-tools.json 已存在时保留自定义开关并补齐缺失工具 =====

  it('Slice 3: 已有 chat-tools.json 时保留用户关闭的工具，并补齐缺失的默认工具', () => {
    // 模拟老用户：已有一份不完整的 chat-tools.json
    // - 用户手动关闭了 ma-kol-data-mcp
    // - 缺少 ma-budget-forecast（旧版本未配置）
    const legacyConfig = {
      toolStates: {
        'ma-kol-data-mcp': { enabled: false },
        memory: { enabled: false },
      },
      toolCredentials: { 'ma-kol-data-mcp': { apiKey: 'user-secret' } },
      customTools: [],
    }
    writeFileSync(join(TEST_DIR, 'chat-tools.json'), JSON.stringify(legacyConfig), 'utf-8')

    // 注意：此时默认工作区已在 Slice 1 创建，ensureDefaultWorkspace 会走 else 分支，
    // 不会再次调用 ensureDefaultChatToolsConfig。因此这里直接验证合并读取逻辑
    // （getChatToolsConfig 用 {...DEFAULT, ...data} 合并，运行时补齐缺失工具）。
    const merged = chatToolConfig.getChatToolsConfig()

    // 用户手动关闭的工具被保留
    expect(merged.toolStates['ma-kol-data-mcp']?.enabled).toBe(false)
    expect(merged.toolStates['memory']?.enabled).toBe(false)

    // 缺失的工具被补齐为默认启用
    expect(merged.toolStates['ma-budget-forecast']?.enabled).toBe(true)
    expect(merged.toolStates['ma-strategy-iq']?.enabled).toBe(true)

    // 用户凭据被保留
    expect(merged.toolCredentials['ma-kol-data-mcp']?.apiKey).toBe('user-secret')
  })

  // ===== Slice 4: 默认工作区已存在时不重复覆盖 chat-tools.json（幂等） =====

  it('Slice 4: 默认工作区已存在时再次调用 ensureDefaultWorkspace 不覆盖 chat-tools.json', () => {
    // Slice 3 已写入一份用户自定义的 chat-tools.json
    // 再次调用 ensureDefaultWorkspace（走 else 分支，不应触发 ensureDefaultChatToolsConfig）
    workspaceManager.ensureDefaultWorkspace()

    // chat-tools.json 仍为 Slice 3 写入的内容，未被重置为默认值
    const config = readChatToolsFile()
    expect(config.toolStates['ma-kol-data-mcp']?.enabled).toBe(false)
    expect(config.toolStates['memory']?.enabled).toBe(false)
    expect(config.toolCredentials['ma-kol-data-mcp']?.apiKey).toBe('user-secret')
  })
})
