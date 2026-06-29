import * as React from 'react'
import { ChevronDown, X, Search, User } from 'lucide-react'
import type { CampaignKOLPoolItem } from '@ma-proma/shared'

interface KOLSelectorProps {
  /** KOL 候选池 */
  pool: CampaignKOLPoolItem[]
  /** 当前选中的 KOL ID */
  value: string | null
  /** 选择变化回调 */
  onChange: (kolId: string | null, kol: CampaignKOLPoolItem | null) => void
  /** 是否禁用 */
  disabled?: boolean
  /** 占位文本 */
  placeholder?: string
}

export function KOLSelector({ pool, value, onChange, disabled = false, placeholder = '选择 KOL' }: KOLSelectorProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const containerRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const selected = React.useMemo(() => pool.find((item) => item.kolId === value) ?? null, [pool, value])

  const filtered = React.useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return pool
    return pool.filter(
      (item) =>
        item.name.toLowerCase().includes(trimmed) ||
        item.kolId.toLowerCase().includes(trimmed) ||
        item.platform.toLowerCase().includes(trimmed),
    )
  }, [pool, query])

  React.useEffect(() => {
    if (open) {
      setQuery('')
      // 下拉打开后聚焦搜索框
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // 点击外部关闭
  React.useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleSelect = (kol: CampaignKOLPoolItem) => {
    onChange(kol.kolId, kol)
    setOpen(false)
    setQuery('')
  }

  const handleClear = (event: React.MouseEvent) => {
    event.stopPropagation()
    onChange(null, null)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
          disabled
            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
            : 'bg-white border-slate-300 text-slate-900 hover:border-slate-400 focus:border-blue-500 focus:outline-none'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <User className="w-4 h-4 text-slate-400 shrink-0" />
          {selected ? (
            <div className="flex flex-col items-start min-w-0">
              <span className="font-medium truncate">{selected.name}</span>
              <span className="text-xs text-slate-500 truncate">
                {selected.platform} · {selected.followers} 粉丝 · 报价 {selected.price}
              </span>
            </div>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {selected && !disabled && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-8 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
          aria-label="清除选择"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索 KOL 名称、ID 或平台"
              className="flex-1 text-sm outline-none text-slate-900 placeholder:text-slate-400"
              role="combobox"
              aria-controls="kol-selector-listbox"
              aria-autocomplete="list"
            />
          </div>

          <ul
            id="kol-selector-listbox"
            role="listbox"
            className="max-h-60 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-sm text-slate-500 text-center">
                未找到匹配的 KOL
              </li>
            ) : (
              filtered.map((item) => {
                const isSelected = item.kolId === value
                return (
                  <li
                    key={item.kolId}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(item)}
                    className={`px-3 py-2.5 cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{item.name}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {item.platform} · {item.followers} 粉丝 · 互动 {item.engagement}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 shrink-0 ml-2">{item.price}</div>
                    </div>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
