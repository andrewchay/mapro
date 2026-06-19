/**
 * AboutSettings - 关于页面（简化版）
 *
 * 仅显示应用版本号等基本信息，已移除更新和版本历史功能。
 */

import * as React from 'react'
import { Info, Terminal, RefreshCw, Loader2, AlertCircle } from 'lucide-react'
import type { RuntimeStatus } from '@ma-proma/shared'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
} from './primitives'
import { EnvironmentCheckCard } from '@/components/environment/EnvironmentCheckCard'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'

/** 从 package.json 构建时由 Vite define 注入 */
declare const __APP_VERSION__: string
const APP_VERSION = __APP_VERSION__

/** Shell 环境卡片（Windows 平台）*/
function ShellEnvironmentCard(): React.ReactElement | null {
  const [runtimeStatus, setRuntimeStatus] = React.useState<RuntimeStatus | null>(null)
  const [isChecking, setIsChecking] = React.useState(false)

  React.useEffect(() => {
    window.electronAPI.getRuntimeStatus().then((status) => {
      setRuntimeStatus(status)
    })
  }, [])

  const handleCheck = async () => {
    setIsChecking(true)
    try {
      const status = await window.electronAPI.getRuntimeStatus()
      setRuntimeStatus(status)
    } catch (error) {
      console.error('[Shell 环境检测] 检测失败:', error)
    } finally {
      setIsChecking(false)
    }
  }

  if (!runtimeStatus || !runtimeStatus.shell) {
    return null
  }

  const { shell } = runtimeStatus
  const hasShell = shell.gitBash?.available || shell.wsl?.available

  return (
    <SettingsCard>
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Shell 环境（Windows）</h3>
            {!hasShell && <Badge variant="destructive">!</Badge>}
          </div>
          <button
            onClick={handleCheck}
            disabled={isChecking}
            className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {isChecking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {isChecking ? '检测中...' : '重新检查'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          营销工具脚本执行需要 Git Bash 或 WSL 支持
        </p>
      </div>

      <div className="p-4 space-y-3">
        <EnvironmentCheckCard
          name="Git Bash"
          status={shell.gitBash?.available ? 'success' : 'error'}
          version={shell.gitBash?.version ?? undefined}
          requirement="Git for Windows 自带"
          action={{ type: 'download', installerId: 'git-for-windows' }}
          statusText={
            shell.gitBash?.available
              ? `${shell.gitBash.path}`
              : shell.gitBash?.error || '未安装'
          }
        />

        <EnvironmentCheckCard
          name="WSL"
          status={shell.wsl?.available ? 'success' : 'error'}
          version={shell.wsl?.version ? `WSL ${shell.wsl.version}` : undefined}
          requirement="WSL 1 或 WSL 2"
          action={{
            type: 'openExternal',
            url: 'https://learn.microsoft.com/zh-cn/windows/wsl/install',
          }}
          statusText={
            shell.wsl?.available
              ? `默认发行版: ${shell.wsl.defaultDistro || '未设置'} (${shell.wsl.distros.join(', ')})`
              : shell.wsl?.error || '未安装'
          }
        />

        {shell.recommended && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>当前使用：</strong>
              {shell.recommended === 'git-bash' ? 'Git Bash（推荐）' : 'WSL'}
            </AlertDescription>
          </Alert>
        )}

        {!hasShell && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>未检测到可用的 Shell 环境！</strong>
              <br />
              部分营销工具脚本需要 Git Bash 或 WSL 才能运行。请安装其中之一后重启应用。
            </AlertDescription>
          </Alert>
        )}
      </div>
    </SettingsCard>
  )
}

export function AboutSettings(): React.ReactElement {
  return (
    <SettingsSection
      title="关于 MAPro"
      description="MAPro 支持 macOS、Windows 和 Linux。"
    >
      <SettingsCard>
        <SettingsRow label="版本">
          <span className="text-sm text-muted-foreground font-mono">{APP_VERSION}</span>
        </SettingsRow>
        <SettingsRow label="运行时">
          <span className="text-sm text-muted-foreground">Electron + React</span>
        </SettingsRow>
      </SettingsCard>

      {/* Shell 环境卡片（仅 Windows，用于执行营销工具脚本） */}
      <ShellEnvironmentCard />
    </SettingsSection>
  )
}
