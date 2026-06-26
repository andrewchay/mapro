import * as React from 'react'
import { useSetAtom } from 'jotai'
import { createCampaignAtom } from '../store/campaign-atoms.ts'

interface CreateCampaignDialogProps {
  open: boolean
  onClose: () => void
}

export function CreateCampaignDialog({ open, onClose }: CreateCampaignDialogProps) {
  const createCampaign = useSetAtom(createCampaignAtom)
  const [name, setName] = React.useState('')
  const [brand, setBrand] = React.useState('')
  const [platform, setPlatform] = React.useState('xiaohongshu')
  const [budget, setBudget] = React.useState('')
  const [durationMonths, setDurationMonths] = React.useState('3')
  const [targetCityText, setTargetCityText] = React.useState('')
  const [targetAudience, setTargetAudience] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !brand) return

    setSubmitting(true)
    try {
      await createCampaign({
        name,
        brand,
        platform,
        budget: Number(budget) || 0,
        durationMonths: Number(durationMonths) || 1,
        targetCity: targetCityText
          .split(/[,，]/)
          .map((city) => city.trim())
          .filter(Boolean),
        targetAudience,
      })
      setName('')
      setBrand('')
      setBudget('')
      setDurationMonths('3')
      setTargetCityText('')
      setTargetAudience('')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-slate-900">新建 Campaign</h2>
        <p className="text-sm text-slate-500 mt-1">阶段 A 仅支持填写基础信息</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">项目名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="例如：Q3 新品种草 campaign"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">品牌</label>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.currentTarget.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="品牌名称"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">平台</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.currentTarget.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="xiaohongshu">小红书</option>
              <option value="douyin">抖音</option>
              <option value="dual">双平台</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">预算</label>
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.currentTarget.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">周期（月）</label>
              <input
                type="number"
                value={durationMonths}
                onChange={(e) => setDurationMonths(e.currentTarget.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                min={1}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">目标城市</label>
            <input
              type="text"
              value={targetCityText}
              onChange={(e) => setTargetCityText(e.currentTarget.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="例如：上海、杭州"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">目标人群</label>
            <input
              type="text"
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.currentTarget.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="例如：25-35 岁一线城市女性"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
            >
              {submitting ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
