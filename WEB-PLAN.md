# MAPro Web 化方向规划

> 性质：**方向规划 + 进度对照**。
>
> 目标：将 MAPro 桌面版扩展为「桌面 + Web 服务端」双端并行，核心服务层共享，UI 层按需复刻。
>
> 策略：采用**两阶段推进**，先做最小 MVP 验证架构与需求，再决定是否投入全功能迁移。
>
> **进度基线**：阶段 A（A0/A1/A2）已完成，阶段 B（Agent 服务端化）核心已落地。本文件最后一章「实施进度对照」按 v0.1.14 实际代码逐项核对，标注已完成 / 部分完成 / 待办。

---

## 一、总体判断

这个规划的大方向是理性的，尤其是「**桌面保留完整功能、Web 先做单用户 MVP、阶段 A 不碰 Agent**」这个边界非常关键。

开工前曾被低估的几处工程成本，截至 v0.1.14 已多数解决：

1. **Chat 渠道密钥** —— 部分解决。Chat 流式已跑通（`apps/web-ui/src/pages/ChatPage.tsx`），采用环境变量单 Provider 方案（`MAPRO_CHAT_PROVIDER` / `MAPRO_CHAT_API_KEY` / `MAPRO_CHAT_BASE_URL` / `MAPRO_CHAT_MODEL`）。但 Web 端仍无渠道 CRUD UI，多渠道切换需进一步设计。
2. **服务层抽离** —— 已解决。`campaign-manager.ts` 的纯数据部分已抽到 `packages/server`：`CampaignRepository` / `CampaignQueryService` / `CampaignCommandService` / `CampaignWorkflowService` / `CampaignArtifactValidator`，不再整文件搬运。
3. **UI 复用** —— 已解决。`apps/web-ui` 已复刻 Campaign 列表 / 详情 / 内容追踪看板、Agent 面板、三个审批 Banner（Permission / AskUser / ExitPlanMode），并各自带 BDD 测试。
4. **Docker 部署** —— 已解决。根目录已有可执行多阶段 `Dockerfile`（COPY package.json → bun install → typecheck + build → 生产镜像）与 `docker-compose.yml`；`MAPRO_DATA_DIR` 已在 `apps/web/src/context.ts` 注入；`/health` 端点已有；SIGTERM 优雅关闭已补。
5. **阶段 B 周期** —— 仍然成立。内部单用户/小团队 Web 版 8–12 周可能成立；SaaS 级多租户 Agent 是一次平台安全架构重建，周期更长。

本文件保留「方向规划」定位：指明边界与优先级，具体脚本与依赖版本以代码为准。

---

## 二、范围与阶段

### 保留桌面端

- 桌面端 Electron 保持不变，作为完整功能的主部署通道。
- 桌面端用 `safeStorage`（OS keychain）加密 API Key。
- 桌面端数据存储在 `~/.mapro/`。
- 复杂工作流、Agent 执行、系统设置、语音听写、桥接集成等核心能力继续在桌面端提供。

### 阶段 A：Web MVP（已完成，分 A0/A1/A2）

阶段 A 的核心目标是：**验证「桌面业务逻辑能在服务端跑起来」**。截至 v0.1.14，A0/A1/A2 均已交付。

| 子阶段 | 范围 | 估算 | 状态 |
|--------|------|------|------|
| **A0** | `packages/server` 最小抽离 + Campaign `list` / `get` / `create` API | 1–1.5 周 | ✅ 已完成 |
| **A1** | Web UI 只读 Campaign + 内容追踪展示 | 1.5–2 周 | ✅ 已完成 |
| **A2** | Chat 流式 + 最小渠道密钥方案（环境变量单 Provider） | 2–3 周 | ✅ 已完成 |
| **合计** | | **5–6.5 周** | 架构验证通过，已进入阶段 B |

#### A0 范围（最小化）

✅ 做：
- 新建 `packages/server`，抽象 `AppContext` / `CryptoProvider` / `EventSink`。
- 从 `campaign-manager.ts` 中抽出 **CampaignRepository** / **CampaignQueryService**，只保留：
  - 数据库初始化
  - `listCampaigns()` / `getCampaignById()` / `createCampaign()`
  - 内容追踪读接口
- 新建 `apps/web/` Express 骨架，暴露最小 REST API。
- 不引入 Agent、workspace、KOL 服务、内容审核等依赖。

