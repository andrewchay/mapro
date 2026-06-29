import * as React from 'react'
import type { CampaignWorkflow, CampaignWorkflowStep, CampaignWorkflowStepId, WorkspaceFileEntry } from '@ma-proma/shared'
import { webAPI } from '../api/web-api.ts'
import { FilePreviewDialog, type PreviewContent } from './FilePreviewDialog.tsx'
import { ChevronDown, ChevronRight, RefreshCw, CheckCircle, PlayCircle, AlertCircle, FileText, Play } from 'lucide-react'

interface CampaignWorkflowStepsProps {
  campaignId: string
}

const STEP_DIR_CONFLICT: Record<string, string> = {
  add_to_pool: 'search_kols',
}

function statusIcon(status: CampaignWorkflowStep['status']) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-green-600" />
    case 'in_progress':
      return <PlayCircle className="h-4 w-4 text-blue-600" />
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-red-600" />
    default:
      return <div className="h-4 w-4 rounded-full border-2 border-slate-300" />
  }
}

export function CampaignWorkflowSteps({ campaignId }: CampaignWorkflowStepsProps) {
  const [workflow, setWorkflow] = React.useState<CampaignWorkflow | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [artifacts, setArtifacts] = React.useState<Record<string, WorkspaceFileEntry[]>>({})
  const [artifactsLoading, setArtifactsLoading] = React.useState<Set<string>>(new Set())
  const [preview, setPreview] = React.useState<{
    stepId: CampaignWorkflowStepId
    file: WorkspaceFileEntry
    content: PreviewContent
  } | null>(null)
  const [executing, setExecuting] = React.useState<Set<string>>(new Set())
  const [executeError, setExecuteError] = React.useState<string | null>(null)

  const loadWorkflow = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await webAPI.getCampaignWorkflow(campaignId)
      setWorkflow(data)
    } catch (error) {
      console.error('加载工作流失败:', error)
    } finally {
      setLoading(false)
    }
  }, [campaignId])

  React.useEffect(() => {
    loadWorkflow()
  }, [loadWorkflow])

  const toggleStep = async (stepId: CampaignWorkflowStepId) => {
    const next = new Set(expanded)
    if (next.has(stepId)) {
      next.delete(stepId)
      setExpanded(next)
      return
    }
    next.add(stepId)
    setExpanded(next)

    if (artifacts[stepId]) return
    setArtifactsLoading((prev) => new Set(prev).add(stepId))
    try {
      const files = await webAPI.listCampaignArtifacts(campaignId, stepId)
      setArtifacts((prev) => ({ ...prev, [stepId]: files }))
    } catch (error) {
      console.error('加载产物失败:', error)
    } finally {
      setArtifactsLoading((prev) => {
        const next = new Set(prev)
        next.delete(stepId)
        return next
      })
    }
  }

  const handlePreview = async (stepId: CampaignWorkflowStepId, file: WorkspaceFileEntry) => {
    if (file.isDirectory) return
    try {
      const result = await webAPI.readCampaignArtifact(campaignId, stepId, file.path)
      if ('content' in result) {
        setPreview({ stepId, file, content: { type: 'text', content: result.content, mediaType: result.mediaType } })
      } else {
        setPreview({
          stepId,
          file,
          content: { type: 'base64', data: result.data, mediaType: result.mediaType || 'application/octet-stream' },
        })
      }
    } catch (error) {
      console.error('预览产物失败:', error)
    }
  }

  const handleValidate = async (stepId: CampaignWorkflowStepId) => {
    try {
      await webAPI.validateCampaignStep(campaignId, stepId)
      await loadWorkflow()
    } catch (error) {
      console.error('校验步骤失败:', error)
    }
  }

  const handleExecute = async (stepId: CampaignWorkflowStepId) => {
    setExecuting((prev) => new Set(prev).add(stepId))
    setExecuteError(null)
    try {
      const { success, workflow, reason } = await webAPI.completeCampaignStep(campaignId, stepId)
      if (success) {
        setWorkflow(workflow)
        await toggleStep(stepId)
      } else {
        setExecuteError(`步骤执行失败：${reason || '产物校验未通过'}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('执行步骤失败:', error)
      setExecuteError(`步骤执行失败：${message}`)
    } finally {
      setExecuting((prev) => {
        const next = new Set(prev)
        next.delete(stepId)
        return next
      })
    }
  }

  const handleReset = async () => {
    if (!confirm('确定要重置工作流吗？所有步骤状态将恢复为初始状态。')) return
    try {
      await webAPI.resetCampaignWorkflow(campaignId)
      setArtifacts({})
      setExpanded(new Set())
      await loadWorkflow()
    } catch (error) {
      console.error('重置工作流失败:', error)
    }
  }

  if (loading && !workflow) {
    return <div className="py-12 text-center text-slate-500">加载工作流...</div>
  }

  if (!workflow) {
    return <div className="py-12 text-center text-slate-500">暂无工作流数据</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">13 步标准工作流</h2>
        <button
          onClick={handleReset}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />
          重置
        </button>
      </div>

      <div className="space-y-2">
        {workflow.steps.map((step, index) => (
          <StepItem
            key={step.id}
            index={index}
            step={step}
            isExpanded={expanded.has(step.id)}
            loading={artifactsLoading.has(step.id)}
            executing={executing.has(step.id)}
            files={artifacts[step.id] ?? []}
            sharedWith={STEP_DIR_CONFLICT[step.id]}
            onToggle={() => toggleStep(step.id)}
            onValidate={() => handleValidate(step.id)}
            onExecute={() => handleExecute(step.id)}
            onPreview={(file) => handlePreview(step.id, file)}
          />
        ))}
      </div>

      {executeError && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-800">{executeError}</p>
        </div>
      )}

      <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
        <p className="text-sm text-amber-800">
          <span className="font-medium">提示：</span>
          「执行步骤」会校验当前步骤产物并标记完成；若产物不合格，请先在对应工作区目录创建符合要求的文件，或切换到 Agent 会话让 AI 生成产物。
        </p>
      </div>

      {preview && (
        <FilePreviewDialog
          isOpen={!!preview}
          onClose={() => setPreview(null)}
          title={preview.stepId}
          fileName={preview.file.name}
          content={preview.content}
        />
      )}
    </div>
  )
}

interface StepItemProps {
  index: number
  step: CampaignWorkflowStep
  isExpanded: boolean
  loading: boolean
  executing: boolean
  files: WorkspaceFileEntry[]
  sharedWith?: string
  onToggle: () => void
  onValidate: () => void
  onExecute: () => void
  onPreview: (file: WorkspaceFileEntry) => void
}

function StepItem({ index, step, isExpanded, loading, executing, files, sharedWith, onToggle, onValidate, onExecute, onPreview }: StepItemProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
          {index + 1}
        </span>
        {statusIcon(step.status)}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{step.title}</p>
          <p className="truncate text-sm text-slate-500">{step.description}</p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            step.status === 'completed'
              ? 'bg-green-50 text-green-700'
              : step.status === 'in_progress'
                ? 'bg-blue-50 text-blue-700'
                : 'bg-slate-50 text-slate-600'
          }`}
        >
          {step.status === 'completed' ? '已完成' : step.status === 'in_progress' ? '进行中' : step.status === 'failed' ? '失败' : '待开始'}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">产物文件</p>
            <div className="flex items-center gap-2">
              <button
                onClick={onValidate}
                className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={step.status === 'pending'}
              >
                校验
              </button>
              <button
                onClick={onExecute}
                disabled={executing || step.status === 'completed'}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Play className="h-3 w-3" />
                {executing ? '执行中…' : step.status === 'completed' ? '已完成' : '执行'}
              </button>
            </div>
          </div>

          {sharedWith && (
            <p className="mb-2 text-xs text-amber-700">
              本步骤产物目录与「{sharedWith}」共享。
            </p>
          )}

          {loading ? (
            <div className="py-4 text-center text-sm text-slate-500">加载产物...</div>
          ) : files.length === 0 ? (
            <div className="py-4 text-center text-sm text-slate-400">暂无产物文件</div>
          ) : (
            <ul className="space-y-1">
              {files.map((file) => (
                <li key={file.path}>
                  <button
                    onClick={() => onPreview(file)}
                    disabled={file.isDirectory}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                      file.isDirectory
                        ? 'text-slate-500'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    {!file.isDirectory && <span className="text-xs text-slate-400">{formatSize(file.size)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
