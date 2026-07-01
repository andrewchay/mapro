/**
 * Onboarding 视图组件
 *
 * 首次启动时显示的全屏营销场景引导界面。
 *
 * 流程：
 *  Step 1：配置 AI 渠道
 *  Step 2：了解营销 Agent 工作流
 *  Step 3：创建第一个营销项目
 *  Step 4：Windows 环境检测（仅 Windows，其他平台自动跳过）
 */

import { useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  GraduationCap,
  ChevronRight,
  ChevronLeft,
  Key,
  Workflow,
  FolderPlus,
  Rocket,
  Sparkles,
  Target,
  Users,
  MessageSquare,
  Check,
  type LucideIcon,
} from 'lucide-react'
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
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { activeViewAtom } from '@/atoms/active-view'
import { campaignCreateDialogOpenAtom } from '@/atoms/campaign-atoms'
import { appModeAtom } from '@/atoms/app-mode'
import {
  STEP_INFOS,
  getOrderedSteps,
  getCurrentStepIndex,
  isLastStep,
  getNextStep,
  getPrevStep,
  getIndicatorSteps,
  type OnboardingStep,
} from './onboarding-flow'

interface OnboardingViewProps {
  /** 完成回调（进入主界面） */
  onComplete: () => void
}

/** 步骤 → 图标映射（React 组件，与纯函数逻辑分离） */
const STEP_ICONS: Record<OnboardingStep, LucideIcon> = {
  channel: Key,
  workflow: Workflow,
  campaign: FolderPlus,
  environment: Check,
}

