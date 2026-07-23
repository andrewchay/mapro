# MAPro Browser Agent 使用指南：以小红书蒲公英为例

> 目标：通过 MAPro 的 Agent 模式登录小红书蒲公英（创作者服务平台），并自动抓取达人数据到本地 KOL 数据库。
>
> 适用版本：`@ma-proma/electron` 0.1.27+
>
> 相关设计文档（已归档）：`docs/archive/browser-agent-design.md`、`docs/archive/web-scraper-login-anti-crawl-plan.md`

---

## 1. 能力概述

MAPro 提供三类浏览器自动化能力：

| 模式 | 工具 | 适用场景 | 成本 | 速度 |
|------|------|----------|------|------|
| **脚本自动化** | `web_scraper` | 结构化列表页、搜索页、数据表格 | 低 | 快 |
| **认证页面获取** | `browser_fetch` | 需要登录态的页面内容抓取（替代 SDK WebFetch） | 低 | 快 |
| **受管浏览器（Web Bridge）** | `WebBridge*` 系列工具 | 复杂交互、动态页面、需要可见窗口逐步操作的场景 | 中 | 中 |

> 原 `computer_use` 浏览器视觉循环已退役（见 8.2 节）。交互式浏览器自动化由 Web Bridge 承担；桌面应用操控由 OS 级 Computer Use（macOS）承担。

建议流程：
1. **结构化数据** → 先用 `web_scraper`。
2. **登录态页面内容** → 使用 `browser_fetch`（自动复用 web-scraper 的 Profile / Cookie）。
3. **复杂动态交互** → 使用 Web Bridge 受管浏览器。
4. **固定流程反复失败** → 让 Agent 生成并保存「自定义脚本模板」。

---

## 2. 已知问题与当前限制

### 2.1 `WebFetch` 无法抓取登录态页面

SDK 内置的 `WebFetch` 只能获取公开页面，无法携带登录 Cookie，因此无法抓取蒲公英达人后台、报价页等需要登录态的内容。

**正确做法**：使用 MAPro 提供的 `browser_fetch` 工具。它会用真实浏览器（Playwright）打开页面，自动复用 web-scraper 配置中的持久 Profile 和 Cookie，从而抓取登录态内容。

---

## 3. 环境准备

### 3.1 安装 Python + Playwright

Browser Agent 依赖本地 `python3` 和 Playwright Chromium。

```bash
# 检查环境
python3 --version
python3 -c "import playwright; print(playwright.__version__)"

# 如果没有安装
pip install playwright
playwright install chromium
```

### 3.2 在 MAPro 中检查工具可用性

1. 打开 MAPro。
2. 进入 **设置 → 营销工具 → 网页爬取**。
3. 点击 **「检测环境」** 按钮。
4. 如果显示环境正常，即可使用。

---

## 4. 配置持久浏览器 Profile

持久 Profile 是登录态复用的核心。MAPro 会为每个域名自动创建独立的 Profile 目录。

### 4.1 首次登录前配置

进入 **设置 → 营销工具 → 网页爬取**：

| 配置项 | 首次登录建议 |
|--------|--------------|
| **浏览器 Profile 目录** | 保持默认。蒲公英通常对应 `~/.mapro/browser-profiles/xiaohongshu.com/` 或 `pgy.xiaohongshu.com/`。 |
| **headless 模式** | **关闭（false）**，让浏览器窗口弹出来，方便扫码/短信登录。 |
| **Cookie 文本** | 可选。如果你有 JSON/Netscape 格式的 Cookie，可粘贴作为补充。 |
| **超时时间** | 蒲公英后台加载较慢，建议设置为 **90–120 秒**。 |
| **代理** | 如有需要可配置。 |
| **User-Agent** | 一般留空使用默认。 |
| **使用系统 Chrome** | 关闭 headless 后仍被风控时，可启用并连接本机已安装的 Google Chrome。 |
| **Chrome 可执行文件路径** | 系统 Chrome 路径，macOS 典型值为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。 |
| **Chrome 远程调试端口** | 若已手动启动 Chrome 并开启 `--remote-debugging-port=9222`，填入对应端口即可通过 CDP 连接。 |
| **最小/最大操作延迟（毫秒）** | 每次点击、输入、滚动后加入随机等待。小红书/蒲公英建议 **3000–5000**。 |

