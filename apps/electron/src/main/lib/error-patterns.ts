/**
 * 瞬时网络错误模式
 *
 * 覆盖上游 API 偶发断流/抖动：API SSE 流中途 terminated、TCP 连接被重置、
 * DNS 抖动、fetch 层超时等。这些错误无 HTTP 状态码，SDK HTTP 客户端层
 * 内置的 2 次重试无法完全消化时，会穿透到 Orchestrator 应用层兜底。
 */
export const TRANSIENT_NETWORK_PATTERN =
  /terminated|socket hang up|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network error|stream (?:closed|ended|disconnected) prematurely|premature close/i

/** 判断错误消息/stderr 是否为瞬时网络错误 */
export function isTransientNetworkError(message?: string, stderr?: string): boolean {
  if (!message && !stderr) return false
  return (
    (!!message && TRANSIENT_NETWORK_PATTERN.test(message)) ||
    (!!stderr && TRANSIENT_NETWORK_PATTERN.test(stderr))
  )
}

/**
 * 鉴权失败模式：命中即视为 API Key/凭据无效，永不自动重试，应直接透出给用户。
 * 不重试的原因：401/403 重试只会反复拿到同样的错误，反而让用户误以为“一直在转”。
 */
export const AUTHORIZATION_FAILURE_PATTERN =
  /401|403|Unauthoriz|authentication\s*fail|Invalid\s*(?:API\s*Key|key)|api\s*key.*(?:invalid|wrong)|wrong\s*key|token.*(?:invalid|expired)|invalid\s*token|apikey.*(?:invalid|not\s*found)/i

/** 判断错误是否为鉴权类失败（API Key 无效 / 未授权） */
export function isAuthorizationFailure(message?: string, stderr?: string): boolean {
  return AUTHORIZATION_FAILURE_PATTERN.test(`${message ?? ''}\n${stderr ?? ''}`)
}

/**
 * 超时/停滞类错误模式：上游长时间无有效数据（连接超时、流空闲、挂起等）。
 * 这类错误连续重试无意义，应限制重试次数后透出明确错误，避免“一直转圈”。
 */
export const TIMEOUT_LIKE_PATTERN =
  /ETIMEDOUT|timed\s*out|timeout|超时|freeze|hang|stall|无有效数据|空闲/i

/** 判断错误是否为超时/停滞类（应限制重试次数） */
export function isTimeoutLikeError(message?: string, stderr?: string): boolean {
  return TIMEOUT_LIKE_PATTERN.test(`${message ?? ''}\n${stderr ?? ''}`)
}
