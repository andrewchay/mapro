/**
 * PlaywrightBrowserDriver
 *
 * 基于 Playwright Python 的 BrowserDriver 实现。
 * 通过启动一个本地 Python HTTP 服务控制浏览器，支持持久 Profile、Cookie 注入、代理和 User-Agent。
 */

import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  mkdirSync,
  existsSync,
  rmSync,
  cpSync,
  writeFileSync,
} from 'node:fs'
import { getConfigDir } from '../config-paths.ts'
import {
  parseCookiesText,
  type ScraperCookie,
} from './browser-automation-service.ts'
import type {
  ComputerUseOptions,
  BrowserDriver,
} from './computer-use-types.ts'

export const PYTHON_SERVER_SCRIPT = `import base64
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from playwright.sync_api import sync_playwright

HEADLESS = os.environ.get('HEADLESS', 'true') == 'true'
USER_DATA_DIR = os.environ.get('USER_DATA_DIR', '') or None
COOKIES_FILE = os.environ.get('COOKIES_FILE', '') or None
PROXY = os.environ.get('PROXY', '') or None
USER_AGENT = os.environ.get('USER_AGENT', '') or None

playwright = None
browser = None
context = None
page = None


def init_browser():
    global playwright, browser, context, page
    playwright = sync_playwright().start()
    args = ['--disable-blink-features=AutomationControlled']
    viewport = {'width': 1280, 'height': 800}

    proxy = {'server': PROXY} if PROXY else None

    if USER_DATA_DIR:
        context = playwright.chromium.launch_persistent_context(
            USER_DATA_DIR,
            headless=HEADLESS,
            args=args,
            viewport=viewport,
            locale='zh-CN',
            timezone_id='Asia/Shanghai',
            proxy=proxy,
        )
    else:
        browser = playwright.chromium.launch(
            headless=HEADLESS,
            args=args,
            proxy=proxy,
        )
        context = browser.new_context(
            viewport=viewport,
            locale='zh-CN',
            timezone_id='Asia/Shanghai',
        )

    if COOKIES_FILE and os.path.exists(COOKIES_FILE):
        try:
            with open(COOKIES_FILE, 'r', encoding='utf-8') as f:
                cookies = json.load(f)
            if cookies:
                context.add_cookies(cookies)
        except Exception as e:
            print(f'[playwright-driver] 注入 Cookie 失败: {e}', file=sys.stderr)

    if USER_AGENT:
        context.set_extra_http_headers({'User-Agent': USER_AGENT})

    page = context.new_page()


def close_browser():
    global page, context, browser, playwright
    try:
        if page:
            page.close()
    except Exception:
        pass
    page = None
    try:
        if context:
            context.close()
    except Exception:
        pass
    context = None
    try:
        if browser:
            browser.close()
    except Exception:
        pass
    browser = None
    try:
        if playwright:
            playwright.stop()
    except Exception:
        pass
    playwright = None


class Handler(BaseHTTPRequestHandler):
    server_instance = None

    def log_message(self, format, *args):
        # 关闭默认访问日志，避免污染 stdout/stderr
        pass

    def _send_json(self, status, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def do_GET(self):
        try:
            if self.path == '/health':
                self._send_json(200, {'ok': True})
            elif self.path == '/screenshot':
                raw = page.screenshot(full_page=False, type='png')
                self._send_json(200, {'base64': base64.b64encode(raw).decode('utf-8')})
            else:
                self._send_json(404, {'error': 'not found'})
        except Exception as e:
            self._send_json(500, {'error': str(e)})

    def do_POST(self):
        try:
            data = self._read_body()
            path = self.path

            if path == '/goto':
                page.goto(data['url'], wait_until='networkidle')
            elif path == '/click':
                page.mouse.click(int(data['x']), int(data['y']))
            elif path == '/type':
                page.keyboard.type(str(data['text']))
            elif path == '/scroll':
                dx = int(data['dx'])
                dy = int(data['dy'])
                page.evaluate(f'window.scrollBy({dx}, {dy})')
            elif path == '/key':
                page.keyboard.press(str(data['key']))
            elif path == '/wait':
                page.wait_for_timeout(int(data['ms']))
            elif path == '/close':
                close_browser()
                self._send_json(200, {'ok': True})
                threading.Thread(target=self.server_instance.shutdown).start()
                return
            else:
                self._send_json(404, {'error': 'not found'})
                return

            self._send_json(200, {'ok': True})
        except Exception as e:
            self._send_json(500, {'error': str(e)})


def find_port():
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def main():
    init_browser()
    port = find_port()
    server = HTTPServer(('127.0.0.1', port), Handler)
    Handler.server_instance = server
    print(f'PORT {port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
`

function getDriverRootDir(): string {
  const dir = join(getConfigDir(), 'computer-use-driver')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function createDriverTaskDir(): string {
  const taskId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const dir = join(getDriverRootDir(), taskId)
  mkdirSync(dir, { recursive: true })
  return dir
}

async function waitForPort(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`等待 Playwright 驱动服务启动超时（${timeoutMs}ms）`))
    }, timeoutMs)

    const onData = (data: Buffer) => {
      output += data.toString('utf-8')
      const match = output.match(/PORT (\d+)/)
      if (match) {
        if (settled) return
        settled = true
        cleanup()
        resolve(Number(match[1]))
      }
    }

    const onError = (err: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const onClose = (code: number | null) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`Playwright 驱动进程已退出（退出码 ${code ?? 'unknown'}）`))
    }

    const cleanup = () => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      child.off('error', onError)
      child.off('close', onClose)
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', onError)
    child.on('close', onClose)
  })
}

