# AGENTS.md

This file provides guidance to Claude (claude.ai/code) when working with code in this repository.

**重要提示：**
- 当功能发生变化时，请保持此文件和 `README.md` 同步更新。请更新文档以反映当前状态，但是需要经过我的允许后再修改。
- 所有的注释和日志优先采用中文，保留必要的专业术语部分。
- 所有的依赖包的安装都要先进行搜索，综合判断依赖采用的版本，而不是默认采用某个版本。
- 状态管理上我们全部采用 Jotai 来实现。
- 这是个开源项目，本地存储优先，善用配置文件优于大部分默认采用 localstorage；除 Campaign / KOL 等需要关系查询的业务数据使用 SQLite 外，其余配置/会话/工作区仍采用 JSON / JSONL 文件方案。
- 保证充分的组件化以及人类的可读性，每次完成改动后都要思考这一点，运行@code-simplifier 来简化优化代码，保持简单直接不过渡设计的风格。
- 在 UI 设计上采用更现代的方案，UI 组件推荐采用 ShadcnUI，在合适的情况下，用卡片和阴影取代边框，用符合主题的饱满色彩，设置界面要设置背景，为未来做不同主题留下空间。
- 采用 BDD 行为驱动开发的方案。

## 项目概述

MAPro 是一个集成通用 AI Agent 的下一代人工智能软件，采用 Electron 桌面应用架构。

## Monorepo 结构

Bun workspace monorepo：

```
proma-v2/
├── packages/
│   ├── shared/     # 共享类型、IPC 通道常量、配置、工具函数 (v0.1.30)
│   ├── core/       # AI Provider 适配器、代码高亮服务 (v0.2.9)
│   ├── ui/         # 共享 React UI 组件 (CodeBlock, MermaidBlock) (v0.1.3)
│   └── server/     # 服务端共享业务逻辑与跨平台抽象 (v0.1.39)
└── apps/
    ├── electron/   # Electron 桌面应用 (v0.1.23)
    │   └── src/
    │       ├── main/       # 主进程 + 服务层 (main/lib/)
    │       ├── preload/    # IPC 上下文桥接
    │       └── renderer/   # React UI (Vite + Tailwind + Radix UI)
    ├── web/        # Web 服务端入口 (Express + WebSocket) (v0.1.33)
    └── web-ui/     # Web 端 React SPA (v0.1.32)
```

**包命名规范**：`@ma-proma/*` 作用域（`@ma-proma/core`、`@ma-proma/shared`、`@ma-proma/ui`、`@ma-proma/server`、`@ma-proma/electron`）

**依赖管理**：package.json 中使用 `workspace:*` 引用内部包

### 包职责详解

#### @ma-proma/shared (v0.1.30)
- **导出模块**：`./types`、`./config`、`./utils`、`./constants/permission-rules`
- **关键类型**：`AgentMessage`、`ChatMessage`、`Channel`、`PermissionRequest`、`FeishuConfig`、`Campaign`、`ContentAudit`
- **依赖**：无运行时依赖（仅 TypeScript）

#### @ma-proma/core (v0.2.9)
- **导出模块**：`./providers`、`./highlight`、`./types`、`./utils`
- **关键功能**：Provider 适配器注册表、代码高亮（Shiki）
- **依赖**：`@ma-proma/shared`、`shiki`
- **Peer 依赖**：`@anthropic-ai/claude-agent-sdk`、`@anthropic-ai/sdk`、`@modelcontextprotocol/sdk`

#### @ma-proma/ui (v0.1.3)
- **关键组件**：共享 React UI 组件库
- **依赖**：`@ma-proma/core`、`beautiful-mermaid`、`shiki`、Radix UI
- **Peer 依赖**：`react@^18.3.0`、`react-dom@^18.3.0`

#### @ma-proma/server (v0.1.39)
- **导出模块**：`./campaign`、`./chat`、`./context`、`./db`、`./files`、`./kol`、`./secrets`、`./transport`
- **关键功能**：
  - `CampaignRepository` / `CampaignQueryService` / `CampaignCommandService`：Campaign 项目 CRUD 与业务协调
  - `CampaignWorkflowService`：13 步标准工作流状态机（JSON 持久化、Workspace 文件同步）
  - `CampaignArtifactValidator`：产物校验引擎（目录/文件/字数/语义锚点）与 Agent 兜底落盘
  - `ContentAuditRepository` / `ContentAuditService`：内容审核 SQLite 持久化与 LLM 三维度评分
  - `KOLDatabaseRepository`：KOL 主数据库访问
  - `createDbProvider()`：根据 `MAPRO_DB_TYPE` / `MAPRO_DATABASE_URL` 切换 SQLite / PostgreSQL
  - `SqliteMigrationService`：SQLite 数据库导出/导入与数据目录迁移
  - 跨平台抽象：`DbProvider`（`SqliteDbProvider` / `PostgresDbProvider`）、`FileProvider`、`SecretsStore`、`RendererTransport`
- **依赖**：`@ma-proma/shared`、`@ma-proma/core`、`better-sqlite3`、`pg`

#### @ma-proma/web (v0.1.33)
- **职责**：Web 服务端入口，基于 Express + WebSocket 暴露 REST / WS API
- **关键模块**：
  - `routes/campaign.ts`：Campaign / KOL 候选池 / Brief / 内容审核 / 内容追踪 / 13 步工作流 REST 路由；已接入 `createDbProvider()`，支持 SQLite / PostgreSQL
  - `routes/channels.ts` / `routes/settings.ts` / `routes/attachments.ts` / `routes/workspace-files.ts`：通用 REST 路由
  - `websocket/index.ts`：Chat 与 Agent 的 WebSocket 处理器
  - `agent/agent-orchestrator.ts`：与 Electron 共享同一套 Agent 编排逻辑的服务端实现
  - `security.ts`：CORS、API Token、本地 Origin 保护
- **依赖**：`@ma-proma/server`、`@ma-proma/shared`、`@ma-proma/core`

#### @ma-proma/web-ui (v0.1.19)
- **职责**：Web 端 React SPA，复用 Electron 渲染层交互设计
- **关键模块**：
  - `api/platform-api.ts` / `web-api.ts`：`PlatformAPI` 抽象与 REST 实现，自动携带 Bearer Token
  - `api/agent-websocket-client.ts`：按 `sessionId` 隔离的 Agent WebSocket 客户端
  - `pages/CampaignDetailPage.tsx`：Campaign 详情 + KOL 候选池 + 内容追踪
  - `components/CampaignBriefDialog.tsx` / `ContentAuditDialog.tsx` / `ContentTrackingManager.tsx`
  - `components/agent/PermissionBanner.tsx` / `AskUserBanner.tsx` / `ExitPlanModeBanner.tsx`
