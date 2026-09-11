export { createQuackSystem } from "@quack/os";
export type { QuackSystem } from "@quack/os";
export { QuackClient, type QuackClientConfig } from "./client.js";
export type { QuackConfig } from "@quack/os";

// Core types
export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
  IsoTimestamp,
  QuackError,
  QuackResult,
} from "@quack/os";

// Events
export type { QuackEvent, QuackEventType, EventHandler } from "@quack/os";

// Runtime
export { QuackRuntime } from "@quack/os";
export type { Task } from "@quack/os";

// Memory
export { InMemoryMemoryStore, JsonFileMemoryStore } from "@quack/os";
export type { MemoryScope, MemoryRecord, MemoryStore } from "@quack/os";

// Knowledge Graph
export { InMemoryKnowledgeGraphStore, InMemoryKnowledgeGraphStore as InMemoryKnowledgeGraph } from "@quack/os";
export type { KnowledgeNode, KnowledgeEdge, KnowledgeHyperedge, KnowledgeHyperedge as HyperEdge, GraphQueryResult, GraphQueryResult as QueryResult } from "@quack/os";

// Tools
export { ToolRegistry, EchoTool } from "@quack/os";
export type { QuackTool, ToolMetadata, ToolResult, ToolExecutionContext } from "@quack/os";
export { materializeTool, createGovernedToolExecutor, materializationSnapshot } from "@quack/os";
export type { ToolMaterialization, MaterializeToolInput } from "@quack/os";

// Providers
export { ProviderRegistry } from "@quack/os";
export type { ProviderAdapter, GenerateRequest, GenerateResult, ProviderCapabilities } from "@quack/os";
export { GovernedProviderRouter } from "@quack/os";

// Security
export type { Permission, PermissionDecision, PermissionDecision as PermissionCheck } from "@quack/os";
export { InMemoryCapabilityGrantRegistry } from "@quack/os";
export type { CapabilityBroker, CapabilityGrant, CapabilityGrantRegistry } from "@quack/os";

// Delegation (governed parent -> child execution; requires a parent grant)
export { DelegationRuntime, assertChildReceipt } from "@quack/os";
export type { DelegationRequest, DelegationRecord, DelegationState } from "@quack/os";

// Completion receipts (durable evidence chain for completed missions)
export { buildCompletionReceipt, assertCompletionReceipt, receiptSnapshot } from "@quack/os";
export type { CompletionReceiptV1 } from "@quack/os";

// Plugin hooks (governed observer execution)
export { GovernedHookExecutor } from "@quack/os";
export type { GovernedHook, HookDispatchRecord } from "@quack/os";

// Instruction Engine (QIE, ADR 0042) — P8.9 public SDK surface.
// Deterministic instruction/context compilation for governed model
// dispatch: plan contract, fail-closed validation, deterministic composer
// with canonical digest, context selection, firewall admission, governed
// model adaptation, injection defense, metadata-only dispatch records,
// quality scoring, and dispatch observation. Pure primitives; no side
// effects, no provider I/O.
export {
  // Contract + validation
  INSTRUCTION_PLAN_VERSION,
  INSTRUCTION_LAYER_ORDER,
  TRUST_CLASS_PRECEDENCE,
  CATEGORY_TRUST_PAIRING,
  createInstructionPlan,
  validateInstructionPlan,
  collectPlanIssues,
  resolvePrecedence,
  trustClassRank,
  instructionSourceFromPrompt,
  // Composition
  composeInstructionPlan,
  renderComposedText,
  canonicalJson,
  // Selection
  selectContext,
  // Firewall
  admitContext,
  // Model adaptation + dispatch
  adaptComposedInstruction,
  invokeGovernedInstruction,
  // Defense
  enforceInstructionDefense,
  flagsToMetadata,
  assertDispatchable,
  // Records + scoring (P8.6)
  buildInstructionRecord,
  parseInstructionRecord,
  recordToJsonObject,
  distinctTrustClasses,
  scoreInstructionQuality,
  dominantTrustLane,
  // Observability (P8.7)
  InstructionObserver,
} from "@quack/os";
export type {
  InstructionPlan,
  InstructionPlanInput,
  InstructionPlanIssue,
  InstructionLayer,
  InstructionLayerName,
  ContextSourceItem,
  ContextSourceCategory,
  ContextProvenance,
  TrustClass,
  EvidenceItem,
  EvidenceStatus,
  InstructionBudget,
  InstructionOutputContract,
  InstructionOutputKind,
  InstructionFailurePolicy,
  InstructionFailureMode,
  ComposedInstruction,
  ComposedLayer,
  InstructionBudgetReport,
  OmittedItem,
  InstructionSource,
  RegistryPromptVersionView,
  InstructionPlanIssueCode,
  ContextCandidate,
  SelectionInput,
  SelectionResult,
  SelectionReport,
  SelectedEntry,
  TrimmedEntry,
  RejectedEntry,
  SelectionRejectionCode,
  FirewallAuthorities,
  AdmissionInput,
  AdmissionResult,
  AdmissionRejection,
  FirewallRejectionCode,
  GovernedInvocationOptions,
  GovernedInvocationContext,
  GovernedDispatchRuntime,
  InstructionDefenseResult,
  InstructionDefenseErrorCode,
  InjectionFlag,
  GovernedInstructionRecord,
  InstructionDispatchOutcome,
  InstructionRecordErrorCode,
  InstructionLayerCensus,
  InstructionDispatchObserver,
  InstructionQualityDimensions,
  InstructionQualityResult,
  InstructionEventSink,
  InstructionObservationSummary,
  ObservedDispatch,
} from "@quack/os";

// Workspace



// Config
export { createDefaultConfig } from "@quack/os";
