/**
 * Computer Use MCP Server（Agent 模式）
 *
 * 将视觉浏览器自动化能力封装为内置 MCP Server，注入到 Agent 会话。
 * 复用 Chat 模式的 computer-use-tool 执行逻辑与 chat-tools.json 配置开关。
 */

import { getToolState, getToolCredentials } from '../chat-tool-config'
import type { ToolResult } from '@ma-proma/core'

type SdkType = typeof import('@anthropic-ai/claude-agent-sdk')

/**
 * 注入 Computer Use MCP Server 到 Agent 会话
 */
export async function injectComputerUseMcpServer(
  sdk: SdkType,
  mcpServers: Record<string, Record<string, unknown>>,
): Promise<void> {
  const toolState = getToolState('computer-use')
  if (!toolState.enabled) return

  // 复用 Chat 模式凭据，无凭据时也能使用（按 URL 自动生成 Profile）
  const credentials = getToolCredentials('computer-use')

  const { z } = await import('zod')

  const server = sdk.createSdkMcpServer({
    name: 'computer-use',
    version: '1.0.0',
    tools: [
      sdk.tool(
        'computer_use',
        'Use visual browser automation to complete complex tasks. The AI sees screenshots and decides actions (goto, click, type, scroll, key, wait) step by step. Use this when the page is dynamic, requires visual judgment, or when script-based scraping fails.',
        {
          url: z.string().describe('Target webpage URL'),
          task: z.string().describe('Specific task description, e.g. "Log in to Xiaohongshu creator platform and navigate to the KOL cooperation page"'),
          maxSteps: z.number().int().min(1).max(100).optional().describe('Maximum number of steps (default 30)'),
        },
        async (args: { url: string; task: string; maxSteps?: number }) => {
          try {
            const { executeComputerUseTool } = await import('./computer-use-tool')
            const result: ToolResult = await executeComputerUseTool({
              id: `computer-use-${Date.now()}`,
              name: 'computer_use',
              arguments: {
                url: args.url,
                task: args.task,
                maxSteps: args.maxSteps,
              },
            })

            if (result.isError) {
              return {
                content: [{ type: 'text' as const, text: `视觉浏览器自动化失败：${result.content}` }],
              }
            }

            const credentialHint = credentials.userDataDir
              ? `Profile: ${credentials.userDataDir}`
              : '使用默认 Profile（按域名自动生成）'

            return {
              content: [
                {
                  type: 'text' as const,
                  text: `${result.content}\n\n[Computer Use] ${credentialHint}`,
                },
              ],
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            console.error('[Computer Use MCP] 执行失败:', error)
            return {
              content: [{ type: 'text' as const, text: `视觉浏览器自动化执行异常：${msg}` }],
            }
          }
        },
        { annotations: { readOnlyHint: false } },
      ),
    ],
  })

  mcpServers['computer-use'] = server as unknown as Record<string, unknown>
  console.log('[Computer Use MCP] 已注入内置视觉浏览器自动化工具 (computer-use)')
}
