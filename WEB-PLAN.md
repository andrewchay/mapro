# MAPro Web 化方向规划

> 性质：**方向规划**，不是可直接执行的实施脚本。
>
> 目标：将 MAPro 桌面版扩展为「桌面 + Web 服务端」双端并行，核心服务层共享，UI 层按需复刻。
>
> 策略：采用**两阶段推进**，先做最小 MVP 验证架构与需求，再决定是否投入全功能迁移。

---

## 一、总体判断

这个规划的大方向是理性的，尤其是「**桌面保留完整功能、Web 先做单用户 MVP、阶段 A 不碰 Agent**」这个边界非常关键。

但在真正开工前，有几处工程成本被低估了：

1. **Chat MVP 不能随手加上**。现有 `chat-service.ts` 依赖 `listChannels` / `decryptApiKey`，而渠道密钥当前绑定 Electron `safeStorage`。Web 版必须先定义一种最小渠道方案，否则 Chat 跑不起来。
2. **服务层不能直接搬 `campaign-manager.ts`**。该文件除了 SQLite CRUD，还引入了 workspace、Agent、KOL 服务、内容审核等依赖。阶段 A 应该先抽纯数据服务。
3. **UI 复用成本比预期高**。`packages/ui` 目前只有 `CodeBlock`、`MermaidBlock` 和 `useSmoothStream`，Campaign 组件大量直接调用 `window.electronAPI`。复用需要「抽纯展示组件 + 注入数据操作」。
4. **Docker 草案不可直接执行**。根 `package.json` 目前没有 `build:server` / `build:web` 脚本；workspace 项目 Dockerfile 需要先复制各 workspace 的 `package.json`；`MAPRO_DATA_DIR` 也还未真正注入到 `config-paths.ts`。
5. **阶段 B 周期需加限定语**。如果只是内部单用户/小团队 Web 版，8–12 周可能成立；如果是 SaaS 级多租户 Agent，那不是「迁移」，而是一次平台安全架构重建，周期大概率更长。

因此，本文件从「实施脚本」降级为「方向规划」。具体脚本、依赖版本、package scripts 需要在开工前单独调研和制定。

---

## 二、范围与阶段

### 保留桌面端

- 桌面端 Electron 保持不变，作为完整功能的主部署通道。
- 桌面端用 `safeStorage`（OS keychain）加密 API Key。
- 桌面端数据存储在 `~/.mapro/`。
- 复杂工作流、Agent 执行、系统设置、语音听写、桥接集成等核心能力继续在桌面端提供。

### 阶段 A：Web MVP（再收窄，建议分 A0/A1/A2）

阶段 A 的核心目标是：**验证「桌面业务逻辑能在服务端跑起来」**，而不是交付一个功能丰富的 Web 版。

| 子阶段 | 范围 | 估算 | 目标 |
|--------|------|------|------|
| **A0** | `packages/server` 最小抽离 + Campaign `list` / `get` / `create` API | 1–1.5 周 | 验证抽象层可行 |
| **A1** | Web UI 只读 Campaign + 内容追踪展示 | 1.5–2 周 | 验证前端复用模式 |
| **A2** | Chat 流式 + 最小渠道密钥方案 | 2–3 周 | 验证非 Agent 的 AI 调用链路 |
| **合计** | | **5–6.5 周** | 按需决定是否进入 A2 |

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

阶段 B 关键工作：

| 模块 | 复杂度 | 说明 |
|------|--------|------|
| Agent 服务端化 | 🔴 最高 | Agent SDK 在服务端运行，必须解决进程隔离、资源隔离、命令审计 |
| IPC 全量迁移 | 🔴 高 | 287 个端点，很多是文件对话框、截图、托盘、剪贴板等 Electron 专属能力 |
| 工作区文件系统 Web 化 | 🟠 高 | `~/.mapro/agent-workspaces/{slug}/` 映射为按用户隔离的虚拟文件系统 |
| 多用户 / 认证 / 授权 | 🟠 高 | 从单用户本地应用升级为多租户服务端应用 |
| PostgreSQL 迁移 | 🟡 中高 | 替换 SQLite，处理方言差异、事务、数据迁移 |
| 前端补齐 | 🟡 中高 | 权限弹窗、AskUser、文件预览、拖拽上传等 Web 下重新设计 |

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

