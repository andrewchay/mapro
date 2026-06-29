# Tasks

> 本文件跟踪 `WEB-PLAN.md` 第十章「实施进度对照（v0.1.14）」中的待办事项与执行进度。
> 更新规则：完成项移至 Done 并标注完成日期；阻塞项放入 Waiting On；远期/低优先级项放入 Someday。

## Active

### P5 前端功能补齐

- [x] **Agent 设置面板** - 在 SettingsPage 配置默认 Agent 渠道、模型、工作区、权限模式 (2026-06-29)
  - 实现：
    - `packages/shared/src/types/settings.ts`：`AppSettings` 新增 `defaultAgentChannelId` / `defaultAgentModelId` / `defaultAgentWorkspaceId` / `defaultAgentPermissionMode`
    - `packages/server/src/settings/settings-service.ts`：归一化与 PATCH 白名单校验 Agent 默认字段
    - `apps/web-ui/src/store/settings-atoms.ts`：新增四个 Jotai 原子状态
    - `apps/web-ui/src/pages/SettingsPage.tsx`：新增「Agent 默认设置」卡片，渠道/模型联动、工作区下拉、权限模式三选一
    - `apps/web/src/routes/settings.test.ts`：补充 Agent 默认设置 PATCH 与清空测试
    - `apps/web-ui/src/pages/SettingsPage.test.tsx`：新增 5 个 BDD 测试验证渲染与交互
  - 验收：设置页可读写 Agent 默认配置，切换渠道自动清空模型，权限模式可选 auto/bypassPermissions/plan
  - 工期：1–2 天
- [ ] **Brief 生成 / 内容审核 / 内容追踪录入** - Campaign 核心编辑功能 Web 化
  - 依赖：Campaign 写接口、文件附件
  - 验收：Web 可生成 Brief、提交审核、录入追踪数据
  - 工期：4–6 天

### P4 数据库与数据层

- [ ] **PostgreSQL 切主配置开关** - 通过环境变量切换 SQLite / PostgreSQL
  - 依赖：`PostgresDbProvider` 已就绪
  - 验收：仅改环境变量即可用 PG 运行全部现有测试
  - 工期：1–2 天
- [ ] **SQLite/PostgreSQL 方言差异测试** - 覆盖两种数据库的 Campaign/Chat 集成测试
  - 依赖：PG 切主开关
  - 验收：CI 中同时跑 SQLite 和 PG 测试套
  - 工期：2–3 天
- [ ] **数据迁移工具（`~/.mapro/*.sqlite` 导入导出）** - 支持桌面数据导入 Web / PG
  - 依赖：PG 切主开关
  - 验收：CLI 工具可将桌面 SQLite 导入 PG 或导出为 SQL/JSON
  - 工期：3–5 天

### P6 测试覆盖对齐

- [ ] **E2E 接入 CI（配测试用 Provider key）** - 将 `scripts/smoke-test.ts` 加入 GitHub Actions
  - 依赖：Docker 实测闭环
  - 验收：PR 触发 smoke-test，失败阻塞合并
  - 工期：2–3 天
- [ ] **Electron↔Web 双端一致性专项** - 针对同一业务逻辑验证 IPC 与 HTTP/WS 行为一致
  - 依赖：主要 API 补齐后
  - 验收：形成一致性测试矩阵文档，关键路径（Agent 审批链、Campaign CRUD）有对比测试
  - 工期：3–5 天

## Waiting On

- 暂无

## Someday

- 暂无

## Done

### P5 前端功能补齐（2026-06-29）

- [x] ~~13 步工作流执行步骤~~ (2026-06-29)
  - 实现：
    - `apps/web-ui/src/api/platform-api.ts`：新增 `completeCampaignStep(campaignId, stepId, messages?)`
    - `apps/web-ui/src/api/web-api.ts`：实现 `completeCampaignStep` POST 调用
    - `apps/web-ui/src/components/CampaignWorkflowSteps.tsx`：每步骤展开面板新增「执行」按钮，调用 `completeCampaignStep`；成功刷新工作流，失败显示原因
    - `apps/web/src/routes/campaign.ts`：已有 `/api/campaigns/:id/workflow/steps/:stepId/complete` 路由，调用 `commandService.completeStepWithValidation`
    - `apps/web-ui/src/components/CampaignWorkflowSteps.test.tsx`：新增 3 个 BDD 测试（渲染执行按钮、成功调用并更新状态、失败显示错误）
    - `apps/web-ui/src/api/agent-websocket-client.ts`：从 `web-api.ts` 抽离 Agent WebSocket 客户端，避免组件测试的 `mock.module` 全局 mock 影响真实 WebSocket 行为测试
  - 验收：Web 端可对工作流 `in_progress` 步骤点击「执行」，产物合格自动标记 `completed`，不合格展示原因
  - 版本变更：`apps/web-ui` 0.1.15 → 0.1.16

