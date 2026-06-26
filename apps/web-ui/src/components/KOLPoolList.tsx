import type { CampaignKOLPoolItem } from '@ma-proma/shared'

const POOL_STATUS_LABEL: Record<string, string> = {
  candidate: '候选',
  shortlisted: ' shortlisted',
  contacted: '已联系',
  confirmed: '已确认',
  rejected: '已拒绝',
}

interface KOLPoolListProps {
  pool: CampaignKOLPoolItem[]
}

export function KOLPoolList({ pool }: KOLPoolListProps) {
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
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">KOL</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">平台</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">粉丝</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">互动</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">报价</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">状态</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {pool.map((item) => (
            <tr key={`${item.campaignId}-${item.kolId}`} className="hover:bg-slate-50">
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
