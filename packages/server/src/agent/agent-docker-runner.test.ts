import { describe, test, expect } from 'bun:test'
import { DockerAgentRunner } from './agent-docker-runner.ts'

describe('Agent Docker Runner', () => {
  test('checkAvailable 返回布尔值', async () => {
    const runner = new DockerAgentRunner()
    const available = await runner.checkAvailable()
    expect(typeof available).toBe('boolean')
  })

  test('run 在 SDK 路径不存在时抛出错误', async () => {
    const runner = new DockerAgentRunner()
    await expect(
      runner.run({
        sdkCliPath: '/nonexistent/claude',
        workspacePath: '/tmp/mapro-test-workspace',
        prompt: 'hello',
        env: { apiKey: '' },
      }),
    ).rejects.toThrow('SDK binary 不存在')
  })
})
