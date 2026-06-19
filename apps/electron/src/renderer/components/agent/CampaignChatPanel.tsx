/**
 * CampaignChatPanel - Campaign 专属聊天面板
 *
 * 嵌入在 Campaign 详情页底部，通过对话直接编辑 Campaign 数据。
 * 使用 conversationId = campaign_{campaignId}，发送消息时带上 campaignId。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Send, MessageSquare, Bot, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatMessage, ChatSendInput } from '@ma-proma/shared'
import type { Campaign } from '@ma-proma/shared'

interface CampaignChatPanelProps {
  campaign: Campaign
}

export function CampaignChatPanel({ campaign }: CampaignChatPanelProps): React.ReactElement {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [streaming, setStreaming] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const conversationId = `campaign_${campaign.id}`

  // 加载历史消息
  React.useEffect(() => {
    loadMessages()
  }, [conversationId])

  const loadMessages = async () => {
    try {
      const history = await window.electronAPI.getConversationMessages?.(conversationId) ?? []
      setMessages(history)
    } catch (error) {
      console.error('[CampaignChat] 加载历史消息失败:', error)
    }
  }

  // 滚动到底部
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 监听流式事件
  React.useEffect(() => {
    const cleanupChunk = window.electronAPI.onStreamChunk((event) => {
      if (event.conversationId !== conversationId) return
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant') {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + event.delta },
          ]
        }
        return prev
      })
    })

    const cleanupComplete = window.electronAPI.onStreamComplete((event) => {
      if (event.conversationId !== conversationId) return
      setStreaming(false)
      setLoading(false)
      loadMessages()
    })

    const cleanupError = window.electronAPI.onStreamError((event) => {
      if (event.conversationId !== conversationId) return
      setStreaming(false)
      setLoading(false)
      toast.error('发送失败', { description: event.error })
    })

    return () => {
      cleanupChunk()
      cleanupComplete()
      cleanupError()
    }
  }, [conversationId])

  const handleSend = async () => {
    if (!input.trim() || loading) return

    const userContent = input.trim()
    setInput('')
    setLoading(true)
    setStreaming(true)

    // 先添加用户消息到本地
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: userContent,
      createdAt: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])

    // 添加占位助手消息
    const assistantMsg: ChatMessage = {
      id: `msg_${Date.now()}_assistant`,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    }
    setMessages((prev) => [...prev, assistantMsg])

    try {
      // 获取默认渠道和模型
      const channels = await window.electronAPI.listChannels()
      const defaultChannel = channels.find((c) => c.isDefault) ?? channels[0]
      if (!defaultChannel) {
        toast.error('没有可用的 AI 渠道')
        setStreaming(false)
        setLoading(false)
        return
      }

      const sendInput: ChatSendInput = {
        conversationId,
        userMessage: userContent,
        messageHistory: messages,
        channelId: defaultChannel.id,
        modelId: 'default',
        campaignId: campaign.id,
      }

      await window.electronAPI.sendMessage?.(sendInput)
    } catch (error) {
      console.error('[CampaignChat] 发送失败:', error)
      toast.error('发送失败')
      setStreaming(false)
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full border-t border-border/60 bg-background">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40">
        <MessageSquare className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Campaign Agent</span>
        <span className="text-xs text-muted-foreground">— {campaign.name}</span>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            <Bot className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>我可以帮你管理这个 Campaign：</p>
            <p className="text-xs mt-1">修改预算 · 调整 KOL 状态 · 编辑 Brief · 触发审核</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'flex gap-2',
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-primary" />
              </div>
            )}
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-foreground'
              )}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-primary" />
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="px-4 py-3 border-t border-border/40">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="通过对话修改 Campaign..."
            disabled={loading}
            className="flex-1 px-3 py-2 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className={cn(
              'p-2 rounded-xl transition-colors',
              loading || !input.trim()
                ? 'text-muted-foreground cursor-not-allowed'
                : 'text-primary hover:bg-primary/10'
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
