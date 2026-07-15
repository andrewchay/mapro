# 为 MAPro `web-scraper` 增加登录态与反爬能力

## 背景与目标

当前 `web-scraper` 工具已经能被 LLM 调用并执行，但面对小红书后台等需要登录态的页面时存在明显短板：

1. **没有登录态传递**：Playwright 以全新 headless 上下文启动，没有 Cookie / localStorage / 登录凭证。
2. **没有持久浏览器 Profile**：每次任务都是全新浏览器，登录后状态无法复用。
3. **反爬特征明显**：默认 headless、固定 UA、Playwright 自动化标志容易被识别。
4. **没有前端配置入口**：用户无法在设置里配置 Cookie、User-Agent、代理、headless 开关等。
5. **可用性检查虚设**：`isWebScraperAvailable()` 恒返回 `true`，缺少 python3 / playwright 预检。

本计划目标：在不引入外部 SaaS、不改动 LLM Provider 调用链路的前提下，让 `web-scraper` 支持**持久浏览器 Profile**、**Cookie 注入**、**反检测参数**和**前端可视化配置**，从而能够抓取小红书后台等登录态页面。

## 可选方案

### 方案 A：持久 Profile + Cookie 注入 + 反检测参数（推荐先落地）

核心思路：

- **持久 Profile（`userDataDir`）**：每个域名一个 Profile 目录（如 `~/.mapro/browser-profiles/xiaohongshu.com/`）。首次可以启动有界面浏览器让用户扫码/短信登录，后续任务复用该 Profile，登录态自然保留。
- **Cookie 注入（可选）**：在设置里提供 Cookie 文本框（支持 JSON / Netscape 格式），作为 Profile 之外的补充登录手段。
- **反检测参数**：给 Playwright 传 `--disable-blink-features=AutomationControlled`、设置常见 viewport / locale / timezone、使用正常 User-Agent、开启/关闭 headless。
- **前端配置面板**：在 `ToolSettings` 新增「网页爬取」设置区，配置 Profile 路径、Cookie、headless 开关、代理、超时等。
- **真实可用性检查**：`isWebScraperAvailable()` 通过 `spawnSync('python3', ['-c', 'import playwright'])` 等方式检查环境，缺失时标记为不可用并给出明确提示。

**适合**：小红书后台、蒲公英、公开列表页等结构相对固定的页面；实现成本低，几小时即可上线。

### 方案 B：Computer Use 视觉浏览器自动化（进阶）

在方案 A 基础上增加一个“视觉 Agent”模式，让 AI 像人一样看屏幕、决定操作：

- 启动 Playwright 浏览器后，**循环截图 → 发送给多模态 LLM → LLM 返回操作指令**（点击、输入、滚动、返回、完成等）。
- MAPro 执行操作后再截图，形成“观察-思考-行动”循环，直到任务完成或达到最大步数。
- 对小红书后台特别有用：可以自动识别“登录二维码”、“短信验证码输入框”、“达人列表”、“下一页按钮”等动态 UI，无需预先知道 DOM 结构。

**两种实现路径**：

1. **基于 Anthropic Claude Computer Use API**（如果 `@anthropic-ai/claude-agent-sdk@0.3.143` 已内置 `computer-use` 工具）。
   - 复用现有 Agent SDK 的 `computer-use` 能力，MAPro 只需提供截图和执行回调。
   - 开发量小，但强依赖 Anthropic 渠道和 SDK 版本。
2. **自研视觉 Agent 循环**（更通用）。
   - 使用任意支持视觉的 Provider（Claude、GPT-4o、Gemini 等）。
   - 定义一套 action schema：`click(x,y)`、`type(text)`、`scroll(dx,dy)`、`key(name)`、`goto(url)`、`finish(data)` 等。
   - MAPro 负责截图编码、动作执行、状态维护。
   - 开发量中等，但不绑定单一模型。

**适合**：页面结构经常变化、需要多步交互、验证码/滑块需要视觉判断的场景。

### 建议落地节奏

