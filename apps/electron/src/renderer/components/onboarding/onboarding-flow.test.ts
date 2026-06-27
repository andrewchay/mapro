/**
 * Onboarding 引导流程步骤编排测试（B4）
 *
 * BDD 行为驱动，验证 OnboardingView 提取出的步骤编排纯函数：
 * 1. 步骤序列：Windows 4 步（含 environment）/ 其他平台 3 步
 * 2. 索引与末步判定
 * 3. 下一步流转（不越界）
 * 4. 上一步流转（不越界）
 * 5. 指示器过滤 environment
 */

import { describe, it, expect } from 'bun:test'
import {
  STEP_INFOS,
  getOrderedSteps,
  getCurrentStepIndex,
  isLastStep,
  getNextStep,
  getPrevStep,
  getIndicatorSteps,
} from './onboarding-flow'

describe('B4: Onboarding 引导流程步骤编排', () => {
  // ===== Slice 1: 步骤序列 =====

  describe('Slice 1: 步骤序列按平台生成', () => {
    it('Given 非 Windows 平台 when 获取步骤序列 then 返回 3 步且不含 environment', () => {
      const steps = getOrderedSteps(false)
      expect(steps).toEqual(['channel', 'workflow', 'campaign'])
      expect(steps).not.toContain('environment')
      expect(steps).toHaveLength(3)
    })

    it('Given Windows 平台 when 获取步骤序列 then 返回 4 步且 environment 在末尾', () => {
      const steps = getOrderedSteps(true)
      expect(steps).toEqual(['channel', 'workflow', 'campaign', 'environment'])
      expect(steps[steps.length - 1]).toBe('environment')
      expect(steps).toHaveLength(4)
    })

    it('Given 步骤元信息 when 检查 then 仅含 3 个展示步骤（无 environment）', () => {
      // STEP_INFOS 用于指示器，environment 不在其中
      expect(STEP_INFOS).toHaveLength(3)
      expect(STEP_INFOS.map((s) => s.id)).toEqual(['channel', 'workflow', 'campaign'])
      expect(STEP_INFOS.some((s) => s.id === 'environment')).toBe(false)
    })
  })

  // ===== Slice 2: 索引与末步判定 =====

  describe('Slice 2: 当前步骤索引与末步判定', () => {
    it('Given 首步 channel when 查询索引 then index=0 且非末步', () => {
      const steps = getOrderedSteps(false)
      expect(getCurrentStepIndex(steps, 'channel')).toBe(0)
      expect(isLastStep(steps, 'channel')).toBe(false)
    })

    it('Given 非 Windows 末步 campaign when 判定 then 是末步', () => {
      const steps = getOrderedSteps(false)
      expect(getCurrentStepIndex(steps, 'campaign')).toBe(2)
      expect(isLastStep(steps, 'campaign')).toBe(true)
    })

    it('Given Windows 末步 environment when 判定 then 是末步', () => {
      const steps = getOrderedSteps(true)
      expect(getCurrentStepIndex(steps, 'environment')).toBe(3)
      expect(isLastStep(steps, 'environment')).toBe(true)
    })

    it('Given Windows 中间步 campaign when 判定 then 非末步（environment 才是末步）', () => {
      const steps = getOrderedSteps(true)
      expect(isLastStep(steps, 'campaign')).toBe(false)
    })
  })

  // ===== Slice 3: 下一步流转 =====

  describe('Slice 3: 下一步流转不越界', () => {
    it('Given 非末步 when 取下一步 then 返回序列下一项', () => {
      const steps = getOrderedSteps(false)
      expect(getNextStep(steps, 'channel')).toBe('workflow')
      expect(getNextStep(steps, 'workflow')).toBe('campaign')
    })

    it('Given 非 Windows 末步 campaign when 取下一步 then 返回当前步（不越界）', () => {
      const steps = getOrderedSteps(false)
      expect(getNextStep(steps, 'campaign')).toBe('campaign')
    })

    it('Given Windows 末步 environment when 取下一步 then 返回当前步（不越界）', () => {
      const steps = getOrderedSteps(true)
      expect(getNextStep(steps, 'environment')).toBe('environment')
    })
  })

  // ===== Slice 4: 上一步流转 =====

  describe('Slice 4: 上一步流转不越界', () => {
    it('Given 非首步 when 取上一步 then 返回序列上一项', () => {
      const steps = getOrderedSteps(false)
      expect(getPrevStep(steps, 'workflow')).toBe('channel')
      expect(getPrevStep(steps, 'campaign')).toBe('workflow')
    })

    it('Given 首步 channel when 取上一步 then 返回当前步（不越界）', () => {
      const steps = getOrderedSteps(false)
      expect(getPrevStep(steps, 'channel')).toBe('channel')
    })

    it('Given Windows environment when 取上一步 then 返回 campaign', () => {
      const steps = getOrderedSteps(true)
      expect(getPrevStep(steps, 'environment')).toBe('campaign')
    })
  })

  // ===== Slice 5: 指示器过滤 =====

  describe('Slice 5: 指示器过滤 environment', () => {
    it('Given Windows 4 步序列 when 取指示器步骤 then 返回 3 步（排除 environment）', () => {
      const steps = getOrderedSteps(true)
      const indicator = getIndicatorSteps(steps)
      expect(indicator).toEqual(['channel', 'workflow', 'campaign'])
      expect(indicator).not.toContain('environment')
      expect(indicator).toHaveLength(3)
    })

    it('Given 非 Windows 3 步序列 when 取指示器步骤 then 返回全部 3 步', () => {
      const steps = getOrderedSteps(false)
      const indicator = getIndicatorSteps(steps)
      expect(indicator).toEqual(['channel', 'workflow', 'campaign'])
      expect(indicator).toHaveLength(3)
    })
  })
})
