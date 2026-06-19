/**
 * CampaignList - Campaign 项目列表页 + 详情视图
 *
 * Slice 1: 展示所有 Campaign，支持创建新 Campaign。
 * Slice 2: 点击 Campaign 显示详情页（基本信息 + 三阶段进度）。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Plus, Target, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { campaignsAtom, currentCampaignIdAtom } from '@/atoms/campaign-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { CampaignCreateDialog } from './CampaignCreateDialog'
import { CampaignDetail } from './CampaignDetail'
import { cn } from '@/lib/utils'
import type { Campaign } from '@ma-proma/shared'

export function CampaignList(): React.ReactElement {
  const [campaigns, setCampaigns] = useAtom(campaignsAtom)
  const currentCampaignId = useAtomValue(currentCampaignIdAtom)
  const setCurrentCampaignId = useSetAtom(currentCampaignIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [selectedCampaign, setSelectedCampaign] = React.useState<Campaign | null>(null)

  React.useEffect(() => {
    window.electronAPI
      .listCampaigns()
      .then((list) => {
        setCampaigns(list)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [setCampaigns])

  // Slice 2: 当 currentCampaignId 变化时，获取详情
  React.useEffect(() => {
    if (!currentCampaignId) {
      setSelectedCampaign(null)
      return
    }
    // 先尝试从本地列表找
    const local = campaigns.find((c) => c.id === currentCampaignId)
    if (local) {
      setSelectedCampaign(local)
      return
    }
    // 否则从后端获取
    window.electronAPI
      .getCampaignById(currentCampaignId)
      .then((campaign) => {
        if (campaign) setSelectedCampaign(campaign)
      })
      .catch(console.error)
  }, [currentCampaignId, campaigns])

  const handleCampaignCreated = (campaign: Campaign) => {
    setCampaigns((prev) => [campaign, ...prev])
    setCurrentCampaignId(campaign.id)
  }

  const handleBack = () => {
    setCurrentCampaignId(null)
  }

  // 如果有选中的 Campaign，显示详情页
  if (selectedCampaign) {
    return (
      <CampaignDetail
        campaign={selectedCampaign}
        onBack={handleBack}
        onNavigateToKolData={() => setActiveView('kol_data')}
      />
    )
  }

  const platformLabel: Record<string, string> = {
    xiaohongshu: '小红书',
    douyin: '抖音',
    dual: '双平台',
  }

  const statusLabel: Record<string, string> = {
    draft: '草稿',
    strategy: '策略制定',
    kol_selection: '达人筛选',
    negotiation: '商务洽谈',
    content_production: '内容制作',
    live: '投放执行',
    review: '复盘',
    completed: '已完成',
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 头部 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border titlebar-no-drag">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-primary" />
          <h2 className="text-sm font-semibold">Campaign 项目</h2>
        </div>
        <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
          <Plus size={14} className="mr-1" />
          新建 Campaign
        </Button>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Target size={48} className="text-muted-foreground/30 mb-4" />
            <p className="text-sm text-muted-foreground mb-2">暂无 Campaign 项目</p>
            <p className="text-xs text-muted-foreground/60">点击上方按钮创建第一个投放项目</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {campaigns.map((campaign) => (
              <button
                key={campaign.id}
                onClick={() => setCurrentCampaignId(campaign.id)}
                className={cn(
                  'w-full text-left p-4 rounded-xl border transition-all duration-200',
                  currentCampaignId === campaign.id
                    ? 'border-primary/30 bg-primary/5 shadow-sm'
                    : 'border-border bg-background hover:border-primary/20 hover:bg-muted/30'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold truncate">{campaign.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
                        {platformLabel[campaign.platform] ?? campaign.platform}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium">
                        {statusLabel[campaign.status] ?? campaign.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {campaign.brand} · 预算 {campaign.budget.toLocaleString()} 元 · {campaign.durationMonths} 个月
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground/40 flex-shrink-0 ml-2" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <CampaignCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={handleCampaignCreated}
      />
    </div>
  )
}
