import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentAuditLogger, sanitizeToolInput, type AgentAuditEntry } from './agent-audit-logger.ts'
import type { AppContext } from '../context/types.ts'

function createMockContext(configDir: string): AppContext {
  return {
    getConfigDir: () => configDir,
    getResourcesPath: () => '',
    isPackaged: () => false,
  }
}

describe('AgentAuditLogger', () => {
  let tempDir: string
  let context: AppContext
  let logger: AgentAuditLogger

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agent-audit-test-'))
    context = createMockContext(tempDir)
    logger = new AgentAuditLogger(context, { flushIntervalMs: 10000, bufferSize: 100 })
  })

  afterEach(() => {
    logger.dispose()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('应在 dispose 时将单条日志写入 JSONL 文件', () => {
    logger.log({
      sessionId: 'session-1',
      eventType: 'tool_request',
      toolName: 'Read',
      toolUseId: 'tu-1',
      input: { file_path: '/app/data/test.md' },
      permissionMode: 'auto',
    })

    expect(existsSync(join(tempDir, 'logs'))).toBe(false)
    logger.dispose()

    const logDir = join(tempDir, 'logs')
    expect(existsSync(logDir)).toBe(true)

    const today = new Date().toISOString().slice(0, 10)
    const logPath = join(logDir, `agent-audit-${today}.jsonl`)
    expect(existsSync(logPath)).toBe(true)

    const lines = readFileSync(logPath, 'utf-8').trim().split('\n')
    expect(lines.length).toBe(1)

    const entry = JSON.parse(lines[0]!) as AgentAuditEntry
    expect(entry.sessionId).toBe('session-1')
    expect(entry.eventType).toBe('tool_request')
    expect(entry.toolName).toBe('Read')
    expect(entry.input).toEqual({ file_path: '/app/data/test.md' })
    expect(typeof entry.timestamp).toBe('number')
  })

  test('缓冲区达到 bufferSize 时应自动刷盘', () => {
    const smallBufferLogger = new AgentAuditLogger(context, { flushIntervalMs: 10000, bufferSize: 10 })
    for (let i = 0; i < 10; i++) {
      smallBufferLogger.log({
        sessionId: 'session-1',
        eventType: 'tool_request',
        toolName: 'Read',
        toolUseId: `tu-${i}`,
      })
    }

    const logPath = join(tempDir, 'logs', `agent-audit-${new Date().toISOString().slice(0, 10)}.jsonl`)
    expect(existsSync(logPath)).toBe(true)

    const lines = readFileSync(logPath, 'utf-8').trim().split('\n')
    expect(lines.length).toBe(10)
    smallBufferLogger.dispose()
  })

  test('工具输出超长时应截断并记录原始长度', () => {
    const longOutput = 'a'.repeat(5000)
    logger.log({
      sessionId: 'session-1',
      eventType: 'tool_result',
      toolUseId: 'tu-1',
      output: longOutput,
    })
    logger.dispose()

    const logPath = join(tempDir, 'logs', `agent-audit-${new Date().toISOString().slice(0, 10)}.jsonl`)
    const entry = JSON.parse(readFileSync(logPath, 'utf-8').trim()) as AgentAuditEntry

    expect(entry.outputSize).toBe(5000)
    expect(entry.output!.length).toBeLessThan(5000)
    expect(entry.output).toContain('... [truncated')
  })

  test('应脱敏输入中的 apiKey、token 等敏感字段', () => {
    logger.log({
      sessionId: 'session-1',
      eventType: 'tool_request',
      toolName: 'Bash',
      input: {
        command: 'echo hello',
        apiKey: 'sk-123456',
        nested: { token: 'abc', public: 'ok' },
      },
    })
    logger.dispose()

    const logPath = join(tempDir, 'logs', `agent-audit-${new Date().toISOString().slice(0, 10)}.jsonl`)
    const entry = JSON.parse(readFileSync(logPath, 'utf-8').trim()) as AgentAuditEntry

    expect(entry.input).toEqual({
      command: 'echo hello',
      apiKey: '***',
      nested: { token: '***', public: 'ok' },
    })
  })
})

describe('sanitizeToolInput', () => {
  test('应替换敏感字段为 ***', () => {
    const sanitized = sanitizeToolInput({
      url: 'https://example.com',
      apiKey: 'secret',
      headers: {
        Authorization: 'Bearer x',
        'Content-Type': 'application/json',
      },
    })

    expect(sanitized).toEqual({
      url: 'https://example.com',
      apiKey: '***',
      headers: {
        Authorization: '***',
        'Content-Type': 'application/json',
      },
    })
  })
})
