import * as React from 'react'
import { Send, Paperclip, X, FileText, Image as ImageIcon } from 'lucide-react'
import { webAPI } from '../api/web-api.ts'
import type { ChatStreamEvent, ChatSendInput } from '../api/platform-api.ts'
import type { FileAttachment } from '@ma-proma/shared'
import { formatFileSize } from '../lib/file-utils.ts'

interface Message {
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  attachments?: FileAttachment[]
}

const CONVERSATION_ID = 'web-chat'

function getAttachmentParts(localPath: string): { scope: string; id: string; fileId: string } | null {
  const parts = localPath.split('/')
  if (parts.length !== 3) return null
  return { scope: parts[0]!, id: parts[1]!, fileId: parts[2]! }
}

export function ChatPage() {
  const [messages, setMessages] = React.useState<Message[]>([])
  const [input, setInput] = React.useState('')
  const [streaming, setStreaming] = React.useState(false)
  const [attachments, setAttachments] = React.useState<FileAttachment[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [isDragging, setIsDragging] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const dragCounterRef = React.useRef(0)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  React.useEffect(() => {
    scrollToBottom()
  }, [messages])

  const uploadFiles = async (files: FileList | null) => {
    const fileArray = files ? Array.from(files) : []
    if (fileArray.length === 0) return

    setUploading(true)
    try {
      for (const file of fileArray) {
        const attachment = await webAPI.uploadAttachment('chat', CONVERSATION_ID, file)
        setAttachments((prev) => [...prev, attachment])
      }
    } catch (error) {
      console.error('[ChatPage] 上传附件失败:', error)
      alert(error instanceof Error ? error.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    e.target.value = ''
    void uploadFiles(files)
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current += 1
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragging(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    void uploadFiles(e.dataTransfer.files)
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || streaming) return

    const userMessage = input.trim()
    setInput('')
    setStreaming(true)

    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: userMessage || '(附件)', attachments: attachments.length > 0 ? attachments : undefined },
    ]
    setMessages(newMessages)
    const currentAttachments = attachments
    setAttachments([])

    const chatInput: ChatSendInput = {
      conversationId: CONVERSATION_ID,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        createdAt: Date.now(),
        attachments: m.attachments,
      })),
      userMessage,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
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

  const renderAttachmentIcon = (mediaType: string) => {
    if (mediaType.startsWith('image/')) {
      return <ImageIcon className="w-4 h-4" />
    }
    return <FileText className="w-4 h-4" />
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
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {message.attachments.map((att, i) => {
                    const parts = getAttachmentParts(att.localPath)
                    const url = parts ? webAPI.getAttachmentUrl(parts.scope, parts.id, parts.fileId) : ''
                    return (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                          message.role === 'user'
                            ? 'bg-blue-500 text-white hover:bg-blue-400'
                            : 'bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {renderAttachmentIcon(att.mediaType)}
                        <span className="max-w-[120px] truncate">{att.filename}</span>
                        <span className="opacity-75">({formatFileSize(att.size)})</span>
                      </a>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((att, index) => {
            const parts = getAttachmentParts(att.localPath)
            const url = parts ? webAPI.getAttachmentUrl(parts.scope, parts.id, parts.fileId) : ''
            return (
              <div
                key={index}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-slate-100 border border-slate-200 text-slate-700"
              >
                {att.mediaType.startsWith('image/') ? (
                  <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:underline">
                    <ImageIcon className="w-3 h-3" />
                    <span className="max-w-[120px] truncate">{att.filename}</span>
                  </a>
                ) : (
                  <>
                    <FileText className="w-3 h-3" />
                    <span className="max-w-[120px] truncate">{att.filename}</span>
                  </>
                )}
                <span className="text-slate-400">({formatFileSize(att.size)})</span>
                <button
                  onClick={() => handleRemoveAttachment(index)}
                  disabled={streaming}
                  className="ml-1 p-0.5 rounded hover:bg-slate-200 disabled:opacity-50"
                  title="移除附件"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div
        className={`relative mt-4 p-2 rounded-2xl transition-colors ${
          isDragging ? 'bg-blue-50 border-2 border-dashed border-blue-400' : 'border-2 border-transparent'
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-blue-600 font-medium text-sm">释放文件以上传</span>
          </div>
        )}
        <div className={`flex gap-2 ${isDragging ? 'opacity-50' : ''}`}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading || streaming}
            multiple
          />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || streaming}
          className="px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center"
          title="添加附件"
        >
          <Paperclip className="w-4 h-4" />
        </button>
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
            disabled={streaming || (!input.trim() && attachments.length === 0)}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
