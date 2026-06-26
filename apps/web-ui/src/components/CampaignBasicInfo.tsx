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

interface CampaignBasicInfoProps {
  campaign: Campaign
}

export function CampaignBasicInfo({ campaign }: CampaignBasicInfoProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{campaign.name}</h2>
          <p className="text-slate-500 mt-1">{campaign.brand} · {PLATFORM_LABEL[campaign.platform] ?? campaign.platform}</p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-slate-100 text-slate-700">
          {STATUS_LABEL[campaign.status] ?? campaign.status}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-slate-500">预算</p>
          <p className="text-slate-900 font-medium mt-1">¥{(campaign.budget ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-slate-500">周期</p>
          <p className="text-slate-900 font-medium mt-1">{campaign.durationMonths} 个月</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-slate-500">当前阶段</p>
          <p className="text-slate-900 font-medium mt-1">第 {campaign.currentPhase} 阶段</p>
        </div>
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-slate-500">目标人群</p>
          <p className="text-slate-900 font-medium mt-1 truncate">{campaign.targetAudience || '未填写'}</p>
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-slate-900">创意策略</h3>
        <div className="mt-2 text-sm text-slate-600 space-y-1">
          <p><span className="text-slate-500">大创意：</span>{campaign.creativePlan.bigIdea}</p>
          <p><span className="text-slate-500">核心信息：</span>{campaign.creativePlan.coreMessage}</p>
          <p><span className="text-slate-500">调性：</span>{campaign.creativePlan.tone}</p>
          <p><span className="text-slate-500">内容支柱：</span>{campaign.creativePlan.contentPillars.join('、')}</p>
        </div>
      </div>
    </div>
  )
}
