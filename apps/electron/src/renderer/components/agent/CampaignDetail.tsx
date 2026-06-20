/**
 * CampaignDetail - Campaign 详情页
 *
 * Slice 2: 展示 Campaign 基本信息 + 三阶段进度。
 * Slice 3: 添加 KOL 候选池导入 + 展示。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { ArrowLeft, Calendar, MapPin, Users, DollarSign, Plus, UserCheck, FileText, Rocket, ShieldCheck, Bot } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CampaignBriefDialog } from './CampaignBriefDialog'
import { CampaignKOLImportDialog } from './CampaignKOLImportDialog'
import { ContentAuditDialog } from './ContentAuditDialog'
import { CampaignWorkflowSteps } from './CampaignWorkflowSteps'
import { campaignsAtom } from '@/atoms/campaign-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import { activeViewAtom } from '@/atoms/active-view'
import { currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { tabsAtom, activeTabIdAtom, openTab } from '@/atoms/tab-atoms'
import type { Campaign, CampaignKOLPoolItem } from '@ma-proma/shared'

interface CampaignDetailProps {
  campaign: Campaign
  onBack: () => void
  onNavigateToKolData?: () => void
}

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

const POOL_STATUS_LABEL: Record<string, string> = {
  candidate: '候选',
  shortlisted: 'shortlisted',
  contacted: '已联系',
  confirmed: '已确认',
  rejected: '已拒绝',
}

const PHASES = [
  { num: 1, name: '美学吸睛期', months: '第 1-2 月', goal: '建立视觉认知，占领关键词' },
  { num: 2, name: '场景渗透期', months: '第 3-4 月', goal: '场景绑定，情感连接' },
  { num: 3, name: '价值深化期', months: '第 5-6 月', goal: '品牌护城河，长尾维护' },
]

export function CampaignDetail({ campaign: initialCampaign, onBack, onNavigateToKolData }: CampaignDetailProps): React.ReactElement {
  const setCampaigns = useSetAtom(campaignsAtom)
  const setAppMode = useSetAtom(appModeAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setCurrentAgentSessionId = useSetAtom(currentAgentSessionIdAtom)
  const setCurrentAgentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const setTabs = useSetAtom(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const [campaign, setCampaign] = React.useState(initialCampaign)
  const [poolKOLs, setPoolKOLs] = React.useState<CampaignKOLPoolItem[]>([])
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)
  const [briefDialogOpen, setBriefDialogOpen] = React.useState(false)
  const [selectedBriefKOL, setSelectedBriefKOL] = React.useState<CampaignKOLPoolItem | null>(null)
  const [loadingPool, setLoadingPool] = React.useState(true)
  const [advancing, setAdvancing] = React.useState(false)
  const [openingAgent, setOpeningAgent] = React.useState(false)

  // ... rest of the component

  // 内容审核状态
  const [auditDialogOpen, setAuditDialogOpen] = React.useState(false)
  const [selectedAuditKOL, setSelectedAuditKOL] = React.useState<CampaignKOLPoolItem | null>(null)
  const [auditHistoryOpen, setAuditHistoryOpen] = React.useState(false)
  const [auditHistory, setAuditHistory] = React.useState<import('@ma-proma/shared').ContentAudit[]>([])
  const [loadingAudits, setLoadingAudits] = React.useState(false)

  React.useEffect(() => {
    setCampaign(initialCampaign)
  }, [initialCampaign])

  const applyCampaignUpdate = React.useCallback((updated: Campaign) => {
    setCampaign(updated)
    setCampaigns((prev) => prev.map((item) => item.id === updated.id ? updated : item))
  }, [setCampaigns])

  // 加载候选池 KOL
  React.useEffect(() => {
    setLoadingPool(true)
    window.electronAPI
      .getPoolKOLs(campaign.id)
      .then((list) => {
        setPoolKOLs(list)
      })
      .catch(console.error)
      .finally(() => setLoadingPool(false))
  }, [campaign.id])

  // 加载审核历史
  React.useEffect(() => {
    if (!auditHistoryOpen) return
    setLoadingAudits(true)
    window.electronAPI
      .listContentAudits(campaign.id)
      .then((list) => setAuditHistory(list))
      .catch(console.error)
      .finally(() => setLoadingAudits(false))
  }, [auditHistoryOpen, campaign.id])

  const handleImported = () => {
    window.electronAPI
      .getPoolKOLs(campaign.id)
      .then((list) => setPoolKOLs(list))
      .catch(console.error)
  }

  const handleAdvancePhase = async () => {
    if (campaign.currentPhase >= 3) {
      toast.info('已到达最后阶段')
      return
    }
    setAdvancing(true)
    try {
      const updated = await window.electronAPI.advanceCampaignPhase(campaign.id)
      if (updated) {
        applyCampaignUpdate(updated)
        toast.success(`已进入第 ${updated.currentPhase} 阶段：${PHASES[updated.currentPhase - 1]?.name ?? ''}`)
      } else {
        toast.error('推进失败')
      }
    } catch (error) {
      console.error('[CampaignDetail] 推进失败:', error)
      toast.error('推进失败')
    } finally {
      setAdvancing(false)
    }
  }

  const handleOpenInAgent = async (customPrompt?: string) => {
    setOpeningAgent(true)
    try {
      const workspaceSlug = `campaign-${campaign.id}`
      const channels = await window.electronAPI.listChannels()
      const defaultChannel = channels.find((c) => c.enabled)
      if (!defaultChannel) {
        toast.error('未找到可用的 Agent 渠道')
        return
      }

      const workspaces = await window.electronAPI.listAgentWorkspaces()
      let workspace = workspaces.find((w) => w.slug === workspaceSlug)
      if (!workspace) {
        workspace = await window.electronAPI.createAgentWorkspace(campaign.name, workspaceSlug)
      }
      if (!workspace) {
        toast.error('Agent 工作区初始化失败')
        return
      }

      const sessions = await window.electronAPI.listAgentSessions()
      let session = sessions.find(
        (s) => s.title === campaign.name && s.workspaceId === workspace!.id
      )
      if (!session) {
        session = await window.electronAPI.createAgentSession(
          campaign.name,
          defaultChannel.id,
          workspace.id,
        )
      }

      // 打开 Agent 标签并切换模式
      setTabs((prev) => {
        const result = openTab(prev, { type: 'agent', sessionId: session!.id, title: campaign.name })
        return result.tabs
      })
      setActiveTabId(session!.id)
      setAppMode('agent')
      setActiveView('conversations')
      setCurrentAgentSessionId(session!.id)
      setCurrentAgentWorkspaceId(workspace.id)
      window.electronAPI.updateSettings({ agentWorkspaceId: workspace.id }).catch(console.error)

      // 如果有自定义提示词，延迟发送（等待 Agent 初始化完成）
      if (customPrompt) {
        // 等待一小段时间确保会话已初始化
        setTimeout(() => {
          window.electronAPI.sendAgentMessage({
            sessionId: session!.id,
            userMessage: customPrompt,
            channelId: defaultChannel.id,
            workspaceId: workspace!.id,
            permissionModeOverride: 'bypassPermissions',
            startedAt: Date.now(),
          }).catch(console.error)
        }, 500)
      }
    } catch (error) {
      console.error('[CampaignDetail] 打开 Agent 失败:', error)
      toast.error('打开 Agent 失败')
    } finally {
      setOpeningAgent(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      {/* 头部 */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border titlebar-no-drag">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold truncate">{campaign.name}</h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium">
              {PLATFORM_LABEL[campaign.platform]}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
              {STATUS_LABEL[campaign.status]}
            </span>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleOpenInAgent()}
          disabled={openingAgent}
          className="text-xs border-primary/30 text-primary hover:bg-primary/5 flex-shrink-0"
        >
          <Bot size={14} className="mr-1.5" />
          {openingAgent ? '启动中...' : '使用 Agent 协助'}
        </Button>
      </div>

      {/* 基本信息卡片 */}
      <div className="p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="p-3 rounded-xl border border-border bg-background">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
              <DollarSign size={12} />
              总预算
            </div>
            <div className="text-sm font-semibold">{campaign.budget.toLocaleString()} 元</div>
          </div>
          <div className="p-3 rounded-xl border border-border bg-background">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
              <Calendar size={12} />
              投放周期
            </div>
            <div className="text-sm font-semibold">{campaign.durationMonths} 个月</div>
          </div>
          <div className="p-3 rounded-xl border border-border bg-background">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
              <MapPin size={12} />
              目标城市
            </div>
            <div className="text-sm font-semibold truncate">
              {campaign.targetCity.length > 0 ? campaign.targetCity.join('、') : '未指定'}
            </div>
          </div>
          <div className="p-3 rounded-xl border border-border bg-background">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
              <Users size={12} />
              品牌
            </div>
            <div className="text-sm font-semibold truncate">{campaign.brand}</div>
          </div>
        </div>

        {/* 目标人群 */}
        {campaign.targetAudience && (
          <div className="mb-5 p-3 rounded-xl border border-border bg-background">
            <div className="text-[11px] text-muted-foreground mb-1">目标人群</div>
            <div className="text-sm">{campaign.targetAudience}</div>
          </div>
        )}

        {/* 工作流步骤 */}
        <div className="mb-5">
          <CampaignWorkflowSteps
            campaignId={campaign.id}
            campaignName={campaign.name}
            campaignContext={{
              brand: campaign.brand,
              platform: campaign.platform,
              budget: campaign.budget.toString(),
              targetCity: campaign.targetCity.join('、'),
              targetAudience: campaign.targetAudience,
              durationMonths: campaign.durationMonths.toString(),
            }}
            onOpenInAgent={(prompt) => void handleOpenInAgent(prompt)}
          />
        </div>

        {/* 三阶段进度 */}
        <div className="mb-5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            投放阶段
          </h3>
          <div className="space-y-3">
            {campaign.phasePlans.map((phase) => {
              const isActive = phase.phase === campaign.currentPhase
              const isCompleted = phase.phase < campaign.currentPhase
              return (
                <div
                  key={phase.phase}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-xl border transition-all',
                    isActive
                      ? 'border-primary/30 bg-primary/5'
                      : isCompleted
                        ? 'border-border/60 bg-muted/20'
                        : 'border-border bg-background'
                  )}
                >
                  <div
                    className={cn(
                      'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isCompleted
                          ? 'bg-primary/20 text-primary'
                          : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {isCompleted ? '✓' : phase.phase}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={cn(
                        'text-sm font-medium',
                        isActive ? 'text-foreground' : isCompleted ? 'text-foreground/70' : 'text-muted-foreground'
                      )}>
                        {phase.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{phase.months}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{phase.goal}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 创意策略 */}
        <div className="mb-5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            创意策略
          </h3>
          <div className="p-3 rounded-xl border border-border bg-background">
            <div className="text-sm font-semibold">{campaign.creativePlan.bigIdea}</div>
            <p className="text-xs text-muted-foreground mt-1">{campaign.creativePlan.coreMessage}</p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {campaign.creativePlan.contentPillars.map((pillar) => (
                <span key={pillar} className="px-2 py-1 rounded-md bg-muted text-[10px] text-muted-foreground">
                  {pillar}
                </span>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground mt-3">
              语气：{campaign.creativePlan.tone}
            </div>
          </div>
        </div>

        {/* 预算分配 + 推进按钮 */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              预算分配
            </h3>
            {campaign.currentPhase < 3 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleAdvancePhase()}
                disabled={advancing}
                className="text-xs border-primary/30 text-primary hover:bg-primary/5"
              >
                <Rocket size={13} className="mr-1" />
                {advancing ? '推进中...' : '推进到下一阶段'}
              </Button>
            )}
            {campaign.currentPhase >= 3 && (
              <span className="text-[10px] text-muted-foreground px-2 py-1 rounded bg-muted">
                全部阶段已完成
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {campaign.phasePlans.map((phase) => {
              const isActive = phase.phase === campaign.currentPhase
              return (
                <div
                  key={phase.phase}
                  className={cn(
                    'p-3 rounded-xl border text-center',
                    isActive ? 'border-primary/20 bg-primary/5' : 'border-border bg-background'
                  )}
                >
                  <div className="text-[11px] text-muted-foreground mb-1">{phase.name}</div>
                  <div className="text-sm font-semibold">{phase.budget.toLocaleString()} 元</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {phase.months}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* KOL 候选池 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              KOL 候选池
            </h3>
            <Button size="sm" variant="outline" onClick={() => setImportDialogOpen(true)}>
              <Plus size={14} className="mr-1" />
              导入 KOL
            </Button>
          </div>

          {loadingPool ? (
            <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
          ) : poolKOLs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-border rounded-xl">
              <UserCheck size={32} className="text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">暂无 KOL 在候选池</p>
              <p className="text-xs text-muted-foreground/60 mt-1">点击上方按钮导入 KOL</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {poolKOLs.map((kol) => (
                <div
                  key={kol.kolId}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border bg-background hover:border-primary/20 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-medium text-primary">
                    {kol.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{kol.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {kol.platform}
                      </span>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                        kol.status === 'confirmed' ? 'bg-green-500/10 text-green-600' :
                        kol.status === 'contacted' ? 'bg-blue-500/10 text-blue-600' :
                        kol.status === 'shortlisted' ? 'bg-amber-500/10 text-amber-600' :
                        kol.status === 'rejected' ? 'bg-red-500/10 text-red-600' :
                        'bg-gray-500/10 text-gray-600'
                      )}>
                        {POOL_STATUS_LABEL[kol.status] ?? kol.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {kol.followers} 粉丝 · {kol.engagement} 互动率 · {kol.category}
                      {kol.city && ` · ${kol.city}`}
                      {kol.price && ` · ${kol.price}`}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-primary flex-shrink-0"
                    onClick={() => {
                      setSelectedBriefKOL(kol)
                      setBriefDialogOpen(true)
                    }}
                  >
                    <FileText size={13} className="mr-1" />
                    Brief
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-emerald-600 flex-shrink-0"
                    onClick={() => {
                      setSelectedAuditKOL(kol)
                      setAuditDialogOpen(true)
                    }}
                  >
                    <ShieldCheck size={13} className="mr-1" />
                    审核
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CampaignKOLImportDialog
        campaignId={campaign.id}
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImported={handleImported}
        onNavigateToKolData={onNavigateToKolData}
      />

      {selectedBriefKOL && (
        <CampaignBriefDialog
          campaign={campaign}
          kol={selectedBriefKOL}
          open={briefDialogOpen}
          onOpenChange={(open) => {
            setBriefDialogOpen(open)
            if (!open) setSelectedBriefKOL(null)
          }}
        />
      )}

      {selectedAuditKOL && (
        <ContentAuditDialog
          campaign={campaign}
          kol={selectedAuditKOL}
          open={auditDialogOpen}
          onOpenChange={(open) => {
            setAuditDialogOpen(open)
            if (!open) setSelectedAuditKOL(null)
          }}
          onAudited={() => {
            window.electronAPI.listContentAudits(campaign.id)
              .then((list) => setAuditHistory(list))
              .catch(console.error)
          }}
        />
      )}

    </div>
  )
}
