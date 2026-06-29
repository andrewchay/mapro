/**
 * AskUserBanner — Agent AskUserQuestion 交互式问答横幅
 *
 * 多问题用顶部 Tab 切换，选项竖向排列。
 * 键盘：↑↓ 选择选项，Enter 确认当前问题（最后一题提交，否则翻页）。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { Send, X } from 'lucide-react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { agentAskUserRequestsAtom } from '../../store/agent-atoms.ts'
import { webAPI } from '../../api/web-api.ts'
import type { AskUserQuestion } from '@ma-proma/shared'

interface QuestionAnswer {
  selected: string[]
  customText: string
  showCustom: boolean
}

const EMPTY_ANSWER: QuestionAnswer = { selected: [], customText: '', showCustom: false }

const PREVIEW_REMARK_PLUGINS = [remarkGfm]

function safeUrlTransform(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return defaultUrlTransform(url)
}

/** AskUserBanner 属性接口 */
interface AskUserBannerProps {
  sessionId: string
}

export function AskUserBanner({ sessionId }: AskUserBannerProps): React.ReactElement | null {
  const [allRequests, setAllRequests] = useAtom(agentAskUserRequestsAtom)
  const requests = allRequests.get(sessionId) ?? []
  const [answers, setAnswers] = React.useState<Map<number, QuestionAnswer>>(new Map())
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState(0)
  const [focusedOptIdx, setFocusedOptIdx] = React.useState(-1)

  const request = requests[0] ?? null
  const questions = request?.questions ?? []
  const isLastTab = activeTab >= questions.length - 1

  // ===== Refs：确保 keydown handler 始终读取最新值，消除闭包过期问题 =====
  const activeTabRef = React.useRef(activeTab)
  activeTabRef.current = activeTab
  const questionsRef = React.useRef(questions)
  questionsRef.current = questions
  const focusedOptIdxRef = React.useRef(focusedOptIdx)
  focusedOptIdxRef.current = focusedOptIdx
  const submitRef = React.useRef<(() => void) | null>(null)
  const autoAdvanceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearAutoAdvanceTimer = React.useCallback((): void => {
    if (autoAdvanceTimerRef.current != null) {
      clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
    }
  }, [])

  // 组件卸载时清理未触发的跳转定时器
  React.useEffect(() => clearAutoAdvanceTimer, [clearAutoAdvanceTimer])

  React.useEffect(() => {
    clearAutoAdvanceTimer()
    setActiveTab(0)
    setFocusedOptIdx(-1)
    const firstOpt = questions[0]?.options[0]
    setAnswers(firstOpt
      ? new Map([[0, { ...EMPTY_ANSWER, selected: [firstOpt.label] }]])
      : new Map())
  }, [request?.requestId])

  // 切换 Tab 时重置焦点并默认选中第一个选项
  React.useEffect(() => {
    setFocusedOptIdx(-1)
    setAnswers((prev) => {
      if (prev.has(activeTab)) return prev
      const firstOpt = questions[activeTab]?.options[0]
      if (!firstOpt) return prev
      const map = new Map(prev)
      map.set(activeTab, { ...EMPTY_ANSWER, selected: [firstOpt.label] })
      return map
    })
  }, [activeTab])

  // 键盘导航：只在 requestId 变化时重建 handler，内部通过 ref 读取最新值
  React.useEffect(() => {
    if (!request || questions.length === 0) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const curTab = activeTabRef.current
      const qs = questionsRef.current
      const curFocusIdx = focusedOptIdxRef.current
      const q = qs[curTab]
      if (!q) return
      const itemCount = q.options.length + 1
      const lastTab = curTab >= qs.length - 1

      // 自由文本输入框内：仅 Enter 生效（输入法组合中跳过）
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault()
          if (lastTab) submitRef.current?.()
          else setActiveTab((prev) => prev + 1)
        }
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const nextIdx = curFocusIdx === -1
          ? (e.key === 'ArrowDown' ? 0 : itemCount - 1)
          : e.key === 'ArrowDown'
            ? (curFocusIdx + 1) % itemCount
            : (curFocusIdx - 1 + itemCount) % itemCount
        setFocusedOptIdx(nextIdx)
        // 移动焦点同时选中
        if (nextIdx < q.options.length) {
          const opt = q.options[nextIdx]
          if (opt) toggleOptionByState(curTab, q, opt.label)
        } else {
          toggleCustomByState(curTab)
        }
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        if (lastTab) submitRef.current?.()
        else setActiveTab((prev) => prev + 1)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [request?.requestId])

  /** 关闭问题：发送空答案等价取消，避免服务端 Promise 挂起 */
  const handleDismiss = async (): Promise<void> => {
    if (submitting || !request) return
    setSubmitting(true)
    try {
      webAPI.respondAgentAskUser(sessionId, request.requestId, {})
      setAllRequests((prev) => {
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (!request) return null

  const getAnswer = (idx: number): QuestionAnswer => answers.get(idx) ?? EMPTY_ANSWER

  function toggleOptionByState(qIdx: number, q: AskUserQuestion, label: string): void {
    setAnswers((prev) => {
      const map = new Map(prev)
      const cur = map.get(qIdx) ?? EMPTY_ANSWER
      const selected = q.multiSelect
        ? (cur.selected.includes(label) ? cur.selected.filter((s) => s !== label) : [...cur.selected, label])
        : [label]
      map.set(qIdx, { ...cur, selected, showCustom: false, customText: '' })
      return map
    })
  }

  function toggleCustomByState(qIdx: number): void {
    setAnswers((prev) => {
      const map = new Map(prev)
      const cur = map.get(qIdx) ?? EMPTY_ANSWER
      map.set(qIdx, { ...cur, showCustom: !cur.showCustom, selected: cur.showCustom ? cur.selected : [] })
      return map
    })
  }

  const handleSubmit = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      const answersRecord: Record<string, string> = {}
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i]
        if (!q) continue
        const answer = getAnswer(i)
        const key = q.question || String(i)
        if (answer.showCustom && answer.customText.trim()) {
          answersRecord[key] = answer.customText.trim()
        } else if (answer.selected.length > 0) {
          answersRecord[key] = answer.selected.join(', ')
        }
      }
      webAPI.respondAgentAskUser(sessionId, request.requestId, answersRecord)
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
      setSubmitting(false)
    }
  }

  submitRef.current = handleSubmit

  const hasValidAnswers = questions.every((_, idx) => {
    const a = getAnswer(idx)
    return a.selected.length > 0 || (a.showCustom && a.customText.trim().length > 0)
  })

  const currentQuestion = questions[activeTab]
  if (!currentQuestion) return null

  const goNextTab = (): void => {
    if (!isLastTab) setActiveTab((prev) => prev + 1)
  }

  return (
    <div className="mx-4 mb-3 rounded-xl bg-white shadow-lg overflow-hidden border border-slate-200 animate-in slide-in-from-bottom-2 duration-200">
      {/* 头部 + Tab 栏 */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-900">MAPro Agent 需要你的输入</span>
          <div className="flex items-center gap-1.5">
            {requests.length > 1 && (
              <span className="text-xs text-slate-500">(+{requests.length - 1})</span>
            )}
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

        {/* Tab 栏（多问题时显示） */}
        {questions.length > 1 && (
          <div className="flex gap-1">
            {questions.map((q, idx) => {
              const isActive = idx === activeTab
              const hasAnswer = getAnswer(idx).selected.length > 0
                || (getAnswer(idx).showCustom && getAnswer(idx).customText.trim().length > 0)
              return (
                <button
                  key={idx}
                  type="button"
                  className={`
                    px-2.5 py-1 rounded-lg text-xs font-medium transition-all outline-none
                    ${isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : hasAnswer
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                    }
                  `}
                  onClick={() => setActiveTab(idx)}
                >
                  {`${idx + 1}-${q.multiSelect ? '多选' : '单选'}：${q.header || `问题 ${idx + 1}`}`}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 当前问题内容 */}
      <div className="px-4 pb-2">
        <QuestionCard
          question={currentQuestion}
          questionIndex={activeTab}
          answer={getAnswer(activeTab)}
          focusedIndex={focusedOptIdx}
          showBadge={questions.length === 1}
          onToggleOption={(label) => {
            toggleOptionByState(activeTab, currentQuestion, label)
            if (!currentQuestion.multiSelect && !isLastTab) {
              clearAutoAdvanceTimer()
              autoAdvanceTimerRef.current = setTimeout(() => {
                autoAdvanceTimerRef.current = null
                setActiveTab((prev) => prev + 1)
              }, 150)
            }
          }}
          onToggleCustom={() => toggleCustomByState(activeTab)}
          onCustomTextChange={(text) => setAnswers((prev) => {
            const map = new Map(prev)
            const cur = map.get(activeTab) ?? EMPTY_ANSWER
            map.set(activeTab, { ...cur, customText: text })
            return map
          })}
          onSubmit={isLastTab ? handleSubmit : goNextTab}
        />
      </div>

      {error && (
        <div className="px-4 pb-2 text-xs text-red-600">{error}</div>
      )}

      {/* 底部 */}
      <div className="flex items-center justify-end gap-1.5 px-4 pb-3">
        <span className="text-[10px] text-slate-400 mr-auto">
          ↑↓ 选择 · Enter {isLastTab ? '确认' : '下一个'}
        </span>
        {isLastTab && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !hasValidAnswers}
            className="h-7 px-3 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 inline-flex items-center"
          >
            <Send className="w-3 h-3 mr-1" />
            确认
          </button>
        )}
      </div>
    </div>
  )
}

/** 单个问题卡片（竖向选项） */
function QuestionCard({
  question,
  questionIndex,
  answer,
  focusedIndex,
  showBadge,
  onToggleOption,
  onToggleCustom,
  onCustomTextChange,
  onSubmit,
}: {
  question: AskUserQuestion
  questionIndex: number
  answer: QuestionAnswer
  focusedIndex: number
  showBadge: boolean
  onToggleOption: (label: string) => void
  onToggleCustom: () => void
  onCustomTextChange: (text: string) => void
  onSubmit: () => void
}): React.ReactElement {
  const optionCount = question.options.length
  const previewOption = focusedIndex >= 0 && focusedIndex < optionCount
    ? question.options[focusedIndex]
    : question.options.find((o) => answer.selected.includes(o.label))
  const previewContent = previewOption?.preview

  return (
    <div className="space-y-2">
      {/* 问题标签 + 文本（分行显示） */}
      <div className="space-y-1">
        {showBadge && (
          <span className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-600 text-white shadow-sm">
            {`${questionIndex + 1}-${question.multiSelect ? '多选' : '单选'}${question.header ? `：${question.header}` : ''}`}
          </span>
        )}
        <p className="text-sm text-slate-900">{question.question}</p>
      </div>

      {/* 竖向选项 */}
      <div className="flex flex-col gap-1">
        {question.options.map((option, idx) => {
          const isSelected = answer.selected.includes(option.label)
          const isFocused = focusedIndex === idx
          return (
            <button
              key={option.label}
              type="button"
              className={`
                flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all outline-none text-left
                ${isSelected
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                }
                ${isFocused ? 'ring-2 ring-blue-400 ring-offset-1 ring-offset-white' : ''}
              `}
              onClick={() => onToggleOption(option.label)}
            >
              <span className={`text-[10px] shrink-0 ${isSelected ? 'text-white/60' : 'text-slate-400'}`}>
                {idx + 1}
              </span>
              <span className="font-medium">{option.label}</span>
              {option.description && (
                <span className={`text-[11px] ${isSelected ? 'text-white/70' : 'text-slate-500'}`}>
                  {option.description}
                </span>
              )}
            </button>
          )
        })}

        {/* "其他" */}
        <button
          type="button"
          className={`
            flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all outline-none text-left
            ${answer.showCustom
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
            }
            ${focusedIndex === optionCount ? 'ring-2 ring-blue-400 ring-offset-1 ring-offset-white' : ''}
          `}
          onClick={onToggleCustom}
        >
          <span className={`text-[10px] shrink-0 ${answer.showCustom ? 'text-white/60' : 'text-slate-400'}`}>
            {optionCount + 1}
          </span>
          <span className="font-medium">其他...</span>
        </button>
      </div>

      {/* 自由文本输入 */}
      {answer.showCustom && (
        <input
          type="text"
          className="w-full px-3 py-2 rounded-lg text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-slate-400 transition-colors"
          placeholder="输入自定义答案..."
          value={answer.customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.stopPropagation() // 阻止冒泡到 document handler，避免重复触发 setActiveTab
              onSubmit()
            }
          }}
          autoFocus
        />
      )}

      {/* 选项 Preview（聚焦或选中时展示） */}
      {previewContent && (
        <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs prose prose-sm max-w-none prose-p:my-0 prose-headings:my-0.5 prose-li:my-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <Markdown remarkPlugins={PREVIEW_REMARK_PLUGINS} urlTransform={safeUrlTransform}>
            {previewContent}
          </Markdown>
        </div>
      )}
    </div>
  )
}
