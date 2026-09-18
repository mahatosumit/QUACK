import { createHash } from "node:crypto";
import type { EventBus } from "../../events/event-bus.js";
import type { JsonObject } from "../../core/types.js";
import type { StepAttemptJournal, StepAttemptRecord } from "./step-attempt-journal.js";
import type { ProbeRunner } from "../../isolation/probe-runner.js";
import {
  evidenceMatchesIdentity, executionEvidenceDigest, type ExecutionEvidenceRecord,
  type ExecutionEvidenceVerification,
} from "../../isolation/execution-evidence.js";
import type { VerificationStrategy } from "./action-contract.js";
import type { ActionResultV1 } from "../../contracts/v1/contracts.js";

/**
 * P15 (ADR 0049): TRUSTED automatic ambiguous-step reconciliation.
 *
 * P14 parks AMBIGUOUS steps forever — correct but operationally frozen. P15
 * may release them ONLY through trusted verification:
 *
 *   AMBIGUOUS → durable evidence record (identity-bound) → trusted probes
 *     → all PASSED  → COMPLETED (with provenance + evidence digest)
 *     → any FAILED → FAILED (definitive negative — the effect observably
 *                     did not reach the declared state)
 *     → INCONCLUSIVE / missing / conflicting / malformed → stays AMBIGUOUS
 *
 * Doctrine (unchanged from P13/P14):
 * - NEVER infer success from absence of failure.
 * - NEVER use model output as verification (probes read durable runtime
 *   evidence records only — records written by the trusted supervisor at
 *   execution time, never by the model).
 * - NEVER automatically retry the ambiguous external effect.
 * - Probe identity/binding must match the EXACT attempt (missionId,
 *   stepIndex, capability, executionId) — a record from another execution
 *   can never settle this one (evidenceMatchesIdentity).
 * - The reconciliation itself must already hold the mission's coordination
 *   lease (the caller — the loop — enforces it); this module never claims
 *   authority, it only reads durable evidence and records a journal
 *   transition with provenance.
 *
 * A reconciliation failure (probe crash, store error) leaves the attempt
 * AMBIGUOUS — fail closed, retry on the next resume.
 */

/** Verification strategy source for reconciliation: trusted records only. */
export interface AmbiguityReconciliationInputs {
  readonly missionId: string;
  readonly journal: StepAttemptJournal;
  /** Trusted probe runner (existing isolation surface). */
  readonly probeRunner: ProbeRunner;
  /** Durable evidence store the supervisor wrote at execution time. */
  readonly evidenceStore: { load(executionId: string): Promise<ExecutionEvidenceRecord | undefined> };
  readonly events?: EventBus;
  readonly actor?: string;
}

export type ReconciliationOutcome =
  | { readonly kind: "RESOLVED_COMPLETED"; readonly attempt: StepAttemptRecord; readonly evidenceDigest: string }
  | { readonly kind: "RESOLVED_FAILED"; readonly attempt: StepAttemptRecord; readonly evidenceDigest: string }
  | { readonly kind: "REMAINS_AMBIGUOUS"; readonly attempt: StepAttemptRecord; readonly reason: string };

/**
 * Attempt reconciliation for ONE ambiguous step. The verificationStrategy
 * comes from the TRUSTED proposal the runtime dispatched (recorded at
 * dispatch through the action ledger); the model cannot supply a NEW
 * strategy at reconciliation time — this function accepts the strategy the
 * original dispatch carried, re-read from the trusted proposal channel.
 */
