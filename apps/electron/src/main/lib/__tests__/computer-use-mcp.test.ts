import { test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolResult } from '@ma-proma/core'

let testConfigDir: string

beforeEach(() => {
  testConfigDir = mkdtempSync(join(tmpdir(), 'mapro-cu-mcp-'))
  process.env._MAPRO_TEST_CONFIG_DIR = testConfigDir
})

afterEach(() => {
  rmSync(testConfigDir, { recursive: true, force: true })
})

interface FakeTool {
  name: string
  description: string
  inputSchema: unknown
  handler: (args: Record<string, unknown>) => Promise<unknown>
  options?: unknown
}

function createFakeSdk(tools: FakeTool[]) {
  return {
    createSdkMcpServer: ({ tools: serverTools }: { tools: FakeTool[] }) => {
      for (const t of serverTools) {
        tools.push(t)
      }
      return { tools: serverTools, name: 'computer-use' }
    },
    tool: (
      name: string,
      description: string,
      schema: unknown,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
      options?: unknown,
    ): FakeTool => ({
      name,
      description,
      inputSchema: schema,
      handler,
      options,
    }),
  }
}

test('Computer Use MCP > 工具禁用时不会注入', async () => {
  mock.module('../chat-tool-config.ts', () => ({
    getToolState: () => ({ enabled: false }),
    getToolCredentials: () => ({}),
  }))

  const { injectComputerUseMcpServer } = await import('../chat-tools/computer-use-mcp.ts')
  const sdk = createFakeSdk([])
  const mcpServers: Record<string, Record<string, unknown>> = {}

  await injectComputerUseMcpServer(sdk as never, mcpServers)

  expect(Object.keys(mcpServers)).toHaveLength(0)
})

test('Computer Use MCP > 工具启用时注入 computer_use，且 handler 能正确调用执行器', async () => {
  const executeComputerUseTool = mock(async (_toolCall: unknown): Promise<ToolResult> => ({
    toolCallId: 'cu-1',
    content: '任务已完成，截图已保存',
  }))

  mock.module('../chat-tool-config.ts', () => ({
    getToolState: () => ({ enabled: true }),
    getToolCredentials: () => ({ headless: 'true', userDataDir: '/tmp/profile' }),
  }))
  mock.module('../chat-tools/computer-use-tool.ts', () => ({
    executeComputerUseTool,
  }))

  const { injectComputerUseMcpServer } = await import('../chat-tools/computer-use-mcp.ts')
  const tools: FakeTool[] = []
  const sdk = createFakeSdk(tools)
  const mcpServers: Record<string, Record<string, unknown>> = {}

  await injectComputerUseMcpServer(sdk as never, mcpServers)

  expect(Object.keys(mcpServers)).toContain('computer-use')
  expect(tools).toHaveLength(1)
  expect(tools[0]?.name).toBe('computer_use')

  const handler = tools[0]?.handler
  if (!handler) throw new Error('tool handler not found')

  const result = (await handler({
    url: 'https://example.com',
    task: '点击登录按钮',
    maxSteps: 10,
  })) as { content: Array<{ type: string; text: string }> }

  expect(executeComputerUseTool).toHaveBeenCalled()
  const call = executeComputerUseTool.mock.calls[0]
  if (!call) throw new Error('executeComputerUseTool not called')
  const callArg = call[0] as {
    id: string
    name: string
    arguments: Record<string, unknown>
  }
  expect(callArg.name).toBe('computer_use')
  expect(callArg.arguments.url).toBe('https://example.com')
  expect(callArg.arguments.task).toBe('点击登录按钮')
  expect(callArg.arguments.maxSteps).toBe(10)

  expect(result.content[0]?.type).toBe('text')
  expect(result.content[0]?.text).toContain('任务已完成')
  expect(result.content[0]?.text).toContain('/tmp/profile')
})

test('Computer Use MCP > handler 执行失败时返回错误文本', async () => {
  mock.module('../chat-tool-config.ts', () => ({
    getToolState: () => ({ enabled: true }),
    getToolCredentials: () => ({}),
  }))
  mock.module('../chat-tools/computer-use-tool.ts', () => ({
    executeComputerUseTool: mock(async () => {
      throw new Error('browser crashed')
    }),
  }))

  const { injectComputerUseMcpServer } = await import('../chat-tools/computer-use-mcp.ts')
  const tools: FakeTool[] = []
  const sdk = createFakeSdk(tools)
  const mcpServers: Record<string, Record<string, unknown>> = {}

  await injectComputerUseMcpServer(sdk as never, mcpServers)

  const handler = tools[0]?.handler
  if (!handler) throw new Error('tool handler not found')

  const result = (await handler({
    url: 'https://example.com',
    task: 'test',
  })) as { content: Array<{ type: string; text: string }> }

  expect(result.content[0]?.text).toContain('browser crashed')
})
