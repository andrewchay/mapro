/**
 * Onboarding 视图组件
 *
 * 首次启动时显示的全屏欢迎界面。
 *
 * 流程：
 *  Step 1：欢迎 + 教程入口
 *  Step 2：Windows 环境检测（仅 Windows，其他平台自动跳过）
 */

import { useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { GraduationCap, ChevronRight, ChevronLeft, HardDriveDownload, Users, Target, Sparkles, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TutorialViewer } from '@/components/tutorial/TutorialViewer'
import { EnvironmentCheckPanel } from '@/components/environment/EnvironmentCheckPanel'
import { isShellEnvironmentOkAtom } from '@/atoms/environment'
import { detectIsWindows } from '@/lib/platform'
import { migrationImportDialogOpenAtom } from '@/atoms/migration-atoms'

interface OnboardingViewProps {
  /** 完成回调（进入主界面） */
  onComplete: () => void
}

export function OnboardingView({ onComplete }: OnboardingViewProps) {
  const [showTutorial, setShowTutorial] = useState(false)
  const [step, setStep] = useState<'welcome' | 'environment'>('welcome')
  const isWindows = useMemo(() => detectIsWindows(), [])
  const shellOk = useAtomValue(isShellEnvironmentOkAtom)
  const setMigrationImportDialogOpen = useSetAtom(migrationImportDialogOpenAtom)

  const handleFinish = async () => {
    await window.electronAPI.updateSettings({
      onboardingCompleted: true,
    })
    onComplete()
  }

  const handleNextFromWelcome = () => {
    if (isWindows) {
      setStep('environment')
    } else {
      handleFinish()
    }
  }

  const handleOpenMigration = () => {
    setMigrationImportDialogOpen(true)
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-8">
      {step === 'welcome' && (
        <>
          <div className="mb-12 text-center">
            <h1 className="text-4xl font-bold mb-4">欢迎使用 MAPro</h1>
            <p className="text-lg text-muted-foreground">
              智能社交营销 AI 代理 —— 让每一分投放都有复利
            </p>
            <div className="mt-6 flex items-center justify-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Target size={16} className="text-primary" />
                <span>策略生成</span>
              </div>
              <div className="flex items-center gap-2">
                <Users size={16} className="text-primary" />
                <span>达人匹配</span>
              </div>
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-primary" />
                <span>创意指导</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-primary" />
                <span>投放优化</span>
              </div>
            </div>
          </div>

          <div className="w-full max-w-2xl">
            <div className="space-y-3">
              <button
                onClick={() => setShowTutorial(true)}
                className="w-full rounded-xl bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border border-primary/15 p-4 flex items-center gap-4 hover:from-primary/10 hover:via-primary/15 hover:to-primary/10 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <GraduationCap size={20} className="text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground">查看营销工作流教程</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    了解从策略制定到达人匹配、内容创作、投放优化的完整营销 Agent 工作流
                  </p>
                </div>
              </button>

              <p className="text-sm text-muted-foreground pt-2">
                团队已有 MAPro 配置？直接导入即可开始协作
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleOpenMigration}
                  className="rounded-xl bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border border-primary/15 p-4 flex items-center gap-3 hover:from-primary/10 hover:via-primary/15 hover:to-primary/10 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <HardDriveDownload size={20} className="text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-foreground">从其他设备迁移</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      导入自己其他设备上的营销项目配置
                      <br/>
                      <br/>
                      需要先在原设备上导出 .mapro-backup 文件，再双击导入即可
                    </p>
                  </div>
                </button>
                <button
                  onClick={handleOpenMigration}
                  className="rounded-xl bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border border-primary/15 p-4 flex items-center gap-3 hover:from-primary/10 hover:via-primary/15 hover:to-primary/10 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Users size={20} className="text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-foreground">导入团队配置</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      从同事或团队成员处导入营销工作区
                      <br/>
                      <br/>
                      需要先导出 .mapro-share 文件，再双击导入即可
                    </p>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <div className="w-full max-w-2xl mt-8 flex flex-col items-center gap-2">
            <Button className="w-full h-12 text-base" onClick={handleNextFromWelcome}>
              {isWindows ? (
                <>
                  下一步：环境检测
                  <ChevronRight className="ml-1 h-4 w-4" />
                </>
              ) : (
                '开始使用'
              )}
            </Button>
            <p className="text-xs text-muted-foreground/60">
              这些配置之后也能在设置中找到，随时可以继续完善
            </p>
          </div>
        </>
      )}

      {step === 'environment' && isWindows && (
        <div className="w-full max-w-2xl">
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-semibold mb-2">环境检查</h2>
            <p className="text-sm text-muted-foreground">
              MAPro 在 Windows 上需要 Git Bash 或 WSL 来执行部分营销工具脚本
            </p>
          </div>

          <div className="rounded-xl border bg-card p-5 mb-6">
            <EnvironmentCheckPanel autoDetectOnMount />
          </div>

          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep('welcome')}
              className="text-muted-foreground"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              上一步
            </Button>
            <div className="flex gap-3">
              <Button
                onClick={handleFinish}
                variant={shellOk ? 'default' : 'outline'}
              >
                {shellOk ? '开始使用' : '稍后处理（进入主界面）'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Sheet open={showTutorial} onOpenChange={setShowTutorial}>
        <SheetContent side="right" className="w-[560px] sm:max-w-[560px] p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <GraduationCap size={18} className="text-primary" />
              MAPro 使用教程
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-80px)]">
            <div className="px-6 py-4">
              <TutorialViewer />
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  )
}