❌ 不做：
- 不搬 `campaign-manager.ts` 整文件。
- 不处理工作流、候选池导入、Brief、内容审核。
- 不处理多租户。

#### A1 范围（只读 Web UI）

✅ 做：
- 新建 `apps/web-ui/`，复刻 Campaign 列表 / 详情 / 内容追踪看板。
- 建立 `PlatformAPI` 抽象接口，Web 端注入 `fetch` 实现。
- 把纯展示逻辑从 `CampaignDetail.tsx` 等组件中抽出，数据操作通过 `PlatformAPI` 注入。

❌ 不做：
- 不实现编辑、工作流执行、候选池导入、Brief 生成。
- 不实现 Chat / Agent。

#### A2 范围（Chat 流式，可选）

✅ 做：
- 迁移 Chat 流式调用到 Web。
- 定义一种**最小渠道密钥方案**：例如环境变量单 Provider、服务端配置文件，或 Web 设置页的极简版。

❌ 不做：
- 不迁移完整的渠道管理 UI。
- 不做 Agent 模式。

> **建议**：如果阶段 A 的核心目标是验证 Campaign Web 化，A2 可以推迟到阶段 B 再做。

### 阶段 B：全功能迁移

阶段 B 是否启动，应在阶段 A 验证架构和需求后再决定。

| 目标类型 | 周期估算 | 说明 |
|----------|----------|------|
| 内部单用户/小团队 Web 版 | 8–12 周 | 不强制多租户，重点补齐 Agent 和工作流 |
| SaaS 级多租户 Agent | 12–18 周或更长 | 涉及进程隔离、资源隔离、命令审计、平台安全架构重建 |

阶段 B 关键工作（含 v0.1.14 现状）：

| 模块 | 复杂度 | 现状 | 说明 |
|------|--------|------|------|
| Agent 服务端化 | 🔴 最高 | 🟡 核心已落地 | `agent-orchestrator.ts` / 权限 / AskUser / ExitPlan / WebSocket / Docker runner / native runner 均已实现并有测试；**待办**：命令审计日志、资源限制（CPU/内存/网络）、危险工具禁用清单、沙箱专项测试 |
| IPC 全量迁移 | 🔴 高 | 🟡 部分 | Web 端已有 `agent.ts` + `campaign.ts` 两组路由；**待办**：文件附件、设置/用户档案、渠道 CRUD、系统能力（截图/快捷键/语音）的 Web 策略 |
| 工作区文件系统 Web 化 | 🟠 高 | 🟡 部分 | `FileProvider` 接口已定义（`packages/server/src/files/types.ts`）+ `LocalFileProvider` 实现；**待办**：按 session/user 隔离路径、Web 上传下载 API、产物在线预览 |
| 多用户 / 认证 / 授权 | 🟠 高 | ⬜ 未开始 | 阶段 A 单用户匿名；**待办**：JWT + 用户/角色/权限模型（SaaS 化时启动） |
| PostgreSQL 迁移 | 🟡 中高 | 🟡 部分 | `PostgresDbProvider` 已是真实 `pg.Pool` 实现（非骨架），但默认仍用 SQLite（`campaign.ts` 用 `SqliteDbProvider`）；**待办**：配置开关、迁移脚本、方言差异测试、数据导入导出工具 |
| 前端补齐 | 🟡 中高 | 🟡 部分 | Agent 面板 + 三个审批 Banner + Campaign 只读视图已交付并带测试；**待办**：13 步工作流执行 UI、设置面板、文件预览、拖拽上传、Brief/审核/追踪录入 |

### 维护策略：避免两套业务逻辑

| 层级 | 维护策略 |
|------|---------|
| 业务逻辑 | **一套**：抽象到 `packages/server`，Electron 和 Web 共用 |
| 数据访问 | **一套 + 适配**：通过 `AppContext` / `CryptoProvider` 注入不同存储/加密实现 |
| 传输层 | **两套**：Electron IPC + Express/WebSocket，保持薄层 |
| 共享 UI 组件 | **一套**：把纯展示组件抽到 `packages/ui`，桌面端和 Web 端共用 |
| 平台适配 API | **一套接口 + 两套实现**：`PlatformAPI` 接口统一，Electron/Web 分别实现 |

> 注意：当前 `packages/ui` 只有 `CodeBlock`、`MermaidBlock` 和 `useSmoothStream`。Campaign 相关组件需要从 `apps/electron/src/renderer/components/agent/` 中**逐步抽离纯展示部分**，而不是直接复用整文件。