export function OnboardingView({ onComplete }: OnboardingViewProps) {
  const [showTutorial, setShowTutorial] = useState(false)
  const [step, setStep] = useState<OnboardingStep>('channel')
  const isWindows = useMemo(() => detectIsWindows(), [])
  const shellOk = useAtomValue(isShellEnvironmentOkAtom)
  const setMigrationImportDialogOpen = useSetAtom(migrationImportDialogOpenAtom)

  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setCampaignCreateOpen = useSetAtom(campaignCreateDialogOpenAtom)
  const setAppMode = useSetAtom(appModeAtom)

  const orderedSteps = useMemo(() => getOrderedSteps(isWindows), [isWindows])
  const indicatorSteps = useMemo(() => getIndicatorSteps(orderedSteps), [orderedSteps])
  const currentIndex = getCurrentStepIndex(orderedSteps, step)
  const atLastStep = isLastStep(orderedSteps, step)

  const handleFinish = async () => {
    await window.electronAPI.updateSettings({
      onboardingCompleted: true,
    })
    onComplete()
  }

  const handleNext = () => {
    if (atLastStep) {
      handleFinish()
    } else {
      setStep(getNextStep(orderedSteps, step))
    }
  }

  const handlePrev = () => {
    setStep(getPrevStep(orderedSteps, step))
  }

  const handleOpenSettings = async () => {
    await window.electronAPI.updateSettings({
      onboardingCompleted: true,
    })
    setSettingsTab('channels')
    setSettingsOpen(true)
    onComplete()
  }

  const handleOpenCampaignCreate = async () => {
    await window.electronAPI.updateSettings({
      onboardingCompleted: true,
    })
    setAppMode('agent')
    setActiveView('campaigns')
    setCampaignCreateOpen(true)
    onComplete()
  }

  const handleOpenMigration = () => {
    setMigrationImportDialogOpen(true)
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-8">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold mb-3">欢迎使用 MAPro</h1>
        <p className="text-lg text-muted-foreground">
          智能社交营销 AI 代理 —— 让每一分投放都有复利
        </p>
      </div>

      {/* 步骤指示器 */}
      <div className="w-full max-w-3xl mb-8">
        <div className="flex items-center justify-between">
          {indicatorSteps
            .map((s) => {
              const info = STEP_INFOS.find((i) => i.id === s)!
              const Icon = STEP_ICONS[s]
              const isActive = step === s
              const isCompleted = currentIndex > getCurrentStepIndex(orderedSteps, s)
              return (
                <div key={s} className="flex flex-col items-center gap-2 flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                      isActive
                        ? 'border-primary bg-primary text-primary-foreground'
                        : isCompleted
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-muted-foreground/30 text-muted-foreground'
                    }`}
                  >
                    {isCompleted ? <Check size={18} /> : <Icon size={18} />}
                  </div>
                  <div className="text-center">
                    <p
                      className={`text-sm font-medium ${
                        isActive || isCompleted ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {info.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{info.description}</p>
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      {/* 内容区 */}
      <div className="w-full max-w-2xl">
        {step === 'channel' && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Key size={32} className="text-primary" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">第一步：配置 AI 渠道</h2>
              <p className="text-muted-foreground">
                MAPro 的 Agent 模式需要 Anthropic 兼容的 API 渠道来驱动营销分析、达人匹配和内容创作。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Target size={16} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">策略分析</h3>
                  <p className="text-xs text-muted-foreground mt-1">市场分析、竞品洞察、品牌 DNA 提取</p>
                </div>
              </div>
              <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Users size={16} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">达人匹配</h3>
                  <p className="text-xs text-muted-foreground mt-1">KOL 搜索、筛选、建联与 Brief 生成</p>
                </div>
              </div>
              <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <MessageSquare size={16} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">内容创作</h3>
                  <p className="text-xs text-muted-foreground mt-1">创意概念、平台矩阵、A/B 测试设计</p>
                </div>
              </div>
              <div className="rounded-xl border bg-card p-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Sparkles size={16} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">投放优化</h3>
                  <p className="text-xs text-muted-foreground mt-1">内容审核、数据追踪、效果分析</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
              <p>推荐渠道：Anthropic Claude、DeepSeek、Kimi、MiniMax。配置完成后即可开始使用 Agent 模式。</p>
            </div>

            <div className="flex flex-col gap-2">
              <Button className="w-full h-12 text-base" onClick={handleOpenSettings}>
                <Key className="mr-2 h-4 w-4" />
                立即配置 AI 渠道
              </Button>
              <Button variant="ghost" className="w-full" onClick={handleNext}>
                稍后配置，继续了解工作流
              </Button>
            </div>
          </div>
        )}

        {step === 'workflow' && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Workflow size={32} className="text-primary" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">第二步：了解营销 Agent 工作流</h2>
              <p className="text-muted-foreground">
                MAPro 把品牌营销投放抽象成 14 步标准工作流，Agent 会按步骤推进并沉淀产物。
              </p>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Target size={16} className="text-primary" />
                  阶段一：策略制定（步骤 1-7）
                </h3>
                <p className="text-xs text-muted-foreground">
                  市场分析 → 竞品分析 → 用户分析 → 品牌 DNA → 品牌信息核实 → Brand Concept → 目标设定
                </p>
              </div>
              <div className="rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Users size={16} className="text-primary" />
                  阶段二：达人矩阵（步骤 8-12）
                </h3>
                <p className="text-xs text-muted-foreground">
                  Big Idea → 平台矩阵 → KOL 金字塔 → 筛选达人 → 加入候选池
                </p>
              </div>
              <div className="rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <MessageSquare size={16} className="text-primary" />
                  阶段三：内容与优化（步骤 13-14）
                </h3>
                <p className="text-xs text-muted-foreground">
                  生成达人 Brief → 设计 A/B 测试 → 内容审核与数据追踪
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowTutorial(true)}
              className="w-full rounded-xl bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border border-primary/15 p-4 flex items-center gap-4 hover:from-primary/10 hover:via-primary/15 hover:to-primary/10 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <GraduationCap size={20} className="text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">查看完整营销工作流教程</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  深入了解每个步骤的产物要求和操作方式
                </p>
              </div>
              <ChevronRight size={16} className="text-muted-foreground" />
            </button>

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={handlePrev}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                上一步
              </Button>
              <Button onClick={handleNext}>
                下一步：创建项目
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 'campaign' && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <FolderPlus size={32} className="text-primary" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">第三步：创建第一个营销项目</h2>
              <p className="text-muted-foreground">
                Campaign 是 MAPro 的核心单元。创建一个项目后，Agent 会带你走完 14 步营销工作流。
              </p>
            </div>

            <div className="rounded-xl border bg-card p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Rocket size={16} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">快速启动</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    输入品牌、平台、预算和周期，即可生成专属工作区和标准产物目录。
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Workflow size={16} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">按步骤推进</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    每个步骤都有 Agent Prompt、产物校验和自动历史记录。
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Users size={16} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">KOL 候选池</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    从 KOL 数据库搜索、筛选并导入候选达人，生成个性化 Brief。
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button className="w-full h-12 text-base" onClick={handleOpenCampaignCreate}>
                <FolderPlus className="mr-2 h-4 w-4" />
                立即创建第一个项目
              </Button>
              <Button variant="ghost" className="w-full" onClick={handleNext}>
                先逛逛主界面
              </Button>
            </div>

            {currentIndex > 0 && (
              <div className="flex justify-start">
                <Button variant="ghost" size="sm" onClick={handlePrev}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  上一步
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 'environment' && isWindows && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-semibold mb-2">环境检查</h2>
              <p className="text-sm text-muted-foreground">
                MAPro 在 Windows 上需要 Git Bash 或 WSL 来执行部分营销工具脚本
              </p>
            </div>

            <div className="rounded-xl border bg-card p-5 mb-6">
              <EnvironmentCheckPanel autoDetectOnMount />
            </div>

            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={handlePrev} className="text-muted-foreground">
                <ChevronLeft className="mr-1 h-4 w-4" />
                上一步
              </Button>
              <Button onClick={handleFinish} variant={shellOk ? 'default' : 'outline'}>
                {shellOk ? '开始使用' : '稍后处理（进入主界面）'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 底部全局入口：迁移导入 */}
      {step === 'channel' && (
        <div className="w-full max-w-2xl mt-10 pt-6 border-t text-center">
          <p className="text-sm text-muted-foreground mb-3">已有 MAPro 配置？</p>
          <Button variant="outline" size="sm" onClick={handleOpenMigration}>
            <Rocket className="mr-2 h-4 w-4" />
            导入配置快速开始
          </Button>
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
