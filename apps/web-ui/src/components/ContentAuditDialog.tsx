import * as React from 'react'
import { ShieldCheck, X, Loader2, CheckCircle, AlertCircle, XCircle } from 'lucide-react'
import { webAPI } from '../api/web-api.ts'
import type { Campaign, CampaignKOLPoolItem, ContentAudit } from '@ma-proma/shared'

interface ContentAuditDialogProps {
  campaign: Campaign
  kol: CampaignKOLPoolItem
  open: boolean
  onClose: () => void
  onAudited?: () => void
}

const STATUS_CONFIG = {
  passed: { label: '通过', color: 'text-emerald-600 bg-emerald-50', icon: CheckCircle },
  failed: { label: '不通过', color: 'text-red-600 bg-red-50', icon: XCircle },
  pending: { label: '待审核', color: 'text-amber-600 bg-amber-50', icon: AlertCircle },
  reviewing: { label: '审核中', color: 'text-blue-600 bg-blue-50', icon: Loader2 },
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const color = score >= 80 ? 'text-emerald-500' : score >= 60 ? 'text-amber-500' : score >= 40 ? 'text-orange-500' : 'text-red-500'
  return (
    <div className="flex flex-col items-center">
      <div className={`text-2xl font-bold ${color}`}>{score}</div>
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  )
}

export function ContentAuditDialog({ campaign, kol, open, onClose, onAudited }: ContentAuditDialogProps) {
  const [contentDesc, setContentDesc] = React.useState('')
  const [contentUrl, setContentUrl] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [auditResult, setAuditResult] = React.useState<ContentAudit | null>(null)

  React.useEffect(() => {
    if (open) return
    setContentDesc('')
    setContentUrl('')
    setAuditResult(null)
  }, [open])

  const handleSubmit = async () => {
    if (!contentDesc.trim()) return
    setSubmitting(true)
    try {
      const result = await webAPI.createContentAudit({
        campaignId: campaign.id,
        kolId: kol.kolId,
        kolName: kol.name,
        brand: campaign.brand,
        product: campaign.brand,
        platform: kol.platform,
        contentType: '图文',
        contentDescription: contentDesc.trim(),
        contentUrl: contentUrl.trim() || undefined,
      })
      setAuditResult(result)
      onAudited?.()
    } catch (error) {
      console.error('[ContentAuditDialog] 提交失败:', error)
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const statusConfig = STATUS_CONFIG[auditResult?.auditStatus ?? 'pending']
  const StatusIcon = statusConfig.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            内容审核 — {kol.name}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!auditResult ? (
            <div className="space-y-4">
              <div className="text-sm text-slate-500">
                品牌：<span className="text-slate-900 font-medium">{campaign.brand}</span>
                <span className="mx-2">·</span>
                平台：<span className="text-slate-900 font-medium">{kol.platform}</span>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">内容描述 / 脚本</label>
                <textarea
                  value={contentDesc}
                  onChange={(e) => setContentDesc(e.currentTarget.value)}
                  placeholder="粘贴 KOL 提交的内容文案或脚本..."
                  className="w-full h-32 px-3 py-2 rounded-lg border border-slate-300 text-sm resize-none focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">内容链接（可选）</label>
                <input
                  type="text"
                  value={contentUrl}
                  onChange={(e) => setContentUrl(e.currentTarget.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${statusConfig.color}`}>
                  <StatusIcon className={`w-4 h-4 ${auditResult.auditStatus === 'reviewing' && 'animate-spin'}`} />
                  {statusConfig.label}
                </div>
                <span className="text-sm text-slate-500">
                  综合评分：<span className={`font-bold ${auditResult.overallScore >= 60 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {auditResult.overallScore}
                  </span> / 100
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
                <ScoreRing score={auditResult.complianceScore} label="合规性" />
                <ScoreRing score={auditResult.brandAlignmentScore} label="品牌契合" />
                <ScoreRing score={auditResult.qualityScore} label="内容质量" />
              </div>

              {auditResult.auditReport && (
                <div className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 p-3 rounded-lg border border-slate-200">
                  {auditResult.auditReport}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
          {!auditResult ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting || !contentDesc.trim()}
                className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    AI 审核中...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    提交审核
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setAuditResult(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                重新审核
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                关闭
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
