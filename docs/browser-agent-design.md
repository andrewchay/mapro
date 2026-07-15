# MAPro Browser Agent 设计文档

> 目标：让 MAPro 具备直接控制浏览器完成信息爬取的能力。
> 文档范围：包含模式 A（脚本自动化，当前实现）和模式 B（视觉 Computer Use，未来规划）。

---

## 一、背景与目标

### 业务痛点

- KOL 投放需要大量外部数据：达人主页、粉丝画像、报价、内容互动、竞品投放笔记等
- 抖音/小红书官方 API 门槛高或不可用，很多数据只能通过浏览器获取
- 手动爬取效率低，需要反复切换工具

### 产品目标

让用户在 MAPro 内通过自然语言描述任务，即可自动：
1. 打开目标网页
2. 模拟人类浏览行为
3. 提取结构化数据
4. 保存到工作区或导入 KOL 数据库
5. 生成可审计的执行记录

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                       MAPro UI                               │
│  用户输入 → Agent 消息 → 工具调用 → 结果展示 → 下载文件      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Chat / Agent 层                             │
│  web_scraper 工具定义 → LLM 生成脚本 → 调用执行器            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│           BrowserAutomationService                           │
│  启动浏览器 → 执行脚本/视觉控制 → 截图 → 保存结果            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Playwright / Computer Use Engine                │
│  模式 A：Python 脚本    模式 B：视觉推理循环                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、模式 A：脚本自动化（Script Mode）

### 3.1 定位

- **适用场景**：结构化网站、列表页、搜索页、数据表格
- **核心优势**：速度快、成本低、结果结构化、可回放
- **实现成本**：低
- **运行方式**：AI 根据任务生成 Playwright Python 脚本，MAPro 在沙箱中执行

### 3.2 技术栈

| 组件 | 选择 | 说明 |
|------|------|------|
| 浏览器引擎 | Playwright + Chromium | 已在本机验证可用，支持 headless |
| 脚本语言 | Python | Playwright Python API 成熟，AI 生成质量高 |
| 脚本生成 | LLM（复用当前 Agent provider） | 根据网页 URL 和任务描述生成脚本 |
| 结果格式 | JSON / CSV / Markdown | 默认 JSON，可配置 |
| 沙箱 | 工作区子目录 + 超时控制 | 脚本在 `{workspace}/scraped/{taskId}/` 下运行 |

### 3.3 执行流程

```
1. 用户："抓取 https://example.com/products 前 20 个商品的名称和价格"
        ↓
2. Agent 调用 web_scraper 工具
   参数：{ url, task, outputFormat: 'json' }
        ↓
3. BrowserAutomationService 创建任务目录
   {workspace}/scraped/{taskId}/
        ↓
4. 调用 LLM 生成 Playwright Python 脚本
   输入：任务描述 + URL + 期望输出格式
   输出：可执行的 .py 文件
        ↓
5. 执行脚本（带 60s 超时）
   python3 scrape_{taskId}.py
        ↓
6. 收集结果文件 + 截图证据
   - result.json / result.csv / result.md
   - screenshot.png（关键页面截图）
   - script.py（原始脚本，便于审计）
        ↓
7. 返回摘要给 Agent
   - 抓取数量
   - 结果文件路径
   - 关键字段预览
```

### 3.4 提示词模板（脚本生成）

```
你是一名专业的 Web 爬虫工程师。请根据以下任务生成一个完整的 Python + Playwright 脚本。

任务：{task}
目标 URL：{url}
输出格式：{outputFormat}
工作目录：{workspaceDir}

要求：
1. 使用 Playwright 的同步 API
2. 使用 headless 模式
3. 等待关键元素加载完成后再操作
4. 处理分页、滚动加载等常见情况
5. 将结果保存为 {outputFile}
6. 同时保存一张最终页面截图到 {screenshotFile}
7. 添加适当的错误处理和日志输出
8. 不要访问任务无关的链接
9. 遇到验证码或登录墙时，保存当前页面截图并优雅退出

只输出可执行的 Python 代码，不要输出任何解释文字。
```

### 3.5 安全与风控约束

| 约束 | 实现 |
|------|------|
| 网络隔离 | 脚本只访问指定 URL 及其同域名链接 |
| 超时控制 | 默认 60 秒，防止无限挂起 |
| 随机时间间隔 | 每次操作后随机等待 0.5-3 秒，翻页/滚动后等待 1-4 秒，降低被反爬识别风险 |
| 文件写入限制 | 只能写入任务目录 |
| 敏感操作禁用 | 禁止下载/执行额外文件、禁止访问本地文件 |
| 审计 | 保存原始脚本、截图、执行日志 |

