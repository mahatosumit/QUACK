import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../../events/event-bus.js";
import { ProbeRunner } from "../../isolation/probe-runner.js";
import {
  createExecutionEvidence, executionEvidenceDigest, evidenceMatchesIdentity,
  type ExecutionEvidenceRecord,
} from "../../isolation/execution-evidence.js";
import { InMemoryStepAttemptJournal, stepAttemptKey, type StepAttemptRecord } from "./step-attempt-journal.js";
import { reconcileAmbiguousStep, reconcileMissionAmbiguity, type ReconciliationOutcome } from "./ambiguity-reconciliation.js";
import type { VerificationStrategy } from "./action-contract.js";

/**
 * P15 (ADR 0049) trusted ambiguous-step reconciliation security matrix.
 *
 * Doctrine under test: AMBIGUOUS never leaves AMBIGUOUS without trusted,
 * identity-bound, durable evidence; model output is never verification; a
 * missing probe/evidence stays AMBIGUOUS; conflicting evidence stays
 * AMBIGUOUS; the resolved transition carries provenance + evidence digest;
 * repeated reconciliation is idempotent-fail-closed; probe output alone is
 * insufficient without identity binding.
 */

function tempDir() { return mkdtemp(join(tmpdir(), "quack-amb-")); }

const MISSION = "m-amb";
const CAP = "quack.text.transform";
const EXEC_ID = "exec_amb1";

function attemptRecord(state: "AMBIGUOUS" | "COMPLETED" | "FAILED" = "AMBIGUOUS"): StepAttemptRecord {
  return {
    version: 1,
    attemptKey: stepAttemptKey(MISSION, 2, CAP),
    missionId: MISSION,
    stepIndex: 2,
    capability: CAP,
    state,
    executionId: EXEC_ID,
    recordedAt: new Date().toISOString(),
  };
}

function evidenceRecord(overrides: Partial<ExecutionEvidenceRecord> = {}): ExecutionEvidenceRecord {
  const base = {
    identity: {
      missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID, backendId: "worker-process",
    },
    facts: {
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      exitState: "SUCCEEDED" as const,
      isolationLevel: "WORKER_PROCESS",
      backendGuarantees: { fs: "workspace-only" },
      outputDigest: "a".repeat(64),
      outputBytes: 32,
    },
    cleanup: "CLEANED" as const,
    verification: { state: "UNVERIFIED" as const, probesRun: [], checkedAt: new Date().toISOString() },
  };
  const withOverrides = { ...base, ...overrides } as Omit<ExecutionEvidenceRecord, "digest" | "version" | "recordedAt">;
  const record = createExecutionEvidence(withOverrides as never);
  return record;
}

function probeStrategy(): VerificationStrategy {
  return {
    kind: "probe_external_state",
    capability: CAP,
    arguments: {},
    expected: {
      description: "transform output is probe-checkable",
      successProbes: [{ kind: "status_equals", value: "SUCCEEDED" }],
    },
  };
}

function harness(options: {
  evidence?: ExecutionEvidenceRecord;
  events?: EventBus;
} = {}) {
  const journal = new InMemoryStepAttemptJournal();
  const events = options.events ?? new EventBus();
  const emitted: { type: string; payload: Record<string, unknown> }[] = [];
  events.onAny((event) => { emitted.push({ type: event.type, payload: event.payload as Record<string, unknown> }); });
  const evidenceStore = {
    load: async (executionId: string): Promise<ExecutionEvidenceRecord | undefined> => {
      if (executionId !== EXEC_ID) return undefined;
      return options.evidence;
    },
  };
  const probeRunner = new ProbeRunner({ workspaceRoot: "unused-for-status-probes", events });
  const base = {
    missionId: MISSION,
    journal,
    probeRunner,
    evidenceStore,
    events,
    actor: "test-reconciler",
  };
  return { journal, events, emitted, base };
}

// ---------------------------------------------------------------------------
// Trusted positive / negative probes
// ---------------------------------------------------------------------------

