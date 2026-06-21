/**
 * FilePreviewDialog - 内联文本/Markdown 文件预览弹窗
 *
 * 用于在应用内直接预览产物文件内容，不需要打开外部编辑器。
 */
import * as React from 'react'
import { X, FileText, Copy, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface FilePreviewDialogProps {
  filePath: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FilePreviewDialog({ filePath, open, onOpenChange }: FilePreviewDialogProps): React.ReactElement {
  const [content, setContent] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!filePath || !open) {
      setContent('')
      setError('')
      return
    }

    setLoading(true)
    setError('')
    window.electronAPI
      .readFileContent(filePath)
      .then((result) => {
        if (result.error) {
          setError(result.error)
        } else {
          setContent(result.content)
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false))
  }, [filePath, open])

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      toast.success('已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const fileName = filePath ? filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath : ''
  const isMarkdown = fileName.toLowerCase().endsWith('.md')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b border-border flex flex-row items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={16} className="text-muted-foreground flex-shrink-0" />
            <DialogTitle className="text-sm font-semibold truncate">
              {fileName}
            </DialogTitle>
          </div>
          <div className="flex items-center gap-2">
            {content && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs"
                onClick={handleCopy}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span className="ml-1">{copied ? '已复制' : '复制'}</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => onOpenChange(false)}
            >
              <X size={14} />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              加载中...
            </div>
          ) : error ? (
            <div className="text-sm text-red-500 py-8 text-center">{error}</div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {isMarkdown ? (
                <MarkdownContent content={content} />
              ) : (
                <pre className="whitespace-pre-wrap break-words text-sm font-mono bg-muted/30 p-4 rounded-lg">
                  {content}
                </pre>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 简单的 Markdown 渲染（不引入 react-markdown，用 dangerouslySetInnerHTML） */
function MarkdownContent({ content }: { content: string }): React.ReactElement {
  const html = React.useMemo(() => {
    // 基础 Markdown 转换
    let text = content
      // 代码块
      .replace(/```([\s\S]*?)```/g, '<pre class="bg-muted/50 p-3 rounded-lg overflow-x-auto text-sm font-mono"><code>$1</code></pre>')
      // 行内代码
      .replace(/`([^`]+)`/g, '<code class="bg-muted/50 px-1 py-0.5 rounded text-sm font-mono">$1</code>')
      // 标题
      .replace(/^#{6}\s+(.+)$/gm, '<h6 class="text-sm font-semibold mt-4 mb-2">$1</h6>')
      .replace(/^#{5}\s+(.+)$/gm, '<h5 class="text-sm font-semibold mt-4 mb-2">$1</h5>')
      .replace(/^#{4}\s+(.+)$/gm, '<h4 class="text-base font-semibold mt-4 mb-2">$1</h4>')
      .replace(/^#{3}\s+(.+)$/gm, '<h3 class="text-base font-semibold mt-5 mb-2">$1</h3>')
      .replace(/^#{2}\s+(.+)$/gm, '<h2 class="text-lg font-semibold mt-6 mb-3 border-b border-border pb-1">$1</h2>')
      .replace(/^#{1}\s+(.+)$/gm, '<h1 class="text-xl font-bold mt-6 mb-4">$1</h1>')
      // 粗体
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      // 斜体
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/_([^_]+)_/g, '<em>$1</em>')
      // 无序列表
      .replace(/^\s*[-*+]\s+(.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
      // 有序列表
      .replace(/^\s*\d+\.\s+(.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
      // 链接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-primary underline">$1</a>')
      // 段落（必须在最后）
      .replace(/\n{2,}/g, '</p><p class="mt-3 mb-3 leading-relaxed">')

    // 包装成段落
    return `<p class="mt-3 mb-3 leading-relaxed">${text}</p>`
  }, [content])

  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
