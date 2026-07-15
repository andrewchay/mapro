/**
 * Computer Use 视觉浏览器自动化类型定义
 *
 * 定义动作 Schema、任务输入/输出、BrowserDriver 接口和 LLM 调用接口，
 * 便于服务逻辑与具体 Playwright 实现解耦，方便单元测试。
 */

/** Computer Use 任务输入 */
export interface ComputerUseTaskInput {
  /** 起始 URL */
  url: string
  /** 任务自然语言描述 */
  task: string
  /** 最大步数限制，默认 30 */
  maxSteps?: number
}

/** Computer Use 任务选项 */
export interface ComputerUseOptions {
  /** 持久浏览器 Profile 目录 */
  userDataDir?: string
  /** Cookie 文本（JSON / Netscape） */
  cookies?: string
  /** 是否 headless，默认 true */
  headless?: boolean
  /** 代理服务器 */
  proxy?: string
  /** 自定义 User-Agent */
  userAgent?: string
  /** 单步/任务超时（毫秒），默认 60000 */
  timeoutMs?: number
  /** 任务目录（由服务层传入，驱动层可用于保存中间文件） */
  taskDir?: string
}

/** Computer Use 动作 Schema */
export type ComputerAction =
  | { type: 'goto'; url: string }
  | { type: 'click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'scroll'; dx: number; dy: number }
  | { type: 'key'; key: string }
  | { type: 'wait'; ms: number }
  | { type: 'screenshot' }
  | { type: 'finish'; summary?: string; result?: unknown }

/** Computer Use 任务结果 */
export interface ComputerUseTaskResult {
  /** 是否成功 */
  success: boolean
  /** 结果摘要 */
  summary: string
  /** 任务目录路径 */
  taskDir: string
  /** 最终截图文件相对路径 */
  screenshotFile?: string
  /** 错误信息 */
  error?: string
  /** 实际执行步数 */
  steps: number
}

/** BrowserDriver 抽象接口 */
export interface BrowserDriver {
  /** 初始化浏览器，传入任务选项 */
  init(options: ComputerUseOptions): Promise<void>
  /** 跳转到指定 URL */
  goto(url: string): Promise<void>
  /** 点击指定坐标 */
  click(x: number, y: number): Promise<void>
  /** 输入文本 */
  type(text: string): Promise<void>
  /** 滚动页面 */
  scroll(dx: number, dy: number): Promise<void>
  /** 按下键盘按键 */
  key(key: string): Promise<void>
  /** 等待指定毫秒 */
  wait(ms: number): Promise<void>
  /** 截图，返回 base64 PNG 数据（不含 data: 前缀） */
  screenshot(): Promise<string>
  /** 任务完成前的清理标记 */
  finish(): Promise<void>
  /** 关闭浏览器并释放资源 */
  close(): Promise<void>
}

/** LLM 视觉调用参数 */
export interface LLMVisionCallParams {
  /** 系统提示词 */
  systemPrompt: string
  /** 用户任务描述 */
  task: string
  /** 当前截图 base64 PNG 数据 */
  screenshotBase64: string
  /** 历史动作与思考记录 */
  history: Array<{ thought?: string; action: ComputerAction }>
}

/** LLM 视觉调用器 */
export type LLMVisionCaller = (params: LLMVisionCallParams) => Promise<{
  /** 模型思考过程 */
  thought: string
  /** 下一步动作 */
  action: ComputerAction
}>