推荐模式：

```
共享 UI 组件（逐步抽到 packages/ui）
    ↑
平台适配接口（PlatformAPI）
    ↑
Electron renderer ←──IPC──→ Electron main ←──调用──→ packages/server
Web SPA           ←──HTTP/WS──→ apps/web  ←──调用──→ packages/server
```

---

## 三、架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        桌面端（保留完整功能）                  │
│  ┌──────────────┐    IPC     ┌──────────────┐              │
│  │ React UI     │◄──────────►│ Electron 主进程 │            │
│  │ (renderer)   │ contextBridge│ (main/lib/)   │            │
│  └──────────────┘            └──────────────┘              │
│                             │ safeStorage                   │
│                             │ ~/.mapro/                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 共享 packages/server（阶段 A 先抽纯数据服务）
                              │
┌─────────────────────────────────────────────────────────────┐
│                       Web 服务端（阶段 A 先做 MVP）            │
│  ┌──────────────┐    HTTP    ┌──────────────┐              │
│  │ React SPA    │◄──────────►│ Express API  │            │
│  │ (web-ui)     │  WebSocket │ (apps/web/)  │            │
│  └──────────────┘            └──────────────┘              │
│                             │ serverCrypto                  │
│                             │ SQLite / 注入的 data dir      │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、技术栈

| 层面 | 桌面端 | Web 服务端（阶段 A） | Web 服务端（阶段 B） |
|------|--------|---------------------|---------------------|
| 运行时 | Electron + Bun | Bun（推荐） | Bun 或 Node.js 18+ |
| 框架 | Electron | Express + ws | Express + ws |
| 数据库 | SQLite | SQLite | PostgreSQL（推荐） |
| 加密 | `safeStorage`（OS keychain） | AES-256-GCM + 服务器密钥 | AES-256-GCM + 服务器密钥 / KMS |
| 实时通信 | IPC | WebSocket（SSE 仅作降级） | WebSocket（SSE 仅作降级） |
| 前端 | React + Vite | React + Vite（独立 SPA） | React + Vite（独立 SPA） |
| 部署 | 本地打包 | Docker（单用户） | Docker / K8s（多租户） |

---

## 五、实施路径

### 阶段 A0：服务层最小抽离（1–1.5 周）✅ 已完成

1. 新建 `packages/server`
   - 抽象 `AppContext` / `CryptoProvider` / `EventSink`。
   - 定义数据目录注入接口（替代 `homedir()` 硬编码）。
2. 新建 `CampaignRepository` / `CampaignQueryService`
   - 只包含 DB 初始化、`list` / `get` / `create`、内容追踪读接口。
   - 不引入 workspace、Agent、KOL 服务、内容审核。
3. 新建 `apps/web/` Express 骨架，暴露最小 REST API。
4. 验证 `bun run typecheck`，确认 `packages/server` 无 Electron 依赖。

### 阶段 A1：只读 Web UI（1.5–2 周）✅ 已完成

1. 新建 `apps/web-ui/`，Vite + React + Jotai。
2. 建立 `PlatformAPI` 抽象接口。
3. 从 `CampaignDetail.tsx` 等组件中抽离纯展示组件。
4. 实现 Campaign 列表 / 详情 / 内容追踪看板（只读）。
5. 工作流面板展示为只读，执行按钮隐藏或禁用。

### 阶段 A2：Chat 流式（可选，2–3 周）✅ 已完成（采用方案 A 环境变量单 Provider）

1. 定义最小渠道密钥方案：
   - 方案 A：环境变量单 Provider（最简单，适合自托管）。
   - 方案 B：服务端配置文件。
   - 方案 C：Web 设置页极简版（风险更高，阶段 A 不推荐）。
2. 迁移 Chat 流式调用到 Web（WebSocket 主通道）。
3. 不迁移完整渠道管理 UI。

### 阶段 B：全功能迁移（进行中）

阶段 A 验证通过，已进入阶段 B。`agent-orchestrator.ts` 已迁移到服务端（`apps/web/src/agent/`），权限 / AskUser / ExitPlan 审批链已打通，Docker runner 与 native runner 均已实现。剩余关键方向：

