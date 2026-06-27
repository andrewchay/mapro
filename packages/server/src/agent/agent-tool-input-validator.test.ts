/**
 * 工具参数校验测试
 *
 * 验证 validateToolInput 在 canUseTool 回调中拦截参数缺失的工具调用，
 * 返回 deny message 引导模型重试。这避免了模型用空参数调用工具后失败、
 * 浪费一轮对话的常见反模式。
 */

import { describe, it, expect } from 'bun:test'
import { validateToolInput, TOOL_REQUIRED_PARAMS } from './agent-tool-input-validator.ts'

describe('工具参数校验', () => {
  describe('已知工具参数完整时放行', () => {
    const validCases: Array<[string, string, Record<string, unknown>]> = [
      ['Write', '完整参数', { file_path: '/a/b.md', content: 'hello' }],
      ['Edit', '完整参数', { file_path: '/a/b.md', old_string: 'a', new_string: 'b' }],
      ['Bash', '完整参数', { command: 'ls -la' }],
      ['Read', '完整参数', { file_path: '/a/b.md' }],
      ['Glob', '完整参数', { pattern: '**/*.ts' }],
      ['Grep', '完整参数', { pattern: 'TODO' }],
      ['Agent', '完整参数', { prompt: 'do something', description: 'sub task' }],
    ]

    for (const [toolName, name, input] of validCases) {
      it(`Given ${toolName} ${name} when 校验 then 返回 null`, () => {
        expect(validateToolInput(toolName, input)).toBeNull()
      })
    }
  })

  describe('参数缺失时拒绝并列出缺失项', () => {
    it('Given Write 缺少 content when 校验 then deny 且 message 含 content', () => {
      const result = validateToolInput('Write', { file_path: '/a.md' })
      expect(result).not.toBeNull()
      expect(result!.behavior).toBe('deny')
      expect(result!.message).toContain('"content"')
      expect(result!.message).toContain('Write')
    })

    it('Given Write 缺少多个参数 when 校验 then message 用复数格式列出全部', () => {
      const result = validateToolInput('Write', {})
      expect(result).not.toBeNull()
      // 多参数用 "is missing required parameters:" 格式（源码统一用 is）
      expect(result!.message).toContain('is missing required parameters:')
      expect(result!.message).toContain('"file_path"')
      expect(result!.message).toContain('"content"')
    })

    it('Given Edit 缺少 old_string/new_string when 校验 then deny', () => {
      const result = validateToolInput('Edit', { file_path: '/a.md' })
      expect(result).not.toBeNull()
      expect(result!.message).toContain('"old_string"')
      expect(result!.message).toContain('"new_string"')
    })

    it('Given Bash 缺少 command when 校验 then deny', () => {
      const result = validateToolInput('Bash', {})
      expect(result!.behavior).toBe('deny')
      expect(result!.message).toContain('"command"')
      // 单参数用 "is missing required parameter" 格式
      expect(result!.message).toContain('is missing required parameter')
    })
  })

  describe('空值视为缺失', () => {
    it('Given 参数为空字符串 when 校验 then 视为缺失', () => {
      const result = validateToolInput('Write', { file_path: '/a.md', content: '' })
      expect(result).not.toBeNull()
      expect(result!.message).toContain('"content"')
    })

    it('Given 参数为 null when 校验 then 视为缺失', () => {
      const result = validateToolInput('Read', { file_path: null })
      expect(result).not.toBeNull()
      expect(result!.message).toContain('"file_path"')
    })

    it('Given 参数为 undefined when 校验 then 视为缺失', () => {
      const result = validateToolInput('Read', { file_path: undefined })
      expect(result).not.toBeNull()
    })
  })

  describe('未知工具放行', () => {
    it('Given 未注册的工具 when 校验 then 返回 null（交由后续权限流程处理）', () => {
      expect(validateToolInput('UnknownTool', {})).toBeNull()
      expect(validateToolInput('WebSearch', { query: '' })).toBeNull()
    })
  })

  describe('必需参数映射完整性', () => {
    it('TOOL_REQUIRED_PARAMS 覆盖核心工具', () => {
      // 确保关键工具都在映射中，避免遗漏导致绕过校验
      const expectedTools = ['Write', 'Edit', 'Bash', 'Read', 'Glob', 'Grep', 'Agent']
      for (const tool of expectedTools) {
        expect(TOOL_REQUIRED_PARAMS.has(tool), `${tool} 应在必需参数映射中`).toBe(true)
      }
    })
  })

  describe('单复数 message 格式', () => {
    it('单参数缺失时用 "is missing required parameter"', () => {
      const result = validateToolInput('Bash', {})!
      expect(result.message).toMatch(/is missing required parameter "/)
    })

    it('多参数缺失时用 "is missing required parameters:"', () => {
      const result = validateToolInput('Edit', {})!
      // 源码单复数分支统一用 "is"，仅参数个数措辞不同
      expect(result.message).toMatch(/is missing required parameters:/)
    })
  })
})