- [x] ~~拖拽上传~~ (2026-06-29)
  - 实现：
    - `apps/web-ui/src/pages/ChatPage.tsx`：输入区包裹拖放区域，支持 `dragenter` / `dragleave` / `dragover` / `drop`；拖拽进入时显示“释放文件以上传”提示与蓝色虚线边框
    - `handleFileChange` 与 `uploadFiles` 复用同一上传逻辑；文件输入新增 `multiple` 属性，支持一次性选择/拖拽多个文件
    - 新增 `apps/web-ui/src/pages/ChatPage.test.tsx`：2 个 BDD 测试验证单个/多个文件拖拽上传并展示附件
    - `apps/web-ui/src/test-setup.ts`：补齐 `DataTransfer` / `File` 全局对象，支撑拖拽事件测试
  - 验收：拖入文件后触发上传并展示在输入区
  - 版本变更：`apps/web-ui` 0.1.17 → 0.1.18

- [x] ~~13 步工作流校验 / 重置 / 预览 UI~~ (2026-06-29)
  - 实现：
    - `apps/web-ui/src/components/CampaignWorkflowSteps.tsx`：展示 13 步工作流、展开步骤加载产物、校验步骤、重置工作流
    - `apps/web/src/routes/campaign.ts`：提供 `/api/campaigns/:id/workflow` / `validate` / `reset` / `artifacts` 路由
  - 验收：Web 端可查看工作流状态、校验步骤产物、重置为初始状态

- [x] ~~文件预览组件（图片 / PDF / Markdown）~~ (2026-06-29)
  - 实现：`apps/web-ui/src/components/FilePreviewDialog.tsx` 支持 Markdown（react-markdown + remark-gfm）、图片、PDF iframe、文本、其他类型下载
  - 验收：三种 MIME 预览不报错，typecheck + 全项目回归 352 项全过

### P7 文档与工程规范（2026-06-29）

- [x] ~~README Web 部署说明~~ (2026-06-29)
  - 实现：`README.md` 新增「Web 端部署」章节
  - 内容：
    - Web 端定位与部署要求
    - Docker Compose 启动/健康检查/停止命令
    - 完整环境变量清单（含 Chat/Agent/加密/API Token/Master Key）
    - 生产安全约束（localhost/反向代理/HTTPS/API Token）
    - Agent 安全加固建议
    - 本地开发命令与默认端口
  - 验收：README 包含可直接复制的 `docker compose up --build -d` 与安全约束

### P3 工作区文件系统 Web 化（2026-06-29）

- [x] ~~按 session/user 隔离路径~~ (2026-06-29)
  - 实现：
    - `packages/server/src/workspace/workspace-file-service.ts`：`WorkspaceScope` 限定 `workspace` / `campaign`，`campaign` 自动映射到 `campaign-{id}` 目录
    - `packages/server/src/files/attachment-service.ts`：附件路径 `{dataDir}/attachments/{scope}/{id}/{fileId}`，scope/id/fileId 均做安全校验
    - `packages/server/src/context/config-paths.ts`：`getAttachmentDirForScope` / `resolveAttachmentPathForScope`
  - 安全：
    - `assertAllowedScope` 拒绝非法作用域（403）
    - `assertSafeId` 限制 ID 字符为 `[a-zA-Z0-9_-]`
    - `validateRelativePath` 拦截 `..`、绝对路径、Windows 盘符等路径穿越
    - `.context` 保留目录禁止写入/删除
  - 测试：`workspace-file-service.test.ts` 26 项全过

- [x] ~~Web 上传下载 API~~ (2026-06-29)
  - 实现：
    - `apps/web/src/routes/attachments.ts`：`POST/GET/DELETE /api/attachments/:scope/:id/:fileId`，支持 base64 上传、MIME 预览/下载、列表
    - `apps/web/src/routes/workspace-files.ts`：`GET/POST/DELETE /api/workspace-files/:scope/:id/*path`，支持文本写入、base64 上传、递归列表
    - 注册到 `apps/web/src/index.ts`
  - 安全：
    - 附件 scope/id/fileId 正则校验
    - 工作区文件路径穿越被 400/403 拦截
    - 超大 base64 返回 413
  - 测试：`attachments.test.ts` 6 项 + `workspace-files.test.ts` 11 项全过

