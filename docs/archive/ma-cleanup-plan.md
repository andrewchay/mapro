# MAPro 功能清理方案

> 将通用 AI 工作台 MAPro 改造为垂直广告营销产品，安全移除/隐藏/简化无关功能

---

## 一、清理原则

1. **基础设施不动**：Electron 框架、IPC、状态管理、核心数据流保持完整
2. **代码保留优先**：不确定的功能先"隐藏UI入口"而非删除代码，便于回滚
3. **渐进式清理**：按模块独立操作，每个模块清理后验证编译和运行
4. **营销价值判断**：保留对广告营销工作流有直接价值的功能

---

## 二、功能模块分类总览

### 2.1 基础设施层（🔵 保留，不动）

| 模块 | 文件/目录 | 说明 |
|------|----------|------|
| Electron 主进程 | `src/main/index.ts`, `ipc.ts` | 应用生命周期、IPC 注册 |
| 窗口管理 | `menu.ts`, `tray.ts` | 菜单、托盘、标题栏 |
| 多标签页系统 | `src/renderer/components/tabs/` | TabBar + TabContent + MainArea |
| 应用外壳 | `AppShell.tsx`, `LeftSidebar.tsx`, `RightSidePanel.tsx` | 三栏布局 |
| Jotai 状态管理 | `src/renderer/atoms/` | 所有 atom 定义 |
| IPC Bridge | `src/preload/index.ts` | 渲染进程与主进程通信 |
| 渠道管理 | `channel-manager.ts` | AI 模型供应商配置 |
| 对话管理 | `conversation-manager.ts`, `chat-service.ts` | Chat 会话存储和流式调用 |
| Agent 核心 | `agent-orchestrator.ts`, `agent-service.ts`, `agent-session-manager.ts` | Agent 编排、会话、SDK 调用 |
| 工作区管理 | `agent-workspace-manager.ts` | Skills、MCP、工作区文件 |
| 文件附件 | `attachment-service.ts`, `document-parser.ts` | 附件上传、解析、预览 |
| 设置服务 | `settings-service.ts`, `config-paths.ts` | 配置读写 |
| 自动更新 | `updater/` | 版本检查、下载、安装 |

### 2.2 Chat 模式（🟡 隐藏入口，保留代码）

**现状**：MAPro 是 Chat + Agent 双模式产品，左侧边栏有模式切换器。

**营销场景判断**：
- Chat 模式对营销工作流仍有价值（快速问答、轻量分析、多模型对比）
- 但不应作为**主入口**分散用户注意力
- 建议改为"辅助对话"，从主导航降级

**清理动作**：
1. **隐藏模式切换器**：`LeftSidebar.tsx` 中的 `ModeSwitcher` 组件隐藏（注释或条件渲染）
2. **默认进入 Agent 模式**：`appModeAtom` 默认值改为 `'agent'`
3. **保留 Chat 功能**：代码不动，用户仍可通过快捷键/命令打开 Chat 标签
4. **Chat 工具简化**：只保留对营销有价值的工具（见 2.4）

### 2.3 Agent 模式（🔵 保留，核心）

**现状**：Agent 模式是 MAPro 的核心差异化功能，支持工作区、Skills、MCP、文件操作。

**营销场景判断**：Agent 模式是广告营销公司的**核心工作方式**，必须保留并强化。

**保留内容**：
- Agent 会话管理、工作区隔离
- Skills 系统（包括已有的 11 个 MA Skill）
- MCP 系统（包括 KOL Data MCP Server）
- 文件操作、权限确认、计划模式
- 右侧工作区文件面板

**改造方向**：
- 默认工作区改为营销专用工作区
- Onboarding 流程改为营销场景引导
- Agent 提示词构建器增加营销上下文

### 2.4 Chat 工具（分类处理）

