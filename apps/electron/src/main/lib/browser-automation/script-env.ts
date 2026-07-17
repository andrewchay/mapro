/**
 * Python 脚本执行环境构造
 *
 * LLM 生成的脚本会以子进程方式执行，若直接继承 process.env，
 * 其中的 ANTHROPIC_API_KEY 等敏感变量会暴露给生成脚本。
 * 这里用白名单构造最小环境，仅保留脚本运行必需的变量。
 */

/** 允许继承的环境变量白名单 */
const ENV_ALLOWLIST = [
  // 进程运行必需
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP',
  'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERNAME', 'USERPROFILE',
  // 区域与编码
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
  // Python 运行时
  'PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV', 'PYTHONIOENCODING',
  // 代理（爬取任务常需要走代理）
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
] as const

/**
 * 构造最小环境：白名单变量 + 调用方显式传入的变量
 *
 * @param explicit 调用方显式构造的业务参数（如 HEADLESS、COOKIES_FILE），原样透传
 */
export function buildScriptEnv(explicit: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  for (const [key, value] of Object.entries(explicit)) {
    env[key] = value
  }
  return env
}