- [x] ~~产物在线预览（Campaign 工作流 `.md` 内联渲染）~~ (2026-06-29)
  - 实现：
    - `apps/web-ui/src/components/FilePreviewDialog.tsx`：支持 Markdown（react-markdown + remark-gfm）、图片、PDF（iframe）、文本、其他类型下载
    - `apps/web-ui/src/components/CampaignWorkflowSteps.tsx`：展开步骤加载产物列表，点击产物调用 `readCampaignArtifact` 打开预览
    - `apps/web/src/routes/campaign.ts`：已提供 `/api/campaigns/:id/workflow/artifacts/:stepId` 与 `/:stepId/*filePath`
  - 测试：全项目回归 352 项全过；CampaignWorkflowSteps 与 FilePreviewDialog 经 typecheck 与 CampaignDetailPage 集成验证

### P2 系统能力 Web 策略（2026-06-29）

- [x] ~~系统能力 Web 策略~~ (2026-06-29)
  - 实现：
    - `apps/web-ui/src/pages/SettingsPage.tsx` 新增「桌面端功能」说明卡片，明确列出 Web 端不支持的系统级能力
    - Web 端 `AppSettings` 核心类型不扩展桌面专用字段（如 `voiceDictation`、`mainWindowState`、`shortcutOverrides`），避免误暴露为可调项
  - 范围：
    - 屏幕截图与消息卡片导出
    - 全局快捷键（除发送消息快捷键外）
    - 语音听写与 ASR 输入
    - 系统托盘 / Dock 角标 / 本地通知
    - 主窗口状态、标签页恢复等桌面级持久化
  - 验收：
    - SettingsPage 有明确 UI 提示
    - Web UI 当前不暴露截图/语音/全局快捷键等可调按钮
    - web-ui typecheck 通过
  - 版本变更：`apps/web-ui` 0.1.13 → 0.1.14

### P2 渠道 CRUD（Web）（2026-06-29）

- [x] ~~渠道 CRUD（Web）~~ (2026-06-29)
  - 实现：
    - 后端：`packages/server/src/channels/channel-service.ts` 跨平台渠道服务，支持 CRUD、API Key AES-256-GCM 加密、连接测试、模型拉取
    - API：`apps/web/src/routes/channels.ts` 暴露 `GET/POST/PATCH/DELETE /api/channels`、`POST /api/channels/:id/test`、`POST /api/channels/fetch-models`、`POST /api/channels/test-direct`
    - Web API：`apps/web-ui/src/api/web-api.ts` 实现 `listChannels` / `getChannel` / `createChannel` / `updateChannel` / `deleteChannel` / `testChannel` / `fetchModels` / `testChannelDirect`
    - UI：`apps/web-ui/src/pages/SettingsPage.tsx` 新增 AI 渠道管理面板，支持新建 / 编辑 / 删除 / 测试连接 / 拉取模型 / 启用禁用模型
    - 状态：`apps/web-ui/src/store/channels-atoms.ts` Jotai 状态管理
  - 安全：
    - API Key 通过 `ServerSecretsStore` AES-256-GCM 加密，落盘为 `enc:` 前缀密文
    - `PATCH` 更新时 apiKey 留空保留旧密文，不泄漏也不覆盖
    - `baseUrl` 经 `validateChannelBaseUrl` 校验，禁止非 HTTP(S) / 内网 / 本地敏感地址
  - 测试：
    - `apps/web/src/routes/channels.test.ts` 8 项测试全过（CRUD、加密、非法 provider、fetch-models、test-direct）
    - 回归测试：全项目 352 项测试全过
  - 版本变更：
    - `packages/server` 0.1.20 → 0.1.22
    - `apps/web` 0.1.19 → 0.1.21
    - `apps/web-ui` 0.1.11 → 0.1.13

### M1 部署与安全基线（2026-06-28）

- [x] ~~Docker 实测闭环~~ (2026-06-28)
  - 验证结果：
    - `docker compose up --build -d` 构建并启动成功
    - `GET /health` 返回 `{"status":"ok","chatEnabled":false,"agentEnabled":false}`
    - `POST /api/campaigns` 创建 Campaign 成功，`/app/data/campaign-database.sqlite` 落盘
    - `docker stop ma-proma-web-1` 耗时 1.27s，优雅关闭生效
  - 修复问题：
    - Dockerfile 添加 `packages/ui` 以解析 workspace 依赖
    - 将 `packages/server` 的 `better-sqlite3` 从 dependencies 移到 optionalDependencies，避免 Bun 容器编译原生模块
    - Dockerfile CMD 修正 `--filter='@ma-proma/web'` → `--filter=@ma-proma/web`，去除多余引号
  - 阻塞项：本地开发服务占用 3000/8081 端口，实测前已释放