| 工具 | 营销价值 | 处理方式 | 涉及文件 |
|------|---------|---------|---------|
| **联网搜索** (`web-search`) | 🔵 高（竞品调研、趋势、热点） | 保留 | `chat-tools/web-search-tool.ts` |
| **记忆** (`memory`) | 🔵 高（品牌偏好、历史 Brief） | 保留 | `chat-tools/memory-tool.ts` |
| **Agent 推荐** (`agent-mode-recommend`) | 🔵 中（引导用户使用 Agent） | 保留 | `chat-tools/agent-recommend-tool.ts` |
| **Nano Banana 生图** (`nano-banana`) | 🔵 高（创意视觉、参考图） | 保留 | `chat-tools/nano-banana-tool.ts` |
| **MA 策略生成** (`ma-strategy-iq`) | 🔵 核心 | 保留并强化 | `ma-tools/strategy-iq.ts` |
| **MA KOL 匹配** (`ma-match-ai`) | 🔵 核心 | 保留并强化 | `ma-tools/match-ai.ts` |
| **MA 智能建联** (`ma-connect-bot`) | 🔵 核心 | 保留并强化 | `ma-tools/connect-bot.ts` |
| **MA 创意指导** (`ma-creative-pilot`) | 🔵 核心 | 保留并强化 | `ma-tools/creative-pilot.ts` |
| **MA KOL 搜索** (`ma-kol-search`) | 🔵 核心 | 保留并强化 | `ma-tools/kol-search.ts` |
| **MA KOL Data MCP** (`ma-kol-data-mcp`) | 🔵 核心 | 保留并强化 | `ma-tools/kol-data-mcp.ts` |

**结论**：Chat 工具全部保留，无需要删除的。

### 2.5 设置面板（分类处理）

| 设置 Tab | 营销价值 | 处理方式 | 涉及文件 |
|---------|---------|---------|---------|
| **通用设置** (`general`) | 🔵 中（通知、归档） | 简化：移除"消息悬浮置顶条"等偏开发者的选项 | `GeneralSettings.tsx` |
| **模型配置** (`channels`) | 🔵 核心 | 保留 | `ChannelSettings.tsx` |
| **提示词管理** (`prompts`) | 🟡 低（系统提示词对营销用户太技术） | 隐藏：从设置导航移除，保留代码 | `PromptSettings.tsx` |
| **代理设置** (`proxy`) | 🔵 中（国内用户需要） | 保留 | `ProxySettings.tsx` |
| **Agent 配置** (`agent`) | 🔵 核心 | 保留并改造：默认工作区改为营销工作区 | `AgentSettings.tsx` |
| **Chat 工具** (`tools`) | 🔵 核心 | 保留：但默认启用所有 MA 工具 | `ToolSettings.tsx` |
| **外观设置** (`appearance`) | 🔵 中 | 保留 | `AppearanceSettings.tsx` |
| **远程连接** (`bots`) | 🟡 中（飞书对营销团队有用，钉钉/微信可弱化） | 简化：保留飞书，隐藏钉钉/微信入口 | `BotHubSettings.tsx` |
| **MAPro 教程** (`tutorial`) | ⚪ 改造 | 改造为营销产品教程 | `TutorialViewer.tsx` |
| **快捷键管理** (`shortcuts`) | 🟡 低 | 隐藏：从设置导航移除 | `ShortcutSettings.tsx` |
| **语音输入** (`voice-input`) | 🔵 中（快速记录创意想法） | 保留 | `VoiceInputSettings.tsx` |
| **数据迁移** (`migration`) | 🟡 低 | 隐藏：从设置导航移除 | `MigrationSettings.tsx` |
| **磁盘管理** (`storage`) | 🟡 低 | 隐藏：从设置导航移除 | `StorageSettings.tsx` |
| **关于/更新** (`about`) | 🔵 中 | 保留：品牌信息改为 MAPro | `AboutSettings.tsx` |

### 2.6 远程机器人桥接（分类处理）

| 平台 | 营销价值 | 处理方式 | 涉及文件 |
|------|---------|---------|---------|
| **飞书/Lark** | 🔵 高（营销团队内部协作、客户沟通） | 保留 | `feishu-bridge.ts`, `feishu-config.ts` 等 |
| **钉钉** | 🟡 中（部分企业用） | 隐藏：从 BotHub 移除入口，保留代码 | `dingtalk-bridge.ts`, `dingtalk-config.ts` 等 |
| **微信/WeClaw** | 🟡 低（个人社交，非工作流） | 隐藏：从 BotHub 移除入口，保留代码 | `wechat-bridge.ts`, `wechat-config.ts` 等 |

