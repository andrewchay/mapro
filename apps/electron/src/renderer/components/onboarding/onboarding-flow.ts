/**
 * Onboarding 引导流程步骤编排（纯函数）
 *
 * 把 OnboardingView 的步骤序列/索引/流转逻辑提取为无副作用纯函数，
 * 便于 BDD 测试与复用。React 侧的图标映射保留在组件内。
 *
 * 步骤顺序：
 *  Step 1：配置 AI 渠道（channel）
 *  Step 2：了解营销 Agent 工作流（workflow）
 *  Step 3：创建第一个营销项目（campaign）
 *  Step 4：Windows 环境检测（environment，仅 Windows）
 */

/** 引导步骤标识 */
export type OnboardingStep = 'channel' | 'workflow' | 'campaign' | 'environment'

/** 步骤元信息（数据部分，不含 React 组件） */
export interface OnboardingStepInfo {
  id: OnboardingStep
  title: string
  description: string
}

/** 步骤展示信息（不含 environment，environment 不在指示器中显示） */
export const STEP_INFOS: OnboardingStepInfo[] = [
  { id: 'channel', title: '配置 AI 渠道', description: '连接 AI 供应商' },
  { id: 'workflow', title: '营销 Agent 工作流', description: '13 步标准流程' },
  { id: 'campaign', title: '创建第一个项目', description: '启动 Campaign' },
]

/** 基础步骤序列（所有平台共有） */
const BASE_STEPS: OnboardingStep[] = ['channel', 'workflow', 'campaign']

/**
 * 按平台返回有序步骤序列。
 * - Windows：基础 3 步 + environment（末尾）
 * - 其他平台：基础 3 步
 */
export function getOrderedSteps(isWindows: boolean): OnboardingStep[] {
  return isWindows ? [...BASE_STEPS, 'environment'] : [...BASE_STEPS]
}

/** 返回当前步骤在序列中的索引，未找到时返回 -1 */
export function getCurrentStepIndex(steps: OnboardingStep[], current: OnboardingStep): number {
  return steps.indexOf(current)
}

/** 是否序列中的最后一步 */
export function isLastStep(steps: OnboardingStep[], current: OnboardingStep): boolean {
  const idx = getCurrentStepIndex(steps, current)
  return idx >= 0 && idx === steps.length - 1
}

/**
 * 下一步。
 * - 非末步：返回序列下一项
 * - 末步或未找到：返回当前步（不越界）
 */
export function getNextStep(steps: OnboardingStep[], current: OnboardingStep): OnboardingStep {
  const idx = getCurrentStepIndex(steps, current)
  if (idx < 0 || idx >= steps.length - 1) return current
  return steps[idx + 1]!
}

/**
 * 上一步。
 * - 非首步：返回序列上一项
 * - 首步或未找到：返回当前步（不越界）
 */
export function getPrevStep(steps: OnboardingStep[], current: OnboardingStep): OnboardingStep {
  const idx = getCurrentStepIndex(steps, current)
  if (idx <= 0) return current
  return steps[idx - 1]!
}

/** 用于步骤指示器：过滤掉 environment 的步骤列表 */
export function getIndicatorSteps(steps: OnboardingStep[]): OnboardingStep[] {
  return steps.filter((s) => s !== 'environment')
}
