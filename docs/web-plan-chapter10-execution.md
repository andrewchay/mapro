# WEB-PLAN 第十章执行计划

> 基于 `WEB-PLAN.md` 第十章「实施进度对照（v0.1.14）」制定的可执行计划与跟进文档。
> 性质：执行跟踪，不替代原规划的方向性判断。
> 对应代码版本：MAPro v0.1.14 起，当前 server 0.1.26 / web 0.1.24 / web-ui 0.1.20。

---

## 一、目标与原则

### 目标

将阶段 B（全功能迁移）中剩余的 ⬜ 待办项按优先级落地，优先完成「部署闭环 + Agent 安全 + 核心 Campaign 工作流」三条主线，补齐 Web 端到可对外小团队内测的水平。

### 原则

1. **先跑通、再补齐**：P0 Docker 实测闭环是后续所有集成测试的前置。
2. **安全优先于功能**：P1 Agent 安全加固（审计、资源限制、黑名单、沙箱测试）必须在扩大 Web 部署前完成。
3. **一套业务逻辑**：尽量复用 `packages/server` 已有抽象，不另起炉灶写第二套业务逻辑。
4. **Electron 不降级**：Web 端不支持的功能（截图、快捷键、语音）要明确降级，不在桌面端删能力。
5. **文档同步**：修改 `WEB-PLAN.md` / `README.md` 前需经项目负责人许可。

---

## 二、当前基线（第十章摘要）

| 分组 | 已完成 ✅ | 待办 ⬜ |
|---|---|---|
| P0 部署闭环 | Dockerfile、compose、data dir、health、SIGTERM、Docker 实测闭环 | — |
| P1 Agent 安全 | 编排器、权限/AskUser/ExitPlan、Docker/native runner、审计日志、资源限制、危险工具黑名单、沙箱隔离测试 | — |
| P2 IPC 映射 | agent.ts + campaign.ts、文件附件 API、设置/档案 API、渠道 CRUD、系统能力 Web 策略 | — |
| P3 工作区文件 | FileProvider + LocalFileProvider、路径隔离、上传下载 API、产物在线预览 | — |
| P4 数据库 | DbProvider + SqliteDbProvider、PostgresDbProvider | PG 切主开关、方言差异测试、迁移工具 |
| P5 前端 | Agent 面板、审批 Banner、Campaign 只读/详情/追踪、Chat 流式、SettingsPage、13 步工作流执行/校验/重置/预览 UI、文件预览组件、Agent 默认设置面板、拖拽上传、Brief 生成 / 内容审核 / 内容追踪录入 | — |
| P6 测试 | Banner / AgentPage / orchestrator / websocket / smoke-test 脚本 | E2E 接入 CI、双端一致性专项 |
| P7 文档 | WEB-PLAN 同步、环境变量清单、README Web 部署说明 | — |

---

## 三、总体路线图

分四个里程碑推进，每个里程碑结束后做一次集成验证。

### 里程碑 M1：部署与安全基线（已完成，2026-06-28）

- P0 Docker 实测闭环
- P1 命令审计日志
- P1 资源限制（Docker / native）
- P1 危险工具 / 命令禁用清单
- P1 沙箱隔离专项测试

**集成验证**：`docker compose up --build` + smoke-test 通过，Agent 安全测试通过。

### 里程碑 M2：核心服务补齐（已完成，2026-06-29）

- P2 文件附件 API
- P2 设置 / 用户档案 API
- P3 按 session 隔离路径
- P3 Web 上传下载 API
- P7 README Web 部署说明（随 P0 验证后补齐）

**集成验证**：Web 端可上传文件、可修改设置、Campaign 工作区文件可读写；对应单元测试与回归测试全过。

### 里程碑 M3：Campaign 核心工作流 Web 化（已完成，2026-06-29）