- **依赖**：`@ma-proma/shared`、`@ma-proma/ui`、`@ma-proma/core`、Jotai、Radix UI、Tailwind CSS

#### @ma-proma/electron (v0.1.23)
- **职责**：Electron 桌面应用主体，集成所有包
- **关键依赖**：
  - `@anthropic-ai/claude-agent-sdk@0.3.143` - Agent SDK
  - `@larksuiteoapi/node-sdk` - 飞书集成
  - Radix UI、TipTap、Tailwind CSS
  - 文件解析：`pdf-parse`、`officeparser`、`word-extractor`

## 常用命令

```bash
# 开发模式（推荐 - 自动启动 Vite + Electron + 热重载）
bun run dev

# 手动开发模式（调试时更稳定）
# 终端 1: cd apps/electron && bun run dev:vite
# 终端 2: cd apps/electron && bun run dev:electron

# 构建并运行
bun run electron:start

# 仅构建
bun run electron:build

# 类型检查（所有包）
bun run typecheck

# 单包类型检查
cd packages/core && bun run typecheck

# 测试（使用 --isolate 避免 mock.module 跨测试文件泄漏）
bun test --isolate

# 打包分发
cd apps/electron
bun run dist:mac      # macOS
bun run dist:win      # Windows
bun run dist:linux    # Linux
bun run dist:fast     # 当前架构快速打包
```

### Electron 构建脚本（`apps/electron/` 目录下）

```bash
bun run build:main        # esbuild → dist/main.cjs
bun run build:preload     # esbuild → dist/preload.cjs
bun run build:renderer    # Vite → dist/renderer/
bun run build:resources   # 复制 resources/ 到 dist/
bun run generate:icons    # 生成应用图标
```

## 运行时环境

使用 Bun 代替 Node.js/npm/pnpm：

- `bun install` 安装依赖，`bun run <script>` 运行脚本
- `bun test --isolate` 运行测试（使用 `--isolate` 让每个测试文件拥有独立全局对象，避免 `mock.module` 跨文件泄漏；内置测试运行器，`import { test, expect } from "bun:test"`）
- Bun 自动加载 .env 文件（无需 dotenv）
- 优先使用 Bun 原生 API：`Bun.file` > `node:fs`，`Bun.$\`command\`` > `execa`

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| **运行时** | Bun | 1.2.5+ |
| **语言** | TypeScript | 5.0.0+ |
| **桌面框架** | Electron | 39.8.10 |
| **前端框架** | React | 18.3.1 |
| **状态管理** | Jotai | 2.17.1 |
| **UI 组件** | Radix UI | 最新 |
| **样式** | Tailwind CSS | 3.4.17 |
| **富文本编辑器** | TipTap | 3.19.0 |
| **代码高亮** | Shiki | 3.22.0 |
| **Markdown** | React Markdown | 10.1.0 |
| **图表** | Beautiful Mermaid | 最新 |
| **数学公式** | KaTeX | 0.16+ |
| **构建工具** | Vite | 6.0.3 |
| **打包工具** | esbuild | 0.24.0+ |
| **分发工具** | Electron Builder | 25.1.8 |
| **Agent SDK** | @anthropic-ai/claude-agent-sdk | 0.3.143 |
| **飞书 SDK** | @larksuiteoapi/node-sdk | 最新 |

## 核心架构

### IPC 通信模式（最重要的架构模式）

类型定义 → 主进程处理 → Preload 桥接 → 渲染进程调用：

1. **类型 & 常量**：`@ma-proma/shared` 定义 IPC 通道名称常量和请求/响应类型
2. **主进程处理**：`main/ipc.ts`（57KB）注册 `ipcMain.handle()` 处理器，调用 `main/lib/` 服务
3. **Preload 桥接**：`preload/index.ts` 通过 `contextBridge.exposeInMainWorld` 暴露类型安全的 API
4. **渲染进程**：通过 `window.electronAPI.*` 调用，Jotai atoms 中封装调用逻辑

添加新 IPC 通道时，需要同步修改这四个位置。

#### 主要 IPC 通道组

- `IPC_CHANNELS` - 基础通道（运行时、Git、环境）
- `CHANNEL_IPC_CHANNELS` - 渠道管理
- `CHAT_IPC_CHANNELS` - Chat 功能
- `AGENT_IPC_CHANNELS` - Agent 功能
- `ENVIRONMENT_IPC_CHANNELS` - 环境检查
- `PROXY_IPC_CHANNELS` - 代理设置
- `SYSTEM_PROMPT_IPC_CHANNELS` - 系统提示词
- `MEMORY_IPC_CHANNELS` - 记忆功能
- `CHAT_TOOL_IPC_CHANNELS` - Chat 工具
- `FEISHU_IPC_CHANNELS` - 飞书集成
- `CAMPAIGN_IPC_CHANNELS` - Campaign 项目管理（Campaign / KOL 候选池 / Brief / 工作流）
- `CONTENT_AUDIT_IPC_CHANNELS` - 内容审核
- `CONTENT_TRACKING_IPC_CHANNELS` - 内容数据追踪（KOL 内容数据回收、投流分析、性能分级）
- `KOL_DATA_IPC_CHANNELS` - KOL 数据管理
- `GITHUB_RELEASE_IPC_CHANNELS` - GitHub 发布

### 主进程服务层（`main/lib/`）

#### 核心服务

| 服务 | 职责 |
|------|------|
| `agent-orchestrator.ts` | Agent 核心编排层（71KB）：并发守卫、渠道查找、环境变量构建、SDK 路径解析、消息持久化、事件流处理、错误处理、自动标题生成 |
| `agent-session-manager.ts` | Agent 会话管理：SDK 消息持久化、会话元数据 CRUD、JSONL 存储 |
| `agent-prompt-builder.ts` | Agent 系统提示词构建（18KB）：动态上下文构建、内置 Agent 构建、工作区上下文注入 |
| `agent-permission-service.ts` | Agent 权限管理：工具权限检查、权限模式管理 |
| `agent-ask-user-service.ts` | Agent 用户交互：AskUser 请求处理 |
| `agent-exit-plan-service.ts` | Agent 退出计划服务 |
| `agent-workspace-manager.ts` | 工作区管理（16KB）：MCP Server 配置、Skills 配置、工作区 CRUD |
| `chat-service.ts` | Chat 流式调用编排（20KB）：Provider 适配器集成、消息持久化、AbortController |
| `conversation-manager.ts` | 对话管理（13KB）：对话 CRUD、JSONL 消息存储、置顶、上下文分割 |
| `channel-manager.ts` | 渠道管理（16KB）：渠道 CRUD、API Key AES-256-GCM 加密（safeStorage）、连接测试、模型获取 |

