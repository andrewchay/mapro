/**
 * Claude Agent SDK 运行时加载器。
 *
 * 注意：这里刻意使用 Function 包裹动态 import，避免 esbuild 在 CJS bundle
 * 中把 SDK 打包进 main.cjs。SDK 内部依赖 import.meta.url，打包后会变成
 * undefined，导致运行时报 filename/path 参数错误。
 */
export async function loadClaudeAgentSdk(): Promise<typeof import('@anthropic-ai/claude-agent-sdk')> {
  const runtimeImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<typeof import('@anthropic-ai/claude-agent-sdk')>

  return runtimeImport('@anthropic-ai/claude-agent-sdk')
}
