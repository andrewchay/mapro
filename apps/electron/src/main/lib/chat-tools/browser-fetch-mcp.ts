/**
 * Browser Fetch MCP Server（Agent 模式）
 *
 * 为 Agent 提供可抓取登录态页面的工具，作为 SDK WebFetch 的替代方案。
 * 复用 web-scraper 的凭据配置（浏览器 Profile、Cookie、代理等）。
 */

import { getToolState, getToolCredentials } from '../chat-tool-config'
import type { ToolResult } from '@ma-proma/core'
import {
  executeBrowserFetchTask,
  getDefaultUserDataDir,
  resolveTimeoutMs,
} from '../browser-automation/browser-automation-service'

type SdkType = typeof import('@anthropic-ai/claude-agent-sdk')

/**
 * 注入 Browser Fetch MCP Server 到 Agent 会话
 */
export async function injectBrowserFetchMcpServer(
  sdk: SdkType,
  mcpServers: Record<string, Record<string, unknown>>,
): Promise<void> {
  const toolState = getToolState('web-scraper')
  if (!toolState.enabled) return

  const credentials = getToolCredentials('web-scraper')
  const { z } = await import('zod')

  const server = sdk.createSdkMcpServer({
    name: 'browser-fetch',
    version: '1.0.0',
    tools: [
      sdk.tool(
        'browser_fetch',
        'Fetch a webpage using a real browser with persistent profile and cookies. Use this when the page requires login or when the built-in WebFetch fails because it cannot access authenticated content.',
        {
          url: z.string().describe('Target webpage URL'),
          format: z.enum(['html', 'text', 'markdown']).optional().describe('Output format: html (default), text, or markdown'),
          waitMs: z.number().int().min(0).max(120_000).optional().describe('Extra wait time in milliseconds after page load'),
          selector: z.string().optional().describe('Optional CSS selector to extract only a specific element'),
        },
        async (args: { url: string; format?: 'html' | 'text' | 'markdown'; waitMs?: number; selector?: string }) => {
          try {
            const userDataDir =
              typeof credentials.userDataDir === 'string' && credentials.userDataDir.trim()
                ? credentials.userDataDir.trim()
                : getDefaultUserDataDir(args.url)

            const result = await executeBrowserFetchTask(
              {
                url: args.url,
                format: args.format,
                waitMs: args.waitMs,
                selector: args.selector,
              },
              {
                userDataDir,
                cookies: typeof credentials.cookies === 'string' ? credentials.cookies : undefined,
                headless: credentials.headless !== 'false',
                proxy: typeof credentials.proxy === 'string' ? credentials.proxy : undefined,
                userAgent: typeof credentials.userAgent === 'string' ? credentials.userAgent : undefined,
                timeoutMs: resolveTimeoutMs(credentials.timeoutMs),
              },
            )

            if (!result.success) {
              return {
                content: [{ type: 'text' as const, text: `browser_fetch 失败：${result.error ?? '未知错误'}\n\n任务目录：${result.taskDir}` }],
              }
            }

            return {
              content: [{ type: 'text' as const, text: result.summary }],
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            console.error('[Browser Fetch MCP] 执行失败:', error)
            return {
              content: [{ type: 'text' as const, text: `browser_fetch 执行异常：${msg}` }],
            }
          }
        },
        { annotations: { readOnlyHint: true } },
      ),
    ],
  })

  mcpServers['browser-fetch'] = server as unknown as Record<string, unknown>
  console.log('[Browser Fetch MCP] 已注入浏览器页面抓取工具 (browser-fetch)')
}
