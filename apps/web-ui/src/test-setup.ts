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
globalThis.MessageEvent = window.MessageEvent as unknown as typeof globalThis.MessageEvent
globalThis.CloseEvent = window.CloseEvent as unknown as typeof globalThis.CloseEvent
globalThis.DataTransfer = window.DataTransfer as unknown as typeof globalThis.DataTransfer
