/**
 * Shared utility functions for MAPro
 */

// Placeholder - will be expanded as needed
export function noop(): void {
  // no-op
}

export { diffCapabilities } from './capabilities-diff'
export type { CapabilityChange } from './capabilities-diff'
export {
  THINKING_SIGNATURE_ERROR_CODE,
  THINKING_SIGNATURE_ERROR_TITLE,
  THINKING_SIGNATURE_ERROR_MESSAGE,
  isThinkingSignatureError,
  formatThinkingSignatureError,
  normalizeThinkingSignatureError,
} from './thinking-signature-error'
export {
  getRuntimeErrorMessage,
  normalizeAgentRuntimeError,
} from './agent-runtime-error'
export type { NormalizeAgentRuntimeErrorInput } from './agent-runtime-error'
export {
  buildArtifactPersistenceDirective,
  splitOutputByFiles,
} from './campaign-prompt'
export {
  BRAND_DNA_FIELDS,
  BRAND_DNA_FILE_PLAN,
  BRAND_DNA_PREREQUISITE_STEPS,
  BRAND_DNA_PREREQUISITE_DIRS,
  BRAND_DNA_PREREQUISITE_LABELS,
  buildBrandDnaFieldSpec,
  buildBrandDnaPrerequisiteDirective,
} from './brand-dna-spec'
export type { BrandDnaField } from './brand-dna-spec'
