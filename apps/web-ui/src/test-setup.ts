import { Window } from 'happy-dom'

const window = new Window({
  url: 'http://localhost:3000',
  settings: {
    fetch: {
      // 测试中禁用同源策略，避免 happy-dom fetch 将服务端路由测试误判为跨域
      disableSameOriginPolicy: true,
    },
  },
})

globalThis.window = window as unknown as typeof globalThis.window
globalThis.document = window.document as unknown as typeof globalThis.document
globalThis.navigator = window.navigator as unknown as typeof globalThis.navigator
globalThis.localStorage = window.localStorage as unknown as typeof globalThis.localStorage
globalThis.fetch = window.fetch.bind(window) as unknown as typeof globalThis.fetch
globalThis.HTMLElement = window.HTMLElement as unknown as typeof globalThis.HTMLElement
globalThis.HTMLInputElement = window.HTMLInputElement as unknown as typeof globalThis.HTMLInputElement
globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement as unknown as typeof globalThis.HTMLTextAreaElement
globalThis.File = window.File as unknown as typeof globalThis.File
globalThis.Event = window.Event as unknown as typeof globalThis.Event
globalThis.CustomEvent = window.CustomEvent as unknown as typeof globalThis.CustomEvent
globalThis.MessageEvent = window.MessageEvent as unknown as typeof globalThis.MessageEvent
globalThis.CloseEvent = window.CloseEvent as unknown as typeof globalThis.CloseEvent
globalThis.DataTransfer = window.DataTransfer as unknown as typeof globalThis.DataTransfer

globalThis.getComputedStyle = window.getComputedStyle.bind(window) as unknown as typeof globalThis.getComputedStyle
globalThis.matchMedia = window.matchMedia.bind(window) as unknown as typeof globalThis.matchMedia
globalThis.MutationObserver = window.MutationObserver as unknown as typeof globalThis.MutationObserver
globalThis.ResizeObserver = window.ResizeObserver as unknown as typeof globalThis.ResizeObserver
globalThis.NodeFilter = window.NodeFilter as unknown as typeof globalThis.NodeFilter

// happy-dom Window 上缺少部分原生构造函数，补齐以避免 Radix 组件内部报错
;(window as unknown as { TypeError: typeof TypeError }).TypeError = TypeError

globalThis.requestAnimationFrame = globalThis.requestAnimationFrame ?? ((callback: FrameRequestCallback) => setTimeout(callback, 16))
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame ?? ((id: number) => clearTimeout(id))
