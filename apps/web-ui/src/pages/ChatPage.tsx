import * as React from 'react'
import { Send } from 'lucide-react'
import { webAPI } from '../api/web-api.ts'
import type { ChatStreamEvent, ChatSendInput } from '../api/platform-api.ts'

interface Message {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
}

export function ChatPage() {
  const [messages, setMessages] = React.useState<Message[]>([])
  const [input, setInput] = React.useState('')
  const [streaming, setStreaming] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  React.useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = () => {
    if (!input.trim() || streaming) return

    const userMessage = input.trim()
    setInput('')
    setStreaming(true)

    const newMessages: Message[] = [...messages, { role: 'user', content: userMessage }]
    setMessages(newMessages)

    const chatInput: ChatSendInput = {
      conversationId: 'web-chat',
      messages: newMessages.map((m) => ({
        role: m.role,
        content: m.content,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        createdAt: Date.now(),
      })),
      userMessage,
    }

    let assistantContent = ''
    let assistantReasoning = ''

    webAPI.sendChatMessage(chatInput, (event: ChatStreamEvent) => {
      if (event.type === 'chunk' && event.delta) {
        assistantContent += event.delta
        setMessages((prev) => {
          const others = prev.filter((m) => m.role !== 'assistant' || prev.indexOf(m) !== prev.length - 1)
          return [...others, { role: 'assistant', content: assistantContent, reasoning: assistantReasoning }]
        })
      } else if (event.type === 'reasoning' && event.delta) {
        assistantReasoning += event.delta
        setMessages((prev) => {
          const others = prev.filter((m) => m.role !== 'assistant' || prev.indexOf(m) !== prev.length - 1)
          return [...others, { role: 'assistant', content: assistantContent, reasoning: assistantReasoning }]
        })
      } else if (event.type === 'done') {
        setStreaming(false)
      } else if (event.type === 'error') {
        setStreaming(false)
        setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${event.error ?? '请求失败'}` }])
      }
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">Chat</h1>
        <p className="text-sm text-slate-500">阶段 A2：基础流式对话（环境变量单 Provider）</p>
      </div>

      <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-slate-200 p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-400 py-12">开始一段新对话</div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-none'
                  : 'bg-slate-100 text-slate-800 rounded-bl-none'
              }`}
            >
              {message.reasoning && (
                <div className="text-xs text-slate-500 mb-1 border-b border-slate-300 pb-1">
                  推理：{message.reasoning}
                </div>
              )}
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="mt-4 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={streaming}
          className="flex-1 resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100"
          rows={2}
        />
        <button
          onClick={handleSend}
          disabled={streaming || !input.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
