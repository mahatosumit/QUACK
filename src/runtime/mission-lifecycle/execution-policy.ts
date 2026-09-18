import { createHash } from "node:crypto";
import type { ExecutionRiskLevel } from "./action-contract.js";
import type { IsolationBackend, IsolationLevel } from "../../isolation/contract.js";

/**
 * P12 (ADR 0046): the canonical, provider-neutral execution policy.
 *
 * The policy is the single trusted description of HOW a capability may run:
 * timeout, isolation state, containment limits, cancellation semantics, and
 * verification requirements. It is derived EXCLUSIVELY from runtime-trusted
 * inputs (descriptor risk class, descriptor timeout, trusted isolation
 * configuration) — never from proposal payloads. Model output can request a
 * capability; it can never determine risk, sandbox, timeout, limits, or
 * verification. Proposal fields are ignored by policy resolution entirely.
 *
 * Honesty rules (ADR 0046):
 * - The default governed path is POLICY_RESTRICTED: broker-policy
 *   enforcement of registered host functions. That is a POLICY boundary, not
 *   process or OS isolation, and it is never labeled as one.
 * - A required isolation level without a supporting backend fails closed
 *   (FAILED_CLOSED) — there is no silent downgrade to a weaker mode.
 * - Resource limits that the runtime cannot enforce (memory) are marked
 *   advisory (null), never claimed as enforced.
 */

export const EXECUTION_POLICY_VERSION = 1;

/**
 * Honest isolation classification for a governed execution. Distinct from
 * {@link IsolationLevel}: these are the states the runtime can actually PROVE
 * for a mission-loop execution, not the levels a skill workload may request.
 */
export type IsolationState =
  | "UNISOLATED"
  | "POLICY_RESTRICTED"
  | "PROCESS_ISOLATED"
  | "OS_ISOLATED"
  | "FAILED_CLOSED";

/** Explicit terminal execution classification (P12.8), derived from runtime evidence only. */
export type ExecutionState =
  | "EXECUTION_COMPLETED"
  | "EXECUTION_VERIFIED"
  | "EXECUTION_FAILED"
  | "EXECUTION_TIMED_OUT"
  | "EXECUTION_CANCELLED"
  | "EXECUTION_DENIED"
  | "EXECUTION_AMBIGUOUS";

/** Risk-tier wall-clock ceilings (ms). Runtime-owned; proposals cannot raise them. */
export interface RiskLevelTimeouts {
  readonly READ_ONLY: number;
  readonly REVERSIBLE: number;
  readonly IRREVERSIBLE: number;
  readonly DESTRUCTIVE: number;
}

export const DEFAULT_RISK_TIMEOUTS: RiskLevelTimeouts = {
  READ_ONLY: 30_000,
  REVERSIBLE: 60_000,
  IRREVERSIBLE: 120_000,
  DESTRUCTIVE: 300_000,
};

/** Default output containment at the execution boundary (bytes of canonical JSON). */
export const DEFAULT_MAX_OUTPUT_BYTES = 262_144;

/** Default concurrent governed executions per loop instance (enforced in-process). */
export const DEFAULT_MAX_CONCURRENT_STEPS = 4;

/** Trusted inputs for policy resolution. None of these come from model output. */
export interface ExecutionPolicyInput {
  /** Registered capability id (action descriptor id or core tool id). */
  readonly capability: string;
  readonly providerKind: "ACTION_PROVIDER" | "CORE_TOOL";
  /** Risk level derived by the runtime from the descriptor (never the proposal). */
  readonly riskLevel: ExecutionRiskLevel;
  /** Descriptor-declared timeout ceiling, when known. */
  readonly descriptorTimeoutMs?: number;
  /**
   * Isolation requirement from TRUSTED configuration only (operator/deployer
   * policy), never from a proposal. Defaults to IN_PROCESS — i.e. the
   * registered-host-function path governed by broker policy.
   */
  readonly requiredIsolation?: IsolationLevel;
  /** Optional isolation backend for levels beyond policy restriction. */
  readonly isolationBackend?: IsolationBackend;
  /** Trusted containment overrides (deployer configuration), never proposal data. */
  readonly overrides?: {
    readonly maxOutputBytes?: number;
    readonly timeoutCeilingMs?: number;
  };
}

