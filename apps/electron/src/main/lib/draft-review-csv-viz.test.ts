/**
 * draft-review-csv-viz 结构化提取逻辑测试
 *
 * 覆盖：稿件标题 / 话题标签 / 正文的 md 区块解析（区块式、内联式、空行间隔、纯文本兜底），
 * 回归"## 标题"、"## 话题标签"区块未被结构化提取导致 viz CSV 第 9/10 列一直为空的问题。
 */
import { describe, expect, test } from 'bun:test'
import { extractBody, extractTags, extractTitle } from './draft-review-csv-viz'

describe('extractTitle 稿件标题提取', () => {
  test('区块式：## 标题 后直接跟标题', () => {
    expect(extractTitle('## 标题\n夏日清爽穿搭分享\n## 话题标签\n#忘本美学 #vonbon忘本甄果')).toBe('夏日清爽穿搭分享')
  })

  test('区块式：## 标题 与内容之间有空行（原先返回空）', () => {
    expect(extractTitle('# 稿件 v1 · 达人\n\n## 标题\n\n夏日清爽穿搭分享\n\n## 话题标签\n\n#忘本美学')).toBe('夏日清爽穿搭分享')
  })

  test('内联式：## 标题：xxx', () => {
    expect(extractTitle('## 标题：夏日清爽穿搭分享\n正文……')).toBe('夏日清爽穿搭分享')
  })

  test('内联式：标题：xxx', () => {
    expect(extractTitle('标题：夏日清爽穿搭分享\n正文……')).toBe('夏日清爽穿搭分享')
  })

  test('三级标题 ### 标题', () => {
    expect(extractTitle('### 标题\n夏日清爽穿搭分享\n## 话题标签\n#忘本美学')).toBe('夏日清爽穿搭分享')
  })

  test('纯文本兜底：取首个非空非 md 标题行', () => {
    expect(extractTitle('夏日清爽穿搭分享\n正文……\n#忘本美学')).toBe('夏日清爽穿搭分享')
  })

  test('空输入返回空', () => {
    expect(extractTitle('')).toBe('')
  })
})

describe('extractTags 话题标签提取', () => {
  test('区块式：## 话题标签 后跟标签行', () => {
    expect(extractTags('## 标题\n夏日清爽穿搭分享\n## 话题标签\n#忘本美学 #vonbon忘本甄果\n## 正文\n……')).toBe('#忘本美学 #vonbon忘本甄果')
  })

  test('区块式：## 话题标签 与内容之间有空行（原先返回空）', () => {
    expect(extractTags('# 稿件 v1 · 达人\n\n## 话题标签\n\n#忘本美学 #vonbon忘本甄果')).toBe('#忘本美学 #vonbon忘本甄果')
  })

  test('内联式：## 话题标签：#忘本美学', () => {
    expect(extractTags('## 话题标签：#忘本美学 #vonbon忘本甄果\n正文……')).toBe('#忘本美学 #vonbon忘本甄果')
  })

  test('标签区多条标签合并为空格分隔', () => {
    expect(extractTags('## 话题标签\n#忘本美学\n#vonbon忘本甄果\n#夏日穿搭')).toBe('#忘本美学 #vonbon忘本甄果 #夏日穿搭')
  })

  test('纯文本兜底：含 #xxx 的行', () => {
    expect(extractTags('夏日清爽穿搭分享\n正文……\n#忘本美学 #vonbon忘本甄果')).toBe('#忘本美学 #vonbon忘本甄果')
  })
})

describe('extractBody 正文拆分', () => {
  test('去掉归档头与标题/话题标签区块，只留正文', () => {
    const md = '# 稿件 v1 · 达人\n\n## 标题\n\n夏日清爽穿搭分享\n\n## 话题标签\n\n#忘本美学 #vonbon忘本甄果\n\n正文内容第一行\n正文内容第二行'
    expect(extractBody(md)).toBe('正文内容第一行\n正文内容第二行')
  })

  test('保留正文内的 md 子标题', () => {
    const md = '## 标题\n标题内容\n\n## 话题标签\n#忘本美学\n\n## 场景\n教室对坐\n## 动作\n递果汁'
    expect(extractBody(md)).toBe('## 场景\n教室对坐\n## 动作\n递果汁')
  })

  test('纯文本（无 md 区块）原样返回', () => {
    expect(extractBody('夏日清爽穿搭分享\n正文……\n#忘本美学')).toBe('夏日清爽穿搭分享\n正文……\n#忘本美学')
  })
})
