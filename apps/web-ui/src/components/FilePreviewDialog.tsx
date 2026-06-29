import { X, Download } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface PreviewContent {
  type: 'text' | 'base64'
  content?: string
  data?: string
  mediaType?: string
}

export interface FilePreviewDialogProps {
  isOpen: boolean
  onClose: () => void
  title: string
  fileName?: string
  content: PreviewContent | null
}

function isImage(mediaType: string): boolean {
  return mediaType.startsWith('image/')
}

function isPdf(mediaType: string): boolean {
  return mediaType === 'application/pdf'
}

function isMarkdown(fileName: string, mediaType?: string): boolean {
  return fileName.toLowerCase().endsWith('.md') || mediaType === 'text/markdown'
}

function isTextual(mediaType?: string): boolean {
  if (!mediaType) return false
  return (
    mediaType.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType === 'application/xml' ||
    mediaType === 'application/javascript'
  )
}

function buildDataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`
}

export function FilePreviewDialog({ isOpen, onClose, title, fileName = '', content }: FilePreviewDialogProps) {
  if (!isOpen || !content) return null

  const mediaType = content.mediaType || 'application/octet-stream'
  const isMd = isMarkdown(fileName, mediaType)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
            {fileName && (
              <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">{fileName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-6">
          {content.type === 'text' && isMd && (
            <div className="prose prose-neutral max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.content || ''}</ReactMarkdown>
            </div>
          )}

          {content.type === 'text' && !isMd && isTextual(mediaType) && (
            <pre className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-4 text-sm text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
              {content.content}
            </pre>
          )}

          {content.type === 'base64' && isImage(mediaType) && content.data && (
            <img
              src={buildDataUrl(mediaType, content.data)}
              alt={fileName}
              className="max-w-full rounded-lg"
            />
          )}

          {content.type === 'base64' && isPdf(mediaType) && content.data && (
            <iframe
              src={buildDataUrl(mediaType, content.data)}
              title={fileName}
              sandbox="allow-same-origin"
              className="h-[70vh] w-full rounded-lg"
            />
          )}

          {content.type === 'base64' && !isImage(mediaType) && !isPdf(mediaType) && content.data && (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <p className="text-neutral-600 dark:text-neutral-300">该文件类型不支持在线预览</p>
              <a
                href={buildDataUrl(mediaType, content.data)}
                download={fileName}
                className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                <Download className="h-4 w-4" />
                下载文件
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
