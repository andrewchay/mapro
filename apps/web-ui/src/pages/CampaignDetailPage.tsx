import * as React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAtomValue, useSetAtom } from 'jotai'
import { ArrowLeft, Plus } from 'lucide-react'
import { currentCampaignAtom, campaignLoadingAtom, campaignErrorAtom, loadCampaignAtom } from '../store/campaign-atoms.ts'
import { CampaignBasicInfo } from '../components/CampaignBasicInfo.tsx'
import { CampaignPhasePlans } from '../components/CampaignPhasePlans.tsx'
import { KOLPoolList } from '../components/KOLPoolList.tsx'
import { ContentTrackingList } from '../components/ContentTrackingList.tsx'
import { CampaignWorkflowSteps } from '../components/CampaignWorkflowSteps.tsx'
import { CampaignBriefDialog } from '../components/CampaignBriefDialog.tsx'
import { ContentAuditDialog } from '../components/ContentAuditDialog.tsx'
import { ContentAuditList } from '../components/ContentAuditList.tsx'
import { ContentTrackingFormDialog, PaidDataDialog, AnalysisDialog } from '../components/ContentTrackingDialogs.tsx'
import { usePoolKOLs, useContentTracking, useContentAudits } from '../hooks/use-campaign-data.ts'
import type { CampaignKOLPoolItem, KOLContentTracking } from '@ma-proma/shared'
import { webAPI } from '../api/web-api.ts'

type Tab = 'phases' | 'workflow' | 'kol-pool' | 'tracking' | 'audits'

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>()
  const campaign = useAtomValue(currentCampaignAtom)
  const loading = useAtomValue(campaignLoadingAtom)
  const error = useAtomValue(campaignErrorAtom)
  const loadCampaign = useSetAtom(loadCampaignAtom)
  const [activeTab, setActiveTab] = React.useState<Tab>('phases')

  const { pool, loading: poolLoading, error: poolError, refresh: refreshPool } = usePoolKOLs(id)
  const { tracking, loading: trackingLoading, error: trackingError, refresh: refreshTracking } = useContentTracking(id)
  const { audits, loading: auditsLoading, error: auditsError, refresh: refreshAudits } = useContentAudits(id)

  React.useEffect(() => {
    if (id) {
      loadCampaign(id)
    }
  }, [id, loadCampaign])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'phases', label: '三阶段计划' },
    { key: 'workflow', label: '工作流' },
    { key: 'kol-pool', label: 'KOL 候选池' },
    { key: 'tracking', label: '内容追踪' },
    { key: 'audits', label: '内容审核' },
  ]

  // Brief 弹窗
  const [briefOpen, setBriefOpen] = React.useState(false)
  const [briefKOL, setBriefKOL] = React.useState<CampaignKOLPoolItem | null>(null)

  // 审核弹窗
  const [auditOpen, setAuditOpen] = React.useState(false)
  const [auditKOL, setAuditKOL] = React.useState<CampaignKOLPoolItem | null>(null)

  // 内容追踪弹窗
  const [trackingFormOpen, setTrackingFormOpen] = React.useState(false)
  const [editingTracking, setEditingTracking] = React.useState<KOLContentTracking | null>(null)
  const [paidOpen, setPaidOpen] = React.useState(false)
  const [paidItem, setPaidItem] = React.useState<KOLContentTracking | null>(null)
  const [analysisOpen, setAnalysisOpen] = React.useState(false)
  const [analysisItem, setAnalysisItem] = React.useState<KOLContentTracking | null>(null)

  const handleBrief = (kol: CampaignKOLPoolItem) => {
    setBriefKOL(kol)
    setBriefOpen(true)
  }

  const handleAudit = (kol: CampaignKOLPoolItem) => {
    setAuditKOL(kol)
    setAuditOpen(true)
  }

  const handleEditTracking = (item: KOLContentTracking) => {
    setEditingTracking(item)
    setTrackingFormOpen(true)
  }

  const handleAddTracking = () => {
    setEditingTracking(null)
    setTrackingFormOpen(true)
  }

  const handleAddPaid = (item: KOLContentTracking) => {
    setPaidItem(item)
    setPaidOpen(true)
  }

  const handleAnalyze = (item: KOLContentTracking) => {
    setAnalysisItem(item)
    setAnalysisOpen(true)
  }

  const handleDeleteTracking = async (trackingId: string) => {
    if (!confirm('确定删除该条内容追踪数据？')) return
    try {
      await webAPI.deleteContentTracking(trackingId)
      await refreshTracking()
    } catch (error) {
      console.error('[CampaignDetailPage] 删除内容追踪失败:', error)
    }
  }

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

          {activeTab === 'workflow' && id && <CampaignWorkflowSteps campaignId={id} />}

          {activeTab === 'kol-pool' && (
            poolLoading ? (
              <div className="text-center py-12 text-slate-500">加载中...</div>
            ) : poolError ? (
              <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">{poolError}</div>
            ) : (
              <KOLPoolList pool={pool} onBrief={handleBrief} onAudit={handleAudit} />
            )
          )}

          {activeTab === 'tracking' && (
            trackingLoading ? (
              <div className="text-center py-12 text-slate-500">加载中...</div>
            ) : trackingError ? (
              <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">{trackingError}</div>
            ) : (
              <>
                <div className="flex justify-end mb-3">
                  <button
                    onClick={handleAddTracking}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    <Plus className="w-4 h-4" />
                    添加数据
                  </button>
                </div>
                <ContentTrackingList
                  tracking={tracking}
                  onEdit={handleEditTracking}
                  onAddPaid={handleAddPaid}
                  onAnalyze={handleAnalyze}
                  onDelete={handleDeleteTracking}
                />
              </>
            )
          )}

          {activeTab === 'audits' && (
            auditsLoading ? (
              <div className="text-center py-12 text-slate-500">加载中...</div>
            ) : auditsError ? (
              <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">{auditsError}</div>
            ) : (
              <ContentAuditList audits={audits} />
            )
          )}
        </div>
      )}

      {campaign && briefKOL && (
        <CampaignBriefDialog
          campaign={campaign}
          kol={briefKOL}
          open={briefOpen}
          onClose={() => {
            setBriefOpen(false)
            setBriefKOL(null)
          }}
        />
      )}

      {campaign && auditKOL && (
        <ContentAuditDialog
          campaign={campaign}
          kol={auditKOL}
          open={auditOpen}
          onClose={() => {
            setAuditOpen(false)
            setAuditKOL(null)
          }}
          onAudited={async () => {
            await refreshAudits()
            if (activeTab === 'audits') {
              loadCampaign(campaign.id)
            }
          }}
        />
      )}

      {id && (
        <ContentTrackingFormDialog
          open={trackingFormOpen}
          onClose={() => {
            setTrackingFormOpen(false)
            setEditingTracking(null)
          }}
          campaignId={id}
          pool={pool}
          editingItem={editingTracking}
          onSaved={async () => {
            await refreshTracking()
            if (activeTab === 'kol-pool') {
              await refreshPool()
            }
          }}
        />
      )}

      <PaidDataDialog
        item={paidItem}
        open={paidOpen}
        onClose={() => {
          setPaidOpen(false)
          setPaidItem(null)
        }}
        onSaved={refreshTracking}
      />

      <AnalysisDialog
        item={analysisItem}
        open={analysisOpen}
        onClose={() => {
          setAnalysisOpen(false)
          setAnalysisItem(null)
        }}
        onSaved={refreshTracking}
      />
    </div>
  )
}