1. **Agent 安全加固**：命令审计日志、资源限制（Docker `--cpus/--memory/--network`、native ulimit）、危险工具/命令禁用清单、沙箱隔离专项测试。
2. **IPC 增量迁移**：在现有 `agent.ts` + `campaign.ts` 基础上补齐文件附件、设置/用户档案、渠道 CRUD、系统能力 Web 策略。
3. **多租户与数据库迁移**：设计用户/角色/权限模型，迁移 SQLite → PostgreSQL（`PostgresDbProvider` 已就绪，待接入与方言测试）。
4. **前端补齐**：13 步工作流执行 UI、设置面板、文件预览、拖拽上传、Brief/审核/追踪录入。
5. **双端测试覆盖**：同一业务逻辑覆盖 Electron IPC 路径和 Web HTTP/WS 路径（当前 Web 侧 Banner / AgentPage / orchestrator / websocket 测试已较全，Electron↔Web 一致性专项仍缺）。

---

## 六、关键前置决策

阶段 A 的前置决策均已落地，阶段 B 决策按需推进：

| 决策项 | 阶段 A（已落地） | 阶段 B（待定） |
|--------|------------|------------|
| 数据目录 | ✅ `AppContext` 注入，`MAPRO_DATA_DIR` 环境变量覆盖（`apps/web/src/context.ts`） | 是否需要按用户分目录 |
| 渠道密钥 | ✅ 环境变量单 Provider（`MAPRO_CHAT_*`） | 完整渠道管理 + 多用户隔离 |
| 数据库 | ✅ SQLite 沿用，`DbProvider` 抽象就绪 | PostgreSQL 切主 + 多租户策略 |
| 加密 | ✅ `CryptoProvider` 抽象 + 服务端密钥 | KMS / HashiCorp Vault 等 |
| 用户认证 | ✅ 单用户匿名 | JWT + 用户/角色/权限模型 |
| Agent 隔离 | 🟡 Docker runner / native runner 已实现（含超时） | 资源限制（CPU/内存/网络）+ 命令审计 + 沙箱加固 |

> `config-paths.ts` 已改为通过 `AppContext.getConfigDir()` 获取目录，不再硬编码 `homedir()`；`apps/web/src/context.ts` 读取 `MAPRO_DATA_DIR`，Docker 数据目录已真正生效。

---

## 七、风险与应对

| 风险 | 可能性 | 影响 | 应对 | 状态 |
|------|--------|------|------|------|
| 阶段 A 范围膨胀 | 中 | 高 | 严格冻结 A0/A1/A2 边界，A2 可选 | ✅ 已控制 |
| Chat 渠道密钥方案未定 | 高 | 高 | A0/A1 不做 Chat，A2 必须先定最小方案 | ✅ 已定（环境变量单 Provider） |
| `campaign-manager.ts` 依赖过重 | 高 | 高 | 阶段 A 只抽 Repository/QueryService，不搬整文件 | ✅ 已抽离 |
| UI 复用成本超预期 | 中 | 中 | 按「抽纯展示组件 + 注入数据操作」估算 | ✅ 已复刻 |
| `MAPRO_DATA_DIR` 未真正注入 | 高 | 中 | 阶段 A0 必须改造 `config-paths.ts` 的目录获取逻辑 | ✅ 已注入 |
| Docker 草案直接执行失败 | 高 | 低 | 文档明确为草案，开工前单独制定可执行版本 | ✅ 已有可执行版 |
| 依赖版本冲突 | 中 | 中 | 不写死版本号，开工前按项目规则搜索/测试确定 | ✅ 已验证 |
| 阶段 B 周期低估 | 高 | 高 | 阶段 B 估算加限定语，SaaS 级需单独评估 | ⚠️ 仍需关注 |
| Web 端无鉴权即暴露端口 | 高 | 高 | 阶段 A 单用户可不做认证，但部署须绑定 localhost 或前置反向代理鉴权 | ⚠️ 待文档约束 |
| Agent 服务端命令无审计 | 高 | 高 | 阶段 B 必须补命令审计日志 + 危险工具禁用清单 | ⬜ 待办 |

---

## 八、Docker / 部署（已可执行）

根目录已有真实可执行的 `Dockerfile` 与 `docker-compose.yml`，无需再从草案制定。多阶段构建：builder 阶段复制各 workspace `package.json` → `bun install` → typecheck + 前端 build；生产镜像只复制运行所需文件，`ENV MAPRO_DATA_DIR=/app/data`、`ENV MAPRO_WEB_UI_DIR=/app/web-ui-dist`，由 `apps/web` 托管静态资源。