> 登录完成后，关闭浏览器窗口或等待任务结束，MAPro 会自动把登录态写回 Profile。

### 4.2 登录态保存后配置

首次登录成功后，把 **headless 模式改回 true**，后续抓取任务就可以在后台无界面运行。

如果你启用了「使用系统 Chrome」，请保持 Chrome 远程调试端口可访问，或确保 Chrome 可执行文件路径正确。

### 4.3 降低反爬：系统 Chrome 与随机操作间隔

小红书/蒲公英等平台对默认 Chromium + 快速连续操作的风控较严。遇到以下情况时，建议开启反检测选项：

1. 在设置中启用 **使用系统 Chrome**：
   - 方式 A：手动启动 Chrome，带上自己的用户数据目录和远程调试端口：
     ```bash
     /Applications/Google Chrome.app/Contents/MacOS/Google Chrome \
       --remote-debugging-port=9222 \
       --user-data-dir=~/.mapro/browser-profiles/xiaohongshu.com
     ```
     然后在 MAPro 中填入 **Chrome 远程调试端口 = 9222**。
   - 方式 B：直接填写 **Chrome 可执行文件路径**，让 Playwright 使用系统 Chrome 启动新窗口。
2. 将 **最小操作延迟** 和 **最大操作延迟** 设置为 `3000` 和 `5000`（毫秒）。
3. 让 Agent 在脚本中加入自然滚动和随机停顿（环境变量 `MIN_ACTION_DELAY_MS` / `MAX_ACTION_DELAY_MS` 已自动注入）。

> 注意：系统 Chrome 和随机延迟设置同时影响 `web_scraper` 和 `browser_fetch` 两个工具。
>
> CDP 安全行为：MAPro 仅关闭任务自己打开的页面标签，不会关闭你的外部 Chrome 窗口或已有上下文，也不会向已有上下文注入额外 Cookie。

---

## 5. 首次登录蒲公英

### 5.1 在 Agent 模式下发送指令

建议用明确的指令，让 Agent 只完成登录、不执行抓取：

```text
打开小红书蒲公英后台 https://pgy.xiaohongshu.com/，
完成扫码或短信登录。
登录成功后停止任务，不要抓取数据。
```

### 5.2 会发生什么

1. Agent 调用 `web_scraper` 工具。
2. 因为 `headless=false`，会弹出一个真实的 Chromium 浏览器窗口。
3. 窗口加载蒲公英登录页。
4. 你完成扫码或短信登录。
5. 关闭浏览器窗口或等待任务结束。
6. MAPro 把 Cookie / localStorage / IndexedDB 写回到 Profile 目录。

### 5.3 验证登录态

登录态保存后，发送测试指令：

```text
用无界面模式打开小红书蒲公英后台，
检查是否已经是登录状态。
如果是登录状态，告诉我页面顶部的账号昵称。
```

如果返回已登录，说明 Profile 复用成功。

---

## 6. 日常爬取达人数据

### 6.1 单次爬取

登录态可用后，在 Agent 模式输入：

```text
在小红书蒲公英搜索「美妆」领域的达人，
粉丝量范围 1 万–10 万，
抓取前 50 个达人的：昵称、粉丝数、赞藏总量、互动率、图文报价、视频报价。
把结果保存到 KOL 数据库。
```

Agent 会：
1. 生成 Playwright Python 脚本。
2. 在沙箱 `{workspace}/scraped/{taskId}/` 中执行。
3. 保存结果到 `result.json`。
4. 如果工具配置中启用了 `importToKolDatabase`，自动导入 `kol-database.sqlite`。

### 6.2 批量 URL 爬取

也可以一次性给多个达人主页 URL：

```text
抓取以下小红书达人主页的基础数据，每个主页保存一个 result.json：
- https://www.xiaohongshu.com/user/profile/xxx
- https://www.xiaohongshu.com/user/profile/yyy
```

### 6.3 自定义输出格式

默认输出 `json`。也可以让 Agent 输出 `csv` 或 `markdown`：

```text
以 markdown 表格格式输出抓取结果。
```

> 注意：`outputFormat=markdown` 时，实际落盘文件为 `result.md`，不是 `result.markdown`。

---

## 7. 抓取登录态页面：`browser_fetch`

`browser_fetch` 是 Agent 模式下的 MCP 工具，使用真实浏览器访问页面并返回内容。它复用 **web-scraper 配置中的 Profile 和 Cookie**，因此可以抓取需要登录的页面，弥补 SDK `WebFetch` 无法携带登录态的不足。

