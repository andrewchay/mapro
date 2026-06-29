import * as React from 'react'
import type { CampaignKOLPoolItem } from '@ma-proma/shared'
import { FileText, ShieldCheck } from 'lucide-react'

const POOL_STATUS_LABEL: Record<string, string> = {
  candidate: '候选',
  shortlisted: 'shortlisted',
  contacted: '已联系',
  confirmed: '已确认',
  rejected: '已拒绝',
}

interface KOLPoolListProps {
  pool: CampaignKOLPoolItem[]
  onBrief?: (kol: CampaignKOLPoolItem) => void
  onAudit?: (kol: CampaignKOLPoolItem) => void
  selection?: {
    selected: string[]
    onChange: (selected: string[]) => void
  }
}

export function KOLPoolList({ pool, onBrief, onAudit, selection }: KOLPoolListProps) {
  const isSelectable = !!selection
  const selectedSet = React.useMemo(() => new Set(selection?.selected ?? []), [selection?.selected])
  const allSelected = pool.length > 0 && pool.every((item) => selectedSet.has(item.kolId))
  const someSelected = pool.some((item) => selectedSet.has(item.kolId)) && !allSelected

  const toggleAll = () => {
    if (!selection) return
    if (allSelected) {
      selection.onChange([])
    } else {
      selection.onChange(pool.map((item) => item.kolId))
    }
  }

  const toggleOne = (kolId: string) => {
    if (!selection) return
    const next = new Set(selectedSet)
    if (next.has(kolId)) {
      next.delete(kolId)
    } else {
      next.add(kolId)
    }
    selection.onChange(Array.from(next))
  }

  if (pool.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
        暂无 KOL 候选
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            {isSelectable && (
              <th className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected
                  }}
                  onChange={toggleAll}
                  aria-label="全选"
                />
              </th>
            )}
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">KOL</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">平台</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">粉丝</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">互动</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">报价</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">状态</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {pool.map((item) => (
            <tr key={`${item.campaignId}-${item.kolId}`} className="hover:bg-slate-50">
              {isSelectable && (
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(item.kolId)}
                    onChange={() => toggleOne(item.kolId)}
                    aria-label={`选择 ${item.name}`}
                  />
                </td>
              )}
              <td className="px-4 py-3 text-sm text-slate-900">{item.name}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{item.platform}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{item.followers}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{item.engagement}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{item.price}</td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                  {POOL_STATUS_LABEL[item.status] ?? item.status}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onBrief?.(item)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-md"
                    title="Brief"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Brief
                  </button>
                  <button
                    onClick={() => onAudit?.(item)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-md"
                    title="审核"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    审核
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