- P5 13 步工作流执行 / 校验 / 重置 UI
- P5 产物在线预览（.md 内联渲染）
- P5 文件预览组件（图片 / PDF / Markdown）
- P5 拖拽上传
- P5 Brief 生成 / 内容审核 / 内容追踪录入

**集成验证**：组件与 API 测试通过；完整「从零创建 Campaign 并推进到结束」的端到端验证待补（见验证记录表 🟡 项）。

### 里程碑 M4：可扩展性与一致性（进行中，预估 2–3 周）

- P4 PostgreSQL 切主配置开关
- P4 SQLite/PostgreSQL 方言差异测试
- P4 数据迁移工具
- P6 E2E 接入 CI
- P6 Electron↔Web 双端一致性专项

> P2 渠道 CRUD（Web）与 P2 系统能力 Web 策略已提前在 M2 前完成，不再列入 M4。

**集成验证**：CI 全绿，PG 与 SQLite 双跑测试通过，关键路径一致性测试通过。

---

## 四、关键依赖与阻塞点

| 阻塞项 | 被阻塞任务 | 缓解措施 |
|---|---|---|
| P0 Docker 实测闭环 | P6 E2E CI、P7 README 部署说明 | 已随 M1 完成 |
| P1 资源限制落地 | P1 沙箱隔离测试 | 已随 M1 完成 |
| P2 文件附件 API | P3 上传下载、P5 拖拽上传、产物预览 | 在 M2 尽早完成 |
| P3 路径隔离 | P3 上传下载、产物预览 | 与文件附件 API 一起设计 |
| P2 设置/档案 API | P5 设置面板、P2 系统能力策略 | M2 完成 |
| P4 PG 切主开关 | P4 方言测试、迁移工具 | M4 启动 |

---

## 五、详细任务说明

### P0 Docker 实测闭环

- **目标**：确认生产 Docker 镜像可完整启动、落盘、健康检查、优雅关闭。
- **步骤**：
  1. `docker compose up --build -d`
  2. `curl http://localhost:3000/health` 返回预期 JSON
  3. 触发 Chat / Campaign 写入，确认 SQLite 文件出现在挂载目录
  4. `docker stop` 测量退出时间，确认 ≤ 2s
- **验收**：上述四步全部通过，并补充到 `docs/web-plan-chapter10-execution.md` 的「验证记录」。

### P1 命令审计日志

- **目标**：所有 Agent 工具调用可被审计。
- **设计要点**：
  - 写入 `MAPRO_DATA_DIR/logs/agent-audit-{date}.jsonl`
  - 字段：`sessionId`、`toolName`、`inputHash`、`outputSize`、`status`、`timestamp`、`durationMs`、`permissionMode`
  - 不记录完整 API Key、Token 等敏感字段
- **验收**：orchestrator 测试可断言审计文件生成与字段完整。

### P1 资源限制

- **目标**：容器/native 进程不会吞掉整台服务器。
- **设计要点**：
  - Docker：`--cpus=${MAPRO_AGENT_CPU:-1} --memory=${MAPRO_AGENT_MEMORY:-512m} --network=${MAPRO_AGENT_NETWORK:-none}`
  - Native：`ulimit -t` CPU 时间、`ulimit -v` 虚拟内存
- **验收**：单元测试验证限制生效。

### P1 危险工具 / 命令禁用清单

- **目标**：可配置禁止某些工具或命令模式。
- **设计要点**：
  - 环境变量 `MAPRO_AGENT_DISABLED_TOOLS=bash:rm,bash:sudo,mcp:xxx`
  - 命中后返回 `PermissionDenied` 并记审计日志
- **验收**：测试验证黑名单命中与未命中场景。

### P1 沙箱隔离专项测试

- **目标**：证明容器内无法逃逸到宿主敏感目录。
- **设计要点**：
  - 在测试里启动 Docker runner，尝试读取 `/root/.mapro` 或宿主机挂载
  - 断言读取失败
- **验收**：测试通过。

### P2 文件附件 API

