/**
 * CampaignList - Campaign 项目列表页 + 详情视图
 *
 * Slice 1: 展示所有 Campaign，支持创建新 Campaign。
 * Slice 2: 点击 Campaign 显示详情页（基本信息 + 三阶段进度）。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Bot, MessageSquare, Plus, Target } from 'lucide-react'
import { campaignsAtom, campaignConversationMapAtom, currentCampaignIdAtom, campaignCreateDialogOpenAtom } from '@/atoms/campaign-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { conversationsAtom, chatPendingMessageAtom } from '@/atoms/chat-atoms'
import { agentWorkspacesAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { CampaignDetail } from './CampaignDetail'
import { AgentView } from './AgentView'
import { ChatView } from '@/components/chat'
import { cn } from '@/lib/utils'
import type { AgentSessionMeta, AgentWorkspace, Campaign, Channel, ConversationMeta } from '@ma-proma/shared'

type CampaignAssistantMode = 'agent' | 'chat'

const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  dual: '双平台',
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  strategy: '策略制定',
  kol_selection: '达人筛选',
  negotiation: '商务洽谈',
  content_production: '内容制作',
  live: '投放执行',
  review: '复盘',
  completed: '已完成',
}

export function CampaignList(): React.ReactElement {
  const [campaigns, setCampaigns] = useAtom(campaignsAtom)
  const [conversations, setConversations] = useAtom(conversationsAtom)
  const [campaignConversationMap, setCampaignConversationMap] = useAtom(campaignConversationMapAtom)
  const [, setAgentWorkspaces] = useAtom(agentWorkspacesAtom)
  const currentCampaignId = useAtomValue(currentCampaignIdAtom)
  const setCurrentCampaignId = useSetAtom(currentCampaignIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setChatPendingMessage = useSetAtom(chatPendingMessageAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setCampaignCreateDialogOpen = useSetAtom(campaignCreateDialogOpenAtom)
  const [loading, setLoading] = React.useState(true)
  const [selectedCampaign, setSelectedCampaign] = React.useState<Campaign | null>(null)
  const [assistantMode, setAssistantMode] = React.useState<CampaignAssistantMode>('agent')
  const [chatConversationId, setChatConversationId] = React.useState<string | null>(null)
  const [agentSession, setAgentSession] = React.useState<AgentSessionMeta | null>(null)
  const [agentWorkspace, setAgentWorkspace] = React.useState<AgentWorkspace | null>(null)
  const [defaultChannel, setDefaultChannel] = React.useState<Channel | null>(null)
  const [assistantLoading, setAssistantLoading] = React.useState(false)

  React.useEffect(() => {
    window.electronAPI
      .listCampaigns()
      .then((list) => {
        setCampaigns(list)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [setCampaigns])

  // Slice 2: 当 currentCampaignId 变化时，获取详情
  React.useEffect(() => {
    if (!currentCampaignId) {
      setSelectedCampaign(null)
      return
    }
    // 先尝试从本地列表找
    const local = campaigns.find((c) => c.id === currentCampaignId)
    if (local) {
      setSelectedCampaign(local)
      return
    }
    // 否则从后端获取
    window.electronAPI
      .getCampaignById(currentCampaignId)
      .then((campaign) => {
        if (campaign) setSelectedCampaign(campaign)
      })
      .catch(console.error)
  }, [currentCampaignId, campaigns])

  const handleBack = () => {
    setCurrentCampaignId(null)
  }

  const ensureDefaultChannel = React.useCallback(async (): Promise<Channel | null> => {
    if (defaultChannel) return defaultChannel
    const channels = await window.electronAPI.listChannels()
    const channel = channels.find((item) => item.enabled) ?? null
    setDefaultChannel(channel)
    return channel
  }, [defaultChannel])

  const ensureCampaignChat = React.useCallback(async (campaign: Campaign): Promise<string | null> => {
    const mappedId = campaignConversationMap.get(campaign.id)
    if (mappedId) return mappedId

    const existing = conversations.find((conversation) => conversation.title === `${campaign.name} · Campaign`)
    if (existing) {
      setCampaignConversationMap((prev) => {
        const next = new Map(prev)
        next.set(campaign.id, existing.id)
        return next
      })
      return existing.id
    }

    const channel = await ensureDefaultChannel()
    const meta: ConversationMeta = await window.electronAPI.createConversation(
      `${campaign.name} · Campaign`,
      undefined,
      channel?.id,
    )
    setConversations((prev) => [meta, ...prev])
    setCampaignConversationMap((prev) => {
      const next = new Map(prev)
      next.set(campaign.id, meta.id)
      return next
    })
    return meta.id
  }, [campaignConversationMap, conversations, ensureDefaultChannel, setCampaignConversationMap, setConversations])

  const ensureCampaignAgent = React.useCallback(async (campaign: Campaign): Promise<{ session: AgentSessionMeta; workspace: AgentWorkspace; channel: Channel } | null> => {
    const channel = await ensureDefaultChannel()
    if (!channel) return null

    const workspaceSlug = `campaign-${campaign.id}`
    let workspaces = await window.electronAPI.listAgentWorkspaces()
    setAgentWorkspaces(workspaces)
    let workspace = workspaces.find((item) => item.slug === workspaceSlug)
    if (!workspace) {
      try {
        workspace = await window.electronAPI.createAgentWorkspace(campaign.name, workspaceSlug)
        setAgentWorkspaces((prev) => [workspace!, ...prev.filter((item) => item.id !== workspace!.id)])
      } catch (error) {
        // 可能是旧工作区同名或另一个窗口刚刚创建；重新拉取，优先找 campaign slug。
        console.warn('[CampaignList] 创建 Campaign 工作区失败，尝试复用已有工作区:', error)
        workspaces = await window.electronAPI.listAgentWorkspaces()
        setAgentWorkspaces(workspaces)
        workspace = workspaces.find((item) => item.slug === workspaceSlug)
          ?? workspaces.find((item) => item.name === campaign.name && item.slug.startsWith('campaign-'))
      }
    }
    if (!workspace) return null

    const sessions = await window.electronAPI.listAgentSessions()
    let session = sessions.find((item) => item.title === campaign.name && item.workspaceId === workspace!.id)
    if (!session) {
      session = await window.electronAPI.createAgentSession(campaign.name, channel.id, workspace.id)
    }

    setAgentSession(session)
    setAgentWorkspace(workspace)
    setCurrentAgentSessionId(session.id)
    setCurrentAgentWorkspaceId(workspace.id)
    window.electronAPI.updateSettings({ agentWorkspaceId: workspace.id }).catch(console.error)
    return { session, workspace, channel }
  }, [ensureDefaultChannel, setAgentWorkspaces, setCurrentAgentSessionId, setCurrentAgentWorkspaceId])

  React.useEffect(() => {
    if (!selectedCampaign) {
      setChatConversationId(null)
      setAgentSession(null)
      setAgentWorkspace(null)
      return
    }

    let cancelled = false
    setAssistantLoading(true)
    Promise.all([
      ensureCampaignChat(selectedCampaign),
      ensureCampaignAgent(selectedCampaign),
    ])
      .then(([conversationId]) => {
        if (cancelled) return
        setChatConversationId(conversationId)
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setAssistantLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [ensureCampaignAgent, ensureCampaignChat, selectedCampaign])

  const handleSendToAssistant = React.useCallback((prompt: string) => {
    if (!selectedCampaign) return
    if (assistantMode === 'chat') {
      if (!chatConversationId) return
      setChatPendingMessage({ conversationId: chatConversationId, message: prompt })
      return
    }

    ensureCampaignAgent(selectedCampaign)
      .then((result) => {
        if (!result) return
        return window.electronAPI.sendAgentMessage({
          sessionId: result.session.id,
          userMessage: prompt,
          channelId: result.channel.id,
          workspaceId: result.workspace.id,
          permissionModeOverride: 'bypassPermissions',
          startedAt: Date.now(),
        })
      })
      .catch(console.error)
  }, [assistantMode, chatConversationId, ensureCampaignAgent, selectedCampaign, setChatPendingMessage])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 grid grid-cols-[minmax(320px,0.4fr)_minmax(520px,1fr)_minmax(380px,0.72fr)] overflow-hidden">
      {/* 左侧：Campaign 列表 */}
      <aside className="min-w-0 min-h-0 flex flex-col border-r border-border bg-background">
        <div className="h-12 px-4 border-b border-border flex items-center justify-between titlebar-no-drag">
          <div className="text-sm font-semibold">Campaign 项目</div>
          <button
            type="button"
            onClick={() => setCampaignCreateDialogOpen(true)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="新建 Campaign"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
          {campaigns.map((campaign) => (
            <button
              key={campaign.id}
              type="button"
              onClick={() => setCurrentCampaignId(campaign.id)}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-xl border transition-all',
                currentCampaignId === campaign.id
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-border/60 bg-background hover:bg-muted/50'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{campaign.name}</span>
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0',
                  campaign.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600' :
                  campaign.status === 'live' ? 'bg-blue-500/10 text-blue-600' :
                  'bg-muted text-muted-foreground'
                )}>
                  {STATUS_LABEL[campaign.status]}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {campaign.brand} · {PLATFORM_LABEL[campaign.platform]}
              </div>
            </button>
          ))}
          {campaigns.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-8">
              暂无 Campaign 项目
            </div>
          )}
        </div>
      </aside>

      {/* 中间：Campaign 细节和工作流 */}
      <main className="min-w-0 min-h-0 flex border-r border-border">
        {selectedCampaign ? (
          <CampaignDetail
            campaign={selectedCampaign}
            onBack={handleBack}
            onNavigateToKolData={() => setActiveView('kol_data')}
            onSendToAssistant={handleSendToAssistant}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
            <Target size={32} className="opacity-20 mb-2" />
            <span>选择一个 Campaign 查看详情</span>
          </div>
        )}
      </main>

      {/* 右侧：原生 Agent / Chat 对话框 */}
      <aside className="min-w-0 min-h-0 flex flex-col bg-background">
        <div className="h-14 px-4 border-b border-border flex items-center justify-between gap-3 titlebar-no-drag">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">
              {assistantMode === 'agent' ? 'Agent 对话' : 'Chat 对话'}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {selectedCampaign ? selectedCampaign.name : '未选择 Campaign'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => setAssistantMode('agent')}
              className={cn(
                'h-8 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors',
                assistantMode === 'agent' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Bot size={13} />
              Agent
            </button>
            <button
              type="button"
              onClick={() => setAssistantMode('chat')}
              className={cn(
                'h-8 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors',
                assistantMode === 'chat' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <MessageSquare size={13} />
              Chat
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          {!selectedCampaign ? (
            <div className="h-full flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
              <MessageSquare size={28} className="opacity-20" />
              <span>选择 Campaign 后开始对话</span>
            </div>
          ) : assistantLoading ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              初始化对话中...
            </div>
          ) : assistantMode === 'agent' ? (
            agentSession ? (
              <AgentView sessionId={agentSession.id} />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Agent 会话初始化失败
              </div>
            )
          ) : chatConversationId ? (
            <ChatView conversationId={chatConversationId} campaignId={selectedCampaign.id} />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Chat 会话初始化失败
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