### 关键实现点（均已落地）

| 项 | 实现 | 位置 |
|----|------|------|
| 数据目录注入 | `process.env.MAPRO_DATA_DIR ?? join(cwd(), '.mapro')` | `apps/web/src/context.ts:34` |
| 健康检查 | `GET /health` 返回 `{ status, chatEnabled, agentEnabled }` | `apps/web/src/index.ts:38` |
| 优雅关闭 | `SIGTERM`/`SIGINT` → 关闭 wss + HTTP server → 1s grace period 后退出 | `apps/web/src/index.ts`（本次补齐） |
| 构建脚本 | 无具名 `build:server`/`build:web`，Dockerfile 用 `bun run --filter='@ma-proma/*'` 直接 typecheck/build，不阻塞 | 根 `Dockerfile` |
| 端口 | HTTP `3000`、WebSocket `8081` | `docker-compose.yml` |

### 启动命令

```bash
# 本地开发（前后端热重载）
bun run web:dev

# 生产 Docker 部署
docker compose up --build -d
# 健康检查
curl http://localhost:3000/health
```

### ⚠️ 部署安全约束（阶段 A 单用户）

`docker-compose.yml` 将 `3000`/`8081` 映射到宿主机。阶段 A 不做认证，**生产部署必须**：
- 绑定 `127.0.0.1` 仅本地访问；或
- 前置反向代理（nginx/Caddy）加 Basic Auth / mTLS；或
- 不映射到公网端口。

否则 Agent WebSocket 与 Campaign API 会裸奔公网。阶段 B 接入 JWT 鉴权后解除该约束。

### 环境变量清单

| 变量 | 必需 | 说明 |
|------|------|------|
| `MAPRO_DATA_DIR` | 生产必填 | 数据根目录（SQLite/JSONL/工作区），Docker 默认 `/app/data` |
| `MAPRO_WEB_UI_DIR` | 生产必填 | 前端静态产物目录，Docker 默认 `/app/web-ui-dist` |
| `MAPRO_WEB_PORT` | 可选 | HTTP 端口，默认 `3000` |
| `MAPRO_WS_PORT` | 可选 | WebSocket 端口，默认 `8081` |
| `MAPRO_CHAT_PROVIDER` | 用 Chat 时必填 | 单 Provider（如 `deepseek`/`openai`/`anthropic`） |
| `MAPRO_CHAT_API_KEY` | 用 Chat 时必填 | 对应 Provider 的 API Key |
| `MAPRO_CHAT_BASE_URL` | 可选 | 自定义端点 |
| `MAPRO_CHAT_MODEL` | 可选 | 模型名 |
| `MAPRO_AGENT_*` | 用 Agent 时必填 | Agent 渠道配置（同 Chat 命名空间） |
| `MAPRO_ENCRYPTION_KEY` | 推荐 | 服务端密钥（AES-256-GCM），不设则用默认 |
| `MAPRO_DEV` | 可选 | `=1` 时用 `.mapro-dev` 目录 |

---

## 九、建议的下一步

1. **实测 Docker 闭环**：`docker compose up --build`，验证数据目录挂载、SQLite 落盘、`/health`、SIGTERM 优雅关闭（`docker stop` 应在 ~1s 内退出）。
2. **Agent 安全加固（阶段 B 核心）**：命令审计日志、Docker `--cpus/--memory/--network` 资源限制、危险工具/命令禁用清单、沙箱隔离专项测试。
3. **工作流执行 UI**：`CampaignWorkflowService` / `CampaignArtifactValidator` 已在 server 实现，补 Web 路由 + 13 步执行/校验/重置按钮（Campaign 主线价值所在）。
4. **Web 文件能力**：基于已就绪的 `FileProvider` 接口补上传下载 API + 文件预览组件 + 拖拽上传。
5. **PostgreSQL 切主**：`PostgresDbProvider` 已就绪，补配置开关 + 迁移脚本 + 方言差异测试（SaaS 化前启动）。
6. **测试补齐**：E2E smoke-test 接入 CI（脚本已有）、Electron↔Web 双端一致性专项、Docker runner 沙箱隔离测试。

---

## 十、实施进度对照（v0.1.14）

按部署 / 安全 / 映射 / 文件 / 数据 / 前端 / 测试 / 文档分组，逐项对照真实代码状态。

