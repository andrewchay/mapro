/**
 * 渠道 URL 安全校验
 *
 * 防止 fetch-models / test-direct / test-channel 被用作 SSRF 探针。
 * 限制：
 * - 仅允许 HTTPS 协议（local/dev 测试场景通过注入 fetchFn 绕过真实请求）
 * - 拒绝 IP 地址、localhost、私有网段、链路本地地址
 * - 拒绝空 hostname 或过长 hostname
 * - 出站前解析 DNS，拒绝解析到内网/链路本地/回环地址的域名（DNS rebinding 防护）
 */

import dns from 'node:dns/promises'

const MAX_HOSTNAME_LENGTH = 253

/** 私有 / 特殊 IPv4 网段正则 */
const PRIVATE_IPV4_PATTERNS = [
  /^0\./, // 0.0.0.0/8
  /^10\./, // 10.0.0.0/8
  /^127\./, // 127.0.0.0/8
  /^169\.254\./, // 169.254.0.0/16
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./, // 100.64.0.0/10
  /^255\./, // 255.0.0.0/8
]

const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback'])

function looksLikeIpv4(value: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value)
}

function isPrivateIpv4(value: string): boolean {
  return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(value))
}

function isPrivateIpv6(value: string): boolean {
  const lower = value.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  // fc00::/7 (unique local), fe80::/10 (link-local), ::ffff:0:0/96 (IPv4 mapped)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true
  if (lower.startsWith('::ffff:')) return true
  return false
}

export function isDangerousHostname(hostname: string): boolean {
  if (LOCAL_HOSTNAMES.has(hostname.toLowerCase())) return true
  if (looksLikeIpv4(hostname)) return isPrivateIpv4(hostname)
  if (hostname.includes(':')) return isPrivateIpv6(hostname)
  return false
}

/** 解析 hostname 的所有 A 记录 */
export async function resolveHostIps(hostname: string): Promise<string[]> {
  try {
    return await dns.resolve(hostname)
  } catch {
    return []
  }
}

/**
 * 异步校验：在字面量校验后额外执行 DNS 解析，防止 DNS rebinding。
 * 注意：TLS 连接仍依赖证书与 SNI，此校验仅作为 SSRF 防御层。
 */
export async function validateChannelBaseUrlAsync(baseUrl: string): Promise<UrlSafetyResult> {
  const literal = validateChannelBaseUrl(baseUrl)
  if (!literal.safe) return literal

  const url = new URL(baseUrl)
  const ips = await resolveHostIps(url.hostname)
  if (ips.length === 0) {
    return { safe: false, reason: '无法解析主机地址' }
  }

  for (const ip of ips) {
    if (isDangerousHostname(ip)) {
      return { safe: false, reason: `DNS 解析到禁止地址: ${ip}` }
    }
  }

  return { safe: true }
}

export interface UrlSafetyResult {
  safe: boolean
  reason?: string
}

/**
 * 校验渠道 Base URL 是否可用于服务端出站请求。
 */
export function validateChannelBaseUrl(baseUrl: string): UrlSafetyResult {
  if (!baseUrl || typeof baseUrl !== 'string') {
    return { safe: false, reason: 'baseUrl 不能为空' }
  }

  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return { safe: false, reason: 'baseUrl 不是合法 URL' }
  }

  if (url.protocol !== 'https:') {
    return { safe: false, reason: '仅允许 HTTPS 协议' }
  }

  const hostname = url.hostname
  if (!hostname) {
    return { safe: false, reason: 'baseUrl 缺少 hostname' }
  }

  if (hostname.length > MAX_HOSTNAME_LENGTH) {
    return { safe: false, reason: 'hostname 过长' }
  }

  if (isDangerousHostname(hostname)) {
    return { safe: false, reason: '禁止访问本地/私有地址' }
  }

  return { safe: true }
}
