import type { ContentAudit } from '@ma-proma/shared'
import { ShieldCheck, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react'

interface ContentAuditListProps {
  audits: ContentAudit[]
}

const STATUS_CONFIG = {
  passed: { label: '通过', color: 'text-emerald-600 bg-emerald-50', icon: CheckCircle },
  failed: { label: '不通过', color: 'text-red-600 bg-red-50', icon: XCircle },
  pending: { label: '待审核', color: 'text-amber-600 bg-amber-50', icon: AlertCircle },
  reviewing: { label: '审核中', color: 'text-blue-600 bg-blue-50', icon: Loader2 },
}

export function ContentAuditList({ audits }: ContentAuditListProps) {
  if (audits.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
        暂无内容审核记录
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
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">状态</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">综合评分</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">合规 / 品牌 / 质量</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">报告摘要</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {audits.map((audit) => {
            const statusConfig = STATUS_CONFIG[audit.auditStatus]
            const StatusIcon = statusConfig.icon
            return (
              <tr key={audit.auditId} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-900">{audit.kolName}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{audit.platform}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${statusConfig.color}`}>
                    <StatusIcon className={`w-3.5 h-3.5 ${audit.auditStatus === 'reviewing' && 'animate-spin'}`} />
                    {statusConfig.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-slate-900">{audit.overallScore}</td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {audit.complianceScore} / {audit.brandAlignmentScore} / {audit.qualityScore}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">
                  {audit.auditReport || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