async function httpRequest(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = 60_000,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })

    const text = await response.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }

    if (!response.ok) {
      const errorMessage = (data as { error?: string }).error ?? `HTTP ${response.status}`
      throw new Error(`浏览器操作失败: ${errorMessage}`)
    }

    return data
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 基于 Playwright Python 的真实浏览器驱动
 */
export class PlaywrightBrowserDriver implements BrowserDriver {
  private taskDir: string
  private sourceProfileDir?: string
  private taskProfileDir?: string
  private cookiesPath?: string
  private process?: ChildProcess
  private baseUrl?: string
  private options?: ComputerUseOptions
  private closed = false
  private initTimeoutMs = 60_000

  constructor(taskDir?: string) {
    this.taskDir = taskDir ?? createDriverTaskDir()
  }

  async init(options: ComputerUseOptions): Promise<void> {
    this.options = options
    this.initTimeoutMs = options.timeoutMs ?? 60_000

    // 准备 Profile：复制到任务目录以避免并发修改
    if (options.userDataDir) {
      this.sourceProfileDir = options.userDataDir
      this.taskProfileDir = join(this.taskDir, 'profile')
      if (existsSync(this.sourceProfileDir)) {
        try {
          cpSync(this.sourceProfileDir, this.taskProfileDir, { recursive: true })
        } catch (error) {
          console.warn('[PlaywrightDriver] 复制 Profile 失败，将直接使用源目录:', error)
          this.taskProfileDir = this.sourceProfileDir
        }
      } else {
        mkdirSync(this.taskProfileDir, { recursive: true })
      }
    }

    // 准备 Cookie 文件
    if (options.cookies) {
      const cookies = parseCookiesText(options.cookies)
      if (cookies.length > 0) {
        this.cookiesPath = join(this.taskDir, 'cookies.json')
        writeFileSync(this.cookiesPath, JSON.stringify(cookies as ScraperCookie[], null, 2), 'utf-8')
      }
    }

    const serverPath = join(this.taskDir, 'server.py')
    writeFileSync(serverPath, PYTHON_SERVER_SCRIPT, 'utf-8')

    const env: Record<string, string> = {
      ...process.env,
      HEADLESS: options.headless === false ? 'false' : 'true',
      USER_DATA_DIR: this.taskProfileDir ?? '',
      COOKIES_FILE: this.cookiesPath ?? '',
      PROXY: options.proxy ?? '',
      USER_AGENT: options.userAgent ?? '',
    }

    const child = spawn('python3', [serverPath], {
      cwd: this.taskDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process = child

    try {
      const port = await waitForPort(child, this.initTimeoutMs)
      this.baseUrl = `http://127.0.0.1:${port}`
      // 简单健康检查
      await httpRequest(this.baseUrl, 'GET', '/health', undefined, 10_000)
    } catch (error) {
      this.killProcess()
      throw error
    }
  }

  async goto(url: string): Promise<void> {
    await this.post('/goto', { url })
  }

  async click(x: number, y: number): Promise<void> {
    await this.post('/click', { x, y })
  }

  async type(text: string): Promise<void> {
    await this.post('/type', { text })
  }

  async scroll(dx: number, dy: number): Promise<void> {
    await this.post('/scroll', { dx, dy })
  }

  async key(key: string): Promise<void> {
    await this.post('/key', { key })
  }

  async wait(ms: number): Promise<void> {
    await this.post('/wait', { ms })
  }

  async screenshot(): Promise<string> {
    const data = (await this.get('/screenshot')) as { base64: string }
    return data.base64
  }

  async finish(): Promise<void> {
    this.writeBackProfile()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    try {
      if (this.baseUrl) {
        await httpRequest(this.baseUrl, 'POST', '/close', {}, 5_000)
      }
    } catch {
      // 服务可能已关闭，忽略
    }

    this.writeBackProfile()
    this.killProcess()
  }

  private async post(path: string, body: unknown): Promise<void> {
    if (!this.baseUrl) {
      throw new Error('浏览器驱动未初始化')
    }
    await httpRequest(this.baseUrl, 'POST', path, body, this.options?.timeoutMs ?? 60_000)
  }

  private async get(path: string): Promise<unknown> {
    if (!this.baseUrl) {
      throw new Error('浏览器驱动未初始化')
    }
    return httpRequest(this.baseUrl, 'GET', path, undefined, this.options?.timeoutMs ?? 60_000)
  }

  private writeBackProfile(): void {
    if (!this.sourceProfileDir || !this.taskProfileDir) return
    if (this.sourceProfileDir === this.taskProfileDir) return
    if (!existsSync(this.taskProfileDir)) return
    try {
      cpSync(this.taskProfileDir, this.sourceProfileDir, { recursive: true, force: true })
    } catch (error) {
      console.warn('[PlaywrightDriver] 写回 Profile 失败:', error)
    }
  }

  private killProcess(): void {
    if (!this.process) return
    try {
      this.process.kill('SIGTERM')
    } catch {
      // ignore
    }
    this.process = undefined
  }
}
