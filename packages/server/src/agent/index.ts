/**
 * Agent 服务模块
 *
 * 阶段 B：将 Electron 主进程中的 Agent 核心逻辑迁移到服务端。
 * 本模块导出无 Electron 依赖的可复用 Agent 服务。
 */

export { AgentEventBus } from './agent-event-bus.ts'
export { AgentPermissionService } from './agent-permission-service.ts'
export type { PermissionResult, CanUseToolOptions, PermissionUpdate } from './agent-permission-service.ts'
export { AgentAskUserService } from './agent-ask-user-service.ts'
export { AgentExitPlanService } from './agent-exit-plan-service.ts'
export type { ExitPlanPermissionResult, ExitPlanModeCallbacks } from './agent-exit-plan-service.ts'
export { validateToolInput } from './agent-tool-input-validator.ts'
export { estimateTokenCount, WRITE_CONTENT_TOKEN_THRESHOLD, isCjkCodePoint } from './agent-tool-token-estimator.ts'
export { loadClaudeAgentSdk } from './claude-sdk-loader.ts'
export { isTransientNetworkError, TRANSIENT_NETWORK_PATTERN } from './error-patterns.ts'
export { ClaudeAgentAdapter } from './adapters/claude-agent-adapter.ts'
export type { ClaudeAgentQueryOptions } from './adapters/claude-agent-adapter.ts'
export { DockerAgentRunner, runAgentInDocker, checkDockerAvailable } from './agent-docker-runner.ts'
export { NativeAgentRunner } from './agent-native-runner.ts'
export type { AgentRunEnv, AgentRunOptions, AgentRunResult, AgentRunCallbacks, AgentRunner } from './agent-runner.ts'
export { buildAgentEnvironment } from './agent-runner.ts'
export {
  AgentSessionManager,
  type AgentSessionManagerDeps,
  type AgentWorkspaceResolver,
  type AgentWorkspaceSnapshot,
} from './agent-session-manager.ts'
export {
  AgentWorkspaceManager,
  type AgentWorkspaceManagerDeps,
} from './agent-workspace-manager.ts'
export { ChatToolConfigService, type ChatToolConfigServiceDeps } from './chat-tool-config.ts'