test("P15.C1 trusted positive probe resolves AMBIGUOUS → COMPLETED with evidence-bound provenance", async t => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { journal, emitted, base } = harness({ evidence: evidenceRecord() });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const outcome = await reconcileAmbiguousStep({ ...base, attempt: attemptRecord(), strategy: probeStrategy() });
  assert.equal(outcome.kind, "RESOLVED_COMPLETED");
  if (outcome.kind === "RESOLVED_COMPLETED") {
    assert.match(outcome.evidenceDigest, /^[0-9a-f]{64}$/, "resolution is digest-bound to the evidence");
    const record = await journal.load(stepAttemptKey(MISSION, 2, CAP));
    assert.equal(record!.state, "COMPLETED");
    assert.equal(record!.resolvedBy, "test-reconciler", "provenance is recorded");
    assert.equal(record!.resolutionEvidenceDigest, outcome.evidenceDigest, "journal carries the evidence digest");
  }
  const types = emitted.map(e => e.type);
  assert.ok(types.includes("mission.reconciliation_attempted"));
  assert.ok(types.includes("mission.reconciliation_verified"));
});

test("P15.C2 trusted negative probe resolves AMBIGUOUS → FAILED (definitive absence of the declared effect)", async t => {
  const { journal, base } = harness({ evidence: evidenceRecord({ facts: { ...evidenceRecord().facts, exitState: "FAILED" } }) });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const strategy = probeStrategy();
  const negativeStrategy: VerificationStrategy = strategy.kind === "probe_external_state"
    ? { ...strategy, expected: { ...strategy.expected, successProbes: [{ kind: "status_equals", value: "SUCCEEDED" }] } }
    : strategy;
  const outcome = await reconcileAmbiguousStep({ ...base, attempt: attemptRecord(), strategy: negativeStrategy });
  // exitState FAILED ⇒ reconstructed status FAILED ⇒ status_equals(SUCCEEDED) fails ⇒ definitive negative.
  assert.equal(outcome.kind, "RESOLVED_FAILED");
  const record = await journal.load(stepAttemptKey(MISSION, 2, CAP));
  assert.equal(record!.state, "FAILED");
});

// ---------------------------------------------------------------------------
// Missing / malformed / stale / cross-mission evidence stays AMBIGUOUS
// ---------------------------------------------------------------------------

test("P15.C3 missing evidence record: stays AMBIGUOUS (never infer success from absence)", async t => {
  const { journal, base } = harness({ evidence: undefined });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const outcome = await reconcileAmbiguousStep({ ...base, attempt: attemptRecord(), strategy: probeStrategy() });
  assert.equal(outcome.kind, "REMAINS_AMBIGUOUS");
  if (outcome.kind === "REMAINS_AMBIGUOUS") assert.match(outcome.reason, /no durable evidence/);
  assert.equal((await journal.load(stepAttemptKey(MISSION, 2, CAP)))!.state, "AMBIGUOUS");
});

test("P15.C4 missing probe strategy (no registered adapter): stays AMBIGUOUS", async t => {
  const { journal, base } = harness({ evidence: evidenceRecord() });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const outcome = await reconcileAmbiguousStep({ ...base, attempt: attemptRecord(), strategy: undefined });
  assert.equal(outcome.kind, "REMAINS_AMBIGUOUS");
  assert.equal((await journal.load(stepAttemptKey(MISSION, 2, CAP)))!.state, "AMBIGUOUS", "no verifier, no exit");
});

test("P15.C5 trust_executed strategies never reconcile (no runtime-verifiable evidence)", async t => {
  const { journal, base } = harness({ evidence: evidenceRecord() });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const outcome = await reconcileAmbiguousStep({ ...base, attempt: attemptRecord(), strategy: { kind: "trust_executed", reason: "r" } });
  assert.equal(outcome.kind, "REMAINS_AMBIGUOUS");
  assert.equal((await journal.load(stepAttemptKey(MISSION, 2, CAP)))!.state, "AMBIGUOUS");
});

