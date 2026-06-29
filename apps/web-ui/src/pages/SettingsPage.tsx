import * as React from 'react'
import { useAtom } from 'jotai'
import { User, Palette, Keyboard, Plug, Monitor, Bot } from 'lucide-react'
import { webAPI } from '../api/web-api.ts'
import {
  settingsAtom,
  themeModeAtom,
  themeStyleAtom,
  sendWithCmdEnterAtom,
  defaultAgentChannelIdAtom,
  defaultAgentModelIdAtom,
  defaultAgentWorkspaceIdAtom,
  defaultAgentPermissionModeAtom,
} from '../store/settings-atoms.ts'
import { userProfileAtom } from '../store/user-profile-atoms.ts'
import { channelsAtom } from '../store/channels-atoms.ts'
import { agentWorkspacesAtom, refreshAgentWorkspacesAtom } from '../store/agent-atoms.ts'
import type { ThemeMode, ThemeStyle, Channel, ChannelCreateInput, ProviderType, ChannelModel, MAProPermissionMode } from '@ma-proma/shared'
import { PROVIDER_DEFAULT_URLS, PROVIDER_LABELS, MAPRO_PERMISSION_MODE_CONFIG } from '@ma-proma/shared'
import { DEFAULT_THEME_STYLE } from '@ma-proma/shared'

const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
  { value: 'special', label: '特殊' },
]

const THEME_STYLES: { value: ThemeStyle; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'ocean-light', label: '海洋（浅）' },
  { value: 'ocean-dark', label: '海洋（深）' },
  { value: 'forest-light', label: '森林（浅）' },
  { value: 'forest-dark', label: '森林（深）' },
  { value: 'slate-light', label: '石板（浅）' },
  { value: 'slate-dark', label: '石板（深）' },
]

const PROVIDER_OPTIONS = Object.entries(PROVIDER_LABELS).map(([value, label]) => ({
  value: value as ProviderType,
  label,
}))