- **目标**：Web 端能上传和预览附件。
- **设计要点**：
  - `POST /api/attachments/:conversationId`
  - `GET /api/attachments/:conversationId/:attachmentId`
  - 使用 `FileProvider` 存储，按 conversationId 子目录隔离
- **验收**：上传后可通过 GET 下载，MIME 正确。

### P2 设置 / 用户档案 API

- **目标**：Web 端持久化应用设置和用户档案。
- **设计要点**：
  - `GET/POST /api/settings`
  - `GET/POST /api/profile`
  - 复用 Electron 的 JSON Schema，路径通过 `AppContext`
- **验收**：设置/档案读写后，Electron 端（如共用 data dir）能看到一致数据。

### P2 渠道 CRUD（Web）

- **目标**：Web 端可管理多个 Chat/Agent 渠道。
- **设计要点**：
  - `GET/POST/PUT/DELETE /api/channels`
  - API Key 用 `CryptoProvider` AES-256-GCM 加密
  - 先支持单用户本地部署，多租户场景在 M4 考虑
- **验收**：增删改查不破坏现有 Chat 流式。

### P3 路径隔离

- **目标**：每个 session/conversation 有独立文件空间。
- **设计要点**：
  - `FileProvider` 增加 `scope` 参数
  - 路径模板：`{dataDir}/attachments/{scope}/{id}/{filename}`
- **验收**：跨 scope 读取返回 403/404。

### P5 13 步工作流 UI

- **目标**：Web 端可查看、校验、重置并执行 Campaign 13 步工作流。
- **设计要点**：
  - 复用桌面端 `CampaignWorkflowSteps` 的纯展示部分
  - `PlatformAPI` 新增 `completeCampaignStep(campaignId, stepId, messages?)`
  - `CampaignWorkflowSteps` 每步骤展开面板提供「执行」按钮，仅对 `in_progress` 步骤启用
  - 调用后端 `/api/campaigns/:id/workflow/steps/:stepId/complete`，产物合格则标记 `completed`，不合格展示原因
  - Agent WebSocket 客户端从 `web-api.ts` 抽离到 `agent-websocket-client.ts`，避免组件测试的 `mock.module` 全局 mock 影响真实 WebSocket 行为测试
- **验收**：可完成一条 Campaign 的完整推进；全量测试 363 项通过。

### P4 PostgreSQL 切主

- **目标**：通过环境变量切换主数据库。
- **设计要点**：
  - `MAPRO_DB_TYPE=sqlite|postgres`
  - `MAPRO_DATABASE_URL`
  - `DbProvider` 工厂按配置构造
- **验收**：同一套测试在 SQLite 和 PG 下都通过。

---

## 六、跟进机制

1. **TASKS.md 为唯一任务源**：所有执行项拆分为 `TASKS.md` 中的可勾选任务，完成即勾选并标注日期。
2. **里程碑检查点**：每个里程碑结束时运行集成验证脚本，记录在本文档「验证记录」章节。
3. **每周进度同步**：每周更新本文件「本周进展」与「下周计划」。
4. **风险升级**：遇到阻塞超过 2 天，移至 `TASKS.md` Waiting On 并标注阻塞原因。
5. **文档同步**：修改 `WEB-PLAN.md` / `README.md` 前必须取得项目负责人许可；本执行计划可随时更新。

---

## 七、验证记录