test("P15.C6 cross-mission evidence never settles this attempt", async t => {
  const { journal, base } = harness({
    evidence: evidenceRecord({ identity: { ...evidenceRecord().identity, missionId: "m-OTHER" } } as never),
  });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const outcome = await reconcileAmbiguousStep({ ...base, attempt: attemptRecord(), strategy: probeStrategy() });
  assert.equal(outcome.kind, "REMAINS_AMBIGUOUS");
  if (outcome.kind === "REMAINS_AMBIGUOUS") assert.match(outcome.reason, /identity does not match/);
  assert.equal((await journal.load(stepAttemptKey(MISSION, 2, CAP)))!.state, "AMBIGUOUS");
});

test("P15.C7 tampered evidence record (digest mismatch): stays AMBIGUOUS", async t => {
  const evidence = evidenceRecord();
  // Tamper: re-digest over ALTERED facts (simulates an attacker editing
  // facts but keeping the old digest).
  const { digest: _d, ...rest } = evidence;
  void _d;
  const tampered: ExecutionEvidenceRecord = {
    ...rest,
    facts: { ...rest.facts, exitState: "SUCCEEDED" },
    digest: "0".repeat(64),
  };
  const { journal, base } = harness({ evidence: tampered });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const outcome = await reconcileAmbiguousStep({ ...base, attempt: attemptRecord(), strategy: probeStrategy() });
  assert.equal(outcome.kind, "REMAINS_AMBIGUOUS");
  if (outcome.kind === "REMAINS_AMBIGUOUS") assert.match(outcome.reason, /digest mismatch/);
});

test("P15.C8 conflicting evidence (durable FAILED verification vs fresh PASSED probe): stays AMBIGUOUS", async t => {
  const base = evidenceRecord();
  const conflicting = evidenceRecord({
    verification: { state: "FAILED", probesRun: ["status_equals:SUCCEEDED"], checkedAt: new Date().toISOString() },
  });
  void base;
  const { journal, base: h } = harness({ evidence: conflicting });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const outcome = await reconcileAmbiguousStep({ ...h, attempt: attemptRecord(), strategy: probeStrategy() });
  assert.equal(outcome.kind, "REMAINS_AMBIGUOUS", "a PASSED probe can never overwrite a durable FAILED verification");
  if (outcome.kind === "REMAINS_AMBIGUOUS") assert.match(outcome.reason, /conflict/);
});

test("P15.C9 stale evidence (predates the attempt): stays AMBIGUOUS", async t => {
  const stale = evidenceRecord();
  const { journal, base } = harness({ evidence: stale });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  // Attempt recorded NOW; evidence completed 10 minutes AGO → stale.
  const staleAttempt: StepAttemptRecord = { ...attemptRecord(), recordedAt: new Date(Date.now() + 600_000).toISOString() };
  const outcome = await reconcileAmbiguousStep({ ...base, attempt: staleAttempt, strategy: probeStrategy() });
  assert.equal(outcome.kind, "REMAINS_AMBIGUOUS");
  if (outcome.kind === "REMAINS_AMBIGUOUS") assert.match(outcome.reason, /stale/);
});

test("P15.C10 probe crash: stays AMBIGUOUS (fail closed)", async t => {
  const { journal, base } = harness({ evidence: evidenceRecord() });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const crashingProbes = {
    ...base,
    probeRunner: {
      runProbes: async () => { throw new Error("probe infrastructure crash"); },
    } as never as ProbeRunner,
  };
  const outcome = await reconcileAmbiguousStep({ ...crashingProbes, attempt: attemptRecord(), strategy: probeStrategy() });
  assert.equal(outcome.kind, "REMAINS_AMBIGUOUS");
});

test("P15.C11 repeated reconciliation: a COMPLETED attempt is never re-reconciled; a second pass over an already-resolved attempt parks (no state change)", async t => {
  const { journal, base } = harness({ evidence: evidenceRecord() });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const first = await reconcileAmbiguousStep({ ...base, attempt: attemptRecord(), strategy: probeStrategy() });
  assert.equal(first.kind, "RESOLVED_COMPLETED");
  // Re-read the attempt from the journal (now COMPLETED) and attempt again.
  const resolvedAttempt = await journal.load(stepAttemptKey(MISSION, 2, CAP));
  const second = await reconcileAmbiguousStep({ ...base, attempt: resolvedAttempt!, strategy: probeStrategy() });
  assert.equal(second.kind, "REMAINS_AMBIGUOUS", "COMPLETED is terminal — no second resolution");
  if (second.kind === "REMAINS_AMBIGUOUS") assert.match(second.reason, /not AMBIGUOUS/);
});

