import type { IsolationLevel, Guarantee } from "./contract.js";
import type { IsolationState, ExecutionState } from "../runtime/mission-lifecycle/execution-policy.js";
import type { EvidenceVerificationState, ExecutionEvidenceFacts, CleanupStatus } from "./execution-evidence.js";
import type { RecoveryState, MissionCheckpoint } from "../runtime/mission-lifecycle/mission-recovery.js";
import type { ApprovalRecord } from "../runtime/mission-lifecycle/approval-contract.js";
import type { AdapterVerificationStrategy } from "./workload-adapter.js";

/**
 * P13 (ADR 0047): provider-neutral SDK surface for isolation and verified
 * execution. These are INSPECTION-ONLY types: metadata about what the
 * runtime can enforce and what an execution proved. They deliberately
 * expose no backend internals — no Docker clients, no process handles, no
 * supervisor primitives, no filesystem or credential surfaces.
 */

/** Inspection metadata for a registered isolation backend. */
export interface IsolationBackendInfo {
  /** Backend id (deployer vocabulary, never model vocabulary). */
  readonly id: string;
  /** Levels the backend class supports. */
  readonly supportedLevels: readonly IsolationLevel[];
  /** Honest per-dimension guarantees for this backend. */
  readonly guarantees: Readonly<Record<"filesystem" | "network" | "process" | "environment" | "resources" | "secrets", Guarantee>>;
  /** Availability on the current host (environment-dependent by design). */
  readonly available: boolean;
  /** Metadata-only availability reason; never contains paths or secrets. */
  readonly reason: string;
}

/** Inspection metadata for one isolated execution's evidence. */
export interface ExecutionEvidence {
  readonly missionId: string;
  readonly stepIndex: number;
  readonly capability: string;
  readonly executionId: string;
  /** Backend that ran the workload ("none" when denied before launch). */
  readonly backendId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly exitState: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "UNSUPPORTED";
  readonly isolationLevel: string;
  readonly cleanup: CleanupStatus;
}

/** Runtime-derived verification outcome for an executed action. */
export interface VerificationResult {
  /** VERIFIED only when trusted probes passed over runtime evidence. */
  readonly state: EvidenceVerificationState;
  /** Declared probe labels that ran (provenance is runtime-only). */
  readonly probesRun: readonly string[];
  readonly checkedAt: string;
  readonly summary?: string;
}

/**
 * P14 (ADR 0048) SDK inspection surface: durable mission recovery and the
 * approval contract. Metadata-only views over trusted records — no
 * checkpoint stores, no approval callbacks, no privileged recovery
 * functions cross the SDK boundary. Nothing here can force a resume,
 * forge an approval, or bypass reconciliation.
 */

/** Recovery decision derived from durable records. Metadata only. */
export interface RecoveryInfo {
  readonly missionId: string;
  readonly state: RecoveryState;
  readonly nextStepIndex: number;
  readonly lastSettledStep: number;
  readonly ambiguousStep: number;
  readonly reason: string;
}

/** Inspection view over one durable mission checkpoint. Metadata only. */
export interface MissionCheckpointInfo {
  readonly version: number;
  readonly missionId: string;
  readonly runId: string;
  readonly recovery: RecoveryState;
  readonly nextStepIndex: number;
  readonly lastSettledStep: number;
  readonly ambiguousStep: number;
  readonly usage: { readonly iterations: number; readonly modelCalls: number; readonly toolCalls: number; readonly cost: number };
  readonly recordedAt: string;
}

/** Inspection view over one identity-bound approval record. Metadata only. */
export interface ApprovalInfo {
  readonly approvalId: string;
  readonly missionId: string;
  readonly stepIndex: number;
  readonly capability: string;
  readonly riskLevel: "IRREVERSIBLE" | "DESTRUCTIVE";
  readonly decision: "GRANTED" | "DENIED";
  readonly state: "PENDING" | "GRANTED" | "CONSUMED" | "DENIED";
  readonly approver: string;
  readonly decidedAt: string;
}

/** Inspection view over one registered production workload adapter. */
export interface AdapterInfo {
  readonly capability: string;
  readonly requiredLevel: "WORKER_PROCESS" | "CONTAINER_ISOLATED";
  readonly riskLevel: "READ_ONLY" | "REVERSIBLE";
  readonly verification: AdapterVerificationStrategy;
  readonly network: "DENY";
  readonly credentials: "NONE";
  readonly description: string;
}

/** Connection between the inspection surface and the trusted modules. */
export type { IsolationState, ExecutionState, EvidenceVerificationState, ExecutionEvidenceFacts, RecoveryState, MissionCheckpoint, ApprovalRecord, AdapterVerificationStrategy };
