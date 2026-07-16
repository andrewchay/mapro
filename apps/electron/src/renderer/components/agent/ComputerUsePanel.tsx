/**
 * Computer Use 视觉浏览器自动化专用面板
 *
 * 实时展示浏览器截图、动作历史、当前步骤，并允许用户：
 * - 暂停 / 继续
 * - 单步执行
 * - 终止任务
 * - 切换单步模式
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { computerUsePanelOpenAtom, computerUseTaskAtom, computerUseStepModeAtom } from '@/atoms/computer-use-atoms'
import { Pause, Play, StepForward, Square, FolderOpen, X, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ComputerUsePanel(): React.ReactElement | null {
  const [open, setOpen] = useAtom(computerUsePanelOpenAtom)
  const task = useAtomValue(computerUseTaskAtom)
  const [stepMode, setStepMode] = useAtom(computerUseStepModeAtom)

  const taskId = task?.taskId
  const status = task?.status ?? 'running'
  const isRunning = status === 'running' || status === 'resumed'
  const isPaused = status === 'paused'
  const isFinished = status === 'finished'

  const sendCommand = React.useCallback(
    (command: import('@ma-proma/shared').ComputerUseControlCommand) => {
      if (!taskId) return
      window.electronAPI.controlComputerUse(taskId, command).catch((error: unknown) => {
        console.error('[ComputerUsePanel] 控制命令失败:', error)
      })
    },
    [taskId],
  )

  const handlePause = () => sendCommand({ type: 'pause' })
  const handleResume = () => sendCommand({ type: 'resume' })
  const handleStep = () => sendCommand({ type: 'step' })
  const handleStop = () => sendCommand({ type: 'stop' })

  const handleToggleStepMode = React.useCallback(
    (checked: boolean) => {
      setStepMode(checked)
      if (taskId) {
        sendCommand({ type: 'set-step-mode', enabled: checked })
      }
    },
    [setStepMode, sendCommand, taskId],
  )

  const handleOpenTaskDir = React.useCallback(() => {
    if (!task?.taskDir) return
    window.electronAPI.openPath(task.taskDir).catch((error: unknown) => {
      console.error('[ComputerUsePanel] 打开任务目录失败:', error)
    })
  }, [task?.taskDir])

  const statusLabel = {
    running: '运行中',
    paused: '已暂停',
    resumed: '继续中',
    stopping: '正在停止',
    finished: '已完成',
  }[status]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-6xl w-[95vw] h-[90vh] p-0 flex flex-col gap-0 overflow-hidden">
        <DialogDescription className="sr-only">
          视觉浏览器自动化任务面板，展示实时截图、动作历史和控制按钮。
        </DialogDescription>
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Monitor className="w-5 h-5 text-primary" />
              <DialogTitle className="text-base font-semibold">视觉浏览器自动化</DialogTitle>
              <Badge variant={isFinished ? (task?.success ? 'default' : 'destructive') : 'secondary'}>{statusLabel}</Badge>
            </div>
            <div className="flex items-center gap-2">
              {task?.taskDir && (
                <Button variant="ghost" size="sm" onClick={handleOpenTaskDir}>
                  <FolderOpen className="w-4 h-4 mr-1" />
                  任务目录
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {task && (
            <div className="mt-2 text-xs text-muted-foreground truncate">
              {task.task}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* 左侧：实时截图 */}
          <div className="flex-1 min-h-0 bg-muted/30 flex flex-col">
            <div className="px-4 py-2 text-xs text-muted-foreground border-b flex items-center justify-between">
              <span>实时截图</span>
              {task && (
                <span>
                  步骤 {task.step} / {task.maxSteps}
                </span>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4 flex items-center justify-center">
              {task?.screenshotBase64 ? (
                <img
                  src={`data:image/png;base64,${task.screenshotBase64}`}
                  alt="浏览器截图"
                  className="max-w-full max-h-full object-contain rounded-md border shadow-sm"
                />
              ) : (
                <div className="text-sm text-muted-foreground">等待截图...</div>
              )}
            </div>
          </div>

          {/* 右侧：控制 + 历史 */}
          <div className="w-full lg:w-[360px] border-t lg:border-t-0 lg:border-l flex flex-col shrink-0">
            {/* 控制栏 */}
            <div className="p-4 border-b space-y-3">
              <div className="flex items-center gap-2">
                {isPaused ? (
                  <Button size="sm" onClick={handleResume} className="flex-1">
                    <Play className="w-4 h-4 mr-1" />
                    继续
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={handlePause} disabled={isFinished} className="flex-1">
                    <Pause className="w-4 h-4 mr-1" />
                    暂停
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={handleStep} disabled={isFinished || (isRunning && !isPaused)}>
                  <StepForward className="w-4 h-4 mr-1" />
                  单步
                </Button>
                <Button size="sm" variant="destructive" onClick={handleStop} disabled={isFinished}>
                  <Square className="w-4 h-4 mr-1" />
                  终止
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <label htmlFor="computer-use-step-mode" className="text-sm cursor-pointer">
                  单步模式（每步需手动确认）
                </label>
                <Switch id="computer-use-step-mode" checked={stepMode} onCheckedChange={handleToggleStepMode} />
              </div>

              {!open && task && status !== 'finished' && (
                <div className="text-xs text-muted-foreground">关闭面板后任务仍在后台运行，可重新打开查看。</div>
              )}
            </div>

            {/* 动作历史 */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="px-4 py-2 text-xs text-muted-foreground border-b">动作历史</div>
              <ScrollArea className="flex-1 p-4">
                {task?.history.length === 0 && (
                  <div className="text-sm text-muted-foreground">暂无动作</div>
                )}
                <div className="space-y-3">
                  {task?.history.map((item, index) => (
                    <React.Fragment key={index}>
                      {index > 0 && <Separator className="my-2" />}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground">第 {item.step} 步</span>
                        </div>
                        <div className="text-sm">{item.thought || '（无思考说明）'}</div>
                        <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">
                          {JSON.stringify(item.action, null, 2)}
                        </pre>
                      </div>
                    </React.Fragment>
                  ))}
                </div>

                {task?.error && (
                  <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    {task.error}
                  </div>
                )}
                {task?.summary && (
                  <div className="mt-4 p-3 rounded-md bg-muted text-sm">
                    {task.summary}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