test("P15.C12 mission-wide reconciliation parks on the first unresolved attempt", async t => {
  const { journal, base } = harness({ evidence: evidenceRecord() });
  // Step 0 resolvable (its evidence is bound to step 0); step 3 unresolved
  // (different executionId → no evidence record).
  const step0Evidence = evidenceRecord();
  // Rebuild evidence bound to step 0 / its own execution id.
  const step0Exec = "exec_step0";
  const step0Record = createExecutionEvidence({
    identity: { missionId: MISSION, stepIndex: 0, capability: CAP, executionId: step0Exec, backendId: "worker-process" },
    facts: {
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {},
      outputDigest: "b".repeat(64), outputBytes: 8,
    },
    cleanup: "CLEANED",
    verification: { state: "UNVERIFIED", probesRun: [], checkedAt: new Date().toISOString() },
  });
  void step0Evidence;
  const evidenceStore = {
    load: async (executionId: string): Promise<ExecutionEvidenceRecord | undefined> => {
      if (executionId === step0Exec) return step0Record;
      return undefined;
    },
  };
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 0, CAP), missionId: MISSION, stepIndex: 0, capability: CAP, executionId: step0Exec });
  await journal.settle(stepAttemptKey(MISSION, 0, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 3, CAP), missionId: MISSION, stepIndex: 3, capability: CAP, executionId: "exec-other" });
  await journal.settle(stepAttemptKey(MISSION, 3, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const outcomes: readonly ReconciliationOutcome[] = await reconcileMissionAmbiguity({
    ...base,
    evidenceStore,
    strategyFor: () => probeStrategy(),
  });
  assert.equal(outcomes.length, 2, "both ambiguous attempts were attempted");
  assert.equal(outcomes[0]!.kind, "RESOLVED_COMPLETED");
  assert.equal(outcomes[1]!.kind, "REMAINS_AMBIGUOUS", "the attempt without evidence parks");
});

test("P15.C13 evidence-boundary honesty: output content is never reconstructed — probes needing raw output honestly fail", async t => {
  // Evidence stores a DIGEST of output, never the payload. A probe that
  // requires output fields cannot verify from evidence alone.
  const { journal, base } = harness({ evidence: evidenceRecord() });
  await journal.reserve({ attemptKey: stepAttemptKey(MISSION, 2, CAP), missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID });
  await journal.settle(stepAttemptKey(MISSION, 2, CAP), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const strategy = probeStrategy();
  const outputStrategy: VerificationStrategy = strategy.kind === "probe_external_state"
    ? { ...strategy, expected: { ...strategy.expected, successProbes: [{ kind: "output_field", path: "transformed", equals: "HELLO" }] } }
    : strategy;
  const outcome = await reconcileAmbiguousStep({ ...base, attempt: attemptRecord(), strategy: outputStrategy });
  assert.equal(outcome.kind, "REMAINS_AMBIGUOUS", "raw-output probes honestly cannot verify from the metadata-only evidence store");
});

test("P15.C14 evidence identity binding is exact on every field", () => {
  const record = evidenceRecord();
  assert.ok(evidenceMatchesIdentity(record, { missionId: MISSION, stepIndex: 2, capability: CAP, executionId: EXEC_ID }));
  assert.ok(!evidenceMatchesIdentity(record, { missionId: "other", stepIndex: 2, capability: CAP, executionId: EXEC_ID }));
  assert.ok(!evidenceMatchesIdentity(record, { missionId: MISSION, stepIndex: 3, capability: CAP, executionId: EXEC_ID }));
  assert.ok(!evidenceMatchesIdentity(record, { missionId: MISSION, stepIndex: 2, capability: "other", executionId: EXEC_ID }));
  assert.ok(!evidenceMatchesIdentity(record, { missionId: MISSION, stepIndex: 2, capability: CAP, executionId: "other" }));
  // Digest helper covers the full identity tuple.
  const { digest, ...rest } = record;
  assert.equal(executionEvidenceDigest(rest), digest, "digest is over the canonical record");
});