#### 集成服务

| 服务 | 职责 |
|------|------|
| `feishu-bridge.ts` | 飞书集成（68KB）：消息同步、任务通知、OAuth 认证 |
| `dingtalk-bridge.ts` / `dingtalk-bridge-manager.ts` | 钉钉集成：机器人桥接、消息同步 |
| `wechat-bridge.ts` | 微信集成：机器人桥接入口 |
| `memory-service.ts` | 记忆管理：跨会话记忆存储与检索 |
| `memos-client.ts` | Memos 客户端：笔记服务集成 |

#### Campaign 业务服务（fork 后新增）

| 服务 | 职责 |
|------|------|
| `campaign-manager.ts` | Campaign 项目数据服务：SQLite 存储（`~/.mapro/campaign-database.sqlite`）、Campaign CRUD、KOL 候选池、Brief、阶段推进、内容审核、KOL 数据库连接（双引擎适配 `bun:sqlite` / `better-sqlite3`） |
| `campaign-workflow-service.ts` | Campaign 13 步工作流状态机（Electron 本地实现）：工作流 JSON 持久化、标准产物目录管理、语义锚点校验（`artifactRequirements` + `minArtifactLength`）、兜底落盘、执行历史（`history.md`）、`todo.md` 同步 |
| `agent-workspace-manager.ts` | Agent 工作区 CRUD、默认营销工作区初始化（`ensureDefaultWorkspace`）、默认 Skills 同步、`chat-tools.json` 预配置（含 KOL Data MCP 默认启用） |
| `ma-tools/` | MA 营销工具集（17 个 Chat Tool）：strategy-iq、match-ai、connect-bot、creative-pilot、script-studio、kol-search、kol-crm、kol-portal、kol-data-mcp、kol-data-service、campaign-agent、campaign-optimizer、campaign-tester、content-audit、llm-service 等，通过 `ChatToolMeta` + `ToolDefinition` 注册到 Chat 模式 |

#### 工具与文件

| 服务 | 职责 |
|------|------|
| `chat-tools/` | Chat 工具实现目录：内置工具函数（含 `web-scraper-tool.ts` 网页爬取工具） |
| `browser-automation/` | 浏览器自动化：基于 Playwright Python 的脚本生成与执行（模式 A），支持持久 Profile、Cookie 注入、反检测参数、代理、headless 控制、真实环境检查（`checkPythonAndPlaywright`） |
| `ma-tools/` | MA 营销工具集：19 个营销相关 Chat Tool（见上方 Campaign 业务服务） |
| `workspace-watcher.ts` | 工作区文件监听：文件系统变化监控 |
| `chat-tools-watcher.ts` | Chat 工具监听：工具配置变化监控 |
| `attachment-service.ts` | 附件管理：存储/读取/删除、文件对话框 |
| `document-parser.ts` | 文档解析：PDF/Office/文本文件提取 |
| `file-preview-service.ts` | 文件预览：产物文件内联预览 |
| `git-diff-service.ts` | Git Diff：差异展示服务 |
| `screenshot-service.ts` | 截图服务：屏幕截图能力 |

#### 系统服务

| 服务 | 职责 |
|------|------|
| `runtime-init.ts` | 运行时初始化：Shell 环境、Bun、Git 检测（`bun-finder.ts`、`git-detector.ts`、`shell-env.ts`） |
| `config-paths.ts` | 配置路径管理：`~/.mapro/` 目录结构 |
| `user-profile-service.ts` | 用户档案持久化 |
| `settings-service.ts` | 应用设置持久化（主题等） |
| `voice-dictation-window.ts` / `doubao-asr-service.ts` | 语音听写：豆包 ASR 集成、独立听写窗口 |
| `quick-task-window.ts` | 快速任务窗口：全局快捷键唤起的轻量任务面板 |
| `global-shortcut-service.ts` | 全局快捷键：注册与管理 |
| `text-insertion-service.ts` / `text-output-service.ts` | 文本插入/输出：跨应用文本输入支持 |
| `migration-service.ts` | 迁移服务：旧版本数据迁移 |
| `tray-menu-model.ts` / `dock-badge-service.ts` | 系统托盘 + Dock 角标 |
| `installer-downloader.ts` / `installer-manifest.ts` | 安装包下载：在线更新安装包 |
| `local-file-protocol.ts` | 本地文件协议：`app://` 自定义协议 |
| `updater/` | 自动更新：Electron Updater 集成 |

### AI Provider 适配器（`packages/core/src/providers/`）

基于适配器模式的多 Provider 支持，通过注册表统一管理：

#### 核心架构
- `ProviderAdapter` 接口：定义统一的 `sendMessage()` 流式方法
- `provider-registry.ts`：Provider 注册表，按 `providerId` 查找适配器
- `sse-reader.ts`：通用 SSE 流读取器（fetch + ReadableStream）

#### 支持的 Provider

| Provider | 适配器 | API 协议 | 特性 |
|----------|--------|----------|------|
| **Anthropic** | `anthropic-adapter.ts` | Messages API | extended_thinking、多模态 |
| **OpenAI** | `openai-adapter.ts` | Chat Completions | 标准 OpenAI 协议 |
| **DeepSeek** | `anthropic-adapter.ts` | Messages API | Anthropic 兼容 |
| **智谱 AI** | `openai-adapter.ts` | Chat Completions | OpenAI 兼容 |
| **MiniMax** | `anthropic-adapter.ts` | Messages API | Anthropic 兼容 |
| **豆包** | `openai-adapter.ts` | Chat Completions | OpenAI 兼容 |
| **通义千问** | `openai-adapter.ts` | Chat Completions | OpenAI 兼容 |
| **Google** | `google-adapter.ts` | Generative Language API | Gemini 系列 |
| **Custom** | `openai-adapter.ts` | Chat Completions | 自定义 OpenAI 兼容端点 |

#### 多模态支持
- **图片**：各 Provider 格式不同，适配器自动转换
- **文档**：提取文本后注入 `<file>` XML 标签

### Jotai 状态管理（`renderer/atoms/`）