### P0 部署与运行闭环

| 项 | 状态 |
|---|---|
| 可执行 Dockerfile + docker-compose.yml | ✅ |
| 构建脚本（`--filter` 方式，无具名 build:server/build:web 但不阻塞） | ✅ |
| `MAPRO_DATA_DIR` 注入 | ✅ |
| `/health` 端点 | ✅ |
| SIGTERM 优雅关闭 | ✅ 本次补齐 |
| Docker 实测闭环（build + 落盘 + 健康检查 + stop） | ⬜ 待实测 |

### P1 Agent 服务端化安全与隔离

| 项 | 状态 |
|---|---|
| 编排器 / 权限 / AskUser / ExitPlan 审批链 | ✅ |
| Docker runner + native runner（均含超时 SIGKILL） | ✅ |
| 命令审计日志（持久化） | ⬜ |
| 资源限制（Docker `--cpus/--memory/--network`、native ulimit） | ⬜ |
| 危险工具 / 命令禁用清单（现有允许白名单 + `agent-tool-input-validator`，无可配置禁用） | ⬜ |
| 沙箱隔离专项测试（容器内无法访问宿主 `~/.mapro`） | ⬜ |

### P2 IPC 增量映射

| 项 | 状态 |
|---|---|
| `agent.ts` + `campaign.ts` 路由 | ✅ |
| 文件附件 API（上传 / 预览） | ⬜ |
| 设置 / 用户档案 API | ⬜ |
| 渠道 CRUD（Chat 流式已通，无渠道管理） | ⬜ |
| 系统能力 Web 策略（截图 / 快捷键 / 语音 → 明确不支持或替代） | ⬜ |

### P3 工作区文件系统 Web 化

| 项 | 状态 |
|---|---|
| `FileProvider` 接口 + `LocalFileProvider` 实现 | ✅ |
| 按 session/user 隔离路径 | ⬜ |
| Web 上传下载 API | ⬜ |
| 产物在线预览（Campaign 工作流 `.md` 内联渲染） | ⬜ |

### P4 数据库与数据层

| 项 | 状态 |
|---|---|
| `DbProvider` 抽象 + `SqliteDbProvider`（默认） | ✅ |
| `PostgresDbProvider`（真实 `pg.Pool`，非骨架） | ✅ |
| PG 切主配置开关 | ⬜ |
| SQLite/PostgreSQL 方言差异测试 | ⬜ |
| 数据迁移工具（`~/.mapro/*.sqlite` 导入导出） | ⬜ |

### P5 前端功能补齐

| 项 | 状态 |
|---|---|
| Agent 面板 + 三个审批 Banner（带 BDD 测试） | ✅ |
| Campaign 列表 / 详情 / 内容追踪（只读） | ✅ |
| Chat 流式（环境变量单 Provider） | ✅ |
| 13 步工作流执行 / 校验 / 重置 UI | ⬜ |
| 设置面板（General / Appearance / Channel / Agent） | ⬜ |
| 文件预览组件（图片 / PDF / Markdown） | ⬜ |
| 拖拽上传 | ⬜ |
| Brief 生成 / 内容审核 / 内容追踪录入 | ⬜ |

### P6 测试覆盖对齐

| 项 | 状态 |
|---|---|
| Banner 测试（关闭=拒绝 / planMode 隔离 / AskUser every 校验 / 连接断开错误） | ✅ |
| AgentPage 测试（文本不重复累加 / 切换会话停流） | ✅ |
| orchestrator 测试（权限 / AskUser / ExitPlan 全 action / 并发守卫 / plan 模式 Bash deny） | ✅ |
| websocket 测试（路由 / sessionId 隔离） | ✅ |
| E2E smoke-test 脚本（`scripts/smoke-test.ts`） | ✅ |
| E2E 接入 CI（配测试用 Provider key） | ⬜ |
| Electron↔Web 双端一致性专项 | ⬜ |

### P7 文档与工程规范

| 项 | 状态 |
|---|---|
| WEB-PLAN.md 同步至 v0.1.14 | ✅ 本次更新 |
| 环境变量清单 | ✅ |
| README Web 部署说明 | ⬜ |

---

*文档版本：v4.0（方向规划 + 进度对照版）*
*最后更新：2026-06-28*
*对应代码版本：MAPro v0.1.14*
*对应代码版本：MAPro v0.1.10*
