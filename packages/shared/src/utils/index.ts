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
  M0_ALIGNMENT_ITEM_ID,
  M0_BLOCKED_STEP_IDS,
  CONFIDENCE_GATE_STEP_IDS,
  parseConfidenceGate,
  hasAssumptionMarkers,
  buildM0Confirmation,
  evaluateStepConfirmations,
  mergeConfirmations,
  collectBlockingConfirmations,
  findBlockersForStep,
  applyConfirmation,
} from './campaign-confirmation'