### 3.6 登录态与反爬支持（已实现）

针对小红书后台、蒲公英、抖音星图等需要登录态或带有反爬机制的页面，模式 A 提供以下增强能力（均已落地）：

#### 持久浏览器 Profile

- 每个域名拥有独立的 `userDataDir`（默认 `~/.mapro/browser-profiles/{hostname}/`）。
- 首次登录可关闭 `headless` 模式，在弹出的真实浏览器窗口中完成扫码/短信登录。
- 登录态（Cookie、localStorage、IndexedDB）会自动保存到 Profile，后续 `headless` 任务复用。
- 多任务并发时，系统会先把 Profile 复制到任务目录，任务成功后再写回，避免状态冲突。

#### Cookie 注入

- 支持在设置面板中粘贴 Cookie：
  - Playwright 格式的 JSON Cookie 数组
  - Netscape `cookies.txt` 格式
- Cookie 会在创建浏览器上下文后通过 `context.add_cookies()` 注入，作为 Profile 的补充。

#### 反检测参数

- 启动参数加入 `--disable-blink-features=AutomationControlled`。
- 设置常见 viewport（1280x800）、locale（zh-CN）、timezone（Asia/Shanghai）。
- 支持自定义 User-Agent 和代理服务器。
- 生成脚本的提示词中强制要求随机等待、限制翻页速度、遇到验证码优雅退出。

#### 环境检查

- 工具可用性 `isWebScraperAvailable()` 会真实检查 `python3` 和 `playwright` Python 包。
- 设置页提供「检测环境」按钮，缺失时给出安装命令。

### 3.7 失败处理

- 脚本执行超时：返回超时信息 + 已保存的截图
- 元素未找到：返回错误 + 页面截图供人工判断
- 反爬拦截：返回截图，提示用户切换视觉模式
- 数据为空：返回截图，让 LLM 分析原因并尝试重试

---

## 四、模式 B：视觉 Computer Use（Vision Mode）

### 4.1 定位

- **适用场景**：复杂交互页面、强反爬、验证码、需要人类式判断的页面
- **核心优势**：自适应强、能处理视觉元素、接近人类操作
- **实现成本**：高
- **运行方式**：AI 接收浏览器截图，输出鼠标/键盘操作，形成观察-思考-行动循环

### 4.2 技术栈

| 组件 | 选择 | 说明 |
|------|------|------|
| 视觉推理模型 | Anthropic Claude Computer Use API | 当前最成熟的 Computer Use API |
| 浏览器控制 | Playwright + Chromium | 执行模型输出的点击/输入/滚动 |
| 截图服务 | Playwright page.screenshot | 每次操作前截图 |
| 动作执行 | Playwright 鼠标/键盘 API | 坐标映射、点击、输入、滚动 |
| 循环控制 | Observation → LLM → Action → Observation | 直到任务完成或达到最大步数 |

### 4.3 执行流程

```
1. 用户："帮我在抖音星图里搜索美妆达人并筛选粉丝 10-50w 的"
        ↓
2. Agent 调用 browser_agent_vision 工具
   参数：{ url, task, maxSteps: 30 }
        ↓
3. BrowserAutomationService 启动浏览器并打开 URL
        ↓
4. 循环（最多 maxSteps 步）：
   a. 截图当前页面
   b. 将截图 + 任务 + 历史动作传给 Claude Computer Use
   c. 模型返回下一步动作（click/type/scroll/wait/finish）
   d. 执行动作
   e. 如果 finish，退出循环并提取数据
        ↓
5. 保存结果 + 完整操作日志 + 关键截图
        ↓
6. 返回摘要给 Agent
```

### 4.4 动作空间

```ts
type Action =
  | { type: 'click'; x: number; y: number }
  | { type: 'double_click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string }
  | { type: 'scroll'; x: number; y: number; scrollX?: number; scrollY: number }
  | { type: 'wait'; ms: number }
  | { type: 'screenshot' }
  | { type: 'finish'; answer: string; data?: unknown }
```

### 4.5 UI 设计

视觉模式需要专门的 UI：

- **左侧**：实时截图流（每次操作后更新）
- **右侧**：
  - 任务目标
  - 动作历史（时间线）
  - 当前步骤 / 总步骤
  - 提取的数据预览
- **底部**：
  - 暂停/继续按钮
  - 下一步按钮（人工逐步审批）
  - 终止按钮
  - 截图缩放控制

### 4.6 成本与限制

| 维度 | 评估 |
|------|------|
| API 成本 | 每步都需要上传截图，成本是脚本模式的 10-50 倍 |
| 速度 | 每步 3-10 秒，复杂任务可能需要几十步 |
| 准确率 | 对标准网页高，对复杂 SPA 可能需要调试 |
| 合规 | 需遵守目标网站 robots.txt 和服务条款 |

