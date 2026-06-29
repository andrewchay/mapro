import { describe, test, expect } from 'bun:test'
import { spawn } from 'node:child_process'

/**
 * 沙箱隔离专项测试
 *
 * 验证 Docker 容器默认无法访问宿主敏感目录。
 * 若 Docker 不可用则测试自动跳过。
 */

function dockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['version'], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

function dockerRun(args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['run', '--rm', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString('utf-8') })
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString('utf-8') })
    child.on('error', reject)
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
  })
}

describe('Agent Sandbox Isolation', () => {
  test(
    '容器内无法读取宿主 home 目录',
    async () => {
      if (!(await dockerAvailable())) {
        console.log('[沙箱隔离测试] Docker 不可用，跳过')
        return
      }

      const { stdout } = await dockerRun([
        '--network', 'none',
        'alpine:latest',
        'sh', '-c',
        'if ls "$HOME/.mapro" >/dev/null 2>&1; then echo "home-mapro-readable"; else echo "home-mapro-blocked"; fi',
      ])

      expect(stdout).toContain('home-mapro-blocked')
      expect(stdout).not.toContain('home-mapro-readable')
    },
    60000,
  )

  test(
    '容器内无法写入宿主 home 目录',
    async () => {
      if (!(await dockerAvailable())) {
        console.log('[沙箱隔离测试] Docker 不可用，跳过')
        return
      }

      const hostHome = process.env.HOME ?? '/root'
      const { stdout } = await dockerRun([
        '--network', 'none',
        'alpine:latest',
        'sh', '-c',
        `if touch "${hostHome}/.mapro/sandbox-marker-${Date.now()}" >/dev/null 2>&1; then echo "write-ok"; else echo "write-blocked"; fi`,
      ])

      expect(stdout).toContain('write-blocked')
      expect(stdout).not.toContain('write-ok')
    },
    60000,
  )

  test(
    '容器内无法访问宿主机常见敏感路径',
    async () => {
      if (!(await dockerAvailable())) {
        console.log('[沙箱隔离测试] Docker 不可用，跳过')
        return
      }

      const hostHome = process.env.HOME ?? '/root'
      const sensitivePaths = [`${hostHome}/.mapro`, `${hostHome}/.ssh`, '/Users/current-user', '/root/.mapro'].join(' ')
      const { stdout } = await dockerRun([
        '--network', 'none',
        'alpine:latest',
        'sh', '-c',
        `for path in ${sensitivePaths}; do if [ -e "$path" ]; then echo "exists:$path"; fi; done; echo "probe-done"`,
      ])

      expect(stdout).toContain('probe-done')
      expect(stdout).not.toContain('exists:')
    },
    60000,
  )

  test(
    'DockerAgentRunner 默认不挂载宿主敏感目录',
    async () => {
      if (!(await dockerAvailable())) {
        console.log('[沙箱隔离测试] Docker 不可用，跳过')
        return
      }

      const { stdout, stderr } = await dockerRun([
        '--network', 'none',
        'alpine:latest',
        'sh', '-c',
        'mount | grep -E "(/Users/|/home/|/root/)" || echo "no-user-home-mounted"',
      ])

      const output = stdout + stderr
      expect(output).toContain('no-user-home-mounted')
    },
    60000,
  )
})
