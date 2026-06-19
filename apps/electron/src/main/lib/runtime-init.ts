/**
 * 运行时初始化协调器
 *
 * 负责协调运行时初始化逻辑，包括：
 * 1. Shell 环境加载（macOS）
 * 2. Shell 环境检测（Windows - Git Bash / WSL）
 *
 * 已简化：移除 Node.js / Bun / Git 检测（营销场景不需要）
 */

import type { RuntimeStatus, RuntimeInitOptions, ShellEnvironmentStatus } from '@ma-proma/shared'
import { loadShellEnv } from './shell-env'
import { detectGitBash } from './git-bash-detector'
import { detectWsl } from './wsl-detector'

/** 运行时状态缓存 */
let runtimeStatusCache: RuntimeStatus | null = null

/** 初始化标志 */
let isInitialized = false

/**
 * 初始化运行时环境
 *
 * 按顺序执行：
 * 1. loadShellEnv() - 加载 Shell 环境（仅 macOS 打包环境）
 * 2. detectShellEnvironment() - 检测 Shell 环境（仅 Windows）
 *
 * @param options - 初始化选项
 * @returns 运行时状态
 */
export async function initializeRuntime(options: RuntimeInitOptions = {}): Promise<RuntimeStatus> {
  const startTime = Date.now()
  console.log('[运行时初始化] 开始初始化运行时环境...')

  // 1. 加载 Shell 环境
  let envLoaded = false

  if (!options.skipEnvLoad) {
    try {
      const shellEnvResult = await loadShellEnv()
      envLoaded = shellEnvResult.success
    } catch (error) {
      console.error('[运行时初始化] Shell 环境加载失败:', error)
      envLoaded = false
    }
  }

  // 2. 检测 Shell 环境（仅 Windows 平台）
  let shellEnvironmentStatus: ShellEnvironmentStatus | undefined

  if (process.platform === 'win32' && !options.skipShellDetection) {
    try {
      const gitBashStatus = await detectGitBash()
      const wslStatus = await detectWsl()

      // 推荐策略：优先 Git Bash > WSL 2 > WSL 1
      let recommended: 'git-bash' | 'wsl' | null = null
      if (gitBashStatus.available) {
        recommended = 'git-bash'
      } else if (wslStatus.available) {
        recommended = 'wsl'
      }

      shellEnvironmentStatus = {
        gitBash: gitBashStatus,
        wsl: wslStatus,
        recommended,
      }

      console.log('[运行时初始化] Shell 环境检测完成:', {
        gitBash: gitBashStatus.available ? `✅ ${gitBashStatus.version}` : `❌ ${gitBashStatus.error}`,
        wsl: wslStatus.available
          ? `✅ WSL ${wslStatus.version} (${wslStatus.defaultDistro})`
          : `❌ ${wslStatus.error}`,
        recommended: recommended || '⚠️ 无可用环境',
      })
    } catch (error) {
      console.error('[运行时初始化] Shell 环境检测失败:', error)
    }
  }

  // 构建运行时状态（简化版：移除 Node/Bun/Git 检测）
  const runtimeStatus: RuntimeStatus = {
    node: { available: false, path: null, version: null, error: '营销 Agent 不需要 Node.js 检测' },
    bun: { available: false, path: null, version: null, source: null, error: '营销 Agent 不需要 Bun 检测' },
    git: { available: false, version: null, path: null, error: '营销 Agent 不需要 Git 检测' },
    shell: shellEnvironmentStatus,
    envLoaded,
    initializedAt: Date.now(),
  }

  // 缓存状态
  runtimeStatusCache = runtimeStatus
  isInitialized = true

  const duration = Date.now() - startTime
  console.log(`[运行时初始化] 初始化完成 (耗时 ${duration}ms)`)
  console.log('[运行时初始化] 状态:', {
    node: '⏭️ 跳过（营销场景不需要）',
    bun: '⏭️ 跳过（营销场景不需要）',
    git: '⏭️ 跳过（营销场景不需要）',
    shell: shellEnvironmentStatus
      ? `${shellEnvironmentStatus.recommended ? '✅' : '⚠️'} ${shellEnvironmentStatus.recommended || '无可用环境'}`
      : '⏭️ 跳过（非 Windows）',
    envLoaded: envLoaded ? '✅' : '⚠️ 未加载或不需要',
  })

  return runtimeStatus
}

/**
 * 获取当前运行时状态
 *
 * @returns 运行时状态，如果未初始化返回 null
 */
export function getRuntimeStatus(): RuntimeStatus | null {
  return runtimeStatusCache
}

/**
 * 检查运行时是否已初始化
 *
 * @returns 是否已初始化
 */
export function isRuntimeInitialized(): boolean {
  return isInitialized
}

/**
 * 重新初始化运行时
 *
 * @param options - 初始化选项
 * @returns 新的运行时状态
 */
export async function reinitializeRuntime(options: RuntimeInitOptions = {}): Promise<RuntimeStatus> {
  isInitialized = false
  runtimeStatusCache = null
  return initializeRuntime(options)
}

// 重新导出子模块的函数，方便外部使用
export { loadShellEnv } from './shell-env'
