# MAPro 多 Runtime Agent 架构（Provider-Agnostic Agent Runtime）

> 移植自 proma-mit `docs/provider-agnostic-agent-runtime.md`，已改写为 ma-proma 语境。
> 状态：迁移已完成并扩展为四 runtime 架构（claude / proma / pi / ai-sdk），默认 runtime 为 `claude`。

## 1. 背景与目标

早期 Agent 模式深度依赖 `@anthropic-ai/claude-agent-sdk`，导致：
- 多模型支持困难（SDK 原生为 Claude 设计）
- 工具名、权限模式、会话格式被 Claude 语义绑定
- Prompt 前缀缓存难以按供应商优化

本架构在保留 Claude SDK 路径的同时，构建了一个基于现有 `ProviderAdapter` 的 Provider-Agnostic Agent Runtime，并进一步扩展为多 runtime 体系。

## 2. 四种 Runtime

`AgentRuntime = 'claude' | 'proma' | 'pi' | 'ai-sdk'`（`@ma-proma/shared`），渲染层 AgentRuntimeSelector 按会话选择，`runtime-routing-agent-adapter.ts` 按会话 runtime 路由：

| Runtime | 适配器 | 说明 |
|---------|--------|------|
| `claude`（默认） | `adapters/claude-agent-adapter.ts` | Claude Agent SDK 路径；MCP 工具注入（memos / nano-banana / KOL Data / browser_fetch）仍需 SDK 对象，故保留 `claude-sdk-loader.ts` |
| `proma` | `adapters/provider-agnostic-agent-adapter.ts` | MAPro runtime：基于 `@ma-proma/core` ProviderAdapter + streamSSE 的自建工具循环 |
| `ai-sdk` | `adapters/ai-sdk-agent-adapter.ts` | Vercel AI SDK runtime：复用同一套工具循环，模型调用走 `agent-runtime/ai-sdk-runtime-core.ts` + `@ma-proma/core` 的 `providers/ai-sdk-bridge.ts` |
| `pi` | `adapters/pi-agent-adapter.ts` | Pi runtime：基于 `@earendil-works/pi-coding-agent`（`pi-message-adapter.ts` / `pi-model-registry.ts` / `pi-sdk-loader.ts`），只读工具白名单 |

配套机制：

- **能力矩阵**：`AGENT_RUNTIME_CAPABILITIES` / `AGENT_RUNTIME_HISTORY_SEMANTICS` / `AGENT_PROVIDER_RUNTIME_CAPABILITIES`（11 个 Provider × runtime 能力）+ `resolveAgentRuntimeBaseUrl`；渲染层 `lib/agent-runtime-channels.ts` 按 runtime 过滤可用渠道
- **编排层解耦**：`agent-orchestrator.ts` 只依赖 `AgentProviderAdapter` 接口 + AgentEventBus，不再直接调用 SDK
- **新增 ProviderType**：`kimi-api` / `kimi-coding`

## 3. 架构决策

### 3.1 不自研 Pi 类 harness

Pi 等极简 terminal harness 缺少 MCP、权限系统、Plan 模式、子 Agent 等 MAPro 已具备的能力，重新实现成本过高。Pi runtime 仅作为只读白名单的备选路径接入。

### 3.2 基于现有 ProviderAdapter 构建

复用 `@ma-proma/core` 的 `ProviderAdapter`、`buildStreamRequest`、`streamSSE`、`ToolCall` 抽象，在 Electron 主进程新增：

```
apps/electron/src/main/lib/agent-runtime/
├── types.ts                    # Runtime 输入、工具、消息类型
├── tool-registry.ts            # 工具注册与分发
├── prompt-builder.ts           # 系统提示词 + 历史消息转换
├── attachment-enrichment.ts    # 文档/图片附件富化
├── retry.ts                    # 瞬时错误重试
├── mcp-client.ts               # MCP 服务器连接与工具加载
├── mcp-client-cache.ts         # MCP 客户端跨会话缓存
├── mcp-client-secret-store.ts  # MCP OAuth client_secret 加密存储
├── mcp-oauth-store.ts          # MCP OAuth token 加密存储
├── mcp-oauth-provider.ts       # MCP OAuth ClientProvider 实现
├── mcp-oauth-pending.ts        # MCP OAuth 授权 pending 注册表
├── ai-sdk-runtime-core.ts      # AI SDK runtime 核心
├── runtime-services.ts         # Runtime 共享服务装配
├── runtime-mcp-service.ts      # Runtime MCP 服务
├── runtime-secret-codec.ts     # Runtime 密钥编解码
└── tool-impls/                 # 40+ 内置工具
    ├── read-tool.ts / write-tool.ts / edit-tool.ts
    ├── bash-tool.ts / grep-tool.ts
    ├── plan-mode-tools.ts      # EnterPlanMode / ExitPlanMode
    ├── ask-user-tool.ts        # AskUserQuestion
    ├── agent-tool.ts           # Sub Agent 委派
    ├── goal-checkpoint-tool.ts # Goal 检查点
    ├── web-bridge-tools.ts     # WebBridge×12 受管浏览器
    ├── computer-use-tools.ts   # ComputerUse×15 桌面操控
    ├── mcp-resource-tools.ts   # MCP 资源发现/读取
    └── tool-utils.ts

apps/electron/src/main/lib/adapters/
├── claude-agent-adapter.ts
├── provider-agnostic-agent-adapter.ts
├── ai-sdk-agent-adapter.ts
├── pi-agent-adapter.ts / pi-message-adapter.ts / pi-model-registry.ts / pi-sdk-loader.ts
└── runtime-routing-agent-adapter.ts   # 按会话 runtime 路由
```

