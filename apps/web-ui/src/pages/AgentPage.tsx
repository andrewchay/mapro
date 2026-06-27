import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Plus, Send, Square, Bot, User, Loader2 } from 'lucide-react'
import type { AgentSessionMeta, AgentWorkspace, AgentMessage, AgentStreamPayload } from '@ma-proma/shared'
import {
  agentSessionsAtom,
  agentWorkspacesAtom,
  agentLoadingAtom,
  agentErrorAtom,
  refreshAgentSessionsAtom,
  refreshAgentWorkspacesAtom,
  createAgentSessionAtom,
  loadAgentSessionMessagesAtom,
} from '../store/agent-atoms.ts'
import { webAPI } from '../api/web-api.ts'

interface StreamedMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
}

function extractTextFromPayload(payload: AgentStreamPayload): string {
  if (payload.kind !== 'sdk_message') return ''
  const msg = payload.message as Record<string, unknown>
  if (msg.type === 'assistant') {
    const message = msg.message as Record<string, unknown> | undefined
    const content = message?.content as Array<Record<string, unknown>> | undefined
    return content
      ?.map((block) => {
        if (block.type === 'text') return String(block.text ?? '')
        if (block.type === 'thinking') return `[思考] ${String(block.thinking ?? '')}`
        if (block.type === 'tool_use') return `[工具] ${String(block.name ?? '')}`
        return ''
      })
      .filter(Boolean)
      .join('\n') ?? ''
  }
  if (msg.type === 'result') {
    const result = msg as Record<string, unknown>
    return `[结果] ${result.subtype ?? ''}`
  }
  return ''
}

export function AgentPage() {
  const sessions = useAtomValue(agentSessionsAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const loading = useAtomValue(agentLoadingAtom)
  const error = useAtomValue(agentErrorAtom)
  const refreshSessions = useSetAtom(refreshAgentSessionsAtom)
  const refreshWorkspaces = useSetAtom(refreshAgentWorkspacesAtom)
  const createSession = useSetAtom(createAgentSessionAtom)
  const loadMessages = useSetAtom(loadAgentSessionMessagesAtom)

  const [selectedSession, setSelectedSession] = React.useState<AgentSessionMeta | null>(null)
  const [messages, setMessages] = React.useState<StreamedMessage[]>([])
  const [input, setInput] = React.useState('')
  const [streaming, setStreaming] = React.useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState('')
  const stopRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    refreshSessions()
    refreshWorkspaces()
  }, [refreshSessions, refreshWorkspaces])

  React.useEffect(() => {
    if (!selectedSession) {
      setMessages([])
      return
    }
    loadMessages(selectedSession.id).then((history) => {
      setMessages(
        history.map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
        })),
      )
    })
  }, [selectedSession, loadMessages])

  const handleCreateSession = async () => {
    const workspaceId = selectedWorkspaceId || undefined
    const session = await createSession({ title: '新 Agent 会话', workspaceId })
    setSelectedSession(session)
    setMessages([])
  }

  const handleSend = () => {
    if (!selectedSession || !input.trim() || streaming) return

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setStreaming(true)

    let assistantContent = ''
    let currentToolName: string | undefined

    stopRef.current = webAPI.sendAgentMessage(selectedSession.id, userMessage, (event) => {
      if (event.type === 'payload') {
        const text = extractTextFromPayload(event.payload)
        if (text) {
          assistantContent += text
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { role: 'assistant', content: assistantContent }]
            }
            return [...prev, { role: 'assistant', content: assistantContent }]
          })
        }

        if (event.payload.kind === 'sdk_message') {
          const msg = event.payload.message as Record<string, unknown>
          if (msg.type === 'assistant') {
            const message = msg.message as Record<string, unknown> | undefined
            const content = message?.content as Array<Record<string, unknown>> | undefined
            const toolUse = content?.find((b) => b.type === 'tool_use')
            if (toolUse && toolUse.name !== currentToolName) {
              currentToolName = String(toolUse.name)
              setMessages((prev) => [...prev, { role: 'tool', content: `[调用工具] ${currentToolName}` }])
            }
          }
        }
      } else if (event.type === 'complete') {
        setStreaming(false)
        stopRef.current = null
      } else if (event.type === 'error') {
        setStreaming(false)
        setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${event.error}` }])
        stopRef.current = null
      }
    })
  }

  const handleStop = () => {
    stopRef.current?.()
    stopRef.current = null
    setStreaming(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-[calc(100vh-120px)] gap-4">
      {/* 左侧边栏 */}
      <div className="w-64 flex flex-col gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <label className="block text-xs font-medium text-slate-500 mb-2">默认工作区</label>
          <select
            value={selectedWorkspaceId}
            onChange={(e) => setSelectedWorkspaceId(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
          >
            <option value="">系统默认</option>
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleCreateSession}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            <Plus className="w-4 h-4" />
            新会话
          </button>
        </div>

        <div className="flex-1 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 font-medium text-slate-900">会话列表</div>
          <div className="flex-1 overflow-auto p-2">
            {loading && sessions.length === 0 && (
              <div className="text-center py-8 text-slate-500 text-sm">加载中...</div>
            )}
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setSelectedSession(session)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 ${
                  selectedSession?.id === session.id
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="font-medium truncate">{session.title}</div>
                <div className="text-xs text-slate-400 truncate">{new Date(session.updatedAt).toLocaleString()}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧聊天区 */}
      <div className="flex-1 bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden">
        {!selectedSession ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            选择一个会话或创建新会话开始对话
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="font-medium text-slate-900">{selectedSession.title}</div>
                <div className="text-xs text-slate-500">{selectedSession.id}</div>
              </div>
              {streaming && <Loader2 className="w-4 h-4 animate-spin text-blue-600" />}
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-4">
              {messages.map((message, index) => (
                <div key={index} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      message.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {message.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : message.role === 'tool'
                          ? 'bg-amber-50 text-amber-800 border border-amber-100'
                          : 'bg-slate-100 text-slate-900'
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-slate-100">
              {error && (
                <div className="mb-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>
              )}
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入消息..."
                  rows={1}
                  className="flex-1 resize-none border border-slate-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={streaming ? handleStop : handleSend}
                  disabled={!input.trim() && !streaming}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg"
                >
                  {streaming ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