### 2.7 其他功能模块（分类处理）

| 模块 | 营销价值 | 处理方式 | 涉及文件 |
|------|---------|---------|---------|
| **语音输入** | 🔵 中（快速记录创意） | 保留 | `doubao-asr-service.ts`, `voice-dictation-window.ts` 等 |
| **快速任务窗口** | 🔵 中（快速创建营销任务） | 保留 | `quick-task-window.ts`, `QuickTaskApp.tsx` |
| **截图服务** | 🟡 低 | 隐藏：移除全局快捷键入口 | `screenshot-service.ts` |
| **文本插入/输出服务** | 🟡 低（通用自动化） | 隐藏：移除菜单项 | `text-insertion-service.ts`, `text-output-service.ts` |
| **环境检查** | 🟡 低（Git/Bun/Node 检测对营销用户不必要） | 简化：只检查必要环境，移除开发者导向的检查 | `environment-checker.ts`, `git-detector.ts`, `node-detector.ts`, `bun-finder.ts`, `wsl-detector.ts` |
| **Git 差异服务** | 🔴 无（纯开发者功能） | 隐藏：从 Agent 工具中移除 | `git-diff-service.ts` |
| **教程横幅** | ⚪ 改造 | 改造为营销产品引导 | `TutorialBanner.tsx` |
| **Onboarding** | ⚪ 改造 | 改造为营销场景首次引导 | `OnboardingView.tsx` |
| **欢迎页面** | ⚪ 改造 | 改造为营销工作区欢迎 | `WelcomeView.tsx` |
| **Scratch Pad** | 🟡 低（草稿本） | 隐藏：从侧边栏移除入口 | `ScratchPadView.tsx` |
| **文件浏览器** | 🔵 中（浏览工作区文件） | 保留 | `file-browser/` |
| **Diff/预览面板** | 🔵 中（Agent 文件修改预览） | 保留 | `diff/` |

### 2.8 默认 Skills（分类处理）

| Skill | 营销价值 | 处理方式 |
|------|---------|---------|
| `ma-marketing` | 🔵 核心 | 保留 |
| `ma-brand-dna` | 🔵 核心 | 保留 |
| `ma-creative-concept` | 🔵 核心 | 保留 |
| `ma-tone-manner` | 🔵 核心 | 保留 |
| `ma-ta-portrait` | 🔵 核心 | 保留 |
| `ma-competitor-analyzer` | 🔵 核心 | 保留 |
| `ma-platform-role-mapper` | 🔵 核心 | 保留 |
| `ma-kol-pyramid` | 🔵 核心 | 保留 |
| `ma-content-calendar` | 🔵 核心 | 保留 |
| `ma-ugc-campaign` | 🔵 核心 | 保留 |
| `ma-paid-media` | 🔵 核心 | 保留 |
| `brainstorming` | 🟡 中（通用头脑风暴） | 隐藏：从默认加载列表移除 |
| `docx` | 🔵 中（生成 Word 文档） | 保留 |
| `pdf` | 🔵 中（生成 PDF 报告） | 保留 |
| `pptx` | 🔵 中（生成 PPT 提案） | 保留 |
| `xlsx` | 🔵 中（生成 Excel 数据表） | 保留 |
| `guizang-ppt-skill` | 🟡 低（特定 PPT 工具） | 隐藏 |
| `executing-plans` | 🟡 中（通用计划执行） | 隐藏 |
| `find-skills` | 🟡 中（Skill 发现） | 隐藏 |
| `proma-coach` | 🔴 无（MAPro 使用教练） | 删除或隐藏 |
| `skill-creator` | 🟡 中（Skill 创建工具） | 隐藏：高级功能 |
| `tool-builder` | 🟡 中（工具构建器） | 隐藏：高级功能 |
| `writing-plans` | 🟡 中（通用写作计划） | 隐藏 |

---

## 三、具体清理操作清单