/**
 * The resolved execution policy. Serializable, deterministic (identical
 * inputs → identical policy including digest). Every field is runtime truth.
 */
export interface ExecutionPolicy {
  readonly version: typeof EXECUTION_POLICY_VERSION;
  readonly capability: string;
  readonly providerKind: "ACTION_PROVIDER" | "CORE_TOOL";
  readonly riskLevel: ExecutionRiskLevel;
  readonly timeoutMs: number;
  readonly isolation: {
    /** What is actually enforced for this execution. */
    readonly state: IsolationState;
    /** The trusted requirement the state was resolved against. */
    readonly requiredLevel: IsolationLevel;
    /** Backend that backs the state, when one exists ("none" for policy-restricted). */
    readonly backendId: string;
  };
  /** Filesystem access is broker-capability-scoped; NOT a sandbox claim. */
  readonly filesystem: { readonly mode: "CAPABILITY_SCOPED" };
  /** Network access is broker-capability-scoped; NOT a sandbox claim. */
  readonly network: { readonly mode: "CAPABILITY_SCOPED" };
  /** Host functions run in-process; environment is governed by tool policy, not isolation. */
  readonly environment: { readonly mode: "HOST_IN_PROCESS" };
  /** Credentials only through broker-authorized capabilities; never granted by policy text. */
  readonly credentials: { readonly mode: "BROKER_AUTHORIZED_ONLY" };
  readonly limits: {
    /** Governed executions dispatch at most once per (mission, step, capability). */
    readonly maxAttempts: 1;
    /** Enforced at the harness boundary: oversized output is dropped, flagged, never previewed. */
    readonly maxOutputBytes: number;
    /** Enforced in-process per loop instance. */
    readonly maxConcurrentSteps: number;
    /** Advisory only: this runtime cannot enforce memory limits. Never claim otherwise. */
    readonly memoryBytes: null;
  };
  /** Cancellation aborts the dispatched execution; settlement is awaited. */
  readonly cancellation: { readonly mode: "ABORT_SIGNAL" };
  /**
   * Verification requirement. V1 harness verification is conservative:
   * trust_executed success stays UNVERIFIED; PASSED requires a real probe
   * runner (future work). IRREVERSIBLE/DESTRUCTIVE execution fails closed
   * without one — the policy records that rule.
   */
  readonly verification: { readonly irreversiblePolicy: "FAIL_CLOSED_WITHOUT_RUNNER" };
  /** sha256 over the canonical policy form (all fields except this digest). */
  readonly digest: string;
}

/** Resolve the honest isolation state for a requirement. Fail-closed: no silent downgrade. */
export function resolveIsolationState(input: {
  readonly requiredLevel: IsolationLevel;
  readonly backend?: IsolationBackend;
}): { readonly state: IsolationState; readonly backendId: string } {
  const level = input.requiredLevel ?? "IN_PROCESS";
  const backend = input.backend;
  if (level === "IN_PROCESS") {
    // Registered host functions under broker policy: a policy boundary,
    // honestly labeled. Not process isolation.
    return { state: "POLICY_RESTRICTED", backendId: "none" };
  }
  if (!backend) {
    // A stronger isolation requirement without any backend fails closed.
    return { state: "FAILED_CLOSED", backendId: "none" };
  }
  if (!backend.supportedLevels.includes(level)) {
    // Backend exists but cannot provide this level: deny, never downgrade.
    return { state: "FAILED_CLOSED", backendId: backend.id };
  }
  if (level === "WORKER_PROCESS") return { state: "PROCESS_ISOLATED", backendId: backend.id };
  if (level === "CONTAINER_ISOLATED") return { state: "OS_ISOLATED", backendId: backend.id };
  // FUTURE_STRONG_ISOLATION: no backend in existence supports it today.
  return { state: "FAILED_CLOSED", backendId: backend.id };
}