export async function reconcileAmbiguousStep(input: AmbiguityReconciliationInputs & {
  readonly attempt: StepAttemptRecord;
  readonly strategy: VerificationStrategy | undefined;
}): Promise<ReconciliationOutcome> {
  const { attempt, strategy } = input;
  if (attempt.state !== "AMBIGUOUS") {
    return { kind: "REMAINS_AMBIGUOUS", attempt, reason: `attempt is ${attempt.state}, not AMBIGUOUS` };
  }
  await emitReconciliation(input, "mission.reconciliation_attempted", {
    missionId: attempt.missionId, stepIndex: attempt.stepIndex, capability: attempt.capability,
  });

  // Only probe_external_state strategies can reconcile — trust_executed has
  // no runtime-verifiable evidence (P13), human_confirm needs a human, and
  // evaluator strategies are not runnable as probes. Everything else parks.
  if (strategy?.kind !== "probe_external_state") {
    return unresolved(input, attempt, "no trusted probe strategy on the original dispatch; the attempt stays AMBIGUOUS");
  }
  // Evidence-observability gate: the durable evidence record is
  // METADATA-ONLY (digests, exit state, timestamps — never payload
  // content). Only probes whose inputs survive in that record can be
  // re-verified: status_equals and no_error. An output_field probe (or any
  // other kind) needs raw output the evidence store deliberately does not
  // carry — its verdict would be a FALSE definitive negative. Unobservable
  // probes keep the attempt AMBIGUOUS (fail closed), never FAILED.
  const observable = strategy.expected.successProbes.every((probe) => probe.kind === "status_equals" || probe.kind === "no_error");
  if (!observable) {
    return unresolved(input, attempt, "the declared probes require observations the durable evidence record does not carry; the attempt stays AMBIGUOUS");
  }

  // The attempt MUST carry its executionId — without it there is no durable
  // evidence to verify against.
  if (!attempt.executionId) {
    return unresolved(input, attempt, "the attempt record carries no executionId; no evidence can be bound");
  }

  // Load the durable evidence record; identity-bind it to THIS attempt.
  let evidence: ExecutionEvidenceRecord | undefined;
  try {
    evidence = await input.evidenceStore.load(attempt.executionId);
  } catch {
    return unresolved(input, attempt, "evidence store read failed; fail closed (stays AMBIGUOUS)");
  }
  if (!evidence) {
    return unresolved(input, attempt, "no durable evidence record exists for the attempt (probe unavailable)");
  }
  if (!evidenceMatchesIdentity(evidence, {
    missionId: attempt.missionId,
    stepIndex: attempt.stepIndex,
    capability: attempt.capability,
    executionId: attempt.executionId,
  })) {
    // Cross-mission/cross-execution evidence can NEVER settle this attempt.
    return unresolved(input, attempt, "evidence identity does not match the attempt (cross-mission or forged record rejected)");
  }
  // Integrity: the loaded record's digest must match its content.
  const { digest: _d, ...withoutDigest } = evidence;
  void _d;
  if (executionEvidenceDigest(withoutDigest) !== evidence.digest) {
    return unresolved(input, attempt, "evidence digest mismatch (tampered record); stays AMBIGUOUS");
  }

  // Conflicting-evidence guard: the record's own verification block (if the
  // supervisor already settled one) must not contradict a PASSED probe run.
  const settledVerification: ExecutionEvidenceVerification | undefined = evidence.verification;

  // Re-run the DECLARED probes of the original strategy against the durable
  // evidence-derived result (runtime truth only).
  const reconstructed = evidenceDerivedActionResult(evidence);
  let outcome;
  try {
    outcome = await input.probeRunner.runProbes(strategy.expected, reconstructed, evidence.facts);
  } catch {
    return unresolved(input, attempt, "probe execution crashed; stays AMBIGUOUS (fail closed)");
  }

  // Stale-probe guard: a re-run probe older than the evidence record means
  // the probe evidence predates the attempt — reject (checked via facts'
  // completion timestamp vs the attempt's own recordedAt below).
  if (Date.parse(evidence.facts.completedAt) < Date.parse(attempt.recordedAt) - 60_000) {
    return unresolved(input, attempt, "evidence predates the attempt record (stale evidence rejected)");
  }

  if (outcome.kind === "PASSED") {
    // Conflicting evidence: the supervisor already recorded a FAILED/UNVERIFIED
    // verification — a fresh PASSED probe contradicts the durable record.
    if (settledVerification && (settledVerification.state === "FAILED" || settledVerification.state === "VERIFIED")) {
      // VERIFIED already recorded: idempotent completion is fine (same
      // conclusion). FAILED recorded: conflict — stays AMBIGUOUS.
      if (settledVerification.state === "FAILED") {
        return unresolved(input, attempt, "durable evidence already records a FAILED verification; conflicting PASSED probe rejected (stays AMBIGUOUS)");
      }
    }
    const evidenceDigest = evidence.digest;
    await input.journal.resolveAmbiguous(attempt.attemptKey, {
      to: "COMPLETED",
      by: input.actor ?? "ambiguity-reconciliation",
      reason: `trusted probes passed (${outcome.probesRun.join(", ")})`,
      evidenceDigest,
    });
    await emitReconciliation(input, "mission.reconciliation_verified", {
      missionId: attempt.missionId, stepIndex: attempt.stepIndex, capability: attempt.capability,
      probes: outcome.probesRun.length,
    });
    return { kind: "RESOLVED_COMPLETED", attempt: { ...attempt, state: "COMPLETED" }, evidenceDigest };
  }

  if (outcome.kind === "FAILED") {
    // A definitive negative: the declared expected effect is observably
    // absent in the durable evidence. This settles the attempt FAILED —
    // the runtime never re-executes it.
    const evidenceDigest = evidence.digest;
    await input.journal.resolveAmbiguous(attempt.attemptKey, {
      to: "FAILED",
      by: input.actor ?? "ambiguity-reconciliation",
      reason: `trusted probe failed: ${outcome.summary}`,
      evidenceDigest,
    });
    await emitReconciliation(input, "mission.reconciliation_verified", {
      missionId: attempt.missionId, stepIndex: attempt.stepIndex, capability: attempt.capability,
      probes: outcome.probesRun.length, resolved: "FAILED",
    });
    return { kind: "RESOLVED_FAILED", attempt: { ...attempt, state: "FAILED" }, evidenceDigest };
  }

  return unresolved(input, attempt, `probes were inconclusive: ${outcome.summary}`);
}

