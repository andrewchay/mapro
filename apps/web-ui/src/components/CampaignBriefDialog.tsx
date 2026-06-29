import * as React from 'react'
import { FileText, Wand2, Save, X } from 'lucide-react'
import { webAPI } from '../api/web-api.ts'
import type { Campaign, CampaignKOLPoolItem } from '@ma-proma/shared'

interface CampaignBriefDialogProps {
  campaign: Campaign
  kol: CampaignKOLPoolItem
  open: boolean
  onClose: () => void
}

export function CampaignBriefDialog({ campaign, kol, open, onClose }: CampaignBriefDialogProps) {
  const [content, setContent] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    webAPI
      .getCampaignBrief(campaign.id, kol.kolId)
      .then((brief) => {
        if (brief) {
          setContent(brief.content)
          setLastSavedAt(brief.updatedAt)
        } else {
          setContent('')
          setLastSavedAt(null)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [open, campaign.id, kol.kolId])

  const handleGenerate = async () => {
    const brief = await webAPI.saveCampaignBrief({
      campaignId: campaign.id,
      kolId: kol.kolId,
      kolName: kol.name,
      autoGenerate: true,
    })
    setContent(brief.content)
    setLastSavedAt(brief.updatedAt)
  }

  const handleSave = async () => {
    if (!content.trim()) return
    setSaving(true)
    try {
      const brief = await webAPI.saveCampaignBrief({
        campaignId: campaign.id,
        kolId: kol.kolId,
        kolName: kol.name,
        content: content.trim(),
      })
      setLastSavedAt(brief.updatedAt)
      onClose()
    } catch (error) {
      console.error('[CampaignBriefDialog] 保存失败:', error)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {kol.name} 的 Brief
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 px-6 py-3 border-b border-slate-100">
          <div className="p-2.5 rounded-lg bg-slate-50">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Campaign</div>
            <div className="text-xs font-medium truncate">{campaign.name}</div>
            <div className="text-[11px] text-slate-500">{campaign.brand} · {campaign.targetAudience}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">KOL</div>
            <div className="text-xs font-medium truncate">{kol.name}</div>
            <div className="text-[11px] text-slate-500">{kol.platform} · {kol.followers} · {kol.category}</div>
          </div>
        </div>

        <div className="px-6 py-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <Wand2 className="w-3.5 h-3.5" />
            生成基础 Brief
          </button>
        </div>

        <div className="flex-1 min-h-0 px-6 py-2">
          {loading ? (
            <div className="text-sm text-slate-500 py-8 text-center">加载中...</div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.currentTarget.value)}
              placeholder="点击「生成基础 Brief」自动填充，或手动编写合作 Brief..."
              className="w-full h-80 p-3 rounded-lg border border-slate-300 text-sm font-mono leading-relaxed resize-none focus:border-blue-500 focus:outline-none"
              spellCheck={false}
            />
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200">
          <div className="text-[11px] text-slate-500">
            {lastSavedAt ? `最后更新: ${new Date(lastSavedAt).toLocaleString()}` : '尚未保存'}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !content.trim()}
              className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
            >
              <Save className="w-4 h-4" />
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