### Phase A：UI 入口隐藏（低风险，可回滚）

这些操作只影响 UI 展示，不删除代码，风险最低。

#### A1. 设置面板导航简化

**目标文件**：`SettingsPanel.tsx`

**操作**：
```typescript
// 修改 tabs 构建逻辑，隐藏以下 Tab：
// - prompts（提示词管理）
// - shortcuts（快捷键管理）
// - migration（数据迁移）
// - storage（磁盘管理）

// 保留的 Tab（简化后）：
const SIMPLIFIED_TABS: TabItem[] = [
  { id: "general", label: "通用设置", icon: <Settings size={16} /> },
  { id: "channels", label: "模型配置", icon: <Radio size={16} /> },
  { id: "agent", label: "Agent 配置", icon: <Plug size={16} /> },
  { id: "tools", label: "营销工具", icon: <Wrench size={16} /> },  // 改名
  { id: "proxy", label: "代理设置", icon: <Globe size={16} /> },
  { id: "bots", label: "远程连接", icon: <Bot size={16} /> },
  { id: "voice-input", label: "语音输入", icon: <Mic size={16} /> },
  { id: "appearance", label: "外观设置", icon: <Palette size={16} /> },
  { id: "about", label: "关于/更新", icon: <Info size={16} /> },
];
```

#### A2. BotHub 平台简化

**目标文件**：`BotHubSettings.tsx`

**操作**：
```typescript
// 从 PLATFORMS 数组中移除或注释：
// - dingtalk（钉钉）
// - wechat（微信）
// 保留：feishu（飞书）、defaults（用法）、logos（品牌素材）
```

#### A3. 左侧边栏模式切换隐藏

**目标文件**：`LeftSidebar.tsx`

**操作**：
```typescript
// 注释或条件渲染 ModeSwitcher 组件
// 默认 appModeAtom 设为 'agent'
```

#### A4. 通用设置简化

**目标文件**：`GeneralSettings.tsx`

**操作**：
- 移除"消息悬浮置顶条"设置项
- 简化通知设置（保留核心选项）
- 归档设置保留（对营销项目管理有用）

#### A5. 教程横幅改造

**目标文件**：`TutorialBanner.tsx`

**操作**：
- 文案改为营销产品引导
- 跳转目标改为营销教程

#### A6. 菜单栏简化

**目标文件**：`menu.ts`

**操作**：
- 移除开发者导向的菜单项
- 保留核心文件操作、编辑、视图菜单

### Phase B：默认行为调整（中低风险）

#### B1. 默认模式改为 Agent

**目标文件**：`src/renderer/atoms/app-mode.ts`

**操作**：
```typescript
export const appModeAtom = atom<AppMode>('agent')  // 原为 'chat'
```

#### B2. 默认启用所有 MA 工具

**目标文件**：`chat-tool-config.ts`

**操作**：
```typescript
const DEFAULT_CONFIG: ChatToolsFileConfig = {
  toolStates: {
    memory: { enabled: true },
    'agent-mode-recommend': { enabled: true },
    'web-search': { enabled: true },
    'nano-banana': { enabled: false },  // 需要 API Key，保持默认关闭
    'ma-kol-data-mcp': { enabled: true },
    'ma-strategy-iq': { enabled: true },
    'ma-match-ai': { enabled: true },
    'ma-connect-bot': { enabled: true },
    'ma-creative-pilot': { enabled: true },
    'ma-kol-search': { enabled: true },
  },
  // ...
}
```

#### B3. 默认工作区改为营销工作区

**目标文件**：`agent-workspace-manager.ts` 或初始化逻辑

**操作**：
- 首次启动时自动创建 "默认营销工作区"
- 预加载所有 MA Skills
- 预配置 KOL Data MCP

#### B4. Onboarding 流程改造

**目标文件**：`OnboardingView.tsx`

**操作**：
- 步骤改为营销场景引导
- 第一步：配置 AI 渠道
- 第二步：了解营销 Agent 工作流
- 第三步：创建第一个营销项目

### Phase C：代码删除（高风险，需谨慎）

