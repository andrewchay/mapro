import * as React from 'react'
import { Plus, Pencil, Megaphone, Sparkles, Save, X } from 'lucide-react'
import { webAPI } from '../api/web-api.ts'
import type { KOLContentTracking, CreateContentTrackingInput, UpdateContentTrackingDataInput, AddPaidDataInput, UpdateAnalysisInput } from '@ma-proma/shared'

const inputClass = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:outline-none'

interface ContentTrackingFormDialogProps {
  open: boolean
  onClose: () => void
  campaignId: string
  editingItem: KOLContentTracking | null
  onSaved: () => void
}

export function ContentTrackingFormDialog({ open, onClose, campaignId, editingItem, onSaved }: ContentTrackingFormDialogProps) {
  const isEditing = !!editingItem
  const [form, setForm] = React.useState<Partial<CreateContentTrackingInput>>({
    campaignId,
    kolId: '',
    kolName: '',
    platform: 'xiaohongshu',
    contentUrl: '',
    contentType: 'organic',
    publishDate: new Date().toISOString().split('T')[0],
    exposure: 0,
    views: 0,
    likes: 0,
    saves: 0,
    comments: 0,
    shares: 0,
    completionRate: undefined,
    dataSource: 'manual',
    paidSpend: undefined,
  })
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    if (editingItem) {
      setForm({
        campaignId: editingItem.campaignId,
        kolId: editingItem.kolId,
        kolName: editingItem.kolName,
        platform: editingItem.platform,
        contentUrl: editingItem.contentUrl,
        contentType: editingItem.contentType,
        publishDate: editingItem.publishDate,
        exposure: editingItem.exposure,
        views: editingItem.views,
        likes: editingItem.likes,
        saves: editingItem.saves,
        comments: editingItem.comments,
        shares: editingItem.shares,
        completionRate: editingItem.completionRate,
        dataSource: editingItem.dataSource,
      })
    } else {
      setForm({
        campaignId,
        kolId: '',
        kolName: '',
        platform: 'xiaohongshu',
        contentUrl: '',
        contentType: 'organic',
        publishDate: new Date().toISOString().split('T')[0],
        exposure: 0,
        views: 0,
        likes: 0,
        saves: 0,
        comments: 0,
        shares: 0,
        completionRate: undefined,
        dataSource: 'manual',
        paidSpend: undefined,
      })
    }
  }, [open, editingItem, campaignId])

  if (!open) return null

  const handleSubmit = async () => {
    if (!form.kolName?.trim() || !form.contentUrl?.trim()) return
    setSubmitting(true)
    try {
      if (isEditing && editingItem) {
        const updateInput: UpdateContentTrackingDataInput = {
          id: editingItem.id,
          exposure: Number(form.exposure) || 0,
          views: Number(form.views) || 0,
          likes: Number(form.likes) || 0,
          saves: Number(form.saves) || 0,
          comments: Number(form.comments) || 0,
          shares: Number(form.shares) || 0,
          completionRate: form.completionRate !== undefined ? Number(form.completionRate) : undefined,
          dataSource: form.dataSource as UpdateContentTrackingDataInput['dataSource'],
        }
        await webAPI.updateContentTrackingData(updateInput)
      } else {
        await webAPI.addContentTracking(form as CreateContentTrackingInput)
      }
      onSaved()
      onClose()
    } catch (error) {
      console.error('[ContentTrackingFormDialog] 提交失败:', error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            {isEditing ? <Pencil className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            {isEditing ? '更新内容数据' : '添加内容数据'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">达人名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.kolName ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, kolName: e.target.value }))}
                className={inputClass}
                disabled={isEditing}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">KOL ID</label>
              <input
                type="text"
                value={form.kolId ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, kolId: e.target.value }))}
                className={inputClass}
                disabled={isEditing}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">平台 <span className="text-red-500">*</span></label>
              <select
                value={form.platform ?? 'xiaohongshu'}
                onChange={(e) => setForm((prev) => ({ ...prev, platform: e.target.value }))}
                className={inputClass}
                disabled={isEditing}
              >
                <option value="xiaohongshu">小红书</option>
                <option value="douyin">抖音</option>
                <option value="weibo">微博</option>
                <option value="bilibili">B站</option>
                <option value="kuaishou">快手</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">内容类型</label>
              <select
                value={form.contentType ?? 'organic'}
                onChange={(e) => setForm((prev) => ({ ...prev, contentType: e.target.value as CreateContentTrackingInput['contentType'] }))}
                className={inputClass}
              >
                <option value="organic">自然流</option>
                <option value="paid">付费</option>
                <option value="mixed">混合</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">内容链接 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={form.contentUrl ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, contentUrl: e.target.value }))}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">发布日期</label>
            <input
              type="date"
              value={form.publishDate ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, publishDate: e.target.value }))}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {([
              { key: 'exposure', label: '曝光' },
              { key: 'views', label: '浏览' },
              { key: 'likes', label: '点赞' },
              { key: 'saves', label: '收藏' },
              { key: 'comments', label: '评论' },
              { key: 'shares', label: '转发' },
            ] as const).map(({ key, label }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
                <input
                  type="number"
                  min={0}
                  value={form[key] ?? 0}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: Number(e.target.value) || 0 }))}
                  className={inputClass}
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">完播率 (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={form.completionRate ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, completionRate: e.target.value === '' ? undefined : Number(e.target.value) }))}
                placeholder="可选"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">数据来源</label>
              <select
                value={form.dataSource ?? 'manual'}
                onChange={(e) => setForm((prev) => ({ ...prev, dataSource: e.target.value as CreateContentTrackingInput['dataSource'] }))}
                className={inputClass}
              >
                <option value="manual">手动录入</option>
                <option value="api">API 获取</option>
                <option value="screenshot">截图识别</option>
                <option value="estimated">预估</option>
              </select>
            </div>
          </div>

          {!isEditing && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">投放金额（可选）</label>
              <input
                type="number"
                min={0}
                value={form.paidSpend ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, paidSpend: e.target.value === '' ? undefined : Number(e.target.value) }))}
                placeholder="如有投流，输入投放金额"
                className={inputClass}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
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
            disabled={submitting || !form.kolName?.trim() || !form.contentUrl?.trim()}
            className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
          >
            {submitting ? '保存中...' : isEditing ? '更新数据' : '添加数据'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface PaidDataDialogProps {
  item: KOLContentTracking | null
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function PaidDataDialog({ item, open, onClose, onSaved }: PaidDataDialogProps) {
  const [paidSpend, setPaidSpend] = React.useState(0)
  const [paidExposure, setPaidExposure] = React.useState(0)
  const [paidViews, setPaidViews] = React.useState(0)
  const [paidLikes, setPaidLikes] = React.useState(0)
  const [paidDataJson, setPaidDataJson] = React.useState('{}')
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (item && open) {
      setPaidSpend(item.paidSpend || 0)
      setPaidExposure(item.paidExposure || 0)
      setPaidViews(item.paidViews || 0)
      setPaidLikes(item.paidLikes || 0)
      try {
        const parsed = item.paidData ? JSON.parse(item.paidData) : {}
        setPaidDataJson(JSON.stringify(parsed, null, 2))
      } catch {
        setPaidDataJson(item.paidData || '{}')
      }
    }
  }, [item, open])

  if (!open || !item) return null

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      let parsedPaidData: string
      try {
        const obj = JSON.parse(paidDataJson)
        parsedPaidData = JSON.stringify(obj)
      } catch {
        alert('投流数据 JSON 格式错误')
        setSubmitting(false)
        return
      }

      const input: AddPaidDataInput = {
        id: item.id,
        paidSpend: Number(paidSpend) || 0,
        paidExposure: Number(paidExposure) || 0,
        paidViews: Number(paidViews) || 0,
        paidLikes: Number(paidLikes) || 0,
        paidData: parsedPaidData,
      }
      await webAPI.addContentPaidData(input)
      onSaved()
      onClose()
    } catch (error) {
      console.error('[PaidDataDialog] 提交失败:', error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-purple-600" />
            投流追踪 — {item.kolName}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="text-sm text-slate-500 truncate">
            内容：<a href={item.contentUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{item.contentUrl}</a>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">投放金额 (¥)</label>
              <input type="number" min={0} value={paidSpend} onChange={(e) => setPaidSpend(Number(e.target.value) || 0)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">投流曝光</label>
              <input type="number" min={0} value={paidExposure} onChange={(e) => setPaidExposure(Number(e.target.value) || 0)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">投流浏览</label>
              <input type="number" min={0} value={paidViews} onChange={(e) => setPaidViews(Number(e.target.value) || 0)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">投流点赞</label>
              <input type="number" min={0} value={paidLikes} onChange={(e) => setPaidLikes(Number(e.target.value) || 0)} className={inputClass} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">投流数据详情 (JSON)</label>
            <textarea
              value={paidDataJson}
              onChange={(e) => setPaidDataJson(e.target.value)}
              rows={5}
              className={`${inputClass} font-mono text-xs resize-y`}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
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
            disabled={submitting}
            className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-lg"
          >
            {submitting ? '保存中...' : '保存投流数据'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface AnalysisDialogProps {
  item: KOLContentTracking | null
  open: boolean
  onClose: () => void
  onSaved: () => void
}

const PERFORMANCE_GRADE_OPTIONS: Array<{ value: KOLContentTracking['performanceGrade']; label: string; color: string }> = [
  { value: 'excellent', label: '优秀', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { value: 'good', label: '良好', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'normal', label: '一般', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  { value: 'poor', label: '较差', color: 'bg-red-100 text-red-700 border-red-200' },
  { value: 'pending', label: '待评估', color: 'bg-slate-100 text-slate-700 border-slate-200' },
]

export function AnalysisDialog({ item, open, onClose, onSaved }: AnalysisDialogProps) {
  const [performanceGrade, setPerformanceGrade] = React.useState<KOLContentTracking['performanceGrade']>('pending')
  const [recommendations, setRecommendations] = React.useState('')
  const [aiAnalysis, setAiAnalysis] = React.useState('')
  const [benchmarkComparison, setBenchmarkComparison] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (item && open) {
      setPerformanceGrade(item.performanceGrade)
      setRecommendations(item.recommendations || '')
      setAiAnalysis(item.aiAnalysis || '')
      setBenchmarkComparison(item.benchmarkComparison || '')
    }
  }, [item, open])

  if (!open || !item) return null

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const input: UpdateAnalysisInput = {
        id: item.id,
        performanceGrade,
        benchmarkComparison,
        aiAnalysis,
        recommendations,
      }
      await webAPI.updateContentTrackingAnalysis(input)
      onSaved()
      onClose()
    } catch (error) {
      console.error('[AnalysisDialog] 提交失败:', error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            分析建议 — {item.kolName}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-4 gap-2 p-3 rounded-lg bg-slate-50">
            <div className="text-center">
              <div className="text-xs text-slate-500">曝光</div>
              <div className="text-sm font-semibold">{item.exposure.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500">CTR</div>
              <div className="text-sm font-semibold">{item.ctr.toFixed(2)}%</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500">CPM</div>
              <div className="text-sm font-semibold">¥{item.cpm.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-slate-500">CPE</div>
              <div className="text-sm font-semibold">¥{item.cpe.toFixed(2)}</div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">性能等级</label>
            <div className="flex flex-wrap gap-2">
              {PERFORMANCE_GRADE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setPerformanceGrade(option.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    performanceGrade === option.value ? `${option.color} ring-2 ring-offset-1 ring-blue-300` : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">AI 分析</label>
            <textarea
              value={aiAnalysis}
              onChange={(e) => setAiAnalysis(e.target.value)}
              rows={5}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">与标准对比</label>
            <textarea
              value={benchmarkComparison}
              onChange={(e) => setBenchmarkComparison(e.target.value)}
              rows={3}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">优化建议</label>
            <textarea
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              rows={5}
              className={inputClass}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
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
            disabled={submitting}
            className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
          >
            <Save className="w-4 h-4" />
            {submitting ? '保存中...' : '保存分析'}
          </button>
        </div>
      </div>
    </div>
  )
}
