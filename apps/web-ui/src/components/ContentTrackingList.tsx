import * as React from 'react'
import type { KOLContentTracking } from '@ma-proma/shared'
import { Pencil, Megaphone, Sparkles, Trash2, BarChart3 } from 'lucide-react'
import { EmptyState } from './ui/EmptyState.tsx'
import { TableSkeleton } from './ui/TableSkeleton.tsx'

const GRADE_LABEL: Record<string, string> = {
  excellent: '优秀',
  good: '良好',
  normal: '一般',
  poor: '较差',
  pending: '待评估',
}

const GRADE_COLOR: Record<string, string> = {
  excellent: 'bg-green-100 text-green-700',
  good: 'bg-blue-100 text-blue-700',
  normal: 'bg-yellow-100 text-yellow-700',
  poor: 'bg-red-100 text-red-700',
  pending: 'bg-slate-100 text-slate-700',
}

interface ContentTrackingListProps {
  tracking: KOLContentTracking[]
  loading?: boolean
  onEdit?: (item: KOLContentTracking) => void
  onAddPaid?: (item: KOLContentTracking) => void
  onAnalyze?: (item: KOLContentTracking) => void
  onDelete?: (id: string) => void
}

export function ContentTrackingList({ tracking, loading, onEdit, onAddPaid, onAnalyze, onDelete }: ContentTrackingListProps) {
  if (loading) {
    return <TableSkeleton columns={9} />
  }

  if (tracking.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="暂无内容追踪数据"
        description="添加第一条 KOL 内容数据，开始回收投放效果。"
      />
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">KOL</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">平台</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">曝光</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">浏览</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">点赞</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">评论</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">收藏</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">等级</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {tracking.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm text-slate-900">{item.kolName}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{item.platform}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{(item.exposure ?? 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{(item.views ?? 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{(item.likes ?? 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{(item.comments ?? 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{(item.saves ?? 0).toLocaleString()}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${GRADE_COLOR[item.performanceGrade] ?? GRADE_COLOR.pending}`}>
                  {GRADE_LABEL[item.performanceGrade] ?? item.performanceGrade}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onEdit?.(item)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    title="编辑"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onAddPaid?.(item)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-purple-600 hover:bg-purple-50"
                    title="投流"
                  >
                    <Megaphone className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onAnalyze?.(item)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50"
                    title="分析"
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onDelete?.(item.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
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