| 日期 | 验证项 | 结果 | 备注 |
|---|---|---|---|
| 2026-06-28 | Docker 实测闭环 | ✅ 通过 | build/health/落盘/stop 四项均通过；修复 Dockerfile + packages/server optionalDependencies + CMD 引号 |
| 2026-06-28 | 命令审计日志 | ✅ 通过 | AgentAuditLogger + Web Orchestrator 集成；typecheck + 21 项测试全过 |
| 2026-06-28 | 资源限制（Docker/native） | ✅ 通过 | `--cpus/--memory/--network` + `ulimit -t/-v`；14 项资源限制测试 + 35 项回归测试全过 |
| 2026-06-28 | 危险工具/命令禁用清单 | ✅ 通过 | `AgentToolBlocklist` + 环境变量；覆盖所有权限模式；8 项黑名单测试 + 24 项回归测试全过 |
| 2026-06-28 | 沙箱隔离专项测试 | ✅ 通过 | `agent-sandbox-isolation.test.ts` 4 项全过；容器内无法读/写宿主 home、无法访问 `/etc/shadow` 等敏感路径；typecheck（server + web）通过 |
| 2026-06-28 | 文件附件 API（上传/预览） | ✅ 通过 | `AttachmentService` + `/api/attachments/:scope/:id/:fileId`；Chat 消息可携带附件；`attachments.test.ts` 6 项全过；回归 66 项全过 |
| 2026-06-28 | 设置/用户档案 API | ✅ 通过 | `GET/PATCH /api/settings` + `/api/user-profile`；PATCH 白名单校验；保留 Electron 桌面字段；Web UI ThemeInitializer 实时生效；`settings.test.ts` 7 项全过；回归 73 项全过 |
| 2026-06-29 | 渠道 CRUD（Web） | ✅ 通过 | `channel-service.ts` 跨平台服务 + `/api/channels` REST + SettingsPage 渠道面板；API Key AES-256-GCM 加密；`channels.test.ts` 8 项全过；全项目回归 352 项全过 |
| 2026-06-29 | 系统能力 Web 策略 | ✅ 通过 | SettingsPage 新增「桌面端功能」说明卡片；Web 端不扩展桌面专用设置字段；web-ui typecheck 通过 |
| 2026-06-29 | 按 session/user 隔离路径 | ✅ 通过 | `WorkspaceFileService` scope/id 隔离 + 路径穿越拦截；`AttachmentService` `{scope}/{id}/{fileId}` 隔离；26 项服务测试全过 |
| 2026-06-29 | Web 上传下载 API | ✅ 通过 | `attachments.ts` 6 项 + `workspace-files.ts` 11 项测试全过；base64 上传、文本写入、路径穿越拦截、超大文件 413 |
| 2026-06-29 | 产物在线预览 | ✅ 通过 | `FilePreviewDialog` 支持 Markdown/PDF/图片/文本；`CampaignWorkflowSteps` 可展开步骤预览产物；typecheck + 回归 352 项全过 |
| 2026-06-29 | README Web 部署说明 | ✅ 通过 | `README.md` 新增「Web 端部署」章节，含 Docker Compose 命令、完整环境变量清单、生产安全约束、本地开发端口 |
| 2026-06-29 | Agent 设置面板 | ✅ 通过 | `AppSettings` 扩展 Agent 默认字段；SettingsPage 新增「Agent 默认设置」卡片（渠道/模型/工作区/权限模式）；`settings.test.ts` + `SettingsPage.test.tsx` 共 9 项新测试全过；全项目 360 项回归测试全过 |
| 2026-06-29 | P5 前端补齐（Brief / 内容审核 / 内容追踪录入 + 拖拽上传 + bug 修复） | ✅ 通过 | `CampaignBriefDialog` / `ContentAuditDialog` / `ContentTrackingManager` 上线；修复正则崩溃、PermissionBanner 队列清理、附件路径校验；新增 14 项回归测试；全项目 400+ 项测试全过 |
| 🟡 待补 | Campaign 工作流端到端 | 🟡 部分通过 | 13 步工作流 UI、API、产物预览已可用；完整 Web 端从零创建并推进 Campaign 的端到端集成验证待补 |
| ⬜ 待办 | PG 切主 + 双跑测试 | | |
| ⬜ 待办 | E2E CI 接入 | | |

---

## 八、本周进展 / 下周计划

### 本周进展

