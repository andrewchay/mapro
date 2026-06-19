/**
 * ToolSettings - 工具设置页
 *
 * Chat 模式工具统一管理 tab。
 * 内嵌 MemorySettings（记忆工具）+ 联网搜索工具配置。
 */

import * as React from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { toast } from 'sonner'
import {
  ExternalLink, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Trash2, Users,
  Brain, Target, Search, MessageSquare, Sparkles, Lightbulb, BarChart3,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { MemorySettings } from './MemorySettings'
import { SettingsSection, SettingsCard } from './primitives'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { cn } from '@/lib/utils'

/** 刷新全局工具列表 atom */
async function refreshChatTools(setter: (tools: Awaited<ReturnType<typeof window.electronAPI.getChatTools>>) => void): Promise<void> {
  try {
    const tools = await window.electronAPI.getChatTools()
    setter(tools)
  } catch (err) {
    console.error('[ToolSettings] 刷新工具列表失败:', err)
  }
}

/** 联网搜索工具设置区域 */
function WebSearchSettings(): React.ReactElement {
  const [apiKey, setApiKey] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)
  const setChatTools = useSetAtom(chatToolsAtom)

  // 已保存的 API Key（用于判断是否有变更）
  const savedApiKeyRef = React.useRef('')

  // 从主进程加载当前配置 + 凭据
  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getChatTools(),
      window.electronAPI.getChatToolCredentials('web-search'),
    ]).then(([tools, credentials]) => {
      const searchTool = tools.find((t) => t.meta.id === 'web-search')
      if (searchTool) {
        setEnabled(searchTool.enabled)
      }
      if (credentials.apiKey) {
        setApiKey(credentials.apiKey)
        savedApiKeyRef.current = credentials.apiKey
      }
    }).catch((err: unknown) => {
      console.error('[联网搜索设置] 加载失败:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  /** 静默保存 API Key（blur 时触发） */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const trimmed = apiKey.trim()
    if (trimmed === savedApiKeyRef.current) return
    try {
      await window.electronAPI.updateChatToolCredentials('web-search', { apiKey: trimmed })
      savedApiKeyRef.current = trimmed
      // 刷新全局工具列表（available 状态可能变化）
      await refreshChatTools(setChatTools)
      toast.success('联网搜索设置已保存')
    } catch (error) {
      console.error('[联网搜索设置] 保存失败:', error)
    }
  }, [apiKey, setChatTools])

  const handleToggle = async (checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState('web-search', { enabled: checked })
      setEnabled(checked)
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[联网搜索设置] 切换失败:', error)
    }
  }

  const handleTest = async (): Promise<void> => {
    // 先保存可能的变更
    const trimmed = apiKey.trim()
    if (trimmed !== savedApiKeyRef.current) {
      try {
        await window.electronAPI.updateChatToolCredentials('web-search', { apiKey: trimmed })
        savedApiKeyRef.current = trimmed
        await refreshChatTools(setChatTools)
      } catch (error) {
        console.error('[联网搜索设置] 保存失败:', error)
      }
    }

    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testChatTool('web-search')
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  return (
    <SettingsSection
      title="联网搜索"
      description="启用后 AI 可以实时搜索互联网获取最新信息"
      action={
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 引导说明 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <p>联网搜索由 <span className="font-medium text-foreground">Tavily</span> 提供，启用后 AI 可以搜索互联网获取实时信息。</p>
            <p className="text-xs">配置步骤：</p>
            <ol className="text-xs list-decimal list-inside space-y-1">
              <li>
                访问{' '}
                <a
                  href="https://tavily.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  Tavily 官网
                  <ExternalLink size={10} />
                </a>
                {' '}注册账号
              </li>
              <li>在控制台获取 API Key（免费额度每月 1000 次搜索）</li>
              <li>将 API Key 填入下方，然后开启开关</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">API Key</label>
              <Button
                size="sm"
                variant="outline"
                disabled={testing || !apiKey.trim()}
                onClick={handleTest}
              >
                {testing ? <><Loader2 size={14} className="animate-spin mr-1.5" />测试中...</> : '测试连接'}
              </Button>
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                placeholder="tvly-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={handleBlurSave}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${testResult.success ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
              {testResult.success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/** Nano Banana 生图工具设置区域 */
function NanoBananaSettings(): React.ReactElement {
  const [apiKey, setApiKey] = React.useState('')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [model, setModel] = React.useState('')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null)
  const setChatTools = useSetAtom(chatToolsAtom)

  const savedCredentialsRef = React.useRef({ apiKey: '', baseUrl: '', model: '' })

  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getChatTools(),
      window.electronAPI.getChatToolCredentials('nano-banana'),
    ]).then(([tools, credentials]) => {
      const tool = tools.find((t) => t.meta.id === 'nano-banana')
      if (tool) setEnabled(tool.enabled)
      if (credentials.apiKey) setApiKey(credentials.apiKey)
      if (credentials.baseUrl) setBaseUrl(credentials.baseUrl)
      if (credentials.model) setModel(credentials.model)
      savedCredentialsRef.current = {
        apiKey: credentials.apiKey || '',
        baseUrl: credentials.baseUrl || '',
        model: credentials.model || '',
      }
    }).catch((err: unknown) => {
      console.error('[Nano Banana 设置] 加载失败:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  /** 静默保存凭据（blur 时触发） */
  const handleBlurSave = React.useCallback(async (): Promise<void> => {
    const current = { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() }
    const saved = savedCredentialsRef.current
    if (current.apiKey === saved.apiKey && current.baseUrl === saved.baseUrl && current.model === saved.model) return
    try {
      await window.electronAPI.updateChatToolCredentials('nano-banana', current)
      savedCredentialsRef.current = current
      await refreshChatTools(setChatTools)
      toast.success('Nano Banana 设置已保存')
    } catch (error) {
      console.error('[Nano Banana 设置] 保存失败:', error)
    }
  }, [apiKey, baseUrl, model, setChatTools])

  const handleToggle = async (checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState('nano-banana', { enabled: checked })
      setEnabled(checked)
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[Nano Banana 设置] 切换失败:', error)
    }
  }

  const handleTest = async (): Promise<void> => {
    // 先保存可能的变更
    const current = { apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() }
    const saved = savedCredentialsRef.current
    if (current.apiKey !== saved.apiKey || current.baseUrl !== saved.baseUrl || current.model !== saved.model) {
      try {
        await window.electronAPI.updateChatToolCredentials('nano-banana', current)
        savedCredentialsRef.current = current
        await refreshChatTools(setChatTools)
      } catch (error) {
        console.error('[Nano Banana 设置] 保存失败:', error)
      }
    }

    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electronAPI.testChatTool('nano-banana')
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  return (
    <SettingsSection
      title="Nano Banana"
      description="启用后 AI 可以生成和编辑图片（基于 Gemini Image Generation）"
      action={
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          {/* 引导说明 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <p>Nano Banana 基于 <span className="font-medium text-foreground">Gemini Image Generation</span> 提供 AI 图片生成与编辑能力。</p>
            <p className="text-xs">配置步骤：</p>
            <ol className="text-xs list-decimal list-inside space-y-1">
              <li>
                访问{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-0.5"
                >
                  Google AI Studio
                  <ExternalLink size={10} />
                </a>
                {' '}获取 Gemini API Key
              </li>
              <li>将 API Key 填入下方，可选修改 API 地址和模型</li>
              <li>开启开关即可在对话中使用生图能力</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">API Key</label>
              <Button
                size="sm"
                variant="outline"
                disabled={testing || !apiKey.trim()}
                onClick={handleTest}
              >
                {testing ? <><Loader2 size={14} className="animate-spin mr-1.5" />测试中...</> : '测试连接'}
              </Button>
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                placeholder="AIza..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={handleBlurSave}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">API 地址</label>
            <Input
              type="text"
              placeholder="https://generativelanguage.googleapis.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={handleBlurSave}
            />
            <p className="text-xs text-muted-foreground">留空则使用 Gemini 官方地址</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">模型</label>
            <Input
              type="text"
              placeholder="gemini-3.1-flash-image-preview"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={handleBlurSave}
            />
            <p className="text-xs text-muted-foreground">留空则使用默认模型 gemini-3.1-flash-image-preview</p>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${testResult.success ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
              {testResult.success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/** KOL 数据 MCP Server 设置区域 */
function KOLDataMcpSettings(): React.ReactElement {
  const [enabled, setEnabled] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const setChatTools = useSetAtom(chatToolsAtom)

  React.useEffect(() => {
    window.electronAPI.getChatTools().then((tools) => {
      const tool = tools.find((t) => t.meta.id === 'ma-kol-data-mcp')
      if (tool) setEnabled(tool.enabled)
    }).catch((err: unknown) => {
      console.error('[KOL Data MCP 设置] 加载失败:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const handleToggle = async (checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState('ma-kol-data-mcp', { enabled: checked })
      setEnabled(checked)
      await refreshChatTools(setChatTools)
      toast.success(checked ? 'KOL 数据 MCP 已启用' : 'KOL 数据 MCP 已禁用')
    } catch (error) {
      console.error('[KOL Data MCP 设置] 切换失败:', error)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  return (
    <SettingsSection
      title="KOL 数据 MCP"
      description="启用后 Agent 可使用 KOL 搜索、详情获取、数据同步和 AI 分析工具"
      action={
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
        />
      }
    >
      <SettingsCard divided={false}>
        <div className="space-y-4 p-4">
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm text-muted-foreground">
            <p>将 KOL 数据采集源（新榜、JustOneAPI）封装为 MCP Server，供 Agent 模式调用。</p>
            <p className="text-xs">提供的工具：</p>
            <ul className="text-xs list-disc list-inside space-y-1">
              <li><span className="text-foreground font-medium">search_kols</span> — 本地 KOL 数据库搜索</li>
              <li><span className="text-foreground font-medium">get_kol_detail</span> — 获取 KOL 完整详情</li>
              <li><span className="text-foreground font-medium">sync_kol_data</span> — 从 API 同步数据（需配置凭据）</li>
              <li><span className="text-foreground font-medium">analyze_kol</span> — AI 深度分析 KOL 数据</li>
              <li><span className="text-foreground font-medium">get_kol_stats</span> — 数据库统计概览</li>
              <li><span className="text-foreground font-medium">seed_mock_data</span> — 填充示例数据</li>
            </ul>
            <p className="text-xs mt-2">API 同步凭据复用「KOL 搜索」工具的配置。</p>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/** MA 营销工具设置区域 */
function MAToolsSettings(): React.ReactElement {
  const tools = useAtomValue(chatToolsAtom)
  const setChatTools = useSetAtom(chatToolsAtom)
  const [justoneToken, setJustoneToken] = React.useState('')
  const [newrankKey, setNewrankKey] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const savedCredsRef = React.useRef({ justoneToken: '', newrankKey: '' })

  // 分类定义：名称 + 图标组件 + 描述
  const groups = [
    {
      name: '策略洞察',
      items: [
        { id: 'ma-strategy-iq', name: '策略生成', icon: Lightbulb, desc: '解析品牌Brief，生成完整社交营销策略提案' },
      ],
    },
    {
      name: 'KOL 数据',
      items: [
        { id: 'ma-match-ai', name: 'KOL 匹配', icon: Target, desc: '基于品牌需求智能筛选推荐合适的 KOL/KOC' },
        { id: 'ma-kol-search', name: 'KOL 搜索', icon: Search, desc: '本地数据库搜索 + 外部API数据采集（新榜/JustOne）' },
        { id: 'ma-kol-data-mcp', name: 'KOL 数据 MCP', icon: Users, desc: 'Agent模式专用：搜索/详情/同步/分析/统计' },
      ],
    },
    {
      name: '智能建联',
      items: [
        { id: 'ma-connect-bot', name: '智能建联', icon: MessageSquare, desc: '生成个性化KOL邀约话术、谈判策略与合同建议' },
      ],
    },
    {
      name: '创意内容',
      items: [
        { id: 'ma-creative-pilot', name: '创意指导', icon: Sparkles, desc: '为KOL内容创作提供Brief、脚本建议与合规审核' },
      ],
    },
  ]

  React.useEffect(() => {
    Promise.all([
      window.electronAPI.getChatTools(),
      window.electronAPI.getChatToolCredentials('ma-kol-search'),
    ]).then(([allTools, credentials]) => {
      // 工具状态由 atom 自动维护，这里只加载凭据
      if (credentials.justoneToken) {
        setJustoneToken(credentials.justoneToken)
        savedCredsRef.current.justoneToken = credentials.justoneToken
      }
      if (credentials.newrankKey) {
        setNewrankKey(credentials.newrankKey)
        savedCredsRef.current.newrankKey = credentials.newrankKey
      }
    }).catch((err: unknown) => {
      console.error('[MA 工具设置] 加载失败:', err)
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const handleToggle = async (toolId: string, checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState(toolId, { enabled: checked })
      await refreshChatTools(setChatTools)
      toast.success(checked ? `已启用` : `已禁用`)
    } catch (error) {
      console.error(`[MA 工具设置] 切换失败: ${toolId}`, error)
    }
  }

  const handleSaveCredentials = React.useCallback(async (): Promise<void> => {
    const current = {
      justoneToken: justoneToken.trim(),
      newrankKey: newrankKey.trim(),
    }
    const saved = savedCredsRef.current
    if (current.justoneToken === saved.justoneToken && current.newrankKey === saved.newrankKey) return
    try {
      await window.electronAPI.updateChatToolCredentials('ma-kol-search', current)
      savedCredsRef.current = current
      await refreshChatTools(setChatTools)
      toast.success('KOL 搜索凭据已保存')
    } catch (error) {
      console.error('[MA 工具设置] 保存凭据失败:', error)
    }
  }, [justoneToken, newrankKey, setChatTools])

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
  }

  return (
    <SettingsSection
      title="MA 营销工具"
      description="Flow 复楼 — 智能社交营销工具套件（Chat 模式 + Agent 模式）"
    >
      <SettingsCard divided>
        {groups.map((group) => (
          <div key={group.name} className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {group.name}
              </span>
            </div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const tool = tools.find((t) => t.meta.id === item.id)
                const Icon = item.icon
                const isActive = tool?.enabled ?? false
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={cn('shrink-0 p-1.5 rounded-md', isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn('text-sm font-medium', !isActive && 'text-muted-foreground')}>
                            {item.name}
                          </span>
                          {tool?.available === false && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600">
                              需配置
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                    <Switch
                      checked={isActive}
                      onCheckedChange={(checked) => handleToggle(item.id, checked)}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* KOL 搜索凭据配置 */}
        <div className="p-4 border-t border-border/50">
          <div className="flex items-center gap-2 mb-3">
            <Search className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              API 凭据（KOL 数据采集）
            </span>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">JustOneAPI Token</label>
              <Input
                type="password"
                placeholder="jo_..."
                value={justoneToken}
                onChange={(e) => setJustoneToken(e.target.value)}
                onBlur={handleSaveCredentials}
                className="h-8 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">用于从小红书/抖音/微博/B站等平台采集 KOL 数据</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">新榜 API Key</label>
              <Input
                type="password"
                placeholder="nr_..."
                value={newrankKey}
                onChange={(e) => setNewrankKey(e.target.value)}
                onBlur={handleSaveCredentials}
                className="h-8 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">用于从新榜平台采集国内主流社交媒体 KOL 数据</p>
            </div>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

/** 自定义工具列表区域 */
function CustomToolsSection(): React.ReactElement | null {
  const tools = useAtomValue(chatToolsAtom)
  const setChatTools = useSetAtom(chatToolsAtom)

  const customTools = tools.filter((t) => t.meta.category === 'custom')
  if (customTools.length === 0) return null

  const handleToggle = async (toolId: string, checked: boolean): Promise<void> => {
    try {
      await window.electronAPI.updateChatToolState(toolId, { enabled: checked })
      await refreshChatTools(setChatTools)
    } catch (error) {
      console.error('[自定义工具] 切换失败:', error)
    }
  }

  const handleDelete = async (toolId: string, toolName: string): Promise<void> => {
    try {
      await window.electronAPI.deleteCustomChatTool(toolId)
      await refreshChatTools(setChatTools)
      toast.success(`已删除工具: ${toolName}`)
    } catch (error) {
      console.error('[自定义工具] 删除失败:', error)
      toast.error('删除工具失败')
    }
  }

  return (
    <SettingsSection
      title="自定义工具"
      description="通过 Agent 模式创建的 HTTP API 工具"
    >
      <SettingsCard divided>
        {customTools.map((tool) => (
          <div key={tool.meta.id} className="flex items-center justify-between p-4">
            <div className="flex-1 min-w-0 mr-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{tool.meta.name}</span>
                {tool.meta.httpConfig && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {tool.meta.httpConfig.method}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {tool.meta.description}
              </p>
              {tool.meta.httpConfig && (
                <p className="text-xs text-muted-foreground/60 mt-0.5 truncate font-mono">
                  {tool.meta.httpConfig.urlTemplate}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                checked={tool.enabled}
                onCheckedChange={(checked) => handleToggle(tool.meta.id, checked)}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(tool.meta.id, tool.meta.name)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ))}
      </SettingsCard>
    </SettingsSection>
  )
}

export function ToolSettings(): React.ReactElement {
  return (
    <div className="space-y-8">
      {/* 记忆工具（复用现有 MemorySettings 组件） */}
      <MemorySettings />

      {/* 联网搜索工具 */}
      <WebSearchSettings />

      {/* Nano Banana 生图工具 */}
      <NanoBananaSettings />

      {/* KOL 数据 MCP Server */}
      <KOLDataMcpSettings />

      {/* MA 营销工具套件 */}
      <MAToolsSettings />

      {/* 自定义工具 */}
      <CustomToolsSection />
    </div>
  )
}
