import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveExecutionPolicy,
  parseExecutionPolicy,
  serializeExecutionPolicy,
  policyDigest,
  classifyExecutionState,
  journalStateForExecution,
  clampOutputBytes,
  resolveIsolationState,
  EXECUTION_POLICY_VERSION,
  DEFAULT_MAX_OUTPUT_BYTES,
} from "./execution-policy.js";
import {
  JsonFileStepAttemptJournal,
  InMemoryStepAttemptJournal,
  stepAttemptKey,
} from "./step-attempt-journal.js";
import type { IsolationBackend } from "../../isolation/contract.js";

// ---------------------------------------------------------------------------
// P12.1 execution policy resolution
// ---------------------------------------------------------------------------

test("P12 policy resolution is deterministic and digest-stable", () => {
  const first = resolveExecutionPolicy({ capability: "core.echo", providerKind: "CORE_TOOL", riskLevel: "READ_ONLY" });
  const second = resolveExecutionPolicy({ capability: "core.echo", providerKind: "CORE_TOOL", riskLevel: "READ_ONLY" });
  assert.deepEqual(first, second);
  assert.equal(first.digest, second.digest);
  assert.equal(first.version, EXECUTION_POLICY_VERSION);
  assert.equal(first.timeoutMs, 30_000);
  assert.equal(first.isolation.state, "POLICY_RESTRICTED");
  assert.equal(first.limits.maxAttempts, 1);
  assert.equal(first.limits.memoryBytes, null, "memory limit is honestly advisory (null)");
});

test("P12 policy timeout derives from risk tier and descriptor only", () => {
  const read = resolveExecutionPolicy({ capability: "a.read", providerKind: "ACTION_PROVIDER", riskLevel: "READ_ONLY", descriptorTimeoutMs: 10_000 });
  assert.equal(read.timeoutMs, 10_000);
  const ceiling = resolveExecutionPolicy({ capability: "a.read", providerKind: "ACTION_PROVIDER", riskLevel: "READ_ONLY", descriptorTimeoutMs: 500_000 });
  assert.equal(ceiling.timeoutMs, 30_000, "risk-tier ceiling caps the descriptor timeout");
  const lowered = resolveExecutionPolicy({ capability: "a.read", providerKind: "ACTION_PROVIDER", riskLevel: "READ_ONLY", overrides: { timeoutCeilingMs: 5_000 } });
  assert.equal(lowered.timeoutMs, 5_000);
});

test("P12 policy fails closed on unknown risk level and malformed inputs", () => {
  assert.throws(() => resolveExecutionPolicy({ capability: "x", providerKind: "CORE_TOOL", riskLevel: "CATASTROPHIC" as never }), /known risk level/);
  assert.throws(() => resolveExecutionPolicy({ capability: "", providerKind: "CORE_TOOL", riskLevel: "READ_ONLY" }), /registered capability/);
  assert.throws(() => resolveExecutionPolicy({ capability: "x", providerKind: "CORE_TOOL", riskLevel: "READ_ONLY", descriptorTimeoutMs: -1 }), /positive integer/);
  assert.throws(() => resolveExecutionPolicy({ capability: "x", providerKind: "CORE_TOOL", riskLevel: "READ_ONLY", overrides: { timeoutCeilingMs: 0 } }), /positive integer/);
  assert.throws(() => resolveExecutionPolicy({ capability: "x", providerKind: "CORE_TOOL", riskLevel: "READ_ONLY", overrides: { maxOutputBytes: 0 } }), /positive integer/);
});

// ---------------------------------------------------------------------------
// P12.2 isolation state honesty
// ---------------------------------------------------------------------------

test("P12 isolation: IN_PROCESS is honestly POLICY_RESTRICTED, never a sandbox claim", () => {
  const state = resolveIsolationState({ requiredLevel: "IN_PROCESS" });
  assert.deepEqual(state, { state: "POLICY_RESTRICTED", backendId: "none" });
});

test("P12 isolation: required level without a backend fails closed", () => {
  const state = resolveIsolationState({ requiredLevel: "WORKER_PROCESS" });
  assert.equal(state.state, "FAILED_CLOSED");
});

test("P12 isolation: backend without the required level fails closed — no downgrade", () => {
  const workerOnly: IsolationBackend = {
    id: "fixture-worker",
    supportedLevels: ["WORKER_PROCESS"],
    guarantees: { filesystem: "BEST_EFFORT", network: "UNSUPPORTED", process: "BEST_EFFORT", environment: "ENFORCED", resources: "BEST_EFFORT", secrets: "UNSUPPORTED" },
    execute: async () => { throw new Error("not used"); },
  };
  const denied = resolveIsolationState({ requiredLevel: "CONTAINER_ISOLATED", backend: workerOnly });
  assert.equal(denied.state, "FAILED_CLOSED");
  assert.equal(denied.backendId, "fixture-worker");
  const granted = resolveIsolationState({ requiredLevel: "WORKER_PROCESS", backend: workerOnly });
  assert.equal(granted.state, "PROCESS_ISOLATED");
});

