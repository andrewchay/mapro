import { Link } from 'react-router-dom'
import type { Campaign } from '@ma-proma/shared'

const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  dual: '双平台',
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  strategy: '策略制定',
  kol_selection: '达人筛选',
  negotiation: '商务洽谈',
  content_production: '内容制作',
  live: '投放执行',
  review: '复盘',
  completed: '已完成',
}

interface CampaignCardProps {
  campaign: Campaign
}

export function CampaignCard({ campaign }: CampaignCardProps) {
  return (
    <Link
      to={`/campaigns/${campaign.id}`}
      className="block bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{campaign.name}</h3>
          <p className="text-sm text-slate-500 mt-1">{campaign.brand} · {PLATFORM_LABEL[campaign.platform] ?? campaign.platform}</p>
        </div>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
          {STATUS_LABEL[campaign.status] ?? campaign.status}
        </span>
      </div>
      <div className="mt-4 flex items-center gap-6 text-sm text-slate-600">
        <span>预算：¥{(campaign.budget ?? 0).toLocaleString()}</span>
        <span>周期：{campaign.durationMonths} 个月</span>
        <span>当前阶段：第 {campaign.currentPhase} 阶段</span>
      </div>
    </Link>
  )
}