| Atom 文件 | 管理的状态 |
|-----------|-----------|
| `chat-atoms.ts` | 对话列表、当前消息、流式状态（Map 结构支持多对话并行）、模型选择、上下文设置、并排模式、思考模式、待上传附件 |
| `agent-atoms.ts` | Agent 会话列表、当前会话、流式状态（`AgentStreamState`）、工作区选择、渠道选择、权限/AskUser 请求队列（按 sessionId Map） |
| `campaign-atoms.ts` | Campaign 列表、当前 Campaign ID、创建弹窗开关、Chat 会话↔Campaign / Agent 会话↔Campaign 双向映射 |
| `dingtalk-atoms.ts` / `wechat-atoms.ts` | 钉钉 / 微信桥接状态 |
| `preview-atoms.ts` | 文件预览状态（路径、开关） |
| `tab-atoms.ts` / `sidebar-atoms.ts` | 标签页 + 侧边栏状态 |
| `migration-atoms.ts` | 数据迁移状态 |
| `active-view.ts` | 主面板视图切换（'conversations' / 'settings'） |
| `app-mode.ts` | 应用模式（Chat / Agent） |
| `settings-tab.ts` | 设置面板当前标签页 |
| `theme.ts` | 主题模式（light / dark / system） |
| `user-profile.ts` | 用户档案（姓名 + 头像） |
| `updater.ts` | 自动更新状态（检查/下载/安装），优雅降级（updater 不可用时保持 idle） |

### 渲染进程组件架构（`renderer/components/`）

- **`app-shell/`**：三面板布局（LeftSidebar | NavigatorPanel | MainContentPanel），侧边栏含模式切换、置顶对话、日期分组列表、Campaign 列表、流式指示器
- **`chat/`**：聊天核心 — ChatView（消息加载/流式订阅）、ChatHeader（模型选择/上下文设置）、ChatInput（Tiptap 富文本编辑器）、ChatMessages（消息列表/自动滚动）、ParallelChatMessages（并排模式）
- **`agent/`**：Agent 模式 — AgentView（纯展示 + 交互，IPC 监听已提升到全局）、AgentHeader（渠道/模型选择）、AgentMessages（消息列表 + 工具活动）、ToolActivityItem（工具调用展示）、WorkspaceSelector（工作区切换）、PermissionBanner/AskUserBanner/ExitPlanModeBanner（权限/问答/计划审批请求 UI）；**Campaign 子模块**：CampaignList、CampaignDetail（基本信息 + 三阶段 + 候选池 + 内容追踪）、CampaignWorkflowSteps（13 步工作流执行/校验/重置）、CampaignCreateDialog、CampaignKOLImportDialog、CampaignBriefDialog、ContentAuditDialog、ContentTrackingManager、ContentTrackingList、FilePreviewDialog
- **`settings/`**：设置面板 — GeneralSettings（用户档案）、AppearanceSettings（主题）、ChannelSettings（渠道管理）、ChannelForm（Provider 配置）、AgentSettings（Agent 渠道/工作区/MCP）、McpServerForm（MCP 服务器配置）、AboutSettings（版本/更新）、FeishuSettings（飞书集成）；含 `primitives/` 可复用表单组件
- **`file-browser/`**：文件浏览器 — FileBrowser（工作区文件树浏览）
- **`diff/`**：Git Diff 展示
- **`voice-dictation/`**：语音听写窗口
- **`quick-task/`**：快速任务窗口
- **`tabs/`**：多标签页（TabContent / MainArea）
- **`onboarding/`** / **`welcome/`** / **`tutorial/`**：引导、欢迎、教程
- **`shortcuts/`**：快捷键管理
- **`scratch-pad/`**：草稿本
- **`environment/`**：环境检查
- **`migration/`**：数据迁移
- **`ai-elements/`**：AI 展示组件 — Markdown 渲染、代码块、Mermaid 图、推理折叠、上下文分割线、富文本输入
- **`ui/`**：Radix UI 组件（现代化设计，CSS 变量主题）

### 全局 Hooks（`renderer/hooks/`）

| Hook | 职责 |
|------|------|
| `useGlobalAgentListeners` | 全局 Agent IPC 监听器，在 `main.tsx` 顶层挂载，使用 `useStore()` 直接操作 atoms。处理流式事件、完成/错误、标题更新、权限请求、AskUser 请求，永不随组件卸载销毁 |
| `useBackgroundTasks` | 后台任务管理（Agent/Shell 任务的增删改查），按 sessionId 隔离 |

### 渲染进程初始化组件（`renderer/main.tsx`）

| 组件 | 职责 |
|------|------|
| `ThemeInitializer` | 从主进程加载主题设置、监听系统主题变化、同步到 DOM |
| `AgentSettingsInitializer` | 加载 Agent 渠道/模型/工作区设置、订阅 MCP/文件变化事件 |
| `AgentListenersInitializer` | 挂载 `useGlobalAgentListeners`，全局 Agent IPC 监听 |
| `UpdaterInitializer` | 订阅主进程推送的自动更新状态变化事件 |

### 本地文件存储（`~/.mapro/`）

```
~/.mapro/
├── channels.json           # 渠道配置（API Key 经 safeStorage 加密）
├── conversations.json      # 对话索引（元数据，轻量）
├── conversations/          # 消息存储
│   └── {uuid}.jsonl        # 每对话一个 JSONL 文件，追加写入
├── agent-sessions.json     # Agent 会话索引
├── agent-sessions/         # Agent 会话消息存储
│   └── {uuid}.jsonl        # 每会话一个 JSONL 文件
├── agent-workspaces/       # Agent 工作区目录
│   └── {workspace-slug}/
│       ├── {session-id}/   # 会话工作目录
│       ├── workspace-files/# 工作区持久文件
│       ├── mcp.json        # MCP Server 配置
│       └── skills/         # Skills 配置目录
├── campaign-database.sqlite # Campaign 项目数据库（Campaign / KOL 候选池 / Brief / 内容审核）
├── kol-database.sqlite      # KOL 主数据库（含 fan/engagement/content/overall_score 评分系统）
├── attachments/            # 附件文件
│   └── {conversationId}/
│       └── {uuid}.ext
├── user-profile.json       # 用户档案 { userName, avatar }
├── settings.json           # 应用设置 { themeMode }
└── sdk-config/             # Agent SDK 配置目录
    └── projects/           # SDK 项目配置
```

**关键设计**：
- JSON 配置 + JSONL 追加日志为默认存储方案，文件可移植
- Campaign / KOL 等需要关系查询的业务数据使用 SQLite，双引擎适配（Bun 环境用 `bun:sqlite`，Electron 环境用 `better-sqlite3`，见 `campaign-manager.ts:loadEngine`）
- Agent 工作区按 slug 隔离，每个会话独立目录；Campaign 工作区 slug 形如 `campaign-{id}`，内含 13 步工作流标准产物目录
- MCP 配置和 Skills 按工作区管理

