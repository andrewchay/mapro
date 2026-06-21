/**
 * CampaignList - Campaign 项目列表页 + 详情视图
 *
 * Slice 1: 展示所有 Campaign，支持创建新 Campaign。
 * Slice 2: 点击 Campaign 显示详情页（基本信息 + 三阶段进度）。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Bot, MessageSquare } from 'lucide-react'
import { campaignsAtom, campaignConversationMapAtom, currentCampaignIdAtom } from '@/atoms/campaign-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { conversationsAtom, chatPendingMessageAtom } from '@/atoms/chat-atoms'
import { currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { CampaignDetail } from './CampaignDetail'
import { AgentView } from './AgentView'
import { ChatView } from '@/components/chat'
import { cn } from '@/lib/utils'
import type { AgentSessionMeta, AgentWorkspace, Campaign, Channel, ConversationMeta } from '@ma-proma/shared'

type CampaignAssistantMode = 'agent' | 'chat'

export function CampaignList(): React.ReactElement {
  const [campaigns, setCampaigns] = useAtom(campaignsAtom)
  const [conversations, setConversations] = useAtom(conversationsAtom)
  const [campaignConversationMap, setCampaignConversationMap] = useAtom(campaignConversationMapAtom)
  const currentCampaignId = useAtomValue(currentCampaignIdAtom)
  const setCurrentCampaignId = useSetAtom(currentCampaignIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setChatPendingMessage = useSetAtom(chatPendingMessageAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
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
    const workspaces = await window.electronAPI.listAgentWorkspaces()
    let workspace = workspaces.find((item) => item.slug === workspaceSlug)
    if (!workspace) {
      workspace = await window.electronAPI.createAgentWorkspace(campaign.name, workspaceSlug)
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
  }, [ensureDefaultChannel, setCurrentAgentSessionId, setCurrentAgentWorkspaceId])

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
    <div className="flex-1 min-h-0 grid grid-cols-[minmax(520px,1fr)_minmax(380px,0.72fr)] overflow-hidden">
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
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            选择一个 Campaign 查看详情
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
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              选择 Campaign 后开始对话
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