/** Resolve the canonical execution policy from trusted inputs. Deterministic. */
export function resolveExecutionPolicy(input: ExecutionPolicyInput): ExecutionPolicy {
  if (!input.capability || typeof input.capability !== "string") {
    throw new Error("Execution policy requires a registered capability id.");
  }
  const riskTimeouts = DEFAULT_RISK_TIMEOUTS[input.riskLevel];
  if (riskTimeouts === undefined) {
    throw new Error(`Execution policy requires a known risk level; '${String(input.riskLevel)}' is rejected.`);
  }
  let timeoutMs = riskTimeouts;
  if (input.descriptorTimeoutMs !== undefined) {
    if (!Number.isInteger(input.descriptorTimeoutMs) || input.descriptorTimeoutMs <= 0) {
      throw new Error("Descriptor timeout must be a positive integer.");
    }
    timeoutMs = Math.min(timeoutMs, input.descriptorTimeoutMs);
  }
  if (input.overrides?.timeoutCeilingMs !== undefined) {
    if (!Number.isInteger(input.overrides.timeoutCeilingMs) || input.overrides.timeoutCeilingMs <= 0) {
      throw new Error("Timeout ceiling override must be a positive integer.");
    }
    timeoutMs = Math.min(timeoutMs, input.overrides.timeoutCeilingMs);
  }
  const isolation = resolveIsolationState({
    requiredLevel: input.requiredIsolation ?? "IN_PROCESS",
    backend: input.isolationBackend,
  });
  const maxOutputBytes = input.overrides?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error("Output containment limit must be a positive integer.");
  }
  const policy: Omit<ExecutionPolicy, "digest"> = {
    version: EXECUTION_POLICY_VERSION,
    capability: input.capability,
    providerKind: input.providerKind,
    riskLevel: input.riskLevel,
    timeoutMs,
    isolation: { ...isolation, requiredLevel: input.requiredIsolation ?? "IN_PROCESS" },
    filesystem: { mode: "CAPABILITY_SCOPED" },
    network: { mode: "CAPABILITY_SCOPED" },
    environment: { mode: "HOST_IN_PROCESS" },
    credentials: { mode: "BROKER_AUTHORIZED_ONLY" },
    limits: {
      maxAttempts: 1,
      maxOutputBytes,
      maxConcurrentSteps: DEFAULT_MAX_CONCURRENT_STEPS,
      memoryBytes: null,
    },
    cancellation: { mode: "ABORT_SIGNAL" },
    verification: { irreversiblePolicy: "FAIL_CLOSED_WITHOUT_RUNNER" },
  };
  return { ...policy, digest: policyDigest(policy) };
}

/** Canonical deterministic serialization (sorted keys; any digest key is stripped). */
export function serializeExecutionPolicy(policy: Omit<ExecutionPolicy, "digest">): string {
  const { digest: _ignored, ...rest } = policy as ExecutionPolicy;
  void _ignored;
  return JSON.stringify(sortKeysDeep(rest));
}

/** Digest over the canonical policy form. */
export function policyDigest(policy: Omit<ExecutionPolicy, "digest">): string {
  return createHash("sha256").update(serializeExecutionPolicy(policy)).digest("hex");
}

const POLICY_FIELDS = new Set([
  "version", "capability", "providerKind", "riskLevel", "timeoutMs", "isolation",
  "filesystem", "network", "environment", "credentials", "limits", "cancellation",
  "verification", "digest",
]);

/**
 * Fail-closed parse of a serialized/persisted execution policy. Unknown
 * fields, wrong version, semantic violations, or a digest mismatch are all
 * rejected — a tampered policy is never honored.
 */