## 构建工具

- **主进程/Preload**：esbuild (`--bundle --platform=node --format=cjs --external:electron --external:@anthropic-ai/claude-agent-sdk`)
- **渲染进程**：Vite + React 插件 + Tailwind CSS + HMR
- **开发热重载**：渲染进程 Vite HMR 即时生效；主进程/Preload 通过 electronmon 监听 dist 文件变化自动重启
- **打包分发**：electron-builder（配置见 `electron-builder.yml`）

### 重要：打包配置注意事项

**Agent SDK 打包要求（必须遵守）：**
- `@anthropic-ai/claude-agent-sdk` 必须使用 `--external` 参数排除在 esbuild 打包之外
- **0.2.113+ 架构变化**：SDK 主包已不再携带 JS CLI 入口（`cli.js`）和 `vendor/ripgrep/`，改为按平台分发 native binary（`claude` / `claude.exe`，单文件 214-252 MB），通过 `optionalDependencies` 安装到 `@anthropic-ai/claude-agent-sdk-{platform}-{arch}/` 子包
- `apps/electron/package.json` 必须显式声明当前 CI 矩阵覆盖的平台子包为 `optionalDependencies`（darwin-arm64 / darwin-x64 / win32-x64），否则 bun workspace 不会把它们链接到 `apps/electron/node_modules/`
- `electron-builder.yml` 的 `files` 配置要同时包含主包和所有平台子包：
  ```yaml
  files:
    - dist/**/*
    - package.json
    - node_modules/@anthropic-ai/claude-agent-sdk/**/*
    - node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/**/*
    - node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/**/*
    - node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/**/*
    - "!node_modules/@ma-proma/**"
  ```
- SDK 主包和同级平台子包会被复制到 `app/node_modules/@anthropic-ai/`，Node.js 的模块解析能从 `app/dist/main.cjs` 找到
- `agent-orchestrator.ts` 中 `resolveSDKCliPath()` 解析到 SDK 主包入口后，沿 `..` 到 `@anthropic-ai/` 同级目录，再拼 `claude-agent-sdk-${platform}-${arch}/{claude|claude.exe}` 得到 binary 路径

**跨平台打包限制：**
- optionalDependencies 的平台子包由包管理器按 `os`/`cpu` 字段筛选：Apple Silicon runner 只会装 darwin-arm64，不会装 darwin-x64（cpu 不匹配）
- 因此当前 CI（macos-latest + windows-latest）**不支持在单个 macOS runner 上同时打 arm64 + x64 DMG**
- 若要发布 darwin-x64 版本，需要在 macos-13（x64 runner）单独跑一次构建
- Windows runner 默认 x64，打 win32-x64 正常

**不使用 extraResources 放 binary 的原因：**
- `extraResources` 会将文件复制到 `Contents/Resources/` 目录，路径与 node_modules 解析不一致
- 直接使用 `files` 配置让 Node.js 的模块解析能正确找到 SDK

**修改打包配置时的检查清单：**
1. ✅ 确认 SDK 在 esbuild 中使用 `--external` 参数
2. ✅ 确认 SDK 主包 + 所有目标平台子包都在 `files` 配置中
3. ✅ 确认 `apps/electron/package.json` 的 `optionalDependencies` 列出了所有目标平台子包
4. ✅ `bun install` 后验证 `apps/electron/node_modules/@anthropic-ai/claude-agent-sdk-{platform}-{arch}/` symlink 存在且 binary 可执行
5. ✅ 本地测试打包后的应用 Agent 功能（`CSC_IDENTITY_AUTO_DISCOVERY=false bun run dist:fast`）

**其他依赖的打包策略：**
- **原则**：只有 `electron` 和 `@anthropic-ai/claude-agent-sdk` 需要标记为 `--external`
- `electron`：由 Electron 运行时提供，必须 external
- `@anthropic-ai/claude-agent-sdk`：有特殊打包要求（含 214 MB native binary），必须 external + 在 files 中包含主包和平台子包
- **所有其他依赖**（如 `electron-updater`、`undici`、`chokidar` 等）：应该让 esbuild 打包进 `main.cjs`
  - ✅ 优点：避免遗漏子依赖，简化 electron-builder 配置
  - ❌ 如果标记为 external：必须在 `electron-builder.yml` 的 `files` 中手动列出所有子依赖
- **常见错误**：将普通 npm 包标记为 external 但忘记在 `files` 中包含，导致打包后找不到模块（如 `Cannot find module 'universalify'`）

## 测试

- 运行所有测试：`bun test --isolate`（根目录）
- Web UI 组件测试依赖 `happy-dom` 提供 DOM 全局环境；`bunfig.toml` 通过 `preload` 在测试文件导入 React / `@testing-library/react` 之前完成 polyfill：
  - 根配置：`bunfig.toml` → `"./apps/web-ui/src/test-setup.ts"`
  - 包内配置：`apps/web-ui/bunfig.toml` → `"./src/test-setup.ts"`
- `apps/web-ui/src/test-setup.ts` 负责初始化 `globalThis.window / document / navigator / Event` 等 happy-dom 实例。
- Web UI 组件测试统一使用 `apps/web-ui/src/test-utils/mock-web-api.ts` 共享的 `mockWebAPI` 对象，再调用 `mock.module('../../api/web-api.ts', () => ({ webAPI: mockWebAPI }))`；这样可以避免不同测试文件的 `mock.module` 互相覆盖导致 `webAPI` 方法缺失。
- `apps/electron/src/renderer/lib/markdown-rich-text.ts` 中的 `enhanceMarkdownHtml` 会检测 `document` 是否存在；存在时才走 DOM 解析，且仅在识别到任务列表标记 `[ ]`/`[x]` 时进行解析/序列化，避免非任务列表场景下 DOM 往返改变属性转义。

## 代码风格

- 永远不要使用 `any` 类型 — 创建合适的 interface
- 对象类型优先使用 interface 而不是 type
- 尽可能使用 `import type` 进行仅类型导入
- 注释和日志采用中文，保留专业术语
- **路径别名**：`@/` → `apps/electron/src/renderer/`

## TypeScript 配置

- Module: `"Preserve"` + `"moduleResolution": "bundler"`
- JSX: `"react-jsx"`，严格模式启用，Target: ESNext
- 所有包 `"type": "module"`，导入时使用 `.ts` 扩展名

## 版本管理

提交代码时始终递增受影响包的 patch 版本（如 `0.1.18` → `0.1.19`），影响多个包则都要递增。

### 默认 Skills 版本契约（`apps/electron/default-skills/`）