### 3.3 多 backend 共存

`AgentOrchestrator` 通过 `runtime-routing-agent-adapter.ts` 按会话 runtime 分发到对应适配器。默认 `claude`，避免影响现有用户；`proma` / `ai-sdk` / `pi` 由用户在会话级显式选择。

## 4. 特性对齐要点

### 4.1 权限模式完整映射

| 目标模式 | 行为 |
|---------|------|
| `allow-all` | 所有工具调用自动允许 |
| `ask` | 非只读操作通过 `AgentPermissionService` 弹审批 |
| `safe`（新增） | 仅放行 SAFE_TOOLS 白名单内只读工具与只读 Bash，默认拒绝写操作；claude 路径映射为 SDK `auto` + 严格 canUseTool |

### 4.2 AskUser 工具

- `tool-registry.ts` 注册 `AskUserQuestion` 工具
- 适配器在 `executeToolCalls` 中拦截，调用 `onAskUser` 回调
- `agent-orchestrator.ts` 通过 `askUserService.handleAskUserQuestion` 将问题发送到 UI 并等待回答
- 回答以 JSON 形式注入工具结果，模型可继续后续工具循环
- AskUserBanner 支持 `computer_use_takeover` 接管（用户亲自完成敏感桌面操作）

### 4.3 子 Agent（Sub Agent）

- `agent-tool.ts` 注册 `Agent` 工具，适配器透传给 `runSubAgent` 回调
- 子代理使用内置定义（`code-reviewer` / `explorer` / `researcher`），session ID 为 `sub-{parentSessionId}-{uuid}`，不污染主会话历史
- 子代理默认 `bypassPermissions` 运行，避免向主会话 UI 发送未知 sessionId 的审批请求

### 4.4 MCP OAuth

- `@ma-proma/shared` 的 `McpServerAuthConfig` 支持 `none` / `bearer` / `oauthAuthorizationCode` / `oauthClientCredentials`
- `mcp-oauth-store.ts`：safeStorage 加密存储 token
- `mcp-oauth-provider.ts`：实现 `OAuthClientProvider`；`authorization_code` 打开系统浏览器授权，通过 `mapro://` DeepLink 回调完成授权码交换（`main/index.ts` 注册协议，处理 macOS `open-url` 与 Windows `second-instance`）
- `mcp-oauth-pending.ts`：按 `workspaceSlug:serverName` 索引待完成的 `transport.finishAuth`
- `mcp-client-secret-store.ts`：`client_secret` 经 safeStorage 加密集中存于 `~/.mapro/mcp-client-secrets.json`，`mcp.json` 只保留空占位
- 渲染层 `McpOAuthBanner` 显示待授权服务器，DeepLink 回调完成后自动清除

### 4.5 MCP 其他加固

- **MCP 资源工具**：`ListMcpResourcesTool` / `ReadMcpResourceTool`（只读，`safe` / `plan` 模式默认放行）
- **跨会话连接缓存**：`mcp-client-cache.ts` 按 `workspaceSlug` + 配置指纹复用连接，最后一次使用后 5 分钟自动断开

### 4.6 Web Bridge 与 Computer Use 工具

- `web-bridge-tools.ts`：12 个 WebBridge* 工具，驱动 `web-bridge-service.ts` 的受管浏览器（每会话可见 BrowserWindow 或连接用户 Chrome CDP）
- `computer-use-tools.ts`：15 个 ComputerUse* 工具，驱动 `computer-use-service.ts` 的 OS 级桌面操控（macOS，自研 N-API 模块，TCC 授权）
- 约束：Web Bridge 有结构化页面元素时禁止降级到 Computer Use 操作网页；`ComputerUseRequestTakeover` 让用户接管敏感操作；PermissionBanner 对 WebBridge / ComputerUse 写操作逐次确认
- 两类操作均写入本地脱敏审计（`~/.mapro/{web-bridge-audit,computer-use-audit}/events.jsonl`），由 `agent-audit-service.ts` 统一查询导出

### 4.7 Goal Runtime