### 阶段 A0：服务层最小抽离（1–1.5 周）

1. 新建 `packages/server`
   - 抽象 `AppContext` / `CryptoProvider` / `EventSink`。
   - 定义数据目录注入接口（替代 `homedir()` 硬编码）。
2. 新建 `CampaignRepository` / `CampaignQueryService`
   - 只包含 DB 初始化、`list` / `get` / `create`、内容追踪读接口。
   - 不引入 workspace、Agent、KOL 服务、内容审核。
3. 新建 `apps/web/` Express 骨架，暴露最小 REST API。
4. 验证 `bun run typecheck`，确认 `packages/server` 无 Electron 依赖。

### 阶段 A1：只读 Web UI（1.5–2 周）

1. 新建 `apps/web-ui/`，Vite + React + Jotai。
2. 建立 `PlatformAPI` 抽象接口。
3. 从 `CampaignDetail.tsx` 等组件中抽离纯展示组件。
4. 实现 Campaign 列表 / 详情 / 内容追踪看板（只读）。
5. 工作流面板展示为只读，执行按钮隐藏或禁用。

### 阶段 A2：Chat 流式（可选，2–3 周）

1. 定义最小渠道密钥方案：
   - 方案 A：环境变量单 Provider（最简单，适合自托管）。
   - 方案 B：服务端配置文件。
   - 方案 C：Web 设置页极简版（风险更高，阶段 A 不推荐）。
2. 迁移 Chat 流式调用到 Web（WebSocket 主通道）。
3. 不迁移完整渠道管理 UI。

### 阶段 B：全功能迁移

阶段 B 的具体方案需在阶段 A 验证后再细化。关键方向：

1. **Agent 服务端化**：确定隔离方案（容器/受限进程/chroot），迁移 `agent-orchestrator.ts`。
2. **IPC 全量迁移**：补齐 287 个端点的 REST/WebSocket 映射。
3. **多租户与数据库迁移**：设计用户/角色/权限模型，迁移 SQLite → PostgreSQL。
4. **前端补齐**：Agent 模式、权限弹窗、AskUser、工作流执行、渠道管理、系统设置。
5. **双端测试覆盖**：同一业务逻辑覆盖 Electron 路径和 Web 路径。

---

## 六、关键前置决策

在真正开工前，必须先确定以下事项：

| 决策项 | 阶段 A 建议 | 阶段 B 再定 |
|--------|------------|------------|
| 数据目录 | 通过 `AppContext` 注入，支持环境变量覆盖（如 `MAPRO_DATA_DIR`） | 是否需要按用户分目录 |
| 渠道密钥 | 环境变量单 Provider 或服务端配置文件 | 完整渠道管理 + 多用户隔离 |
| 数据库 | SQLite 沿用 | PostgreSQL + 多租户策略 |
| 加密 | AES-256-GCM + 服务器密钥 | KMS / HashiCorp Vault 等 |
| 用户认证 | 阶段 A 可不做，或简单密码/token | JWT + 用户/角色/权限模型 |
| Agent 隔离 | 不做 | 容器 / 受限进程 / chroot |

> 当前 `config-paths.ts` 使用 `homedir()` 和 `~/.mapro` 逻辑，阶段 A 必须把 data dir 变成注入项，否则 Docker 数据目录不会真正生效。

---

## 七、风险与应对

