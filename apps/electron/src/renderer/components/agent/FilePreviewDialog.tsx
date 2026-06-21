/**
 * FilePreviewDialog - 内联文本/Markdown 文件预览弹窗
 *
 * 安全预览：直接显示原始文本，避免 dangerouslySetInnerHTML 导致白屏。
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b border-border flex flex-row items-center justify-between shrink-0">
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
            <pre className="whitespace-pre-wrap break-words text-sm font-mono leading-relaxed">
              {content}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