- **Phase 1：方案 A**（本周）。先解决 80% 的登录态 + 反爬问题，让用户能抓到小红书后台数据。
- **Phase 2：方案 B 自研视觉循环**（已实现）。当方案 A 遇到复杂动态页面或频繁风控时，可切换或叠加 `computer_use` 能力。

## 关键改动文件

| 文件 | 改动内容 |
|------|----------|
| `apps/electron/src/main/lib/chat-tools/web-scraper-tool.ts` | 读取 credentials，传入 `ScrapingTaskOptions`，定义可用性检查 |
| `apps/electron/src/main/lib/browser-automation/browser-automation-service.ts` | 接收 `ScrapingTaskOptions`，生成带 Profile / Cookie / 反检测 / 代理的 Python 脚本，超时、错误、截图逻辑增强 |
| `apps/electron/src/main/lib/chat-tool-config.ts` | 默认 credentials 占位；`computer-use` 默认启用 |
| `apps/electron/src/main/lib/chat-tool-registry.ts` | 已注册 `web-scraper` 与 `computer-use` |
| `apps/electron/src/main/ipc.ts` | 增加 `testChatTool('web-scraper')` / `testChatTool('computer-use')` 处理 |
| `apps/electron/src/preload/index.ts` | 已暴露 API，无需再改 |
| `apps/electron/src/renderer/components/settings/ToolSettings.tsx` | 新增 `WebScraperSettings` + `ComputerUseSettings` 组件 |
| `apps/electron/src/main/lib/chat-tools/computer-use-tool.ts` | Chat 模式 `computer_use` 工具入口 |
| `apps/electron/src/main/lib/chat-tools/computer-use-mcp.ts` | Agent 模式 `computer_use` MCP Server 注入 |
| `apps/electron/src/main/lib/browser-automation/computer-use-service.ts` | 自研视觉循环服务 |
| `apps/electron/src/main/lib/browser-automation/computer-use-llm.ts` | 多模态 LLM caller |
| `apps/electron/src/main/lib/browser-automation/playwright-browser-driver.ts` | Playwright Python 浏览器驱动 |
| `apps/electron/src/main/lib/ma-tools/llm-service.ts` | 扩展 vision 内容部分 |
| `packages/shared/src/types/chat-tool.ts` | 如有需要，补充 `WebScraperCredentials` / `ComputerUseCredentials` 类型（可选） |
| `docs/browser-agent-design.md` | 更新设计文档，记录登录态、反爬与 Computer Use 能力 |

## 详细实现步骤

### Phase 1：方案 A（脚本自动化增强）

#### 1. 扩展 `ScrapingTaskInput` / 新增 `ScrapingTaskOptions`

在 `browser-automation-service.ts` 中：

```ts
export interface ScrapingTaskOptions {
  userDataDir?: string      // 持久 Profile 目录
  cookies?: string          // JSON / Netscape 格式 Cookie 文本
  headless?: boolean        // 默认 true
  proxy?: string            // http://user:pass@host:port
  userAgent?: string        // 自定义 UA
  timeoutMs?: number        // 任务超时，默认 60s
}
```

`executeScrapingTask(input, options)` 接收 options，并通过环境变量注入 Python 脚本：

- `USER_DATA_DIR`
- `COOKIES_FILE`（把 cookies 文本写入临时文件，脚本读取）
- `HEADLESS`
- `PROXY`
- `USER_AGENT`

### 2. 生成脚本提示词增强

在 `generateScrapingScript` 的 system prompt 中追加：

- 若 `USER_DATA_DIR` 存在，使用 `browser.launch_persistent_context(USER_DATA_DIR, ...)`；否则 `browser.new_context()`。
- 若 `COOKIES_FILE` 存在，在 `context.add_cookies(json.load(...))` 注入。
- 根据 `HEADLESS` 环境变量设置 `headless`。
- 设置 `viewport={"width": 1280, "height": 800}`、`locale='zh-CN'`、`timezone_id='Asia/Shanghai'`。
- 启动参数加入 `--disable-blink-features=AutomationControlled`。
- 若 `PROXY` 存在，传入 `proxy={"server": PROXY}`。
- 若 `USER_AGENT` 存在，使用 `context.set_extra_http_headers` 或 `user_agent=USER_AGENT`。

