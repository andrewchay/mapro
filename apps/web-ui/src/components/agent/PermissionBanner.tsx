/**
 * PermissionBanner — Agent 权限请求横幅
 *
 * 内联在 Agent 对话流底部，当有待处理的权限请求时显示。
 * 显示工具名、命令内容、危险等级，提供允许/拒绝/总是允许操作。
 * 支持队列模式：多个并发请求按 FIFO 逐个展示。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { Shield, ShieldAlert, Check, X } from 'lucide-react'
import { agentPermissionRequestsAtom } from '../../store/agent-atoms.ts'
import { webAPI } from '../../api/web-api.ts'
import type { DangerLevel } from '@ma-proma/shared'

/** 危险等级对应的图标颜色 */
const DANGER_ICON_STYLES: Record<DangerLevel, string> = {
  safe: 'text-green-500',
  normal: 'text-blue-500',
  dangerous: 'text-amber-500',
}

/** 解析工具显示名称（MCP 工具显示 server / tool） */
function formatToolName(toolName: string): string {
  const parts = toolName.split('__')
  if (parts[0] === 'mcp' && parts.length >= 3) {
    return `${parts[1]} / ${parts.slice(2).join('__')}`
  }
  return toolName
}

/** Web Bridge 改变导航、页面或外部状态的操作（与服务端 isWebBridgeMutation 保持一致） */
const WEB_BRIDGE_MUTATION_TOOLS = new Set([
  'WebBridgeNavigate',
  'WebBridgeConnectChrome',
  'WebBridgeClick',
  'WebBridgeType',
  'WebBridgeDownload',
  'WebBridgeUpload',
])

/** 从 URL 中提取 hostname，非法 URL 返回 null */
function extractHost(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

/** PermissionBanner 属性接口 */
interface PermissionBannerProps {
  sessionId: string
}

export function PermissionBanner({ sessionId }: PermissionBannerProps): React.ReactElement | null {
  const [allRequests, setAllRequests] = useAtom(agentPermissionRequestsAtom)
  const requests = allRequests.get(sessionId) ?? []
  const [responding, setResponding] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const respondRef = React.useRef<(behavior: 'allow' | 'deny', alwaysAllow?: boolean) => void>()

  const request = requests[0] ?? null

  // Enter 键快捷允许
  React.useEffect(() => {
    if (!request) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return
      if (e.key === 'Enter') {
        e.preventDefault()
        respondRef.current?.('allow')
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [request?.requestId])

  /** 关闭权限请求：等价于拒绝，避免服务端 Promise 挂起 */
  const handleDismiss = async (): Promise<void> => {
    if (responding || !request) return
    setResponding(true)

    try {
      webAPI.respondAgentPermission(sessionId, request.requestId, 'deny', false)
      // 只移除当前请求，保留同一会话的其他 pending 请求
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const newValue = current.filter((r) => r.requestId !== request.requestId)
        if (newValue.length === 0) map.delete(sessionId)
        else map.set(sessionId, newValue)
        return map
      })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
    } finally {
      setResponding(false)
    }
  }

  if (!request) return null

  const iconColor = DANGER_ICON_STYLES[request.dangerLevel]
  const isDangerous = request.dangerLevel === 'dangerous'
  const isWebBridgeMutation = WEB_BRIDGE_MUTATION_TOOLS.has(request.toolName)
  const webBridgeHost = isWebBridgeMutation ? extractHost(request.contextUrl) : null
  // ComputerUse（除 Status）与 WebBridgeUpload 永远逐次确认；
  // Web Bridge 写操作在能解析出站点域名时允许"信任此站点"，否则回退逐次确认
  const requiresPerActionApproval = (
    request.toolName.startsWith('ComputerUse') && request.toolName !== 'ComputerUseStatus'
  ) || request.toolName === 'WebBridgeUpload'
  || (isWebBridgeMutation && !webBridgeHost)
  const IconComponent = isDangerous ? ShieldAlert : Shield

  /** 响应权限请求 */
  const respond = async (behavior: 'allow' | 'deny', alwaysAllow = false): Promise<void> => {
    if (responding) return
    setResponding(true)

    try {
      webAPI.respondAgentPermission(sessionId, request.requestId, behavior, alwaysAllow)
      // 移除已响应的请求（FIFO 出队）
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const newValue = current.filter((r) => r.requestId !== request.requestId)
        if (newValue.length === 0) map.delete(sessionId)
        else map.set(sessionId, newValue)
        return map
      })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
    } finally {
      setResponding(false)
    }
  }

  respondRef.current = respond

  return (
    <div className="mx-4 mb-3 rounded-xl bg-white shadow-lg overflow-hidden border border-slate-200 animate-in slide-in-from-bottom-2 duration-200">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <IconComponent className={`w-4 h-4 ${iconColor}`} />
          <span className="text-sm font-medium text-slate-900">
            {isDangerous ? '危险操作需要确认' : '需要确认'}
          </span>
          {requests.length > 1 && (
            <span className="text-xs text-slate-500">
              (+{requests.length - 1})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500 font-mono">
            {request.sdkDisplayName ?? formatToolName(request.toolName)}
          </span>
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            onClick={handleDismiss}
            title="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 命令/操作内容 */}
      <div className="px-3 pb-2 space-y-1.5">
        {request.sdkTitle && (
          <p className="text-xs text-slate-900">{request.sdkTitle}</p>
        )}
        {request.sdkDescription && request.sdkDescription !== request.sdkTitle && (
          <p className="text-xs text-slate-500">{request.sdkDescription}</p>
        )}
        {request.command ? (
          <pre className="text-xs font-mono bg-slate-50 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">
            {request.command}
          </pre>
        ) : !request.sdkTitle && Object.keys(request.toolInput).length > 0 ? (
          <pre className="text-xs font-mono bg-slate-50 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">
            {JSON.stringify(request.toolInput, null, 2)}
          </pre>
        ) : !request.sdkTitle ? (
          <p className="text-xs text-slate-500">{request.description}</p>
        ) : null}
      </div>

      {error && (
        <div className="px-3 pb-2 text-xs text-red-600">{error}</div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center justify-end gap-1.5 px-3 pb-2.5">
        <span className="text-[10px] text-slate-400 mr-auto">
          Enter 允许
        </span>
        <button
          type="button"
          onClick={() => respond('deny')}
          disabled={responding}
          className="h-7 px-3 text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
        >
          <X className="w-3 h-3 inline mr-1" />
          拒绝
        </button>

        {!requiresPerActionApproval && (
          <button
            type="button"
            onClick={() => respond('allow', true)}
            disabled={responding}
            className="h-7 px-3 text-xs border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50"
          >
            {webBridgeHost ? `本会话信任 ${webBridgeHost}` : '本次会话总是允许'}
          </button>
        )}

        <button
          type="button"
          onClick={() => respond('allow')}
          disabled={responding}
          className="h-7 px-3 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
        >
          <Check className="w-3 h-3 inline mr-1" />
          允许
        </button>
      </div>
    </div>
  )
}
