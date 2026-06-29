import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { useAtom } from 'jotai'
import { App } from './App.tsx'
import { settingsAtom } from './store/settings-atoms.ts'
import { webAPI } from './api/web-api.ts'
import './index.css'

/**
 * 主题初始化器
 *
 * 根据 settings.themeMode 在 <html> 上切换 dark 类，并监听系统主题变化。
 */
function ThemeInitializer({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useAtom(settingsAtom)

  React.useEffect(() => {
    // 初始加载设置
    webAPI.getSettings().then((loaded) => {
      setSettings(loaded)
    }).catch((error) => {
      console.error('[ThemeInitializer] 加载设置失败:', error)
    })
  }, [setSettings])

  React.useEffect(() => {
    const root = document.documentElement
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    function applyTheme() {
      const mode = settings.themeMode
      if (mode === 'dark') {
        root.classList.add('dark')
      } else if (mode === 'light') {
        root.classList.remove('dark')
      } else if (mode === 'system') {
        if (mediaQuery.matches) {
          root.classList.add('dark')
        } else {
          root.classList.remove('dark')
        }
      } else {
        // 'special' 默认也按 dark 处理
        root.classList.add('dark')
      }
    }

    applyTheme()

    if (settings.themeMode === 'system') {
      mediaQuery.addEventListener('change', applyTheme)
      return () => mediaQuery.removeEventListener('change', applyTheme)
    }
  }, [settings.themeMode])

  return <>{children}</>
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <ThemeInitializer>
        <App />
      </ThemeInitializer>
    </React.StrictMode>,
  )
}