export function parseExecutionPolicy(raw: string): { readonly ok: true; readonly policy: ExecutionPolicy } | { readonly ok: false; readonly reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Policy is not valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "Policy must be a JSON object." };
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!POLICY_FIELDS.has(key)) return { ok: false, reason: `Unknown policy field '${key}' is rejected.` };
  }
  const digest = record["digest"];
  if (typeof digest !== "string" || digest.length !== 64) {
    return { ok: false, reason: "Policy digest is missing or malformed." };
  }
  const candidate = { ...record, digest: "" } as unknown as Omit<ExecutionPolicy, "digest"> & { digest: string };
  const expected = policyDigest(candidate);
  if (expected !== digest) {
    return { ok: false, reason: "Policy digest mismatch: the policy was tampered with." };
  }
  const policy = { ...candidate, digest } as ExecutionPolicy;
  if (policy.version !== EXECUTION_POLICY_VERSION) return { ok: false, reason: "Unsupported policy version." };
  if (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs <= 0) return { ok: false, reason: "Policy timeout must be positive." };
  if (policy.limits.maxAttempts !== 1) return { ok: false, reason: "Policy must enforce at-most-once dispatch." };
  if (policy.limits.memoryBytes !== null) return { ok: false, reason: "Memory limits are advisory on this runtime and must be serialized as null." };
  const states: readonly IsolationState[] = ["UNISOLATED", "POLICY_RESTRICTED", "PROCESS_ISOLATED", "OS_ISOLATED", "FAILED_CLOSED"];
  if (!states.includes(policy.isolation.state)) return { ok: false, reason: "Unknown isolation state." };
  return { ok: true, policy };
}

/** Runtime evidence a classification is derived from. Never model self-report. */
export interface ExecutionStateEvidence {
  readonly status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "DENIED";
  readonly verificationStatus?: "PASSED" | "FAILED" | "INCONCLUSIVE" | "SKIPPED";
  /** Runtime-observed timeout (abort timer fired), not a provider claim. */
  readonly timedOut?: boolean;
  /** Runtime-observed cancellation (operator signal), not a provider claim. */
  readonly cancelled?: boolean;
  /** Ambiguous external state (ledger UNKNOWN_EXTERNAL_STATE / unknown dispatch outcome). */
  readonly ambiguous?: boolean;
}

/**
 * Classify an execution terminal state from runtime evidence. Execution
 * returning SUCCEEDED is NEVER automatically "verified" — verification
 * status comes only from the runtime's own verification evidence.
 */
export function classifyExecutionState(evidence: ExecutionStateEvidence): ExecutionState {
  if (evidence.status === "DENIED") return "EXECUTION_DENIED";
  if (evidence.cancelled || evidence.status === "CANCELLED") return "EXECUTION_CANCELLED";
  if (evidence.timedOut) return "EXECUTION_TIMED_OUT";
  if (evidence.ambiguous) return "EXECUTION_AMBIGUOUS";
  if (evidence.status === "FAILED") return "EXECUTION_FAILED";
  if (evidence.status === "SUCCEEDED") {
    return evidence.verificationStatus === "PASSED" ? "EXECUTION_VERIFIED" : "EXECUTION_COMPLETED";
  }
  return "EXECUTION_FAILED";
}

/** Map an execution state onto the durable step-attempt journal outcome. */
export function journalStateForExecution(state: ExecutionState): "COMPLETED" | "FAILED" | "AMBIGUOUS" {
  switch (state) {
    case "EXECUTION_VERIFIED":
    case "EXECUTION_COMPLETED":
      return "COMPLETED";
    case "EXECUTION_DENIED":
    case "EXECUTION_FAILED":
      return "FAILED";
    // Timeout/cancellation/ambiguity leave the external effect unknown:
    // the attempt is AMBIGUOUS and must never be re-executed blindly.
    case "EXECUTION_TIMED_OUT":
    case "EXECUTION_CANCELLED":
    case "EXECUTION_AMBIGUOUS":
      return "AMBIGUOUS";
  }
}

/**
 * Output containment at the execution boundary (P12.7). Oversized output is
 * DROPPED — never previewed (a preview could leak credentials) — and flagged
 * deterministically. Output stays data; it can never become policy.
 */
export function clampOutputBytes(
  output: Readonly<Record<string, unknown>> | undefined,
  maxOutputBytes: number,
): { readonly output: Readonly<Record<string, unknown>> | undefined; readonly truncated: boolean; readonly byteLength: number } {
  if (output === undefined) return { output: undefined, truncated: false, byteLength: 0 };
  const serialized = JSON.stringify(output);
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength <= maxOutputBytes) return { output, truncated: false, byteLength };
  return {
    output: { quackTruncated: true, byteLength, limitBytes: maxOutputBytes },
    truncated: true,
    byteLength,
  };
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    return sorted;
  }
  return value;
}
