/**
 * 测试用 HTTP 请求辅助函数
 *
 * 使用 node:http 原生的 request，避免 Bun fetch 在并发测试中的连接复用问题，
 * 确保每个请求独立建立 TCP 连接并显式关闭。
 */

import { request as httpRequest } from 'node:http'

export interface HttpRequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: Record<string, unknown> | string
}

export interface HttpResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  text: string
  json: Record<string, unknown>
  buffer: Buffer
}

export async function request(baseUrl: string, path: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
  const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`)
  const method = options.method ?? 'GET'
  if (method === 'GET') {
    url.searchParams.set('t', String(Date.now()))
  }

  const bodyString = options.body
    ? typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body)
    : undefined

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method,
        headers: {
          ...(bodyString ? { 'Content-Type': 'application/json' } : {}),
          'Connection': 'close',
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        res.on('end', () => {
          const buffer = Buffer.concat(chunks)
          const text = buffer.toString('utf-8')
          const contentType = res.headers['content-type']
          const isJson = typeof contentType === 'string' && contentType.includes('application/json')
          const json = isJson && text ? (JSON.parse(text) as Record<string, unknown>) : {}
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text,
            json,
            buffer,
          })
        })
      },
    )
    req.on('error', reject)
    if (bodyString) {
      req.write(bodyString)
    }
    req.end()
  })
}
