/**
 * 前端文件工具
 *
 * 提供 File → base64、文件大小格式化等通用函数。
 */

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // result 格式为 data:{mime};base64,{data}，只取 base64 数据部分
      const base64 = result.split(',')[1]
      if (base64) {
        resolve(base64)
      } else {
        reject(new Error('FileReader 结果格式异常'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
