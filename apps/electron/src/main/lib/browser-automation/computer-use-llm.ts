/**
 * Computer Use LLM Caller
 *
 * 将截图、任务描述、历史动作封装成多模态消息，调用 MAPro 的 LLM 服务获取下一步操作。
 */

import { complete, type LLMContentPart } from '../ma-tools/llm-service.ts'
import { parseLLMAction } from './computer-use-service.ts'
import type { LLMVisionCaller } from './computer-use-types.ts'

/**
 * 创建默认的 Computer Use LLM Caller
 */
export function createComputerUseLLMCaller(): LLMVisionCaller {
  return async ({ systemPrompt, task, screenshotBase64, history }) => {
    const historyText = history
      .map((h, index) => {
        return `第 ${index + 1} 步\n思考：${h.thought ?? ''}\n动作：${JSON.stringify(h.action)}`
      })
      .join('\n\n')

    const promptText = `任务：${task}\n\n历史操作：\n${historyText || '无'}\n\n请根据当前截图决定下一步操作，只返回 JSON。`

    const content: LLMContentPart[] = [
      { type: 'text', text: promptText },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
    ]

    const result = await complete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      { jsonMode: true, maxTokens: 4000, temperature: 0.5 },
    )

    if (!result.success) {
      throw new Error(result.error ?? 'LLM 调用失败')
    }

    return parseLLMAction(result.text)
  }
}
