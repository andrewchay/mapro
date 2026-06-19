/**
 * KOL 数据管理模块
 *
 * 展示 KOL 数据库中所有 KOL，支持：
 * - 搜索（按名称、平台、类目）
 * - 编辑 KOL 信息
 * - 删除 KOL
 * - 刷新数据
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Search, Pencil, Trash2, RefreshCw, X, Save, Users, Database } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KOLListItem } from '@ma-proma/shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// 平台颜色映射
const PLATFORM_COLORS: Record<string, string> = {
  '小红书': 'bg-red-50 text-red-700 border-red-200',
  '抖音': 'bg-slate-900 text-white border-slate-700',
  '微博': 'bg-orange-50 text-orange-700 border-orange-200',
  'B站': 'bg-pink-50 text-pink-700 border-pink-200',
  '快手': 'bg-orange-50 text-orange-700 border-orange-200',
  '微信公众号': 'bg-green-50 text-green-700 border-green-200',
}

function ScoreBadge({ score, label }: { score: number; label: string }): React.ReactElement {
  const getScoreColor = (s: number): string => {
    if (s >= 80) return 'text-emerald-600 bg-emerald-50'
    if (s >= 60) return 'text-amber-600 bg-amber-50'
    if (s >= 40) return 'text-orange-600 bg-orange-50'
    return 'text-red-600 bg-red-50'
  }
  return (
    <div className="flex flex-col items-center min-w-[40px]">
      <div className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', getScoreColor(score))}>
        {score}
      </div>
      <span className="text-[10px] text-muted-foreground mt-0.5">{label}</span>
    </div>
  )
}

function OverallScoreRing({ score }: { score: number }): React.ReactElement {
  const color = score >= 80 ? 'text-emerald-500' : score >= 60 ? 'text-amber-500' : score >= 40 ? 'text-orange-500' : 'text-red-500'
  return (
    <div className="flex flex-col items-center">
      <div className={cn('text-lg font-bold', color)}>{score}</div>
      <span className="text-[10px] text-muted-foreground">综合</span>
    </div>
  )
}

function PlatformBadge({ platform }: { platform: string }): React.ReactElement {
  const style = PLATFORM_COLORS[platform] ?? 'bg-gray-50 text-gray-700 border-gray-200'
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border', style)}>
      {platform}
    </span>
  )
}

export function KOLDataManager(): React.ReactElement {
  const [kols, setKols] = React.useState<KOLListItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [platformFilter, setPlatformFilter] = React.useState('')
  const [categoryFilter, setCategoryFilter] = React.useState('')

  // 编辑弹窗
  const [editingKOL, setEditingKOL] = React.useState<KOLListItem | null>(null)
  const [editForm, setEditForm] = React.useState<Partial<KOLListItem>>({})

  // 删除确认
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  const loadKOLs = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.listAllKOLs()
      setKols(result)
    } catch (error) {
      console.error('[KOL 数据] 加载失败:', error)
      toast.error('加载 KOL 数据失败')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadKOLs()
  }, [loadKOLs])

  // 筛选
  const filteredKOLs = React.useMemo(() => {
    return kols.filter((kol) => {
      const matchSearch = searchQuery === '' ||
        kol.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        kol.city.toLowerCase().includes(searchQuery.toLowerCase())
      const matchPlatform = platformFilter === '' || kol.platform === platformFilter
      const matchCategory = categoryFilter === '' || kol.category === categoryFilter
      return matchSearch && matchPlatform && matchCategory
    })
  }, [kols, searchQuery, platformFilter, categoryFilter])

  // 唯一平台和类目列表
  const platforms = React.useMemo(() => [...new Set(kols.map((k) => k.platform))].sort(), [kols])
  const categories = React.useMemo(() => [...new Set(kols.map((k) => k.category).filter(Boolean))].sort(), [kols])

  const handleEdit = (kol: KOLListItem) => {
    setEditingKOL(kol)
    setEditForm({ ...kol })
  }

  const handleSaveEdit = async () => {
    if (!editingKOL || !editForm.name) return

    try {
      const success = await window.electronAPI.updateKOL({
        id: editingKOL.id,
        name: editForm.name,
        platform: editForm.platform || editingKOL.platform,
        followers: editForm.followers || '',
        engagement: editForm.engagement || '',
        category: editForm.category || '',
        price: editForm.price || '',
        city: editForm.city || '',
      })

      if (success) {
        toast.success('KOL 信息已更新')
        setEditingKOL(null)
        loadKOLs()
      } else {
        toast.error('更新失败')
      }
    } catch (error) {
      console.error('[KOL 数据] 更新失败:', error)
      toast.error('更新失败')
    }
  }

  const handleDelete = async () => {
    if (!deletingId) return

    try {
      const success = await window.electronAPI.deleteKOL(deletingId)
      if (success) {
        toast.success('KOL 已删除')
        setDeletingId(null)
        loadKOLs()
      } else {
        toast.error('删除失败')
      }
    } catch (error) {
      console.error('[KOL 数据] 删除失败:', error)
      toast.error('删除失败')
    }
  }

  return (
    <div className="flex flex-col h-full titlebar-no-drag">
      {/* 头部 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">KOL 数据管理</h2>
          <span className="text-sm text-muted-foreground">({kols.length} 条)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setLoading(true)
              try {
                const result = await window.electronAPI.recalculateKOLScores()
                toast.success(`已重新计算 ${result.updated} 个 KOL 的评分`)
                loadKOLs()
              } catch (error) {
                console.error('[KOL 数据] 评分计算失败:', error)
                toast.error('评分计算失败')
              } finally {
                setLoading(false)
              }
            }}
            disabled={loading}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors',
              loading
                ? 'text-muted-foreground cursor-not-allowed'
                : 'text-foreground hover:bg-primary/5'
            )}
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            重新计算评分
          </button>
          <button
            onClick={loadKOLs}
            disabled={loading}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors',
              loading
                ? 'text-muted-foreground cursor-not-allowed'
                : 'text-foreground hover:bg-primary/5'
            )}
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            刷新
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border/40">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索名称、城市..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">全部平台</option>
          {platforms.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">全部类目</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* KOL 列表 */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading && kols.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            加载中...
          </div>
        ) : filteredKOLs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Users className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">
              {kols.length === 0 ? '暂无 KOL 数据，请通过营销工具采集' : '没有匹配的 KOL'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredKOLs.map((kol) => (
              <div
                key={kol.id}
                className="flex items-center gap-4 px-4 py-3 rounded-xl border border-border/40 bg-card hover:bg-accent/40 transition-colors group"
              >
                {/* 头像占位 */}
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-medium text-primary">
                    {kol.name.slice(0, 1)}
                  </span>
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm truncate">{kol.name}</span>
                    <PlatformBadge platform={kol.platform} />
                    {kol.category && (
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        {kol.category}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>粉丝: {kol.followers || '-'}</span>
                    <span>互动: {kol.engagement || '-'}</span>
                    <span>报价: {kol.price || '-'}</span>
                    <span>城市: {kol.city || '-'}</span>
                    <span className="text-xs text-muted-foreground/60">来源: {kol.source}</span>
                  </div>
                </div>

                {/* 评分 */}
                <div className="flex items-center gap-3 mr-2">
                  <ScoreBadge score={kol.overallScore} label="综合" />
                  <div className="hidden md:flex items-center gap-2">
                    <ScoreBadge score={kol.baseScore} label="基础" />
                    <ScoreBadge score={kol.contentScore} label="内容" />
                    <ScoreBadge score={kol.commercialScore} label="商业" />
                  </div>
                </div>

                {/* 操作 */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleEdit(kol)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-colors"
                    title="编辑"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeletingId(kol.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 编辑弹窗 */}
      <Dialog open={!!editingKOL} onOpenChange={(open) => { if (!open) setEditingKOL(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑 KOL</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">名称</label>
              <input
                type="text"
                value={editForm.name ?? ''}
                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">平台</label>
                <input
                  type="text"
                  value={editForm.platform ?? ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, platform: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">类目</label>
                <input
                  type="text"
                  value={editForm.category ?? ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">粉丝量</label>
                <input
                  type="text"
                  value={editForm.followers ?? ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, followers: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">互动率</label>
                <input
                  type="text"
                  value={editForm.engagement ?? ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, engagement: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">报价</label>
                <input
                  type="text"
                  value={editForm.price ?? ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, price: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">城市</label>
                <input
                  type="text"
                  value={editForm.city ?? ''}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, city: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setEditingKOL(null)}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSaveEdit}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Save className="w-4 h-4" />
              保存
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复，确定要删除这个 KOL 吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
