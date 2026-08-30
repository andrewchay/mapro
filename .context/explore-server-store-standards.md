# apps/server 多租户与 Store 标准姿势 — 实测探索（子Agent explore）

> 日期：2026-08-10
> 探索对象：`/Users/chaihao/LLM/proma-mit`（gravitas / @gravitas/*）
> 路径：`apps/server/src/` + `packages/shared/src/utils/`
> 只读探索，未改任何文件。
> 用途：为「营销域迁入 gravitas 第4 工作模块」实施方案提供 server 侧技术事实。
> 关联：`decision-maping-migration.md`（架构决策）待办「确认营销数据在 apps/server 的租户模型」。

## 1. 两套并存的数据/服务体系（重要前提）

gravitas monorepo 目前有**两套相互独立**的业务运行架构，营销域择路前必须先认清：

| 维度 | A. apps/server（Web/Agent 服务，多租户） | B. electron 主进程（桌面业务模块） |
|---|---|---|
| 入口 | `apps/server/src/index.ts` → `Bun.serve` HTTP | `apps/electron/src/main/` 直接跑在 Electron |
| 典型功能 | agent runtime（任务/会话/spans）、billing、audit、signals、scheduler、eval、MCP 服务端 | 工作模块 projects/calendar/automation（项目管理、日程、自动化工作流） |
| 数据层 | **Postgres**（`Bun.SQL`，多租户行级隔离） | **本地 SQLite**（`sql.js` + `better-sqlite3` 兼容，如 `~/.paa/projects/paa.db`），**无租户列** |
| store 范式 | `packages/shared` 定义接口 + `apps/server` Postgres 实现 | `apps/electron/src/main/lib/*service.ts` + `*sqlite-store.ts` |
| 对外暴露 | HTTP REST（`/agent/*`）+ OIDC JWT / trusted-header 认证 | Electron IPC（`ipcMain`）+ renderer |
| 模块注册 | 无注册表（路由手写 if-else 链） | `work-module-registry.ts` 注册 ActiveView |

> **已拍板约束（见决策文档）**：营销数据接入 **Postgres 多租户**、需**多人协作**。因此营销域**应落 A 体系**（apps/server 扩 store），并在 B 体系（work-module-registry + IPC handlers）注册 `marketing` 视图入口 —— 两者都要做：server 提供租户服务能力，electron 提供桌面模块 UI 入口。

## 2. 租户模型（apps/server）

- **scope 基本单元**：`AgentRuntimeScope = { tenantId: string; userId: string; roles?: AgentRuntimeRole[] }`
  - 定义文件：`packages/shared/src/utils/agent-runtime-server.ts:10`
  - 角色枚举：`viewer | operator | admin | security-auditor`
- **隔离方式 = 行级 `tenant_id` + `user_id` 列**，非 schema 级隔离。所有 Postgres 表都建这两列，SQL 每条 WHERE / PRIMARY KEY 都带上，天然隔离。in-memory 版用 `scopedKey(JSON.stringify([tenantId,userId,id]))` 模拟（`agent-runtime-tenant-store.ts`）。
- **接口契约**：`packages/shared/src/utils/agent-runtime-tenant-store.ts` 定义 `interface TenantRuntimeStore`（18 个方法：credential/workspace/session/messages/task/mcp-oauth/mcp-client-secret/permission-decision）。
- **Postgres 实现**：`packages/shared/src/utils/agent-runtime-postgres-store.ts` — `class PostgresTenantRuntimeStore implements TenantRuntimeStore`。
- **scope 注入路径**：
  - 认证后由 `auth(request)` 解析出 scope 注入每个请求：`apps/server/src/app.ts:290` `const scope = await auth({ request, url })`。
  - 生产走 OIDC JWT（`apps/server/src/jwt-auth.ts`，RS256 + JWKS，claim `tenant_id`/`sub`/`roles`）。
  - 本地/可信头（Electron 桌面本地调用最可能):`createTrustedHeaderAuth`：从 header `x-proma-tenant-id` / `x-proma-user-id` 读取，roles=`['operator']`（`apps/server/src/app.ts:1108+`）。
  - 角色门：`requireAgentActionRole(scope, request)` / `hasAnyRole(scope, ['admin'])` 等做功能级权限。

## 3. 建表机制

- **无独立 SQL 迁移文件，无 ORM/迁移框架**（全程未发现 knex/drizzle/prisma/typeorm/.sql 迁移文件）。
- **建表 = 运行时手写 SQL 幂等初始化**，统一模式：
  ```
  CREATE TABLE IF NOT EXISTS xxx (...) 
  CREATE INDEX IF NOT EXISTS ...
  ALTER TABLE xxx ADD COLUMN IF NOT EXISTS yyy ...
  ```
- 每个 store 实现 `initializeSchema()` 方法；`apps/server/src/app.ts:initialize()` 里**按序逐个调用**（`store / taskLease / usageLedger / auditLog / spanStore / signalStore / evalDataset / interaction / scheduler .initializeSchema()`），无需删库即可升级（`ADD COLUMN IF NOT EXISTS` 补漏列）。
- Postgres 客户端：`class BunPostgresClient`（`apps/server/src/app.ts:1072`）包装 `Bun.SQL`，只暴露 `query(sql, params)`。接口 `AgentRuntimePostgresClient` 定义于 `packages/shared/src/utils/agent-runtime-postgres-store.ts`。
- 时间戳统一用 `BIGINT`（`Date.now()`），JSON 用 `JSONB`/`TEXT` + `::jsonb` 转换，主键常为 `(tenant_id, user_id, <业务id>)` 复合。

## 4. 现有 Store 清单与职责（apps/server/src/ + shared/utils/）

| Store 类 | 文件 | 建表（表名） | 职责 |
|---|---|---|---|
| `PostgresTenantRuntimeStore` | `packages/shared/src/utils/agent-runtime-postgres-store.ts` | `proma_runtime_credentials/workspaces/sessions/session_messages/tasks/mcp_oauth_tokens/mcp_client_secrets/permission_decisions` | agent runtime 会话/任务/MCP 凭证；**最核心租户 store** |
| `PostgresAuditLog` | `apps/server/src/audit.ts` | `proma_runtime_audit_log`、`proma_runtime_audit_legal_holds` | 仅追加审计 + 法律保全 |
| `PostgresUsageLedger` | `apps/server/src/billing.ts` | `proma_runtime_usage`、`proma_runtime_budget_alerts` | 用量账本 + 预算告警 + 成本计费 |
| `PostgresRuntimeSpanStore` | `apps/server/src/spans.ts` | `proma_runtime_spans`（+2 索引） | tracing（trace/span/flame） |
| `PostgresSignalStore` | `apps/server/src/signals.ts` | `proma_runtime_signals`、`proma_runtime_signal_hits` | 信号定义/命中（监控规则） |
| `PostgresRuntimeMetrics` | `apps/server/src/metrics.ts` | 无建表（聚合查 tasks/usage） | 运行指标（24h 任务/成本/token） |
| `PostgresServerSchedulerStore` | `apps/server/src/scheduler-store.ts` | `proma_runtime_schedules`、`proma_runtime_schedule_runs` | 定时任务（interval/cron） |
| `PostgresEvalDatasetStore` | `apps/server/src/eval-dataset.ts` | `proma_runtime_eval_datasets`、`proma_runtime_eval_samples` | 评测数据集/样本 |
| `PostgresTaskRecoveryInspector` | `apps/server/src/recovery.ts` | 无建表（查 tasks） | 僵死任务恢复 |
| `PostgresAgentRuntimeInteractionStore` | `packages/shared/src/utils/agent-runtime-interaction-store.ts` | `proma_runtime_interactions` | 交互记录 |
| `PostgresRunProfileAggregator` | apps/server（见 app.ts 构造） | 无 | run profile 聚合 |
| `PostgresTaskLease` | apps/server（app.ts） | `proma_*` lease 表 | 任务租约/worker 锁 |
| `HttpOperationsReporter`/`NoopOperationsReporter` | `apps/server/src/operations.ts` | 无 | SIEM/alert webhook + trace 上报 |
| Redis 侧：`RedisAgentRuntimeEventStore`、`RedisTaskRateLimiter` | `packages/shared/src/utils/agent-runtime-redis-store.ts` | Redis | durable event / 限流 |

> 说明：业务能力集中在「session/task/audit/usage/span/signal/scheduler/eval」，**尚无 generic 实体 CRUD store**。营销域（KOL/达人/稿件/Campaign/投放）是新的**业务实体域**，需要新增自己的 store，可复用这套 Postgres store 范式。

## 5. 新增业务域的标准姿势（⚠️ 营销域落地的核心结论）

**参考现成 store 的最佳仿写对象：`PostgresEvalDatasetStore`（`apps/server/src/eval-dataset.ts`）或 `PostgresSignalStore`（`apps/server/src/signals.ts`）** —— 它们都是"业务实体 + 部分上下文"型，最贴近营销实体域。

新增一个业务域（如 marketing delivery/KOL）遵循如下 5 步：

1. **类型层**（`apps/server/src/<domain>.ts`）：
   - 实体接口 `extends AgentRuntimeScope`（自带 tenantId/userId），如 `interface KOL extends AgentRuntimeScope`。
   - `class Postgres<Domain>Store`，构造注入 `AgentRuntimePostgresClient`。
   - `async initializeSchema()` 内写 `CREATE TABLE IF NOT EXISTS proma_runtime_<domain>_...`，每条 SQL 带 `tenant_id, user_id` 列 + 复合主键。
2. **store 方法**：每个方法第一参是 `scope: AgentRuntimeScope`，SQL 一律 `WHERE tenant_id=$1 AND user_id=$2 ...`，时间戳 `Date.now()` 存 `BIGINT`，JSON 字段 `::jsonb`。
3. **DI 装配**：在 `apps/server/src/app.ts:createPromaWebServerApplication()` 顶部 `new Postgres<Domain>Store(postgres)`（与 usageLedger/auditLog 同排）；在 `initialize()` 里追加 `await <domain>Store.initializeSchema()`。
4. **暴露方式（HTTP REST，`/agent/*` 前缀）+ 角色门**：
   - `apps/server/src/app.ts` `fetch()` 内手写 if-else 路由，如 `/agent/delivery`, `/agent/kols` 等；每个请求先 `auth()` 得 scope，再 `hasAnyRole(scope,[...])` 做权限。
   - 只读 GET 用 query/parse；POST/DELETE 走 body + 路由 path 段（参考 signals、datasets 的写法，含 `matchXxxRoute`+`decodeURIComponent` path 解析）。
   - 挂审计：`fetch()` 末尾已统一 `auditLog.append({...scope, action, resource:url.pathname, result})`，新路由自动入审计，无需自建。
5. **UI/桌面侧接入（另配）**：在 `apps/electron/src/renderer/atoms/active-view.ts` 追加 `'marketing'` 类型、`atoms/work-module-registry.ts` 注册「marketing」元数据 + 视图组件；主进程 `apps/electron/src/main/lib/` 新增 `marketing-service.ts` +（如需持久化）`marketing-sqlite-store.ts`，并在 `work-module-ipc-handlers.ts` 注册 IPC 通道；但**多租户数据源仍是 apps/server Postgres，electron 通过 HTTP/trusted-header 调 `apps/server`**，SQLite 仅存本地偏好/缓存。

## 6. 关键文件路径速查

```
apps/server/src/index.ts                      # 服务启动入口（Bun.serve, 端口默认 3000, env PROMA_WEB_PORT）
apps/server/src/app.ts                        # createPromaWebServerApplication：DI 装配 + fetch() 手写路由 + initialize() 建表 + 认证/trace/审计
apps/server/src/jwt-auth.ts                   # OIDC JWT (RS256+JWKS) → AgentRuntimeScope
apps/server/src/audit.ts                      # PostgresAuditLog（仿写样板）
apps/server/src/billing.ts                    # PostgresUsageLedger / TenantBudgetPolicy
apps/server/src/signals.ts                    # PostgresSignalStore（仿写样板）
apps/server/src/eval-dataset.ts               # PostgresEvalDatasetStore（仿写样板）
apps/server/src/scheduler-store.ts            # PostgresServerSchedulerStore（interval/cron）
apps/server/src/spans.ts / metrics.ts / recovery.ts / operations.ts
packages/shared/src/utils/agent-runtime-server.ts            # AgentRuntimeScope / roles
packages/shared/src/utils/agent-runtime-tenant-store.ts      # TenantRuntimeStore 接口 + InMemory 实现
packages/shared/src/utils/agent-runtime-postgres-store.ts    # PostgresTenantRuntimeStore + AgentRuntimePostgresClient + 核心 schema SQL
packages/shared/src/utils/agent-runtime-interaction-store.ts  # PostgresAgentRuntimeInteractionStore
packages/shared/src/utils/agent-runtime-redis-store.ts        # Redis event store / rate limiter
packages/shared/src/utils/index.ts                            # @gravitas/shared/utils 导出桶
apps/electron/src/renderer/atoms/active-view.ts               # ActiveView 类型（加 marketing 在此）
apps/electron/src/renderer/atoms/work-module-registry.ts       # 工作模块注册表（加 marketing 在此）
apps/electron/src/main/lib/work-module-ipc-handlers.ts         # 主进程 IPC 注册（加 marketing handlers 在此）
apps/electron/src/main/lib/project-sqlite-store.ts             # SQLite store 样板（本地数据，非多租户）
```

## 7. 对营销域的推论（供父 Agent 整合）

- **租户隔离直接复用现有 `tenant_id`+`user_id` 行级隔离**，无需 schema 级改造。营销实体表（campaign/kolfun/kol/ad_account/稿件审核流）各表都加这两列即可。
- **新增的多租户业务实体 store**应放 `apps/server/src/marketing/`（或按子域拆 `delivery`/`kol`/`strategy`），仿 `PostgresSignalStore`/`PostgresEvalDatasetStore`。
- **审批流**：可复用现有 scheduler（定时）、signals/hits（监控命中）、audit（操作留痕）、member（协作成员，已确认存在成员体系）。指标类复用 `PostgresRuntimeMetrics` 风格聚合查询 `proma_runtime_usage` 或新增营销成本表。
- **投放凭证安全**：参考 `proma_runtime_mcp_client_secrets`(TEXT 存 secret) 与 `aws-kms.ts`(KMS 加密路径)。
- 营销 UI 需 electron 侧补 `marketing` 模块注册 + IPC，但**数据权威源在 apps/server Postgres**（符合已拍板"营销数据走 Postgres 多租户"）。
```
