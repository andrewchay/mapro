import * as React from 'react'
import { ShieldCheck, X, Loader2 } from 'lucide-react'
import { webAPI } from '../api/web-api.ts'
import type { Campaign, CampaignKOLPoolItem } from '@ma-proma/shared'

interface BatchContentAuditDialogProps {
  campaign: Campaign
  kols: CampaignKOLPoolItem[]
  open: boolean
  onClose: () => void
  onAudited?: () => void | Promise<void>
}

export function BatchContentAuditDialog({ campaign, kols, open, onClose, onAudited }: BatchContentAuditDialogProps) {
  const [contentDesc, setContentDesc] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [succeededIds, setSucceededIds] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    if (!open) {
      setContentDesc('')
      setProgress(0)
      setError(null)
      setSucceededIds(new Set())
    }
  }, [open])

  if (!open) return null

  const handleSubmit = async () => {
    if (!contentDesc.trim()) return
    setSubmitting(true)
    setError(null)

    const pendingKols = kols.filter((kol) => !succeededIds.has(kol.kolId))

    try {
      for (let i = 0; i < pendingKols.length; i++) {
        const kol = pendingKols[i]
        if (!kol) continue
        await webAPI.createContentAudit({
          campaignId: campaign.id,
          kolId: kol.kolId,
          kolName: kol.name,
          brand: campaign.brand,
          product: campaign.brand,
          platform: kol.platform,
          contentType: '图文',
          contentDescription: contentDesc.trim(),
        })
        setSucceededIds((prev) => {
          const next = new Set(prev)
          next.add(kol.kolId)
          return next
        })
        setProgress((prev) => prev + 1)
      }
      await onAudited?.()
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : '批量审核失败'
      setError(message)
      console.error('[BatchContentAuditDialog] 批量审核失败:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const allSucceeded = succeededIds.size === kols.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            批量内容审核 — 已选 {kols.length} 人
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" disabled={submitting}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {allSucceeded && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
              全部 KOL 审核已创建成功。
            </div>
          )}

          <div className="text-sm text-slate-500">
            品牌：<span className="text-slate-900 font-medium">{campaign.brand}</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              统一内容描述 / 脚本 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={contentDesc}
              onChange={(e) => setContentDesc(e.currentTarget.value)}
              placeholder="粘贴需要批量审核的内容文案或脚本，将应用至所有已选 KOL..."
              disabled={submitting}
              className="w-full h-32 px-3 py-2 rounded-lg border border-slate-300 text-sm resize-none focus:border-blue-500 focus:outline-none disabled:bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">已选 KOL</label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {kols.map((kol) => (
                <div key={kol.kolId} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-slate-900">{kol.name}</span>
                  <span className={`text-xs ${succeededIds.has(kol.kolId) ? 'text-emerald-600' : 'text-slate-500'}`}>
                    {succeededIds.has(kol.kolId) ? '已创建' : kol.platform}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {submitting && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin" />
              审核进度：{progress} / {kols.length}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !contentDesc.trim() || kols.length === 0 || allSucceeded}
            className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                审核中...
              </>
            ) : allSucceeded ? (
              <>
                <ShieldCheck className="w-4 h-4" />
                已完成
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                提交批量审核
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