| 风险 | 可能性 | 影响 | 应对 |
|------|--------|------|------|
| 阶段 A 范围膨胀 | 中 | 高 | 严格冻结 A0/A1/A2 边界，A2 可选 |
| Chat 渠道密钥方案未定 | 高 | 高 | A0/A1 不做 Chat，A2 必须先定最小方案 |
| `campaign-manager.ts` 依赖过重 | 高 | 高 | 阶段 A 只抽 Repository/QueryService，不搬整文件 |
| UI 复用成本超预期 | 中 | 中 | 按「抽纯展示组件 + 注入数据操作」估算 |
| `MAPRO_DATA_DIR` 未真正注入 | 高 | 中 | 阶段 A0 必须改造 `config-paths.ts` 的目录获取逻辑 |
| Docker 草案直接执行失败 | 高 | 低 | 文档明确为草案，开工前单独制定可执行版本 |
| 依赖版本冲突 | 中 | 中 | 不写死版本号，开工前按项目规则搜索/测试确定 |
| 阶段 B 周期低估 | 高 | 高 | 阶段 B 估算加限定语，SaaS 级需单独评估 |

---

## 八、Docker / 启动草案（不可直接执行）

以下 Dockerfile 和启动脚本仅为**方向示意**，用于说明部署形态。具体实现需要在开工前根据 workspace 结构、package scripts、数据目录注入策略、密钥方案等重新制定。

```dockerfile
# 草案：阶段 A 单容器部署
FROM oven/bun:1.2.5

WORKDIR /app

# TODO: 需要先复制根 package.json 和各 workspace package.json，再 bun install
# COPY package.json bun.lock ./
# COPY packages/shared/package.json ./packages/shared/
# COPY packages/server/package.json ./packages/server/
# COPY apps/web/package.json ./apps/web/
# RUN bun install

# TODO: 复制源码并构建
# COPY packages/shared ./packages/shared
# COPY packages/server ./packages/server
# COPY apps/web ./apps/web
# RUN bun run build:server && bun run build:web

EXPOSE 3000 8081
# CMD ["bun", "run", "start:web"]
```

```yaml
# docker-compose.yml 草案
version: '3.8'

services:
  web:
    build: .
    ports:
      - "3000:3000"
      - "8081:8081"
    environment:
      # TODO: 需先在 config-paths.ts 中支持 MAPRO_DATA_DIR 注入
      - MAPRO_DATA_DIR=/app/data
      - MAPRO_ENCRYPTION_KEY=${MAPRO_ENCRYPTION_KEY}
    volumes:
      - mapro-data:/app/data

volumes:
  mapro-data:
```

### 快速启动脚本草案（不可直接执行）

```bash
#!/usr/bin/env bash
# 草案：阶段 A0 骨架创建思路
# 以下命令仅为示意，依赖版本、目录结构、脚本名需在开工前调研确定。

set -e
cd /Users/chaihao/LLM/ma-proma

# TODO: 新建 packages/server
# mkdir -p packages/server/src/{context,campaign,chat,agent,kol,auth,tools}
# cd packages/server
# cat > package.json << 'PKG'
# {
#   "name": "@ma-proma/server",
#   "version": "0.1.0",
#   "type": "module",
#   "main": "dist/index.js",
#   "scripts": { "build": "tsc", "typecheck": "tsc --noEmit" },
#   "dependencies": { "@ma-proma/shared": "workspace:*" },
#   "devDependencies": { "typescript": "^5.0.0" }
# }
# PKG

# TODO: 新建 apps/web
# mkdir -p apps/web/src/{routes,middleware,websocket}
# cd apps/web
# 依赖版本需调研后确定，不要直接复制固定版本号

# TODO: 安装依赖并验证
# bun install
# bun run typecheck
```

---

## 九、建议的下一步

1. **召开一次范围冻结会**：明确阶段 A0/A1 必须交付什么，A2 做不做。
2. **制定前置决策清单**：数据目录注入、渠道密钥方案、Chat 最小方案。
3. **调研依赖版本**：Express、ws、jsonwebtoken、bcryptjs、tsx 等按项目规则确定版本。
4. **先做 A0 原型**：抽出 `CampaignRepository`，验证 `packages/server` 无 Electron 依赖。
5. **A0 验证通过后再写 Dockerfile**：那时 package scripts、workspace manifests、`MAPRO_DATA_DIR` 都已确定。

---

*文档版本：v3.0（方向规划版）*
*最后更新：2026-06-26*
*对应代码版本：MAPro v0.1.10*