修改任何 `default-skills/<skill>/` 内容时，**必须同步递增该 Skill `SKILL.md` frontmatter 的 `version` 字段**（patch +1）。

**为什么**：`seedDefaultSkills()` 与 `upgradeDefaultSkillsInWorkspaces()` 通过 semver 比较决定是否将 bundle 中的 Skill 同步到老用户的 `~/.mapro/default-skills/` 与各工作区。**version 不变 = 老用户拿不到新内容**。

**早期实现曾用"无条件 cpSync"绕开这个约束**，但每次启动同步 4MB+ 文件会阻塞主进程导致启动卡顿，已恢复为 semver 比较（见 `config-paths.ts:seedDefaultSkills`、`agent-workspace-manager.ts:upgradeDefaultSkillsInWorkspaces`）。

**新增 Skill 不需要先注入 default-skills 目录的旧版本**——`upgradeDefaultSkillsInWorkspaces` 会通过"目标缺失即注入"路径让所有老工作区自动获得。

## Agent SDK 集成架构

基于 `@anthropic-ai/claude-agent-sdk@0.3.143` 实现 Agent 模式，与 Chat 模式并行。

### 核心流程

```
用户输入 → agent-orchestrator.ts (SDK 编排)
  ↓
SDK query() → SDKMessage 流
  ↓
convertSDKMessage() → AgentEvent[]
  ↓
webContents.send() → IPC 推送
  ↓
useGlobalAgentListeners (全局监听) → store.set(atoms)
  ↓
React UI 更新
```

### 关键组件

#### agent-orchestrator.ts（核心编排层，71KB）
- **并发守卫**：同一会话不允许并行请求
- **渠道管理**：查找渠道 + API Key 解密
- **环境构建**：环境变量 + SDK 路径解析
- **消息持久化**：SDK 消息存储到 JSONL
- **事件流处理**：文本累积 + 工具调用解析
- **错误处理**：SDK 错误映射 + 重试逻辑
- **自动标题**：首次对话自动生成标题

#### agent-prompt-builder.ts（提示词构建，18KB）
- **系统提示词生成**：基于工作区配置
- **动态上下文构建**：注入工作区信息
- **内置 Agent 构建**：预定义 Agent 配置

#### agent-permission-service.ts（权限管理）
- **工具权限检查**：基于权限规则
- **权限模式管理**：safe / ask / allow-all

### 关键设计

- **SDK 调用**：`sdk.query({ prompt, options: { apiKey, model, permissionMode, cwd, abortController } })`
- **事件转换**：`convertSDKMessage()`（`@ma-proma/shared`）将 SDK 原始消息转为统一的 `AgentEvent` 类型
- **工具匹配**：`packages/shared/src/agent/tool-matching.ts` — 无状态 `ToolIndex` + `extractToolStarts` / `extractToolResults` 解析工具调用
- **状态管理**：`applyAgentEvent()` 纯函数更新 `AgentStreamState`，支持流式增量更新
- **全局 IPC 监听**：`useGlobalAgentListeners`（`renderer/hooks/`）在 `main.tsx` 顶层挂载，通过 `useStore()` 直接操作 atoms，永不销毁。确保页面切换（如设置页）时流式输出、权限请求不丢失
- **权限请求排队**：权限/AskUser 请求按 sessionId 入队到 Map atoms（`allPendingPermissionRequestsAtom` / `allPendingAskUserRequestsAtom`），不区分当前/后台会话，SDK Promise 等待用户回来响应
- **工作区隔离**：每个工作区独立的 MCP Server 配置和 cwd，Agent 会话按工作区过滤

### 权限 / 交互审批链安全约定（Web 与 Electron 行为一致）

Agent 权限请求、用户追问（AskUserQuestion）、计划模式审批（ExitPlanMode）都是会阻塞 SDK Promise 的交互点。Web 端与 Electron 端共享同一套底层权限服务，渲染层独立实现，但行为必须保持同步。

| 约定 | 说明 |
|------|------|
| **并发守卫** | 同一会话只能有一个 `handleSend` 在运行。再次发送时返回明确错误，避免覆盖 `abortController` / transport。 |
| **权限模式清理** | 请求结束后必须清理 `sessionPermissionModes`（Web）或 `activeSessions` + `sessionPermissionModes`（Electron），防止残留模式影响下一轮对话。 |
| **Plan 模式 Bash 默认拒绝** | `plan` 模式下只允许只读工具、`.md` 的 `Write/Edit`、MCP 工具；`Bash` 默认拒绝，不再维护脆弱的 Shell 命令正则白名单。 |
| **Banner 关闭 = 明确拒绝** | Electron 三个 Banner（Permission / AskUser / ExitPlanMode）的关闭按钮不再只停止 Agent，而是**先向服务端发送 `deny` / 空 `answers` 响应，再停止 Agent**，防止服务端 Promise 挂起。Web 端 Banner 关闭同理，通过 WebSocket 发送拒绝响应。 |
| **AskUser 全必填校验** | 多问题场景下，必须 `every` 个问题都有答案才允许提交，避免 `some` 导致的部分问题漏答。 |
| **会话级请求隔离** | Web 端 WebSocket 按 `sessionId` 绑定独立连接；Electron 端通过 IPC `requestId` + `sessionId` 区分，后台会话的 pending 请求不丢失。 |

### SDK 版本升级注意事项

**`@anthropic-ai/claude-agent-sdk` 0.2.113+ `options.env` 语义为"替换"**