export function SettingsPage() {
  const [settings, setSettings] = useAtom(settingsAtom)
  const [themeMode, setThemeMode] = useAtom(themeModeAtom)
  const [themeStyle, setThemeStyle] = useAtom(themeStyleAtom)
  const [sendWithCmdEnter, setSendWithCmdEnter] = useAtom(sendWithCmdEnterAtom)
  const [profile, setProfile] = useAtom(userProfileAtom)
  const [channels, setChannels] = useAtom(channelsAtom)
  const [workspaces] = useAtom(agentWorkspacesAtom)
  const [, refreshWorkspaces] = useAtom(refreshAgentWorkspacesAtom)

  const [defaultAgentChannelId, setDefaultAgentChannelId] = useAtom(defaultAgentChannelIdAtom)
  const [defaultAgentModelId, setDefaultAgentModelId] = useAtom(defaultAgentModelIdAtom)
  const [defaultAgentWorkspaceId, setDefaultAgentWorkspaceId] = useAtom(defaultAgentWorkspaceIdAtom)
  const [defaultAgentPermissionMode, setDefaultAgentPermissionMode] = useAtom(defaultAgentPermissionModeAtom)

  const [userName, setUserName] = React.useState(profile.userName)
  const [avatar, setAvatar] = React.useState(profile.avatar)
  const [saving, setSaving] = React.useState(false)
  const [message, setMessage] = React.useState('')

  React.useEffect(() => {
    setUserName(profile.userName)
    setAvatar(profile.avatar)
  }, [profile])

  React.useEffect(() => {
    webAPI.getUserProfile().then((loaded) => {
      setProfile(loaded)
    }).catch((error) => {
      console.error('[SettingsPage] 加载用户档案失败:', error)
    })

    webAPI.listChannels().then((loaded) => {
      setChannels(loaded)
    }).catch((error) => {
      console.error('[SettingsPage] 加载渠道列表失败:', error)
    })

    refreshWorkspaces()
  }, [setProfile, setChannels, refreshWorkspaces])

  const handleSaveProfile = async () => {
    setSaving(true)
    setMessage('')
    try {
      const updated = await webAPI.updateUserProfile({ userName, avatar })
      setProfile(updated)
      setMessage('用户档案已保存')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleThemeModeChange = async (value: ThemeMode) => {
    setThemeMode(value)
    try {
      const updated = await webAPI.updateSettings({ themeMode: value })
      setSettings(updated)
    } catch (error) {
      console.error('[SettingsPage] 保存主题模式失败:', error)
    }
  }

  const handleThemeStyleChange = async (value: ThemeStyle | undefined) => {
    setThemeStyle(value)
    try {
      const updated = await webAPI.updateSettings({ themeStyle: value })
      setSettings(updated)
    } catch (error) {
      console.error('[SettingsPage] 保存主题风格失败:', error)
    }
  }

  const handleSendShortcutChange = async (value: boolean) => {
    setSendWithCmdEnter(value)
    try {
      const updated = await webAPI.updateSettings({ sendWithCmdEnter: value })
      setSettings(updated)
    } catch (error) {
      console.error('[SettingsPage] 保存发送快捷键失败:', error)
    }
  }

  const handleChannelSaved = (channel: Channel) => {
    setChannels((prev) => {
      const exists = prev.some((c) => c.id === channel.id)
      if (exists) {
        return prev.map((c) => (c.id === channel.id ? channel : c))
      }
      return [...prev, channel]
    })
  }

  const handleChannelDeleted = (id: string) => {
    setChannels((prev) => prev.filter((c) => c.id !== id))
  }

  const defaultAgentChannel = channels.find((c) => c.id === defaultAgentChannelId)
  const defaultAgentModels = defaultAgentChannel?.models.filter((m) => m.enabled) ?? []

  const handleDefaultAgentChannelChange = async (channelId: string) => {
    const nextChannelId = channelId || undefined
    setDefaultAgentChannelId(nextChannelId)
    setDefaultAgentModelId(undefined)
    try {
      const updated = await webAPI.updateSettings({ defaultAgentChannelId: nextChannelId, defaultAgentModelId: undefined })
      setSettings(updated)
    } catch (error) {
      console.error('[SettingsPage] 保存默认 Agent 渠道失败:', error)
    }
  }

  const handleDefaultAgentModelChange = async (modelId: string) => {
    const nextModelId = modelId || undefined
    setDefaultAgentModelId(nextModelId)
    try {
      const updated = await webAPI.updateSettings({ defaultAgentModelId: nextModelId })
      setSettings(updated)
    } catch (error) {
      console.error('[SettingsPage] 保存默认 Agent 模型失败:', error)
    }
  }

  const handleDefaultAgentWorkspaceChange = async (workspaceId: string) => {
    const nextWorkspaceId = workspaceId || undefined
    setDefaultAgentWorkspaceId(nextWorkspaceId)
    try {
      const updated = await webAPI.updateSettings({ defaultAgentWorkspaceId: nextWorkspaceId })
      setSettings(updated)
    } catch (error) {
      console.error('[SettingsPage] 保存默认 Agent 工作区失败:', error)
    }
  }

  const handleDefaultAgentPermissionModeChange = async (mode: MAProPermissionMode) => {
    setDefaultAgentPermissionMode(mode)
    try {
      const updated = await webAPI.updateSettings({ defaultAgentPermissionMode: mode })
      setSettings(updated)
    } catch (error) {
      console.error('[SettingsPage] 保存默认 Agent 权限模式失败:', error)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">设置</h1>
        <p className="text-sm text-slate-500 mt-1">管理你的个人档案、界面偏好与 AI 渠道</p>
      </div>

      {message && (
        <div className={`px-4 py-2 rounded-lg text-sm ${message.includes('失败') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      {/* 用户档案 */}
      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <User className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">用户档案</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">用户名</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.currentTarget.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">头像</label>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-2xl">
                {avatar.startsWith('data:image') ? (
                  <img src={avatar} alt="avatar" className="w-full h-full rounded-full object-cover" />
                ) : (
                  avatar || '🧑‍💻'
                )}
              </div>
              <input
                type="text"
                value={avatar}
                onChange={(e) => setAvatar(e.currentTarget.value)}
                placeholder="输入 emoji 或图片 URL"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <button
            onClick={handleSaveProfile}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存档案'}
          </button>
        </div>
      </section>

      {/* 外观 */}
      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">外观</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">主题模式</label>
            <div className="flex flex-wrap gap-2">
              {THEME_MODES.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => handleThemeModeChange(mode.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    themeMode === mode.value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">主题风格</label>
            <select
              value={themeStyle}
              onChange={(e) => handleThemeStyleChange(e.currentTarget.value as ThemeStyle)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {THEME_STYLES.map((style) => (
                <option key={style.value} value={style.value}>
                  {style.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* 渠道管理 */}
      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Plug className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">AI 渠道</h2>
        </div>
        <ChannelManager channels={channels} onSaved={handleChannelSaved} onDeleted={handleChannelDeleted} />
      </section>

      {/* Agent 默认设置 */}
      <section className="bg-white rounded-xl border border-slate-200 p-6" data-testid="agent-settings-section">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">Agent 默认设置</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">默认渠道</label>
            <select
              value={defaultAgentChannelId ?? ''}
              onChange={(e) => handleDefaultAgentChannelChange(e.currentTarget.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">系统默认</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name} ({PROVIDER_LABELS[channel.provider]})
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">创建新 Agent 会话时默认使用的渠道</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">默认模型</label>
            <select
              value={defaultAgentModelId ?? ''}
              onChange={(e) => handleDefaultAgentModelChange(e.currentTarget.value)}
              disabled={!defaultAgentChannel || defaultAgentModels.length === 0}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">{defaultAgentChannel ? '使用渠道默认模型' : '请先选择默认渠道'}</option>
              {defaultAgentModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">在默认渠道中优先使用的模型</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">默认工作区</label>
            <select
              value={defaultAgentWorkspaceId ?? ''}
              onChange={(e) => handleDefaultAgentWorkspaceChange(e.currentTarget.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">系统默认</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">创建新 Agent 会话时默认关联的工作区</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">默认权限模式</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(Object.keys(MAPRO_PERMISSION_MODE_CONFIG) as MAProPermissionMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleDefaultAgentPermissionModeChange(mode)}
                  className={`px-3 py-2 rounded-lg text-sm border text-left transition-colors ${
                    defaultAgentPermissionMode === mode
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                  }`}
                >
                  <span className="font-medium">{MAPRO_PERMISSION_MODE_CONFIG[mode].label}</span>
                  <p className={`text-xs mt-0.5 ${defaultAgentPermissionMode === mode ? 'text-blue-100' : 'text-slate-500'}`}>
                    {MAPRO_PERMISSION_MODE_CONFIG[mode].description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 通用 */}
      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Keyboard className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">通用</h2>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={sendWithCmdEnter}
            onChange={(e) => handleSendShortcutChange(e.currentTarget.checked)}
            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-slate-700">使用 Cmd/Ctrl + Enter 发送消息</span>
        </label>
      </section>

      {/* 桌面端功能提示 */}
      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Monitor className="w-5 h-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">桌面端功能</h2>
        </div>
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Web 端为轻量访问入口，以下系统级能力仅在桌面端提供，Web 端不暴露相关设置项：
          </p>
          <ul className="list-disc list-inside space-y-1 pl-1">
            <li>屏幕截图与消息卡片导出</li>
            <li>全局快捷键（除发送消息快捷键外）</li>
            <li>语音听写与 ASR 输入</li>
            <li>系统托盘 / Dock 角标 / 本地通知</li>
            <li>主窗口状态、标签页恢复等桌面级持久化</li>
          </ul>
          <p className="text-xs text-slate-400">
            如需使用这些功能，请下载 MAPro 桌面版。
          </p>
        </div>
      </section>
    </div>
  )
}

interface ChannelManagerProps {
  channels: Channel[]
  onSaved: (channel: Channel) => void
  onDeleted: (id: string) => void
}

function ChannelManager({ channels, onSaved, onDeleted }: ChannelManagerProps) {
  const [editing, setEditing] = React.useState<Channel | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">管理 AI 供应商连接与模型列表</p>
        <button
          onClick={() => {
            setEditing(null)
            setIsCreating(true)
          }}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          新建渠道
        </button>
      </div>

      {channels.length === 0 ? (
        <p className="text-sm text-slate-400">暂无渠道，点击上方按钮创建。</p>
      ) : (
        <div className="space-y-2">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-slate-300"
            >
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${channel.enabled ? 'bg-green-500' : 'bg-slate-300'}`} />
                <div>
                  <p className="text-sm font-medium text-slate-900">{channel.name}</p>
                  <p className="text-xs text-slate-500">
                    {PROVIDER_LABELS[channel.provider]} · {channel.models.length} 个模型
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setEditing(channel)
                    setIsCreating(false)
                  }}
                  className="px-2 py-1 text-xs text-slate-600 hover:text-blue-600 border border-slate-200 rounded"
                >
                  编辑
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`确定删除渠道「${channel.name}」？`)) return
                    try {
                      await webAPI.deleteChannel(channel.id)
                      onDeleted(channel.id)
                    } catch (error) {
                      console.error('[ChannelManager] 删除失败:', error)
                    }
                  }}
                  className="px-2 py-1 text-xs text-slate-600 hover:text-red-600 border border-slate-200 rounded"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(isCreating || editing) && (
        <ChannelDialog
          channel={editing}
          onClose={() => {
            setIsCreating(false)
            setEditing(null)
          }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

interface ChannelDialogProps {
  channel: Channel | null
  onClose: () => void
  onSaved: (channel: Channel) => void
}

function ChannelDialog({ channel, onClose, onSaved }: ChannelDialogProps) {
  const isEdit = !!channel
  const [name, setName] = React.useState(channel?.name ?? '')
  const [provider, setProvider] = React.useState<ProviderType>(channel?.provider ?? 'openai')
  const [baseUrl, setBaseUrl] = React.useState(channel?.baseUrl ?? '')
  const [apiKey, setApiKey] = React.useState('')
  const [enabled, setEnabled] = React.useState(channel?.enabled ?? true)
  const [models, setModels] = React.useState<ChannelModel[]>(channel?.models ?? [])
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [fetching, setFetching] = React.useState(false)
  const [statusMessage, setStatusMessage] = React.useState('')

  React.useEffect(() => {
    if (!baseUrl && PROVIDER_DEFAULT_URLS[provider]) {
      setBaseUrl(PROVIDER_DEFAULT_URLS[provider])
    }
  }, [provider, baseUrl])

  const handleFetchModels = async () => {
    setFetching(true)
    setStatusMessage('')
    try {
      const result = await webAPI.fetchModels({ provider, baseUrl, apiKey })
      if (result.success && result.models.length > 0) {
        setModels(result.models)
        setStatusMessage(`拉取成功：${result.models.length} 个模型`)
      } else {
        setStatusMessage(result.message || '拉取失败')
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '拉取失败')
    } finally {
      setFetching(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setStatusMessage('')
    try {
      let result
      if (isEdit && channel) {
        result = await webAPI.testChannel(channel.id)
      } else {
        result = await webAPI.testChannelDirect({ provider, baseUrl, apiKey })
      }
      setStatusMessage(`${result.success ? '连接成功' : '连接失败'}：${result.message}`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '测试失败')
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim() || !baseUrl.trim()) {
      setStatusMessage('名称和 Base URL 必填')
      return
    }

    setSaving(true)
    setStatusMessage('')
    try {
      const payload: ChannelCreateInput = {
        name: name.trim(),
        provider,
        baseUrl: baseUrl.trim(),
        apiKey,
        models: models.length > 0 ? models : [{ id: 'default', name: '默认模型', enabled: true }],
        enabled,
      }

      const saved = isEdit
        ? await webAPI.updateChannel(channel!.id, { ...payload, apiKey: apiKey || undefined })
        : await webAPI.createChannel(payload)

      onSaved(saved)
      onClose()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-slate-900">
          {isEdit ? '编辑渠道' : '新建渠道'}
        </h3>

        {statusMessage && (
          <div className={`px-3 py-2 rounded-lg text-xs ${statusMessage.includes('成功') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {statusMessage}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">供应商</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.currentTarget.value as ProviderType)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.currentTarget.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              placeholder={isEdit ? '留空表示不修改' : ''}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.currentTarget.checked)}
              className="w-4 h-4 rounded border-slate-300 text-blue-600"
            />
            <span className="text-sm text-slate-700">启用</span>
          </label>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-700">模型列表</label>
              <button
                onClick={handleFetchModels}
                disabled={fetching || !apiKey}
                className="text-xs text-blue-600 hover:text-blue-700 disabled:text-slate-400"
              >
                {fetching ? '拉取中…' : '从供应商拉取'}
              </button>
            </div>
            {models.length === 0 ? (
              <p className="text-xs text-slate-400">暂无模型，可点击上方拉取或保存后自动添加默认模型。</p>
            ) : (
              <div className="space-y-1 max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2">
                {models.map((model) => (
                  <label key={model.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={model.enabled}
                      onChange={(e) => {
                        setModels((prev) =>
                          prev.map((m) => (m.id === model.id ? { ...m, enabled: e.currentTarget.checked } : m))
                        )
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600"
                    />
                    <span className="text-slate-700">{model.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-3 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