### 7.1 典型用法

在 Agent 模式直接描述需求即可：

```text
用 browser_fetch 抓取小红书蒲公英后台的「达人合作」页面，
返回 HTML 内容，方便我查看达人列表结构。
```

```text
用 browser_fetch 抓取 https://pgy.xiaohongshu.com/xxx/xxx，
格式用 text，只取页面中的表格数据。
```

### 7.2 可用参数

| 参数 | 说明 |
|------|------|
| `url` | 目标页面 URL（必填） |
| `format` | 输出格式：`html`（默认）、`text`、`markdown` |
| `waitMs` | 页面加载后额外等待的毫秒数，用于异步渲染 |
| `selector` | CSS 选择器，命中后只返回该元素的 inner HTML |

结果会保存到 `~/.mapro/browser-fetches/{taskId}/result.{html|txt|md}`，并附带 `screenshot.png`。

### 7.3 与 `web_scraper` 的区别

- `web_scraper`：让 LLM 生成 Playwright 脚本，**提取结构化数据**（如表格、列表），适合批量抓取。
- `browser_fetch`：使用固定脚本，**快速获取页面原始内容**，适合登录态页面、需要先看页面源码再决定如何解析的场景。

---

## 8. 遇到反爬或复杂页面：处理策略

### 8.1 首选方案：脚本模板 + 固定流程

如果脚本模式失败（滑块、验证码、页面结构变化、需要多步点击），建议先让 Agent 或你本人编写一段**自定义 Playwright 脚本模板**，把登录后的固定操作流程固化下来：

```text
帮我写一个 Playwright 脚本模板，登录小红书蒲公英后，
进入「达人合作」页面，按关键词「美妆」搜索，
提取前 10 个达人的昵称、粉丝数、图文报价和视频报价。
```

模板保存后，MAPro 会优先使用模板生成脚本，而不是完全依赖 LLM 推理，稳定性更高。

### 8.2 受管浏览器：Web Bridge

如果脚本模板仍无法处理复杂页面（如动态弹窗、多步交互、需要逐步观察页面状态），可以让 Agent 使用 Web Bridge（`WebBridge*` 系列工具，仅 proma / ai-sdk runtime 提供）：

```text
这个页面结构太复杂，请用受管浏览器操作。
打开小红书蒲公英后台，完成登录，然后进入「达人合作」页面，
提取前 10 个达人的昵称和粉丝数。
```

Web Bridge 特点：
- 每个会话打开一个可见的受管 BrowserWindow（独立 session partition），或通过 CDP 连接你自己的 Chrome。
- Agent 优先读取结构化页面元素（快照、选择器）再执行点击 / 输入 / 滚动等操作。
- 安全基线：仅允许 http(s)、禁止 URL 内嵌凭据、文件上传必须经过系统文件选择器确认、下载 50MB 上限且文件名消毒后落盘 `~/.mapro/web-bridge-downloads/`、页面快照 16000 字符截断。
- 所有操作写入本地审计日志 `~/.mapro/web-bridge-audit/events.jsonl`（脱敏），可在 **设置 → 操作审计** 查询导出；**设置 → 自动化与设备控制** 可一键紧急停止全部受管浏览器。

> **已退役**：原 `computer_use` 浏览器视觉循环（截图 → LLM → 执行 action 的 Playwright 循环）已从代码库移除（服务、Chat Tool、渲染层 `ComputerUsePanel`、IPC 通道组均已删除）。如需操控桌面应用本身（非网页），使用 macOS 上的 OS 级 Computer Use（`ComputerUse*` 系列工具，需 TCC 辅助功能 + 屏幕录制授权）；当 Web Bridge 能获取结构化页面元素时，Agent 不会降级用 Computer Use 操作网页。

---

## 9. 定时/周期性抓取

如果需要定期刷新数据，可以让 Agent 创建定时任务：

```text
每天早上 9 点自动抓取小红书蒲公英上「美妆」领域达人的最新报价，
导入 KOL 数据库。
```

定时任务会持久化到 `~/.mapro/scheduled-scraping.json`，MAPro 启动后自动调度。

---

## 10. 数据落盘位置

### 10.1 工作区产物