### P1 Agent 服务端化安全与隔离（2026-06-28）

- [x] ~~命令审计日志（持久化）~~ (2026-06-28)
  - 实现：
    - 新增 `packages/server/src/agent/agent-audit-logger.ts`（缓冲刷盘、JSONL 存储、输入脱敏、输出截断）
    - 新增 `getAgentAuditLogsDir` / `getAgentAuditLogPath` 路径函数
    - 在 `apps/web/src/agent/agent-orchestrator.ts` 的 `canUseTool` 与 `handleSDKMessage` 中记录 tool_request / permission_decision / tool_result / error
    - 在 `apps/web/src/index.ts` 优雅关闭时调用 `agentOrchestrator.dispose()` 确保审计日志落盘
  - 测试：`packages/server/src/agent/agent-audit-logger.test.ts` 5 项全过；`apps/web/src/agent/agent-orchestrator.test.ts` 16 项全过
  - 备注：当前仅 Web 端 Agent 编排器接入审计；Electron 端可后续复用同一 `AgentAuditLogger`
- [x] ~~资源限制（Docker / native）~~ (2026-06-28)
  - 实现：
    - 新增 `packages/server/src/agent/agent-resource-limits.ts`：统一资源限制抽象
    - 环境变量：`MAPRO_AGENT_CPU` / `MAPRO_AGENT_MEMORY` / `MAPRO_AGENT_NETWORK`
    - Docker：`DockerAgentRunner` 注入 `--cpus` / `--memory` / `--network` 参数
    - Native：`NativeAgentRunner` 与 `ClaudeAgentAdapter.spawnClaudeCodeProcess` 用 `sh -c 'ulimit -t ...; ulimit -v ...; exec ...'` 包装
    - `AgentOrchestratorConfig` 支持 `resourceLimits` 透传
  - 默认值：CPU 1 核、内存 512 MB、网络 none
  - 测试：`packages/server/src/agent/agent-resource-limits.test.ts` 14 项全过；回归测试 35 项全过
  - 版本变更：`packages/server` 0.1.15 → 0.1.16；`apps/web` 0.1.14 → 0.1.15
- [x] ~~危险工具 / 命令禁用清单~~ (2026-06-28)
  - 实现：
    - 新增 `packages/server/src/agent/agent-tool-blocklist.ts`：可配置工具/命令黑名单
    - 环境变量：`MAPRO_AGENT_DISABLED_TOOLS`（逗号分隔工具名）、`MAPRO_AGENT_DISABLED_BASH_PATTERNS`（逗号分隔命令前缀）
    - 在 `AgentOrchestrator.canUseTool` 中统一拦截，覆盖 auto/plan/bypassPermissions 所有模式
    - 命中黑名单直接 `deny` 并记录审计日志，不进入用户审批流程
  - 优先级：显式配置 > 环境变量 > 默认值
  - 测试：`packages/server/src/agent/agent-tool-blocklist.test.ts` 8 项全过；回归测试 24 项全过
  - 版本变更：`packages/server` 0.1.16 → 0.1.17；`apps/web` 0.1.15 → 0.1.16
- [x] ~~沙箱隔离专项测试~~ (2026-06-28)
  - 实现：
    - 新增 `packages/server/src/agent/agent-sandbox-isolation.test.ts`：验证 Docker runner 默认挂载策略
    - 新增 `AgentToolBlocklist` 中禁用 `Bash` 危险写入模式与敏感路径读取模式
    - `DockerAgentRunner` 默认不挂载 `/root`、宿主 home、`~/.mapro` 等敏感目录
  - 测试用例：
    - 容器内无法读取宿主 home 目录
    - 容器内无法写入宿主 home 目录
    - 容器内无法访问 `/etc/shadow`、`/root/.ssh` 等敏感路径
    - `DockerAgentRunner` 默认不挂载宿主敏感目录
  - 结果：4 项测试全过；typecheck（server + web）通过
  - 版本变更：`packages/server` 0.1.17 → 0.1.18；`apps/web` 0.1.16 → 0.1.17

### P2 文件附件 API（上传 / 预览）（2026-06-28）