- SDK 将 `options.env` **替换** 传递给子进程（0.2.111/0.2.112 短暂改为叠加，0.2.113 恢复替换）
- 如果传 `env` 时只给 `ANTHROPIC_*` 相关变量，子进程会丢失 `PATH` / `HOME` / `SHELL` 等关键变量，导致 SDK 调用 `npx` / `git` 等命令失败
- **正确做法**：`agent-orchestrator.ts` 的 `buildSdkEnv()` 末尾显式 `{ ...cleanEnv, ...customEnv }` 合并 `process.env`，再剥离不希望泄漏的 `ANTHROPIC_*` 变量
- **修改 `buildSdkEnv()` 时的检查清单**：
  1. ✅ 基于 `process.env` 合并，保证 PATH / HOME / SHELL 等继承到子进程
  2. ✅ 过滤掉不希望泄漏的 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_CUSTOM_HEADERS`、`ANTHROPIC_MODEL` 等
  3. ✅ 新增的 SDK 识别的环境变量必须显式加入 `sdkEnv`
- 若未来升级到后续大版本导致语义再次变化，需重新评估本加固逻辑

**关键 Breaking Changes（升级参考）**：
- `0.2.91`: `sandbox.failIfUnavailable` 默认从 `false` 变为 `true`（目前项目未使用 sandbox 选项）
- `0.2.111`: `options.env` 从"替换"变为"叠加"
- `0.2.113`:
  - `options.env` 回退为"替换"
  - **SDK 包结构重构**：删除 `cli.js`，改为平台 native binary（通过 `@anthropic-ai/claude-agent-sdk-{platform}-{arch}` optionalDependency 分发），ripgrep 编译进 binary
  - 详见上方"打包配置注意事项"段落
- `0.2.120`: `query()` 省略 `settingSources` 时默认加载所有来源（MAPro 已显式传 `['user', 'project']`，不受影响）
- `0.2.121`: `updatedMCPToolOutput` 废弃，改用 `PostToolUseHookSpecificOutput.updatedToolOutput`（适用于所有工具，不再只针对 MCP）— MAPro 未使用，不受影响
- `0.2.133`: 废弃不稳定 V2 session API（`unstable_v2_createSession` / `unstable_v2_resumeSession` / `unstable_v2_prompt`），改用 `query()`；废弃 `allowedTools` 中传 `'Skill'`，改用 `skills` 选项 — MAPro 均未使用
- `0.2.136`: 废弃 `TodoWrite` 工具，后续版本改为 Task 工具（`TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList`）。MAPro 已在 `agent-orchestrator.ts` 的 `PLAN_MODE_ALLOWED_TOOLS` 中同时声明 `TodoWrite` 与 `TaskCreate/TaskUpdate/TaskList/TaskGet`，做过渡兼容
- `0.2.141`: `@anthropic-ai/sdk` 依赖对齐到 `^0.93.0`；Task 工具类型（`TaskCreateInput/Output` 等）从 `@anthropic-ai/claude-agent-sdk/sdk-tools` 导出 — MAPro 已对齐 `^0.93.0`
- `0.3.143`（当前版本）: `@anthropic-ai/sdk` 与 `@modelcontextprotocol/sdk` 从 `dependencies` 改为 `peerDependencies`（运行时不受影响，二者已被打包；yarn classic 用户需显式安装）— MAPro 用 bun workspace，`optionalDependencies`/`dependencies` 自动安装，不受影响
- **0.3.x 系列说明**：0.3.x 未走 GitHub releases 发布（仅在 npm 发布），无独立 CHANGELOG 文件；上述 0.2.121–0.2.141 的 deprecation 在 0.3.x 中正式生效。升级 0.3.x 前应确认未使用已废弃 API

### 共享类型（`@ma-proma/shared`）

- `AgentEvent`：Agent 事件（text / tool_start / tool_result / done / error）
- `AgentSessionMeta`：会话元数据（id / title / channelId / workspaceId）
- `AgentMessage`：持久化消息（role + content blocks）
- `AgentSendInput`：发送请求输入
- `AGENT_IPC_CHANNELS`：Agent 相关 IPC 通道常量
- `WorkspaceCapabilities`：工作区能力（MCP Server 列表 + Skills 列表）
- `Campaign` / `CampaignWorkflow` / `CampaignWorkflowStep` / `CampaignKOLPoolItem` / `CampaignBrief` / `ContentAudit`：Campaign 业务类型（`types/campaign.ts`）
- `CAMPAIGN_IPC_CHANNELS` / `CONTENT_AUDIT_IPC_CHANNELS` / `KOL_DATA_IPC_CHANNELS`：Campaign 相关 IPC 通道常量

## Campaign 功能架构（fork 后新增）

Campaign 是在 Agent 模式之上构建的 **KOL 投放项目管理**高层抽象，把"品牌营销投放"这类多步骤、需产物沉淀的工作流包装成可复用项目。这是当前开发主线。

### 核心数据模型（`packages/shared/src/types/campaign.ts`）

| 实体 | 职责 |
|------|------|
| `Campaign` | 项目主体：品牌、平台（小红书/抖音/双平台）、预算、周期、目标城市/人群、3 阶段 `phasePlans`、创意策略 `creativePlan`、状态机（draft→strategy→kol_selection→negotiation→content_production→live→review→completed） |
| `CampaignKOLPoolItem` | KOL 候选池：每 Campaign 独立，状态流转 candidate→shortlisted→contacted→confirmed/rejected |
| `CampaignBrief` | 每个 KOL 一份 Markdown 合作 Brief，支持 AI 生成标记 |
| `CampaignWorkflow` | 13 步标准工作流：每步含 `agentPrompt` / `toolName` / `artifactRequirements`（语义锚点）/ `minArtifactLength` |
| `ContentAudit` | 内容审核：AI 审核 + 人工复核，4 维度评分（合规/品牌契合/质量/综合） |
| `ContentTracking` | 内容数据追踪：合作内容数据回收（曝光/浏览/点赞/收藏/评论/转发/CPM/CPE/CTR）、自然流性能判断（按价格带标准分级）、投流数据追踪与优化建议 |

### 存储架构

- `~/.mapro/campaign-database.sqlite`：Campaign + KOL 候选池 + Brief + 内容审核 + 内容数据追踪 + 数据标准基准 6 张表
- `~/.mapro/kol-database.sqlite`：KOL 主数据库（含 fan/engagement/content/overall_score 评分系统 + extended_data 达人内容分析数据：粉丝画像、赞藏比、爆文率、CPE/CPM、广告笔记占比、近10条数据趋势等）
- **双引擎适配**：Bun 环境用 `bun:sqlite`，Electron 环境用 `better-sqlite3`（`campaign-manager.ts:loadEngine` 自动选择，二者 API 对齐）
- 每步**产物文件**存到 `~/.mapro/agent-workspaces/campaign-{id}/` 下标准目录：`market-analysis/`、`competitor-analysis/`、`user-analysis/`、`brand-dna/`、`brand-concept/`、`goal-setting/`、`creative-concept/`、`platform-matrix/`、`kol-pyramid/`、`kol-search/`、`briefs/`、`ab-test/`、`.context/`（含 `todo.md` / `campaign.md` / `history.md`）

### 13 步标准工作流（`campaign-workflow-service.ts`）

```
1.  市场分析            → ma-market-analysis
2.  竞品分析            → ma-competitor-analyzer
3.  用户分析（TA画像 + 搜索习惯） → ma-ta-portrait
4.  品牌DNA + 品牌诊断  → ma-brand-dna
5.  Brand Concept 产出  → ma-brand-house
6.  目标设定            → ma-campaign-optimizer
7.  生成 Big Idea        → ma-creative-concept
8.  设计平台矩阵         → ma-platform-role-mapper
9.  设计 KOL 金字塔      → ma-kol-pyramid
10. 筛选候选达人         → kol-data/search_kols
11. 加入候选池           → ma-campaign-agent (ma_campaign_kol_add)
12. 生成达人 Brief       → ma-creative-pilot
13. 设计 A/B 测试        → ma-campaign-tester
```

每步带：模板化 `agentPrompt`（`{brand}`/`{budget}` 等变量替换）、`artifactRequirements`（语义锚点 + 最低字数 300）、产物校验、兜底落盘（Agent 只在对话输出未写文件时自动保存为 `agent-output.md`）。

### 工作流执行闭环

```
用户点"执行此步骤"
  → CampaignWorkflowSteps 标记 in_progress + 模板替换 prompt
  → onSendToAssistant 发到内嵌 Agent 面板
  → Agent 调用 ma-tool / default-skill 执行，产物写入标准目录
  → 主进程 completeStepWithValidation：
      ① 兜底落盘 materializeAssistantOutputIfNeeded
      ② 产物校验 validateStepArtifacts（目录/文件/字数/语义锚点）
      ③ 通过 → completed + appendHistory；失败 → failed
  → 渲染层 2 秒轮询刷新 workflow
  → 全部完成 → 可生成"整合方案"
