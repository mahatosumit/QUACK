export { createQuackSystem, type QuackSystem } from "./system/create-system.js";
export { createDefaultConfig, type QuackConfig } from "./config/config.js";
export * from "./core/types.js";
export * from "./events/event-bus.js";
export * from "./runtime/runtime.js";
export * from "./runtime/task.js";
export * from "./runtime/delegation.js";
export * from "./extensions/index.js";
export * from "./extensions/hooks.js";
export * from "./contracts/index.js";
export * from "./tools/tool.js";
export * from "./tools/materialization.js";
export * from "./engine/completion-receipt.js";
export * from "./memory/memory.js";
export * from "./memory/os.js";
export * from "./providers/provider.js";
export * from "./providers/kernel.js";
export * from "./providers/governed-router.js";
export * from "./security/permissions.js";
export * from "./security/capability-broker.js";
export * from "./engine/task-graph.js";
export * from "./engine/types.js";
export * from "./engine/workflow-engine.js";
export * from "./engine/session-runtime.js";
export * from "./skills/types.js";
export * from "./skills/registry.js";
export type { JsonObject } from "./core/types.js";
export * from "./memory/knowledge-graph.js";
// P9: governed semantic memory / knowledge (ADR 0043). Memory stays a
// context source — retrieval feeds QIE candidates; embeddings dispatch
// through the governed model path; no second authority.
export * from "./memory/semantic/index.js";
// P10: governed ecosystem foundation (ADR 0044). Declarative package
// catalog BEFORE runtime admission — manifests/integrity/lifecycle are
// data; declared capabilities grant nothing; no execution surface here.
export * from "./ecosystem/index.js";
// P8.9: QUACK Instruction Engine (QIE) public contract (ADR 0042) — the
// deterministic instruction/context compiler surface for research
// harnesses and external consumers. Pure composition/selection/defense
// primitives; no runtime side effects.
export * from "./instruction/index.js";
// P11: governed mission runtime (ADR 0045) — the model-in-the-loop mission
// loop over existing authorities: fail-closed proposal parsing, the
// canonical mission state machine, the executive-loop run contract, the
// execution harness, and the durable run-record store. Provider-neutral
// composition surface; no new authority is introduced here.
export {
  GovernedMissionLoop,
  InMemoryMissionRunStore,
  type GovernedMissionLoopOptions,
  type GovernedMissionLoopResult,
  type MissionRunStore,
} from "./runtime/mission-lifecycle/governed-mission-loop.js";
export { JsonFileMissionRunStore } from "./runtime/mission-lifecycle/mission-run-store.js";
export {
  ACTION_PROPOSAL_SCHEMA_REF,
  MAX_PROPOSAL_ARGUMENT_CHARS,
  MAX_FINAL_MESSAGE_CHARS,
  MAX_INTENT_CHARS,
  MAX_RAW_PROPOSAL_CHARS,
  parseActionProposal,
  stepIdempotencyKey,
  buildCapabilityIndex,
  buildIterationPlan,
  type ParsedProposalIntent,
  type ProposalCapabilityIndex,
  type ParseProposalOptions,
  type ProposalErrorCode,
} from "./runtime/mission-lifecycle/proposal-parser.js";
// P12: secure execution & isolation (ADR 0046) — the canonical execution
// policy, honest isolation classification, at-most-once step dispatch, and
// runtime-evidence execution states. Provider-neutral composition surface;
// no broker internals, no privileged execution primitives.
export {
  EXECUTION_POLICY_VERSION,
  DEFAULT_RISK_TIMEOUTS,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_CONCURRENT_STEPS,
  resolveExecutionPolicy,
  resolveIsolationState,
  serializeExecutionPolicy,
  parseExecutionPolicy,
  policyDigest,
  classifyExecutionState,
  journalStateForExecution,
  clampOutputBytes,
  type ExecutionPolicy,
  type ExecutionPolicyInput,
  type IsolationState,
  type ExecutionState,
  type ExecutionStateEvidence,
  type RiskLevelTimeouts,
} from "./runtime/mission-lifecycle/execution-policy.js";
export {
  STEP_ATTEMPT_JOURNAL_VERSION,
  stepAttemptKey,
  InMemoryStepAttemptJournal,
  JsonFileStepAttemptJournal,
  type StepAttemptJournal,
  type StepAttemptRecord,
  type StepAttemptState,
} from "./runtime/mission-lifecycle/step-attempt-journal.js";
// P13: real isolation backends + verified execution (ADR 0047) — backend
// capability negotiation, honest availability, the trusted isolation
// supervisor, identity-bound execution evidence, the probe runner, and
// the governed workload-adapter registry. Provider-neutral composition
// surface; no broker internals, no raw process/container handles, no
// privileged execution primitives are exposed.
export {
  type IsolationLevel,
  type IsolationProfile,
  type IsolationRequest,
  type IsolationResult,
  type IsolationBackend,
  type ProbeableIsolationBackend,
  type BackendAvailability,
  type IsolatedIo,
  type IsolatedWorkload,
  validateIsolationProfile,
  effectiveGuarantees,
} from "./isolation/contract.js";
export {
  IsolationBackendRegistry,
  executeIsolated,
  describeBackends,
  type BackendResolution,
} from "./isolation/backend-resolver.js";
export { ProcessIsolationBackend } from "./isolation/process-backend.js";
export { ContainerIsolationBackend } from "./isolation/container-backend.js";
export { WorkerProcessIsolationBackend } from "./isolation/worker-backend.js";
export {
  EXECUTION_EVIDENCE_VERSION,
  createExecutionEvidence,
  parseExecutionEvidence,
  serializeExecutionEvidence,
  executionEvidenceDigest,
  evidenceMatchesIdentity,
  JsonFileExecutionEvidenceStore,
  InMemoryExecutionEvidenceStore,
  type ExecutionEvidenceRecord,
  type ExecutionEvidenceIdentity,
  type ExecutionEvidenceFacts,
  type ExecutionEvidenceVerification,
  type CleanupStatus,
  type EvidenceVerificationState,
} from "./isolation/execution-evidence.js";
export {
  IsolationSupervisor,
  type IsolationSupervisorOptions,
  type SupervisedExecution,
} from "./isolation/supervisor.js";
export {
  ProbeRunner,
  type ProbeRunnerOptions,
  type ProbeOutcome,
} from "./isolation/probe-runner.js";
export {
  WorkloadAdapterRegistry,
  isAbsoluteOrTraversal,
  resolveEntryInsideRoot,
  type GovernedWorkloadAdapter,
} from "./isolation/workload-adapter.js";
// P13: provider-neutral SDK inspection surface (ADR 0047) — metadata-only
// views over isolation backends, execution evidence, and verification.
// No backend internals, process/container handles, or supervisor
// primitives cross this boundary.
export type {
  IsolationBackendInfo,
  ExecutionEvidence,
  VerificationResult,
} from "./isolation/sdk-types.js";
// P14 (ADR 0048): durable mission recovery + verified actions. The recovery
// orchestration over existing authorities (run store + step journal), the
// digest-protected mission checkpoint, the fenced recovery-state machine,
// and the governed approval contract. Provider-neutral composition surface:
// no privileged recovery functions, no approval callbacks, no broker
// internals are exposed.
export {
  MISSION_CHECKPOINT_VERSION,
  parseMissionCheckpoint,
  missionCheckpointDigest,
  buildMissionCheckpoint,
  reconcileMission,
  journalStateDigest,
  runRecordDigest,
  assertRecoveryTransition,
  JsonFileMissionCheckpointStore,
  InMemoryMissionCheckpointStore,
  serializeMissionCheckpoint,
  type MissionCheckpoint,
  type RecoveryDecision,
  type RecoveryState,
} from "./runtime/mission-lifecycle/mission-recovery.js";
export {
  APPROVAL_RECORD_VERSION,
  ApprovalRunner,
  canonicalProposalDigest,
  approvalRecordDigest,
  parseApprovalRecord,
  ConsoleApprovalRunnerCallback,
  DenyApprovalRunnerCallback,
  type ApprovalRunnerCallback,
  type ApprovalRecord,
  type ApprovalRequestInput,
  type ApprovalCallbackDecision,
} from "./runtime/mission-lifecycle/approval-contract.js";
export type {
  RecoveryInfo,
  MissionCheckpointInfo,
  ApprovalInfo,
  AdapterInfo,
  AdapterVerificationStrategy,
} from "./isolation/sdk-types.js";
export { registerProductionAdapters } from "./isolation/production-adapters.js";