- [x] ~~文件附件 API（上传 / 预览）~~ (2026-06-28)
  - 实现：
    - 新增 `packages/server/src/files/attachment-service.ts`：跨平台附件服务，支持按 `scope/id` 保存、读取、删除、列表
    - 新增 `packages/server/src/context/config-paths.ts`：`getAttachmentDirForScope` / `resolveAttachmentPathForScope`
    - 扩展 `packages/server/src/files/index.ts` 与 `packages/server/src/index.ts` 导出 `AttachmentService`
    - 修改 `packages/server/src/chat/types.ts`：`ChatSendInput` 增加 `attachments?: FileAttachment[]`
    - 修改 `packages/server/src/chat/chat-service.ts`：`ChatService` 注入 `AppContext` + `FileProvider`，支持图片附件 base64 读取
    - 新增 `apps/web/src/routes/attachments.ts`：REST API `POST/GET/DELETE /api/attachments/:scope/:id/:fileId`
    - 注册路由到 `apps/web/src/index.ts`，并在 `apps/web/src/websocket/index.ts` 透传 `attachments`
    - 新增 `apps/web-ui/src/lib/file-utils.ts`：`fileToBase64` / `formatFileSize`
    - 扩展 `apps/web-ui/src/api/platform-api.ts` 与 `web-api.ts`：附件上传/预览 URL/删除/列表
    - 修改 `apps/web-ui/src/pages/ChatPage.tsx`：增加附件上传按钮、附件列表、发送时携带附件
  - 安全：
    - `scope` / `id` 仅允许 `[a-zA-Z0-9_-]`，`fileId` 仅允许 `[a-zA-Z0-9_.-]`
    - 所有读取路径经 `normalize` 后校验在 `{dataDir}/attachments` 根下
    - 不可预览类型强制 `Content-Disposition: attachment`
  - 测试：
    - 新增 `apps/web/src/routes/attachments.test.ts`：6 项测试全过（上传、字段校验、下载、删除、非法 fileId、列表）
    - 回归测试：websocket / orchestrator / server agent 安全测试 60 项全过
  - 版本变更：
    - `packages/server` 0.1.18 → 0.1.19
    - `apps/web` 0.1.17 → 0.1.18
    - `apps/web-ui` 0.1.9 → 0.1.10

### P2 设置 / 用户档案 API（2026-06-28）

- [x] ~~设置 / 用户档案 API~~ (2026-06-28)
  - 实现：
    - 新增 `packages/shared/src/types/settings.ts` 与 `user-profile.ts`：严格核心字段 `AppSettings` / `UserProfile`、默认值、`ThemeMode` / `ThemeStyle`
    - 新增 `packages/server/src/settings/settings-service.ts`：跨平台 `getAppSettings` / `updateAppSettings`，使用 `readJsonFileSafe` / `writeJsonFileAtomic`
    - 新增 `packages/server/src/settings/user-profile-service.ts`：跨平台 `getUserProfile` / `updateUserProfile`
    - 扩展 `packages/server/src/context/config-paths.ts`：`getSettingsPath` / `getUserProfilePath`
    - 新增 `apps/web/src/routes/settings.ts`：REST API `GET/PATCH /api/settings`、`GET/PATCH /api/user-profile`
    - 注册路由到 `apps/web/src/index.ts`
    - 扩展 `apps/web-ui/src/api/platform-api.ts` 与 `web-api.ts`：设置/档案读写
    - 更新 `apps/web-ui/src/test-utils/mock-web-api.ts`：同步 mock 方法
    - 新增 `apps/web-ui/src/store/settings-atoms.ts` / `user-profile-atoms.ts`
    - 新增 `apps/web-ui/src/main.tsx` 的 `ThemeInitializer`：根据 `themeMode` 切换 `<html>` 的 `dark` 类，支持 `system` 模式监听 `prefers-color-scheme`
    - 新增 `apps/web-ui/src/pages/SettingsPage.tsx`：用户档案、主题模式/风格、发送快捷键
    - 扩展 `apps/web-ui/src/App.tsx` 与 `components/Layout.tsx`：增加 `/settings` 路由与导航入口
  - 安全与兼容：
    - `PATCH /api/settings` 白名单校验，未知字段忽略，非法枚举返回 400
    - 保留 Electron 桌面端字段（`voiceDictation`、`mainWindowState` 等）
    - 空用户名回退到默认值
    - `themeStyle` 默认 `undefined`，UI 视为 `'default'`
  - 测试：
    - 新增 `apps/web/src/routes/settings.test.ts`：7 项测试全过
    - 回归测试：附件 / websocket / orchestrator / server agent 安全测试 73 项全过
  - 版本变更：
    - `packages/shared` 0.1.23 → 0.1.24
    - `packages/server` 0.1.19 → 0.1.20
    - `apps/web` 0.1.18 → 0.1.19
    - `apps/web-ui` 0.1.10 → 0.1.11
