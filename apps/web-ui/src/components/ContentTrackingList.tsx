import type { KOLContentTracking } from '@ma-proma/shared'

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
}

export function ContentTrackingList({ tracking }: ContentTrackingListProps) {
  if (tracking.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
        暂无内容追踪数据
      </div>
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
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">点赞</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">评论</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">收藏</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">等级</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {tracking.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm text-slate-900">{item.kolName}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{item.platform}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{(item.exposure ?? 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{(item.likes ?? 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{(item.comments ?? 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{(item.saves ?? 0).toLocaleString()}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${GRADE_COLOR[item.performanceGrade] ?? GRADE_COLOR.pending}`}>
                  {GRADE_LABEL[item.performanceGrade] ?? item.performanceGrade}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