### 3. `web-scraper-tool.ts` 读取凭据并传递

```ts
const credentials = getToolCredentials('web-scraper')
const result = await executeScrapingTask(
  { url, task, outputFormat },
  {
    userDataDir: credentials.userDataDir || join(getConfigDir(), 'browser-profiles', new URL(url).hostname),
    cookies: credentials.cookies,
    headless: credentials.headless !== 'false',
    proxy: credentials.proxy,
    userAgent: credentials.userAgent,
    timeoutMs: Number(credentials.timeoutMs) || 60_000,
  }
)
```

`isWebScraperAvailable()` 改为检查：

```ts
export function isWebScraperAvailable(): boolean {
  return checkPythonAndPlaywright()  // 缓存结果，避免每次同步阻塞
}
```

### 4. 前端新增 `WebScraperSettings`

在 `ToolSettings.tsx` 中新增一个设置区块，字段：

- **启用开关**（复用 `updateChatToolState`）
- **浏览器 Profile 目录**：输入框 + “打开目录”按钮 + “重置为默认”按钮
- **Cookie 文本**：多行文本框，支持 JSON / Netscape 格式， blur 保存
- **headless 模式**：Switch，默认开启；关闭后下次任务会弹出真实浏览器窗口（方便扫码登录）
- **代理**：可选输入框
- **User-Agent**：可选输入框，留空使用 Playwright 默认
- **超时时间（秒）**：数字输入
- **环境检测按钮**：调用 `testChatTool('web-scraper')` 检查 python3 / playwright

保存方式与其他工具一致：`window.electronAPI.updateChatToolCredentials('web-scraper', {...})`。

### 5. `testChatTool` 支持 web-scraper

在 `ipc.ts` 的 `TEST_TOOL` handler 中增加分支：

- 调用 `python3 --version`
- 调用 `python3 -c "import playwright; print(playwright.__version__)"`
- 返回 `{ success, message }`

### 6. 小红书后台抓取使用流程

1. 用户进入设置 → 网页爬取 → 关闭 headless → 保存。
2. 用户告诉 Agent：“打开小红书后台并登录”。
3. Agent 调用 `web_scraper`，`browser-automation-service` 启动有界面浏览器（因为 `headless=false`），加载持久 Profile。
4. 用户在弹出的浏览器窗口中完成扫码/短信登录，然后关闭窗口或等待任务结束。
5. 后续抓取任务开启 `headless=true`，复用同一个 Profile，登录态保留。
6. 如果登录态过期，可再次关闭 headless 重新登录。

### 7. 文档与默认值

- 更新 `docs/browser-agent-design.md`，补充“登录态与反爬”章节。
- 默认 Profile 目录：`~/.mapro/browser-profiles/{hostname}/`。
- 默认 headless：`true`。
- 默认超时：`60000` ms。

### Phase 2：方案 B（Computer Use 视觉浏览器自动化）

#### 1. 新增 `computer-use-service.ts`

在 `apps/electron/src/main/lib/browser-automation/` 下新增服务，职责：

- 启动 Playwright 浏览器（复用 Phase 1 的 Profile / Cookie / 反检测参数）。
- 维护浏览器 `Page` 实例。
- 提供 action 执行器：`goto(url)`、`click(x,y)`、`type(text)`、`scroll(dx,dy)`、`key(key)`、`wait(ms)`、`screenshot()`、`finish()`。
- 实现“截图 → 调用 LLM → 执行 action → 截图”循环，直到 `finish` 或达到最大步数（如 30 步）。

#### 2. 定义 Computer Use action schema

新增 `packages/shared/src/types/computer-use.ts`（或复用现有工具类型）：

```ts
export type ComputerAction =
  | { type: 'goto'; url: string }
  | { type: 'click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'scroll'; dx: number; dy: number }
  | { type: 'key'; key: string }
  | { type: 'wait'; ms: number }
  | { type: 'finish'; summary?: string }
```

#### 3. 视觉提示词

向 LLM 发送：

- 当前截图（base64 PNG）
- 任务目标
- 可用 action 列表
- 历史 action 列表
- 要求：先观察再行动，坐标使用 0-1000 归一化或实际像素。