```

### IPC 全链路

- **通道常量**：`CAMPAIGN_IPC_CHANNELS`（14 个）+ `CONTENT_AUDIT_IPC_CHANNELS`（4 个）+ `CONTENT_TRACKING_IPC_CHANNELS`（7 个）+ `KOL_DATA_IPC_CHANNELS`（4 个）
- **Electron 主进程**：`ipc.ts` → `campaign-manager.ts`（CRUD/候选池/Brief/审核/内容数据追踪）+ `campaign-workflow-service.ts`（工作流状态机/产物校验，本地同步实现）
- **Web 服务端**：`@ma-proma/server` 提供 `CampaignCommandService` / `CampaignWorkflowService` / `CampaignArtifactValidator`，通过 `apps/web/src/routes/campaign.ts` 暴露 REST API
- **Preload**：`window.electronAPI.listCampaigns` / `getCampaignWorkflow` / `advanceCampaignPhase` / `listContentAudits` / `listContentTracking` / `addContentTracking` 等
- **渲染层**：`campaign-atoms.ts` + `CampaignDetail` / `CampaignList` / `CampaignWorkflowSteps` / `CampaignKOLImportDialog` / `CampaignBriefDialog` / `ContentAuditDialog` / `FilePreviewDialog`

### ma-tools 营销工具集（`main/lib/ma-tools/`，19 个工具）

为 Chat 模式提供营销能力，通过 `ChatToolMeta` + `ToolDefinition` 注册：

- **策略类**：strategy-iq、creative-pilot、script-studio
- **KOL 类**：match-ai、connect-bot、kol-search、kol-crm、kol-portal、kol-data-mcp
- **Campaign 类**：campaign-agent（8 个子工具）、campaign-optimizer、campaign-tester、budget-forecast
- **内容类**：content-audit、content-tracker（内容数据回收与投流分析）
- **基础**：llm-service、kol-data-service

配套 `default-skills/` 下 12 个 `ma-*` Skill（brand-dna、brand-house、creative-concept、kol-pyramid、platform-role-mapper、campaign-tester、content-audit、competitor-analyzer、content-calendar、kol-portal、marketing、ugc-campaign 等）。

## 创作参考

遵循 [craft-agents-oss](https://github.com/craftship/craft-agents-oss) 的模式：

- **会话管理**：收件箱/归档工作流
- **权限模式**：safe / ask / allow-all
- **Agent SDK**：@anthropic-ai/claude-agent-sdk（[v1 文档](https://platform.claude.com/docs/en/agent-sdk/typescript)、[v2 文档](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)）
- **MCP 集成**：Model Context Protocol 用于外部数据源
- **凭证存储**：AES-256-GCM 加密
- **配置位置**：`~/.mapro/`（类似 `~/.craft-agent/`）

## 核心特性

### 已实现功能

- ✅ **多 Provider 支持**：Anthropic、OpenAI、DeepSeek、Kimi、智谱、MiniMax、豆包、通义千问、Google、自定义端点
- ✅ **Agent SDK 集成**：基于 Claude Agent SDK 的完整 Agent 模式
- ✅ **Campaign 项目管理**：KOL 投放项目、13 步标准工作流、产物校验、KOL 候选池、Brief 生成、内容审核、内容数据追踪（fork 后新增，详见 Campaign 功能架构段落）
- ✅ **MA 营销工具集**：19 个 ma-tools Chat Tool + 12 个 `ma-*` default Skills，覆盖品牌 DNA、TA 画像、创意概念、KOL 匹配/建联/搜索/CRM、脚本工坊、内容审核、内容数据追踪等
- ✅ **飞书集成**：消息同步、任务通知、OAuth 认证（68KB 核心服务）
- ✅ **钉钉 / 微信桥接**：机器人消息桥接入口
- ✅ **语音听写**：豆包 ASR 集成、独立听写窗口
- ✅ **工作区管理**：多工作区隔离、MCP Server 配置、Skills 管理
- ✅ **权限系统**：工具权限检查、用户确认流程
- ✅ **记忆系统**：跨会话记忆存储与检索
- ✅ **自动更新**：Electron Updater 集成
- ✅ **代理支持**：系统代理检测与配置
- ✅ **文档解析**：PDF、Office、文本文件提取
- ✅ **多模态支持**：图片、文档附件
- ✅ **Chat 工具**：内置工具系统 + 动态加载
- ✅ **网页爬取（Browser Agent 模式 A）**：基于 Playwright Python 的浏览器自动化，AI 生成脚本抓取网页数据，支持持久浏览器 Profile、Cookie 注入（JSON/Netscape）、反检测参数、代理、headless 控制、环境检测；可用于小红书后台等登录态页面抓取
- ✅ **多标签页 + 快速任务窗口**：多会话并行、全局快捷键唤起
- ✅ **数据迁移**：旧版本数据迁移支持

### 架构亮点

- **并发守卫**：同一会话防止并行请求冲突
- **全局监听**：Agent IPC 监听器永不销毁，确保后台会话不丢失
- **权限排队**：按 sessionId 隔离权限请求，支持多会话并行
- **文件监听**：工作区文件、MCP 配置、Chat 工具实时监控
- **事件流处理**：SDK 消息流式转换与累积
- **错误映射**：SDK 错误统一转换为应用错误