/**
 * Reconcile every AMBIGUOUS attempt of a mission (ascending step order).
 * Each attempt is reconciled independently; the first one that remains
 * AMBIGUOUS parks the mission (the loop refuses to step over it).
 * Returns the outcomes for observability.
 */
export async function reconcileMissionAmbiguity(input: AmbiguityReconciliationInputs & {
  readonly strategyFor: (attempt: StepAttemptRecord) => VerificationStrategy | undefined;
}): Promise<readonly ReconciliationOutcome[]> {
  const attempts = await input.journal.listByMission(input.missionId);
  const outcomes: ReconciliationOutcome[] = [];
  for (const attempt of attempts) {
    if (attempt.state !== "AMBIGUOUS") continue;
    outcomes.push(await reconcileAmbiguousStep({ ...input, attempt, strategy: input.strategyFor(attempt) }));
  }
  return outcomes;
}

/**
 * Rebuild the ActionResultV1 the probes read, from DURABLE evidence facts
 * only: status derived from exitState, output never reconstructed from
 * payload content (digests are metadata; probe strategies that need raw
 * output fields will honestly fail — fail-closed, by design).
 */
function evidenceDerivedActionResult(evidence: ExecutionEvidenceRecord): ActionResultV1 {
  const status = evidence.facts.exitState === "SUCCEEDED" ? "SUCCEEDED" : "FAILED";
  return {
    executionId: evidence.identity.executionId,
    providerId: `isolation:${evidence.identity.backendId}`,
    actionId: evidence.identity.capability,
    status,
    // Output content is NOT carried in evidence (metadata-only store). The
    // original output was digested; probes that require output fields cannot
    // verify from evidence alone and will fail — honest, fail-closed.
    output: { evidenceOutputDigest: evidence.facts.outputDigest ?? "absent" } as JsonObject,
    evidenceIds: [],
  };
}

async function unresolved(
  input: AmbiguityReconciliationInputs,
  attempt: StepAttemptRecord,
  reason: string,
): Promise<ReconciliationOutcome> {
  await emitReconciliation(input, "mission.reconciliation_unresolved", {
    missionId: attempt.missionId, stepIndex: attempt.stepIndex, capability: attempt.capability,
    reason: reason.slice(0, 200),
  });
  return { kind: "REMAINS_AMBIGUOUS", attempt, reason };
}

async function emitReconciliation(
  input: AmbiguityReconciliationInputs,
  type: "mission.reconciliation_attempted" | "mission.reconciliation_verified" | "mission.reconciliation_unresolved",
  payload: JsonObject,
): Promise<void> {
  await input.events?.emit(type, payload, { actor: input.actor ?? "ambiguity-reconciliation" }).catch(() => undefined);
}

/** Deterministic digest helper exposed for tests (identity binding checks). */
export function reconciliationBindingDigest(missionId: string, stepIndex: number, capability: string, executionId: string): string {
  return createHash("sha256").update(JSON.stringify({ missionId, stepIndex, capability, executionId })).digest("hex");
}
