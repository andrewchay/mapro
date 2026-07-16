/**
 * Computer Use 全局 IPC 监听器
 *
 * 在应用顶层挂载，永不销毁。负责把主进程的实时事件写入 Jotai atoms，
 * 驱动 ComputerUsePanel 的截图、动作历史、状态变化。
 */

import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { computerUsePanelOpenAtom, computerUseTaskAtom, reduceComputerUseEvent } from '@/atoms/computer-use-atoms'

export function useGlobalComputerUseListeners(): void {
  const setPanelOpen = useSetAtom(computerUsePanelOpenAtom)
  const setTask = useSetAtom(computerUseTaskAtom)

  useEffect(() => {
    const cleanup = window.electronAPI.onComputerUseEvent((event) => {
      if (event.type === 'started') {
        setPanelOpen(true)
      }
      setTask((prev) => reduceComputerUseEvent(prev, event))
    })

    return cleanup
  }, [setPanelOpen, setTask])
}