**⚠️ 警告：以下操作涉及代码删除，建议先完成 Phase A 和 B，确认产品方向后再执行。**

#### C1. 完全无关的检测器（可安全删除）

| 文件 | 说明 | 删除理由 |
|------|------|---------|
| `git-detector.ts` | Git 安装检测 | 营销用户不需要 Git |
| `git-bash-detector.ts` | Git Bash 检测 | Windows 营销用户不需要 |
| `node-detector.ts` | Node.js 检测 | 营销用户不需要 Node |
| `bun-finder.ts` | Bun 检测 | 营销用户不需要 Bun |
| `wsl-detector.ts` | WSL 检测 | 营销用户不需要 WSL |

**注意**：`environment-checker.ts` 需要保留但简化，只检查必要项（如 Python 用于 MCP Server）。

#### C2. Git 差异服务（可安全删除）

| 文件 | 说明 |
|------|------|
| `git-diff-service.ts` | Agent 文件修改的 Git diff 展示 |

**注意**：如果 Agent 模式依赖 git diff 展示文件变更，需要评估影响。营销场景下文件操作较少，可能可以移除。

#### C3. 通用 Skills（可安全隐藏/删除）

| Skill | 处理方式 |
|------|---------|
| `proma-coach` | 删除（完全无关） |
| `find-skills` | 隐藏（从默认加载列表移除） |
| `executing-plans` | 隐藏 |
| `writing-plans` | 隐藏 |
| `guizang-ppt-skill` | 隐藏 |

---

## 四、清理顺序建议

### 第一轮：UI 隐藏（1-2 天）
1. 设置面板导航简化（A1）
2. BotHub 平台简化（A2）
3. 左侧边栏模式切换隐藏（A3）
4. 通用设置简化（A4）
5. 菜单栏简化（A6）

**验证**：编译通过，UI 正常，无报错。

### 第二轮：默认行为调整（1-2 天）
1. 默认模式改为 Agent（B1）
2. 默认启用 MA 工具（B2）
3. 默认工作区改造（B3）
4. Onboarding 改造（B4）

**验证**：首次启动体验流畅，默认进入营销工作流。

### 第三轮：代码删除（2-3 天，谨慎）
1. 环境检测器删除（C1）
2. Git 差异服务评估后删除（C2）
3. 通用 Skills 清理（C3）

**验证**：编译通过，核心功能正常，无运行时错误。

### 第四轮：品牌改造（1-2 天）
1. 应用名称：Proma → MAPro（已完成）
2. Logo 和图标替换
3. 关于页面信息更新
4. 教程内容替换为营销教程

---

## 五、风险与回滚策略

| 风险 | 影响 | 回滚方式 |
|------|------|---------|
| 隐藏 UI 入口后用户找不到功能 | 低 | 恢复被注释的代码即可 |
| 删除环境检测器后 Agent 报错 | 中 | 恢复检测器文件，重新注册 |
| 删除 Git diff 后 Agent 文件预览异常 | 中 | 恢复 `git-diff-service.ts` |
| 默认模式改为 Agent 后老用户不习惯 | 低 | 改回 `appModeAtom` 默认值 |
| 设置 Tab 隐藏后相关功能无法配置 | 低 | 恢复 `SettingsPanel.tsx` 中的 Tab 定义 |

**建议**：
- 所有删除操作前创建 Git 分支
- 优先使用"注释代码"而非"删除文件"
- 保留原始文件备份在 `docs/backup/` 目录

---

## 六、与新增功能的协调

清理和新增可以**并行进行**，但建议按以下顺序：

1. **先完成 Phase A（UI 隐藏）**：让产品界面更聚焦，为新增功能腾出视觉空间
2. **并行进行新增功能开发**：在清理后的框架上新增 MA 工具、Skill、数据模型
3. **后完成 Phase B/C（行为调整/代码删除）**：在新增功能稳定后再删除旧代码

**理由**：
- UI 隐藏风险低，可以快速让产品更像营销工具
- 新增功能需要时间开发，可以并行
- 代码删除风险高，应在功能稳定后进行

---

*文档版本: v1.0*
*基于 MAPro v0.9.12 代码结构*
