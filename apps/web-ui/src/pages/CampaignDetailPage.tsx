import * as React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAtomValue, useSetAtom } from 'jotai'
import { ArrowLeft } from 'lucide-react'
import { currentCampaignAtom, campaignLoadingAtom, campaignErrorAtom, loadCampaignAtom } from '../store/campaign-atoms.ts'
import { CampaignBasicInfo } from '../components/CampaignBasicInfo.tsx'
import { CampaignPhasePlans } from '../components/CampaignPhasePlans.tsx'
import { KOLPoolList } from '../components/KOLPoolList.tsx'
import { ContentTrackingList } from '../components/ContentTrackingList.tsx'
import { usePoolKOLs, useContentTracking } from '../hooks/use-campaign-data.ts'

type Tab = 'phases' | 'kol-pool' | 'tracking'

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>()
  const campaign = useAtomValue(currentCampaignAtom)
  const loading = useAtomValue(campaignLoadingAtom)
  const error = useAtomValue(campaignErrorAtom)
  const loadCampaign = useSetAtom(loadCampaignAtom)
  const [activeTab, setActiveTab] = React.useState<Tab>('phases')

  const { pool, loading: poolLoading } = usePoolKOLs(id)
  const { tracking, loading: trackingLoading } = useContentTracking(id)

  React.useEffect(() => {
    if (id) {
      loadCampaign(id)
    }
  }, [id, loadCampaign])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'phases', label: '三阶段计划' },
    { key: 'kol-pool', label: 'KOL 候选池' },
    { key: 'tracking', label: '内容追踪' },
  ]

  return (
    <div>
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        返回列表
      </Link>

      {loading && !campaign && (
        <div className="text-center py-12 text-slate-500">加载中...</div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {campaign && (
        <div className="space-y-6">
          <CampaignBasicInfo campaign={campaign} />

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-1">
            <div className="flex gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === tab.key
                      ? 'bg-slate-100 text-slate-900'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {activeTab === 'phases' && <CampaignPhasePlans campaign={campaign} />}

          {activeTab === 'kol-pool' && (
            poolLoading ? (
              <div className="text-center py-12 text-slate-500">加载中...</div>
            ) : (
              <KOLPoolList pool={pool} />
            )
          )}

          {activeTab === 'tracking' && (
            trackingLoading ? (
              <div className="text-center py-12 text-slate-500">加载中...</div>
            ) : (
              <ContentTrackingList tracking={tracking} />
            )
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm text-amber-800">
              <span className="font-medium">阶段 A 提示：</span>
              工作流执行、KOL 智能匹配/导入、Brief 生成、内容审核等能力尚未在 Web 端启用，请使用桌面端 MAPro 进行操作。
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