test("P12 policy: FAILED_CLOSED isolation is carried on the resolved policy", () => {
  const policy = resolveExecutionPolicy({
    capability: "x.write", providerKind: "ACTION_PROVIDER", riskLevel: "REVERSIBLE",
    requiredIsolation: "CONTAINER_ISOLATED", // trusted config demands containers
  });
  assert.equal(policy.isolation.state, "FAILED_CLOSED");
  assert.equal(policy.isolation.requiredLevel, "CONTAINER_ISOLATED");
});

// ---------------------------------------------------------------------------
// P12.1 serialization / fail-closed parse
// ---------------------------------------------------------------------------

test("P12 policy serialization round-trips and rejects tampering", () => {
  const policy = resolveExecutionPolicy({ capability: "a.b", providerKind: "ACTION_PROVIDER", riskLevel: "REVERSIBLE" });
  const round = parseExecutionPolicy(JSON.stringify(policy));
  assert.equal(round.ok, true);
  if (round.ok) assert.equal(round.policy.digest, policy.digest);

  // Unknown fields fail closed.
  const unknownField = parseExecutionPolicy(JSON.stringify({ ...policy, sandboxEscape: true }));
  assert.equal(unknownField.ok, false, "unknown policy fields are rejected");

  // Digest tampering fails closed.
  const tampered = { ...policy, timeoutMs: policy.timeoutMs + 60_000 };
  assert.equal(parseExecutionPolicy(JSON.stringify(tampered)).ok, false, "digest mismatch is rejected");

  // Attempts to raise the attempt limit fail closed.
  const multiAttempt = parseExecutionPolicy(JSON.stringify({
    ...policy, limits: { ...policy.limits, maxAttempts: 3 }, digest: "",
  }));
  assert.equal(multiAttempt.ok, false, "maxAttempts>1 must be rejected");
});

test("P12 policy parse rejects advisory memory limits represented as enforced", () => {
  const policy = resolveExecutionPolicy({ capability: "a.b", providerKind: "ACTION_PROVIDER", riskLevel: "READ_ONLY" });
  const forged = JSON.stringify({
    ...policy, limits: { ...policy.limits, memoryBytes: 1024 as unknown as null },
    digest: policyDigest({ ...policy, limits: { ...policy.limits, memoryBytes: 1024 as unknown as null } }),
  });
  // Even a correctly-digested policy is rejected when it claims enforced memory.
  assert.equal(parseExecutionPolicy(forged).ok, false, "enforced memory limits are rejected as dishonest");
});

// ---------------------------------------------------------------------------
// P12.8 execution-state classification
// ---------------------------------------------------------------------------

test("P12 classification: success is never automatically verified", () => {
  assert.equal(classifyExecutionState({ status: "SUCCEEDED" }), "EXECUTION_COMPLETED");
  assert.equal(classifyExecutionState({ status: "SUCCEEDED", verificationStatus: "INCONCLUSIVE" }), "EXECUTION_COMPLETED");
  assert.equal(classifyExecutionState({ status: "SUCCEEDED", verificationStatus: "SKIPPED" }), "EXECUTION_COMPLETED");
  assert.equal(classifyExecutionState({ status: "SUCCEEDED", verificationStatus: "PASSED" }), "EXECUTION_VERIFIED");
  assert.equal(classifyExecutionState({ status: "FAILED" }), "EXECUTION_FAILED");
  assert.equal(classifyExecutionState({ status: "DENIED" }), "EXECUTION_DENIED");
  assert.equal(classifyExecutionState({ status: "SUCCEEDED", timedOut: true }), "EXECUTION_TIMED_OUT");
  assert.equal(classifyExecutionState({ status: "CANCELLED" }), "EXECUTION_CANCELLED");
  assert.equal(classifyExecutionState({ status: "FAILED", ambiguous: true }), "EXECUTION_AMBIGUOUS");
});

test("P12 classification: journal states map honestly", () => {
  assert.equal(journalStateForExecution("EXECUTION_VERIFIED"), "COMPLETED");
  assert.equal(journalStateForExecution("EXECUTION_COMPLETED"), "COMPLETED");
  assert.equal(journalStateForExecution("EXECUTION_FAILED"), "FAILED");
  assert.equal(journalStateForExecution("EXECUTION_DENIED"), "FAILED");
  assert.equal(journalStateForExecution("EXECUTION_TIMED_OUT"), "AMBIGUOUS");
  assert.equal(journalStateForExecution("EXECUTION_CANCELLED"), "AMBIGUOUS");
  assert.equal(journalStateForExecution("EXECUTION_AMBIGUOUS"), "AMBIGUOUS");
});

