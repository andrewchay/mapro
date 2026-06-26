import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Plus } from 'lucide-react'
import { campaignListAtom, campaignLoadingAtom, campaignErrorAtom, refreshCampaignsAtom } from '../store/campaign-atoms.ts'
import { CampaignCard } from '../components/CampaignCard.tsx'
import { CreateCampaignDialog } from '../components/CreateCampaignDialog.tsx'

export function CampaignListPage() {
  const campaigns = useAtomValue(campaignListAtom)
  const loading = useAtomValue(campaignLoadingAtom)
  const error = useAtomValue(campaignErrorAtom)
  const refresh = useSetAtom(refreshCampaignsAtom)
  const [dialogOpen, setDialogOpen] = React.useState(false)

  React.useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Campaign 项目</h1>
          <p className="text-sm text-slate-500 mt-1">阶段 A1：只读列表与基础创建</p>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
        >
          <Plus className="w-4 h-4" />
          新建 Campaign
        </button>
      </div>

      {loading && campaigns.length === 0 && (
        <div className="text-center py-12 text-slate-500">加载中...</div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && campaigns.length === 0 && !error && (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
          <p className="text-slate-500">暂无 Campaign</p>
          <button
            onClick={() => setDialogOpen(true)}
            className="mt-4 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            创建第一个 Campaign
          </button>
        </div>
      )}

      <div className="grid gap-4">
        {campaigns.map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} />
        ))}
      </div>

      <CreateCampaignDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}
