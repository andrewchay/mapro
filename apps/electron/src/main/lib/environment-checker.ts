/**
 * 环境检测服务（营销场景简化版）
 *
 * 已简化：移除 Node.js 和 Git 检测（营销 Agent 不需要）。
 * 保留接口兼容，返回"环境已就绪"状态。
 */

import type { EnvironmentCheckResult } from '@ma-proma/shared'

/**
 * 执行简化的环境检测
 *
 * 营销 Agent 场景不需要 Node.js / Git / Bun 环境，
 * 直接返回已就绪状态，避免用户看到不必要的环境警告。
 *
 * @returns 环境检测结果
 */
export async function checkEnvironment(): Promise<EnvironmentCheckResult> {
  console.log('[环境检测] 营销 Agent 环境检测（已简化）...')

  const platform = process.platform as 'darwin' | 'win32' | 'linux'

  const result: EnvironmentCheckResult = {
    nodejs: {
      installed: true,
      version: 'N/A',
      meetsMinimum: true,
      meetsRecommended: true,
      downloadUrl: 'https://nodejs.org/',
    },
    git: {
      installed: true,
      version: 'N/A',
      meetsRequirement: true,
      downloadUrl: 'https://git-scm.com/',
    },
    platform,
    hasIssues: false,
    checkedAt: Date.now(),
  }

  console.log('[环境检测] 营销 Agent 环境已就绪（Node.js/Git 检测已跳过）')

  return result
}