```
{workspace}/
  scraped/
    {taskId}/
      script.py          # 执行的 Python 脚本
      result.json        # 抓取结果
      result.md          # markdown 输出格式
      screenshot.png     # 关键页面截图
      execution.log      # 执行日志

~/.mapro/
  browser-fetches/
    {taskId}/
      script.py          # browser_fetch 固定脚本
      result.html        # 页面内容（html/text/markdown）
      screenshot.png     # 页面截图
```

### 10.2 KOL 数据库

如果启用了 `importToKolDatabase: true`，数据会进入：

```
~/.mapro/kol-database.sqlite
```

可以通过 `kol-data-service` 或 Campaign 工作流中的 `ma_campaign_kol_add` 工具进一步使用。

---

## 11. 合规与风控建议

1. **遵守平台规则**：爬取前阅读小红书/蒲公英的用户协议和 `robots.txt`，只抓取你有权访问的数据。
2. **控制频率**：建议设置随机等待、限制并发、控制每日抓取量，避免触发风控。
3. **登录态会过期**：如果后续任务提示未登录，重新关闭 headless 登录一次即可。
4. **官方 API 优先**：蒲公英 OpenAPI 门槛较高（消耗额度要求），但长期稳定使用建议评估官方接口。
5. **保护隐私**：不要抓取个人隐私数据（手机号、私信、实名信息等）。

---

## 12. 常见问题

### Q1：Agent 说环境不可用怎么办？

检查 `python3` 和 `playwright` 是否安装：

```bash
python3 -c "import playwright"
playwright install chromium
```

### Q2：首次登录后仍然提示未登录？

- 确认 Profile 目录域名正确（`xiaohongshu.com` vs `pgy.xiaohongshu.com`）。
- 检查登录态是否过期，重新用 `headless=false` 登录一次。
- 蒲公英后台可能需要特定子域的 Cookie，尝试在真实浏览器登录后导出 Cookie 粘贴到设置中。

### Q3：脚本模式总是失败？

- 检查超时时间是否足够长。
- 尝试关闭 headless 观察实际页面行为。
- 让 Agent 生成并保存一段「自定义脚本模板」，把固定流程固化下来。
- 如果只需要页面内容，换用 `browser_fetch`。
- 复杂动态交互可用 Web Bridge 受管浏览器（见 8.2 节）。

### Q4：抓取结果被风控拦截？

- 降低抓取频率，增大随机操作延迟（建议 3000–5000 毫秒）。
- 启用「使用系统 Chrome」，通过 CDP 或本机 Chrome 可执行文件运行。
- 配置代理 IP。
- 使用持久 Profile + 真实浏览器行为（随机等待、滚动）。

---

## 13. 相关代码位置

| 文件 | 说明 |
|------|------|
| `apps/electron/src/main/lib/browser-automation/browser-automation-service.ts` | 脚本模式核心：`web_scraper`、`browser_fetch`、Profile/Cookie 准备、执行、重试 |
| `apps/electron/src/main/lib/browser-automation/playwright-browser-driver.ts` | Playwright Python HTTP 驱动（模式 A 脚本执行） |
| `apps/electron/src/main/lib/web-bridge-service.ts` | Web Bridge 受管浏览器：会话窗口管理、CDP 连接、安全限制 |
| `apps/electron/src/main/lib/agent-runtime/tool-impls/web-bridge-tools.ts` | `WebBridge*` 系列 Agent 工具入口 |
| `apps/electron/src/main/lib/computer-use-service.ts` | OS 级 Computer Use（macOS）：CGEvent 输入、截图、TCC 授权 |
| `apps/electron/src/main/lib/chat-tools/web-scraper-tool.ts` | `web_scraper` Chat Tool 入口 |
| `apps/electron/src/main/lib/chat-tools/browser-fetch-mcp.ts` | Agent 模式 `browser_fetch` MCP 工具入口 |
| `apps/electron/src/renderer/components/settings/ToolSettings.tsx` | 网页爬取设置面板 |
| `apps/electron/src/renderer/components/settings/AutomationSettings.tsx` | 自动化与设备控制设置面板（Computer Use 授权、紧急停止受管浏览器） |

> 已删除：`browser-automation/computer-use-service.ts`、`computer-use-controller.ts`、`computer-use-llm.ts`、`chat-tools/computer-use-tool.ts`、`computer-use-mcp.ts`、渲染层 `ComputerUsePanel`（原视觉循环实现）。

---

*最后更新：2026-07-22*