- 2026-06-28：依据 `WEB-PLAN.md` 第十章梳理全部待办项，创建 `TASKS.md` 与本执行计划；完成 M1「部署与安全基线」全部任务。
- 完成 P1 Agent 安全加固：
  - 命令审计日志（`AgentAuditLogger`）
  - 资源限制（Docker `--cpus/--memory/--network` + native `ulimit`）
  - 危险工具/命令禁用清单（`AgentToolBlocklist` + 环境变量）
  - 沙箱隔离专项测试（4 项测试全过）
- 完成 M2 全部四项：
  - P2「文件附件 API（上传 / 预览）」：`AttachmentService` + `/api/attachments/:scope/:id/:fileId`，Web Chat 支持图片附件
  - P2「设置 / 用户档案 API」：`GET/PATCH /api/settings` + `/api/user-profile`，PATCH 白名单校验，Web UI 主题实时生效
  - P2「渠道 CRUD（Web）」：`channel-service.ts` 跨平台渠道服务 + `/api/channels` REST API + SettingsPage AI 渠道面板，API Key AES-256-GCM 加密
  - P2「系统能力 Web 策略」：SettingsPage「桌面端功能」说明卡片，明确 Web 端不支持的截图/语音/全局快捷键等系统能力
- 完成 M3 全部三项：
  - P3「按 session/user 隔离路径」：`WorkspaceFileService` / `AttachmentService` 双路径隔离 + 路径穿越拦截
  - P3「Web 上传下载 API」：`attachments.ts` + `workspace-files.ts` REST 路由
  - P3「产物在线预览」：`FilePreviewDialog` + `CampaignWorkflowSteps` 产物预览
- 完成 P7「README Web 部署说明」：`README.md` 新增 Web 端部署章节
- 验证记录：shared / server / web / web-ui typecheck 全过；新增 8 项渠道测试 + 17 项文件相关测试 + 全项目 352 项回归测试全过。
- 版本递增：`packages/shared` 0.1.23 → 0.1.24，`packages/server` 0.1.15 → 0.1.22，`apps/web` 0.1.14 → 0.1.21，`apps/web-ui` 0.1.9 → 0.1.14。
- 2026-06-29：完成 P5「Agent 设置面板」：
  - `packages/shared` 0.1.24 → 0.1.25，`AppSettings` 新增 `defaultAgentChannelId` / `defaultAgentModelId` / `defaultAgentWorkspaceId` / `defaultAgentPermissionMode`
  - `packages/server` 0.1.22 → 0.1.23，设置服务校验与归一化 Agent 默认字段
  - `apps/web` 0.1.21 → 0.1.22，Settings API 透传新字段
  - `apps/web-ui` 0.1.14 → 0.1.15，SettingsPage 新增「Agent 默认设置」卡片
  - 新增测试：`settings.test.ts` 3 项 + `SettingsPage.test.tsx` 5 项；全项目 360 项回归测试全过
- 2026-06-29：完成 P5 剩余前端补齐与关键 bug 修复：
  - `CampaignBriefDialog` / `ContentAuditDialog` / `ContentTrackingManager` 上线
  - `packages/server` 0.1.25 → 0.1.26，`ContentAuditService` 修复品牌名正则特殊字符崩溃
  - `apps/web-ui` 0.1.19 → 0.1.20，`PermissionBanner` 关闭只移除当前请求
  - `AttachmentService.save` 补齐 scope/id 路径校验
  - 新增回归测试：`content-audit-service.test.ts` 8 项 + `attachment-service.test.ts` 6 项 + `PermissionBanner.test.tsx` 1 项
  - 全项目 400+ 项测试全过

### 下周计划

- 推进 P4「PostgreSQL 切主配置开关」可行性评估与最小原型。
- 启动 P6「Electron↔Web 双端一致性专项」用例梳理。
- 补做 Web 端 Campaign 工作流端到端集成验证，填平验证记录表中的 🟡 项。

---

*文档版本：v1.4*
*更新日期：2026-06-29*
*对应规划：WEB-PLAN.md 第十章 v0.1.14*