LLM 返回 JSON：

```json
{
  "thought": "...",
  "action": { "type": "click", "x": 120, "y": 340 }
}
```

#### 4. 与 Chat / Agent 模式集成

两种入口：

- **Chat 工具**：新增 `computer_use` 工具，参数 `url`、`task`、`mode='computer-use'`。调用 `executeComputerUseTask()`。
- **Agent 模式**：在 Agent 系统提示词中说明可以调用浏览器，由 Agent 自行决定何时打开浏览器并抓取。

#### 5. 多模态 Provider 适配

- 在 `chat-service.ts` 或 `agent-orchestrator.ts` 中，调用支持 vision 的 Provider 适配器。
- 当前 Provider 适配器主要处理文本 SSE；需要确认 `anthropic-adapter.ts` / `openai-adapter.ts` 是否已支持图片输入。如不支持，需扩展 `buildStreamRequest` 以接受图片附件。
- 更简单做法：Computer Use 服务内部直接使用 Anthropic SDK 的 `computer-use` beta（若 SDK 支持），绕过通用 Provider 适配器。

#### 6. 人机协作安全

- 默认最大步数限制（如 30 步）。
- 遇到新域名或登录敏感操作时，可暂停并请求用户确认（复用现有 AskUser 机制）。
- 所有截图和操作记录保存到任务目录，便于审计。

## 风险与权衡

| 风险 | 说明 | 缓解 |
|------|------|------|
| 小红书风控升级 | 即使使用 Profile 和反检测参数，仍可能触发滑块、验证码、设备指纹风控 | 提供“关闭 headless”让用户手动完成验证；不承诺绕过所有风控 |
| Cookie 明文存储 | `chat-tools.json` 以明文 JSON 保存凭据 | 与 web-search / nano-banana 等其他工具保持一致；如后续需要加密，可统一改造 `safeStorage` 方案 |
| Python 环境依赖 | 需要用户本地安装 python3 + playwright | `isWebScraperAvailable()` 真实检查并在 UI 显示缺失项 |
| 生成脚本质量不稳定 | LLM 生成的 Python 脚本可能因页面结构变化失败 | 保留 `script.py` 和 `screenshot.png` 便于调试；错误信息返回给用户 |
| 多任务 Profile 冲突 | 同时运行多个任务共享同一个 Profile 可能冲突 | 每个任务 copy Profile 到临时目录，或按任务 ID 隔离；简单方案：任务执行前复制 Profile，写回时合并 |
| Computer Use 成本高 | 每步都要发送截图给多模态 LLM，token 和延迟显著高于脚本模式 | 设置最大步数；仅对复杂页面启用；优先使用脚本模式 |
| Computer Use 模型依赖 | 需要视觉模型支持；不同 Provider 的图片输入格式不同 | 优先支持 Anthropic Claude（官方 Computer Use），再逐步扩展到 GPT-4o / Gemini |

## 测试计划

1. **单元/集成测试**：
   - `isWebScraperAvailable()` 在 python3/playwright 缺失时返回 `false`。
   - `executeScrapingTask` 能正确把 `userDataDir`、`cookies`、`headless` 写入环境变量并生成脚本。
2. **手动测试**：
   - 抓取一个无需登录的公开页面（如豆瓣电影 Top 250），确认结构化数据返回。
   - 抓取小红书蒲公英/创作者后台列表页，验证登录态复用。
   - **Computer Use**：让 Agent “打开小红书创作者后台，进入达人合作页面，提取前 10 个达人昵称和粉丝数”，验证视觉循环能完成多步操作（Chat 与 Agent 模式均需验证）。
   - 关闭 headless，验证有界面浏览器弹出并可手动登录。
3. **类型检查**：`bun run --filter='@ma-proma/electron' typecheck`。

## 预期结果

- 设置页出现「网页爬取」配置面板。
- `web-scraper` 工具在有/无登录态场景下均可使用。
- 小红书后台等需要登录的页面，通过持久 Profile 或 Cookie 注入能够抓取。
- 环境缺失时给出明确提示，而不是运行时模糊报错。
