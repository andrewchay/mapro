/**
 * CampaignAgentPanel - Campaign 详情页底部内嵌 Agent 面板
 *
 * 使用 Agent 模式（createAgentSession + sendAgentMessage + onAgentStreamEvent）
 * 每个 Campaign 有自己的 Agent Workspace，Agent 通过文件操作修改 Campaign 数据
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Send, Bot, User, Loader2, AlertCircle, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { userProfileAtom } from '@/atoms/user-profile'
import type { Campaign, AgentStreamEvent, AgentStreamCompletePayload, AgentSendInput } from '@ma-proma/shared'

interface CampaignAgentPanelProps {
  campaign: Campaign
  onCampaignChanged?: (campaign: Campaign) => void
}

interface MessageItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  isStreaming?: boolean
  error?: string
}

export function CampaignAgentPanel({ campaign, onCampaignChanged }: CampaignAgentPanelProps): React.ReactElement {
  const userProfile = useAtomValue(userProfileAtom)
  const workspaceSlug = `campaign-${campaign.id}`

  const [messages, setMessages] = React.useState<MessageItem[]>([])
  const [input, setInput] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(false)
  const [streamingContent, setStreamingContent] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [channelId, setChannelId] = React.useState<string | null>(null)
  const [modelId, setModelId] = React.useState<string | null>(null)
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null)
  const [campaignWorkspacePath, setCampaignWorkspacePath] = React.useState<string | null>(null)
  const [initialized, setInitialized] = React.useState(false)
  const [initError, setInitError] = React.useState<string | null>(null)

  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const streamingContentRef = React.useRef('')
  const isLoadingRef = React.useRef(false)
  const sessionIdRef = React.useRef<string | null>(null)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // 同步 ref 到 state
  React.useEffect(() => { streamingContentRef.current = streamingContent }, [streamingContent])
  React.useEffect(() => { isLoadingRef.current = isLoading }, [isLoading])
  React.useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])

  const clearGenerationTimeout = React.useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const appendAssistantError = React.useCallback((message: string) => {
    setError(message)
    setMessages((prev) => [
      ...prev,
      {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: message,
        createdAt: Date.now(),
        error: message,
      },
    ])
  }, [])

  const stopCurrentRun = React.useCallback(async (message?: string) => {
    const currentSessionId = sessionIdRef.current
    clearGenerationTimeout()
    setIsLoading(false)
    setStreamingContent('')
    if (message) appendAssistantError(message)
    if (currentSessionId) {
      try {
        await window.electronAPI.stopAgent(currentSessionId)
      } catch (err) {
        console.error('[CampaignAgentPanel] 停止 Agent 失败:', err)
      }
    }
  }, [appendAssistantError, clearGenerationTimeout])

  React.useEffect(() => {
    return () => {
      clearGenerationTimeout()
      if (isLoadingRef.current && sessionIdRef.current) {
        window.electronAPI.stopAgent(sessionIdRef.current).catch((err) => {
          console.error('[CampaignAgentPanel] 卸载时停止 Agent 失败:', err)
        })
      }
    }
  }, [clearGenerationTimeout])

  // 自动滚动到底部
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // 初始化：获取默认渠道、查找/创建 Workspace 和 Agent 会话
  React.useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        // 获取默认渠道
        const channels = await window.electronAPI.listChannels()
        const defaultChannel = channels.find((c) => c.enabled)
        const defaultModel = defaultChannel?.models.find((m) => m.enabled)

        if (!defaultChannel || !defaultModel) {
          if (!cancelled) setInitError('未找到可用的渠道或模型')
          return
        }

        if (cancelled) return
        setChannelId(defaultChannel.id)
        setModelId(defaultModel.id)

        // 查找 Campaign 的 Workspace
        const workspaces = await window.electronAPI.listAgentWorkspaces()
        let workspace = workspaces.find((w) => w.slug === workspaceSlug)

        // 如果 Workspace 不存在（旧 Campaign），尝试创建
        if (!workspace) {
          try {
            workspace = await window.electronAPI.createAgentWorkspace(campaign.name, workspaceSlug)
          } catch (err) {
            console.error('[CampaignAgentPanel] 创建 Workspace 失败:', err)
            if (!cancelled) setInitError('Agent 工作区未初始化，请刷新 Campaign 页面重试')
            return
          }
        }

        if (!workspace || cancelled) return
        setWorkspaceId(workspace.id)

        // 确保 Workspace 工具文件存在（旧 Campaign 兼容）
        try {
          const path = await window.electronAPI.ensureCampaignWorkspace(campaign)
          if (!cancelled) setCampaignWorkspacePath(path)
        } catch (err) {
          console.warn('[CampaignAgentPanel] 确保工具文件失败:', err)
        }

        // 查找或创建 Agent 会话
        const sessions = await window.electronAPI.listAgentSessions()
        const existingSession = sessions.find(
          (s) => s.title === campaign.name && s.workspaceId === workspace!.id
        )

        if (existingSession) {
          if (!cancelled) setSessionId(existingSession.id)
        } else {
          const meta = await window.electronAPI.createAgentSession(
            campaign.name,
            defaultChannel.id,
            workspace.id,
          )
          if (!cancelled) setSessionId(meta.id)
        }

        if (!cancelled) setInitialized(true)
      } catch (err) {
        console.error('[CampaignAgentPanel] 初始化失败:', err)
        if (!cancelled) setInitError('初始化失败')
      }
    }

    init()
    return () => { cancelled = true }
  }, [campaign.id, campaign.name, workspaceSlug])

  // 设置流式事件监听器（只设置一次，不随 state 变化）
  React.useEffect(() => {
    const cleanupEvent = window.electronAPI.onAgentStreamEvent((event: AgentStreamEvent) => {
      const currentSessionId = sessionIdRef.current
      if (!currentSessionId || event.sessionId !== currentSessionId) return

      if (event.payload?.kind === 'sdk_message') {
        const msg = event.payload.message
        if (msg && msg.type === 'assistant' && !msg.isReplay) {
          const assistantMessage = msg.message as { content?: unknown } | undefined
          const content = assistantMessage?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block && block.type === 'text' && typeof block.text === 'string') {
                setStreamingContent((prev) => prev + block.text)
              }
            }
          }
        }
      }
    })

    const cleanupComplete = window.electronAPI.onAgentStreamComplete((data: AgentStreamCompletePayload) => {
      const currentSessionId = sessionIdRef.current
      if (!currentSessionId || data.sessionId !== currentSessionId) return
      clearGenerationTimeout()
      setIsLoading(false)

      const finalContent = streamingContentRef.current
      if (finalContent) {
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: finalContent,
            createdAt: Date.now(),
          },
        ])
      }
      setStreamingContent('')

      window.electronAPI
        .getCampaignById(campaign.id)
        .then((updated) => {
          if (updated) onCampaignChanged?.(updated)
        })
        .catch((err) => {
          console.error('[CampaignAgentPanel] 刷新 Campaign 失败:', err)
        })
    })

    const cleanupError = window.electronAPI.onAgentStreamError((data: { sessionId: string; error: string }) => {
      const currentSessionId = sessionIdRef.current
      if (!currentSessionId || data.sessionId !== currentSessionId) return
      clearGenerationTimeout()
      setIsLoading(false)
      setStreamingContent('')
      setError(data.error)
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: data.error,
          createdAt: Date.now(),
          error: data.error,
        },
      ])
    })

    return () => {
      cleanupEvent()
      cleanupComplete()
      cleanupError()
    }
  }, [campaign.id, onCampaignChanged, clearGenerationTimeout])

  const handleSend = React.useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || isLoadingRef.current || !channelId || !sessionId || !workspaceId) return

    setError(null)
    setInput('')

    // 乐观更新：立即显示用户消息
    const userMsg: MessageItem = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setIsLoading(true)
    setStreamingContent('')
    clearGenerationTimeout()
    timeoutRef.current = setTimeout(() => {
      const currentSessionId = sessionIdRef.current
      if (!currentSessionId || !isLoadingRef.current) return
      const timeoutMessage = '本次生成超时，已停止等待。请重试，或检查 Agent 渠道/模型是否可用。'
      void stopCurrentRun(timeoutMessage)
    }, 120_000)

    // 构建 Campaign 上下文提示词
    const campaignContext = JSON.stringify({
      id: campaign.id,
      name: campaign.name,
      brand: campaign.brand,
      platform: campaign.platform,
      budget: campaign.budget,
      durationMonths: campaign.durationMonths,
      targetCity: campaign.targetCity,
      targetAudience: campaign.targetAudience,
      currentPhase: campaign.currentPhase,
      phasePlans: campaign.phasePlans,
      creativePlan: campaign.creativePlan,
      status: campaign.status,
    }, null, 2)

    const toolScriptPath = campaignWorkspacePath
      ? `${campaignWorkspacePath}/.campaign-tools/campaign.py`
      : '.campaign-tools/campaign.py'

    const userMessageWithContext = `Current Campaign Data:
\`\`\`json
${campaignContext}
\`\`\`

IMPORTANT: To read or modify Campaign data, use the Bash tool to run the Python script below.
Use this exact script path because the Agent cwd may be a session subdirectory:
  python "${toolScriptPath}" <command> <campaign_id> [args...]

Available commands:
  get <campaign_id>                              — Get campaign details
  update <campaign_id> --field value ...         — Update campaign fields (name, brand, platform, budget, duration_months, target_city, target_audience, current_phase, status)
  update-phase <campaign_id> <phase> --budget <amount> --goal <text> — Update one visible phase plan
  update-creative <campaign_id> --big_idea <text> --core_message <text> --content_pillars <a,b,c> --tone <text> — Update the visible creative strategy
  list-kols <campaign_id>                        — List all KOLs in the pool
  update-kol <campaign_id> <kol_id> <status>     — Update KOL status (candidate/contacted/negotiating/confirmed/rejected/completed)
  get-brief <campaign_id> <kol_id>               — Get KOL brief
  update-brief <campaign_id> <kol_id> <content>  — Update KOL brief

Examples:
  python "${toolScriptPath}" get ${campaign.id}
  python "${toolScriptPath}" update ${campaign.id} --budget 100000
  python "${toolScriptPath}" update-phase ${campaign.id} 1 --budget 50000
  python "${toolScriptPath}" update-creative ${campaign.id} --big_idea "夏日轻盈通勤" --tone "清爽、可信、都市感"
  python "${toolScriptPath}" list-kols ${campaign.id}
  python "${toolScriptPath}" update-kol ${campaign.id} kol_123 confirmed

The visible plan at the top of the Campaign page is the phasePlans array in Current Campaign Data.
When the user asks to modify Phase 1/2/3 budget, use update-phase.
When the user asks to modify the campaign idea, creative direction, selling point, messaging, content pillars, or tone, use update-creative.
DO NOT use Write or Edit tools to modify campaign.json directly. Always use the Python script above.

User request: ${trimmed}`

    const inputPayload: AgentSendInput = {
      sessionId,
      userMessage: userMessageWithContext,
      channelId,
      modelId: modelId || undefined,
      workspaceId,
      permissionModeOverride: 'bypassPermissions',
      startedAt: Date.now(),
    }

    try {
      await window.electronAPI.sendAgentMessage(inputPayload)
    } catch (err) {
      console.error('[CampaignAgentPanel] 发送消息失败:', err)
      clearGenerationTimeout()
      setIsLoading(false)
      setStreamingContent('')
      const errorMsg = err instanceof Error ? err.message : '发送失败'
      setError(errorMsg)
      setMessages((prev) => {
        const filtered = prev.filter((m) => !m.isStreaming)
        return [...filtered, {
          id: `send-error-${Date.now()}`,
          role: 'assistant',
          content: errorMsg,
          createdAt: Date.now(),
          error: errorMsg,
        }]
      })
    }
  }, [input, channelId, modelId, sessionId, workspaceId, campaign, campaignWorkspacePath, clearGenerationTimeout, stopCurrentRun])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 格式化时间
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp)
    const hh = date.getHours().toString().padStart(2, '0')
    const mm = date.getMinutes().toString().padStart(2, '0')
    return `${hh}:${mm}`
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.length === 0 && !isLoading && !initError && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Bot size={28} className="mb-2 opacity-40" />
            <p className="text-xs">Campaign Agent 已就绪</p>
            <p className="text-[10px] opacity-60 mt-0.5">可以询问关于此 Campaign 的任何问题或修改数据</p>
          </div>
        )}

        {initError && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <AlertCircle size={28} className="mb-2 opacity-40 text-orange-400" />
            <p className="text-xs">{initError}</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'flex gap-2',
              msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
            )}
          >
            {/* 头像 */}
            <div
              className={cn(
                'shrink-0 w-6 h-6 rounded-full flex items-center justify-center',
                msg.role === 'user'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {msg.role === 'user' ? (
                userProfile.avatar ? (
                  <span className="text-[10px]">{userProfile.avatar}</span>
                ) : (
                  <User size={12} />
                )
              ) : (
                <Bot size={12} />
              )}
            </div>

            {/* 气泡 */}
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-tr-sm'
                  : msg.error
                    ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400 rounded-tl-sm border border-red-200 dark:border-red-900'
                    : 'bg-muted text-foreground rounded-tl-sm'
              )}
            >
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              <div
                className={cn(
                  'text-[10px] mt-1 opacity-50',
                  msg.role === 'user' ? 'text-right' : 'text-left'
                )}
              >
                {formatTime(msg.createdAt)}
              </div>
            </div>
          </div>
        ))}

        {/* 流式中显示助手消息 */}
        {isLoading && streamingContent && (
          <div className="flex gap-2 flex-row">
            <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-muted text-muted-foreground">
              <Bot size={12} />
            </div>
            <div className="max-w-[80%] rounded-2xl rounded-tl-sm px-3 py-2 text-xs leading-relaxed bg-muted text-foreground">
              <div className="whitespace-pre-wrap break-words">{streamingContent}</div>
              <div className="flex items-center gap-1 mt-1">
                <Loader2 size={10} className="animate-spin text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground opacity-60">生成中...</span>
              </div>
            </div>
          </div>
        )}

        {/* 流式中但还没有内容 */}
        {isLoading && !streamingContent && (
          <div className="flex gap-2 flex-row">
            <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-muted text-muted-foreground">
              <Bot size={12} />
            </div>
            <div className="max-w-[80%] rounded-2xl rounded-tl-sm px-3 py-2 text-xs leading-relaxed bg-muted text-foreground">
              <div className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">思考中...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="px-3 py-2 border-t border-border bg-background">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !initialized
                ? initError
                  ? '初始化失败'
                  : '正在初始化...'
                : !channelId
                  ? '未配置可用渠道'
                  : isLoading
                    ? '正在生成，可点击右侧按钮停止'
                    : '输入消息...'
            }
            disabled={!initialized || !channelId}
            className={cn(
              'flex-1 min-w-0 px-3 py-2 rounded-lg text-xs',
              'bg-muted/50 border border-transparent',
              'focus:bg-background focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/20',
              'placeholder:text-muted-foreground/50',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors'
            )}
          />
          <Button
            size="sm"
            variant={isLoading ? 'outline' : 'default'}
            className="h-8 px-2.5 text-xs"
            onClick={() => {
              if (isLoading) {
                void stopCurrentRun('已停止当前生成，可以重新发送。')
              } else {
                void handleSend()
              }
            }}
            disabled={(!isLoading && !input.trim()) || !initialized || !channelId}
            title={isLoading ? '停止生成' : '发送'}
          >
            {isLoading ? (
              <Square size={14} />
            ) : (
              <Send size={14} />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
