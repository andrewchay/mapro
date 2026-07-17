/**
 * 代理 Fetch 工具
 *
 * 基于 undici ProxyAgent 创建支持 HTTP 代理的 fetch 函数。
 * 用于渠道配置了代理地址时，让 AI API 请求走指定代理。
 *
 * ProxyAgent 按 proxyUrl 缓存复用：每条消息新建 ProxyAgent 会泄漏连接池。
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici'
import type { RequestInfo, RequestInit } from 'undici'

/** 按 proxyUrl 缓存的 ProxyAgent 连接池 */
const dispatcherCache = new Map<string, ProxyAgent>()

/**
 * 创建代理 fetch 函数
 *
 * @param proxyUrl 代理地址（如 http://127.0.0.1:7890）
 * @returns 走代理的 fetch 函数，签名兼容全局 fetch
 */
export function createProxyFetch(proxyUrl: string): typeof globalThis.fetch {
  let dispatcher = dispatcherCache.get(proxyUrl)
  if (!dispatcher) {
    dispatcher = new ProxyAgent(proxyUrl)
    dispatcherCache.set(proxyUrl, dispatcher)
  }

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    return undiciFetch(input as RequestInfo, {
      ...init,
      dispatcher,
    })
  }) as unknown as typeof globalThis.fetch
}

/**
 * 根据代理地址获取 fetch 函数
 *
 * 如果 proxyUrl 有值则返回代理 fetch，否则返回全局 fetch。
 */
export function getFetchFn(proxyUrl?: string): typeof globalThis.fetch {
  if (proxyUrl?.trim()) {
    return createProxyFetch(proxyUrl.trim())
  }
  return fetch
}

/**
 * 关闭所有缓存的 ProxyAgent 连接池（应用退出时调用）
 */
export async function closeAllProxyAgents(): Promise<void> {
  const agents = [...dispatcherCache.values()]
  dispatcherCache.clear()
  await Promise.allSettled(agents.map((agent) => agent.close()))
}
