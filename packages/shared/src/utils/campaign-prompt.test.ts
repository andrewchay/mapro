import { test, expect, describe } from 'bun:test'
import { buildArtifactPersistenceDirective, splitOutputByFiles } from './campaign-prompt'

describe('buildArtifactPersistenceDirective', () => {
  test('包含目录前缀与全部必需文件的完整路径', () => {
    const directive = buildArtifactPersistenceDirective('user-analysis', [
      'ta-portrait.md',
      'search-habits.md',
      'consumer-insight.md',
    ])

    expect(directive).toContain('user-analysis/ta-portrait.md')
    expect(directive).toContain('user-analysis/search-habits.md')
    expect(directive).toContain('user-analysis/consumer-insight.md')
    expect(directive).toContain('Write')
    expect(directive).toContain('file_path')
  })

  test('单文件时也能生成硬约束', () => {
    const directive = buildArtifactPersistenceDirective('brand-fact-check', ['brand-fact-check.md'])
    expect(directive).toContain('brand-fact-check/brand-fact-check.md')
  })
})

describe('splitOutputByFiles', () => {
  test('按 `# 文件名` 标题把输出拆分为多个必需文件', () => {
    const output = [
      '# ta-portrait.md',
      '目标用户画像是……',
      '',
      '# search-habits.md',
      '搜索习惯包括……',
      '',
      '# consumer-insight.md',
      '消费洞察是……',
    ].join('\n')

    const sections = splitOutputByFiles(output, [
      'ta-portrait.md',
      'search-habits.md',
      'consumer-insight.md',
    ])

    expect(sections.get('ta-portrait.md')).toContain('目标用户画像是')
    expect(sections.get('search-habits.md')).toContain('搜索习惯包括')
    expect(sections.get('consumer-insight.md')).toContain('消费洞察是')
  })

  test('标题仅含去扩展名的文件名也能命中', () => {
    const output = ['## 文件：ta-portrait', '画像正文', '### search-habits', '习惯正文'].join('\n')

    const sections = splitOutputByFiles(output, ['ta-portrait.md', 'search-habits.md'])

    expect(sections.get('ta-portrait.md')).toContain('画像正文')
    expect(sections.get('search-habits.md')).toContain('习惯正文')
  })

  test('无法识别任何分节时返回空 Map（交由调用方整体兜底）', () => {
    const sections = splitOutputByFiles('只有一段没有标题的正文', ['ta-portrait.md'])
    expect(sections.size).toBe(0)
  })

  test('空输出或空必需文件列表返回空 Map', () => {
    expect(splitOutputByFiles('', ['a.md']).size).toBe(0)
    expect(splitOutputByFiles('正文', []).size).toBe(0)
  })
})
