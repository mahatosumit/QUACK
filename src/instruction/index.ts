/**
 * QUACK Instruction Engine (QIE) — canonical subsystem (ADR 0042).
 *
 * Deterministic, provider-neutral instruction/context compilation:
 * Mission/Task State → QIE → GovernedModelRuntime → Provider.
 *
 * P8.1: contract types, validation, precedence, deterministic composer,
 * PromptRegistry adapter. No context retrieval, no model wiring — QIE is
 * an instruction compiler, not a runtime (see docs/adr/0042).
 */
export * from "./types.js";
export { composeInstructionPlan, renderComposedText, canonicalJson, type ComposeResult } from "./composer.js";
export { selectContext, DEFAULT_CATEGORY_LAYER, type ContextCandidate, type SelectionInput, type SelectionResult, type SelectionReport, type SelectedEntry, type TrimmedEntry, type RejectedEntry, type SelectionRejectionCode } from "./selector.js";
export { admitContext, type FirewallAuthorities, type AdmissionInput, type AdmissionResult, type AdmissionRejection, type FirewallRejectionCode } from "./firewall.js";
export { adaptComposedInstruction, invokeGovernedInstruction, type GovernedInvocationOptions, type GovernedInvocationContext, type GovernedDispatchRuntime } from "./model-adapter.js";