- 用户在 Agent 输入框以 `@goal <目标>` 显式创建长程目标（仅 proma / ai-sdk runtime；`@goal` 同时是文件 mention 保留命令）
- `goal-runtime/goal-coordinator.ts`：状态机、检查点校验、最多连续 3 次立即续跑、重启恢复 `recoverDueGoals`
- `goal-runtime/goal-store.ts`：持久化 `~/.mapro/goals.json` + `goals/{id}.jsonl` 审计
- `GoalCheckpoint` 工具由编排层拦截原子持久化；IPC 暴露 `listAgentGoals` / `updateAgentGoalStatus`

## 5. 安全基线

### 5.1 权限检查

适配器在 `executeToolCalls` 前调用权限回调：
- `allow-all`：全部放行
- `ask`：复用 `AgentPermissionService.createCanUseTool`，通过 event bus 向渲染进程发送 `permission_request`
- `safe`：本地 classifier 仅放行只读工具与只读 Bash，写操作直接拒绝
- `plan`：只允许只读工具、写 `.md` 计划文件、只读 Bash、`mcp__*` 调研工具
- 未配置回调：只读工具（Read/Grep）放行，写工具（Write/Edit/Bash）拒绝

### 5.2 路径安全

`resolveToolPath()` 使用 `realpathSync` 解析目标路径和 cwd，并逐级向上检查不存在的祖先目录，防止 symlink 绕过路径遍历限制。

### 5.3 命令注入防护

`Grep` 工具使用 `spawn(command, args)` + 参数数组执行，不拼接 shell 字符串。

### 5.4 Web Bridge 安全基线

仅允许 http(s)、禁止 URL 内嵌凭据、文件上传必须系统文件选择器确认、下载 50MB 上限且文件名消毒落盘 `~/.mapro/web-bridge-downloads/`、页面快照 16000 字符截断。

### 5.5 审计脱敏

`web-bridge-audit-service.ts` / `computer-use-audit-service.ts` 追加写 JSONL，不存截图、页面正文、输入原文与绝对路径。

## 6. 缓存策略

OpenAI / DeepSeek / GLM / Kimi 等大多采用自动前缀缓存。Runtime 的消息顺序为：

1. 系统提示词（稳定）
2. 工具定义（稳定）
3. 历史消息（动态增长）
4. 当前用户消息（动态）

通过将稳定前缀放在前面，最大化自动前缀缓存命中率，无需供应商特定缓存 flag。

## 7. 测试覆盖

| 测试文件 | 说明 |
|---------|------|
| `agent-runtime/tool-impls/tool-impls.test.ts` | Read / Write / Edit / Bash / Grep / Agent 单元测试；含 symlink 绕过、Grep shell 注入、Sub Agent 委派 |
| `agent-runtime/tool-impls/web-bridge-tools.test.ts` | WebBridge 工具参数校验与安全限制 |
| `agent-runtime/tool-impls/computer-use-tools.test.ts` | ComputerUse 工具参数校验 |
| `agent-runtime/prompt-builder.test.ts` | system prompt 构建、SDKMessage → ChatMessage 转换、历史截断 |
| `agent-runtime/retry.test.ts` | withRetry 成功、重试、不可重试、最大次数、中止信号 |
| `agent-runtime/attachment-enrichment.test.ts` | 文档附件富化、图片附件过滤、XML 转义、空附件/失败降级 |
| `agent-runtime/mcp-oauth.test.ts` | token 加密存储、OAuth provider 元数据、client_credentials 参数、pending 注册表 |
| `agent-runtime/mcp-client.test.ts` | MCP 工具名规范化（非法字符、超长截断、`mcp__` 前缀保留） |
| `agent-runtime/mcp-client-secret-store.test.ts` | client_secret 保存/读取/删除/更新 |
| `agent-runtime/ai-sdk-runtime-core.test.ts` | AI SDK runtime 核心循环 |
| `agent-runtime/runtime-services.test.ts` | Runtime 服务装配 |
| `adapters/provider-agnostic-agent-adapter.test.ts` | 完整工具循环 + 权限拒绝 + 附件/历史传入 + plan 模式拒绝 + AskUserQuestion + safe 模式 + streamSSE 重试 + Agent 工具回调；校验请求体顺序 |
| `adapters/ai-sdk-agent-adapter.test.ts` | AI SDK 适配器行为 |
| `adapters/pi-agent-adapter.test.ts` / `pi-message-adapter.test.ts` / `pi-model-registry.test.ts` | Pi 适配器、消息转换、模型注册表 |
| `adapters/runtime-routing-agent-adapter.test.ts` | 按会话 runtime 路由 |
| `goal-runtime/goal-coordinator.test.ts` | Goal 状态机、检查点校验、续跑上限、重启恢复 |

运行：

```bash
bun test --isolate
bun run typecheck
```

## 8. 相关版本

| 包 | 版本 |
|---|------|
| `@ma-proma/shared` | `0.1.32` |
| `@ma-proma/core` | `0.2.11` |
| `@ma-proma/electron` | `0.1.32` |