### 4.7 与模式 A 的关系

```
用户请求
   ↓
模式 A 尝试（脚本生成 + 执行）
   ↓ 成功？
  是 → 返回结果
   ↓ 否（反爬/复杂交互）
提示用户："检测到复杂页面，是否切换到视觉模式？"
   ↓ 用户确认
模式 B 接管
```

---

## 五、数据落盘与后续处理

### 5.1 文件组织

```
{workspace}/
  scraped/
    {taskId}/
      script.py          # 生成的脚本
      result.json        # 提取结果
      result.csv         # 如需要
      screenshot.png     # 关键截图
      execution.log      # 执行日志
      har/               # 可选：网络请求记录
```

### 5.2 与 KOL 数据库联动

抓取到的 KOL 数据可以：
1. 直接导入 `kol-database.sqlite`
2. 生成 CSV 供用户确认后导入
3. 作为 Campaign 的 KOL 候选池数据源

### 5.3 与 Campaign 工作流联动

在 13 步 Campaign 工作流中：
- 步骤 10 `search_kols` 可调用 Browser Agent 抓取真实 KOL 数据
- 步骤 11 `add_to_pool` 可将抓取结果导入候选池
- 内容追踪模块可用 Browser Agent 自动回收已发布内容数据

---

## 六、实现路线图

### Phase 1：模式 A MVP（1-2 周）

- [x] 实现 `BrowserAutomationService`
- [x] 实现 `web_scraper` Chat 工具
- [x] 接入 Chat 工具执行流程
- [x] 支持 JSON/Markdown 输出
- [ ] 运行 3-5 个真实爬取案例（待手动验证小红书后台等登录态页面）
- [x] 添加基础安全约束（超时、目录隔离）
- [x] 持久浏览器 Profile + Cookie 注入 + 反检测参数（见 3.6 节，已落地）
- [x] 前端配置面板（`ToolSettings` 的「网页爬取」设置区）
- [x] 真实环境检查（`checkPythonAndPlaywright` + 「检测环境」按钮）

### Phase 2：模式 A 增强（2-3 周）

- [ ] 支持批量 URL 爬取
- [ ] 支持定时/周期性爬取
- [ ] 添加任务重试机制
- [ ] 支持自定义脚本模板
- [ ] 与 KOL 数据库直接对接

### Phase 3：模式 B 视觉控制（4-6 周）

- [ ] 接入 Anthropic Computer Use API
- [ ] 实现观察-思考-行动循环
- [ ] 开发视觉模式专用 UI
- [ ] 实现人工审批流程
- [ ] A/B 测试模式 A vs 模式 B 的效果与成本

---

## 七、风险与注意事项

1. **法律合规**：爬取数据需遵守目标网站 robots.txt 和用户协议，避免抓取个人隐私数据
2. **平台反爬**：抖音、小红书等平台有严格的反爬机制，可能需要配合代理、Cookie、验证码处理
3. **成本控制**：视觉模式成本高昂，建议仅用于模式 A 失败的场景
4. **稳定性**：网页结构变化会导致脚本失效，需要定期维护和重跑
5. **安全性**：执行 AI 生成的脚本存在风险，必须限制文件/网络访问范围

---

## 八、相关文件

| 文件 | 说明 |
|------|------|
| `apps/electron/src/main/lib/browser-automation/browser-automation-service.ts` | 模式 A 核心：脚本生成、Profile/Cookie 准备、环境变量注入、超时与结果收集 |
| `apps/electron/src/main/lib/chat-tools/web-scraper-tool.ts` | web_scraper Chat 工具：元数据、工具定义、可用性检查、执行入口 |
| `apps/electron/src/main/lib/chat-tool-config.ts` | Chat 工具配置（`~/.mapro/chat-tools.json` 读写，web-scraper 默认启用） |
| `apps/electron/src/main/lib/chat-tool-registry.ts` | Chat 工具注册表（web-scraper 已注册） |
| `apps/electron/src/main/ipc.ts` | `TEST_TOOL` 通道支持 web-scraper 环境检测 |
| `apps/electron/src/renderer/components/settings/ToolSettings.tsx` | 「网页爬取」设置面板（Profile/Cookie/headless/代理/UA/超时/环境检测） |
| `apps/electron/src/main/lib/__tests__/web-scraper.test.ts` | 单元/集成测试（Profile 目录、Cookie 解析、环境检查缓存、环境变量注入） |
| `docs/web-scraper-login-anti-crawl-plan.md` | 登录态与反爬落地计划（Phase 1 已实现） |