// ---------------------------------------------------------------------------
// P12.7 output containment
// ---------------------------------------------------------------------------

test("P12 output containment drops oversized output without previewing it", () => {
  const small = clampOutputBytes({ value: "ok" }, DEFAULT_MAX_OUTPUT_BYTES);
  assert.equal(small.truncated, false);
  assert.deepEqual(small.output, { value: "ok" });

  const oversized = clampOutputBytes({ blob: "x".repeat(DEFAULT_MAX_OUTPUT_BYTES) }, 1_024);
  assert.equal(oversized.truncated, true);
  assert.deepEqual(oversized.output, { quackTruncated: true, byteLength: oversized.byteLength, limitBytes: 1_024 });
  // The dropped content must NOT appear anywhere in the replacement object.
  assert.equal(JSON.stringify(oversized.output).includes("xxxx"), false);
});

// ---------------------------------------------------------------------------
// P12.9/P12.10 step attempt journal
// ---------------------------------------------------------------------------

test("P12 journal: reserve is at-most-once and settle is terminal", async () => {
  const journal = new InMemoryStepAttemptJournal();
  const key = stepAttemptKey("m", 0, "core.echo");
  assert.equal(await journal.reserve({ attemptKey: key, missionId: "m", stepIndex: 0, capability: "core.echo", executionId: "e1" }), true);
  assert.equal(await journal.reserve({ attemptKey: key, missionId: "m", stepIndex: 0, capability: "core.echo", executionId: "e2" }), false, "duplicate step reservation is refused");
  await journal.settle(key, { state: "COMPLETED", executionState: "EXECUTION_COMPLETED" });
  await assert.rejects(() => journal.settle(key, { state: "COMPLETED" }), /already settled/);
  assert.equal((await journal.load(key))?.executionState, "EXECUTION_COMPLETED");
  await assert.rejects(() => journal.settle("missing", { state: "FAILED" }), /unknown attempt key/);
});

test("P12 journal: crash-window DISPATCHING entries reconcile to AMBIGUOUS, never re-execute", async () => {
  const journal = new InMemoryStepAttemptJournal();
  const key = stepAttemptKey("m", 1, "a.write");
  assert.equal(await journal.reserve({ attemptKey: key, missionId: "m", stepIndex: 1, capability: "a.write", executionId: "e1" }), true);
  const orphaned = await journal.reconcileOrphans();
  assert.equal(orphaned.length, 1);
  assert.equal(orphaned[0]?.state, "AMBIGUOUS");
  assert.equal((await journal.load(key))?.state, "AMBIGUOUS");
  // After reconciliation the step is refused: no re-dispatch of an ambiguous attempt.
  assert.equal(await journal.reserve({ attemptKey: key, missionId: "m", stepIndex: 1, capability: "a.write", executionId: "e2" }), false);
});

test("P12 journal: durable JSON-file journal survives process boundaries and fails closed on tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "quack-step-journal-"));
  try {
    const journal = new JsonFileStepAttemptJournal(root);
    const key = stepAttemptKey("mission-a", 2, "core.echo");
    assert.equal(await journal.reserve({ attemptKey: key, missionId: "mission-a", stepIndex: 2, capability: "core.echo", executionId: "exec-1" }), true);

    // A fresh instance (new process) sees the reservation and refuses duplicates.
    const second = new JsonFileStepAttemptJournal(root);
    assert.equal(await second.reserve({ attemptKey: key, missionId: "mission-a", stepIndex: 2, capability: "core.echo", executionId: "exec-2" }), false);

    // Crash-window orphan reconciliation from the new process.
    const orphaned = await second.reconcileOrphans();
    assert.equal(orphaned.length, 1);
    assert.equal(orphaned[0]?.state, "AMBIGUOUS");
    assert.equal((await second.load(key))?.executionId, "exec-1");

    // A forged record (identity mismatch) fails closed on load.
    const { writeFile } = await import("node:fs/promises");
    const forged = stepAttemptKey("forged", 0, "x");
    await import("node:fs/promises").then((fs) => fs.mkdir(join(root, "step-attempts"), { recursive: true }));
    await writeFile(join(root, "step-attempts", "forged_0_x.json"), JSON.stringify({ version: 1, attemptKey: "other:0:x", state: "DISPATCHING" }));
    await assert.rejects(() => second.load(forged), /identity mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
