import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../events/event-bus.js";
import { IsolationBackendRegistry } from "./backend-resolver.js";
import { ProcessIsolationBackend } from "./process-backend.js";
import { IsolationSupervisor } from "./supervisor.js";
import {
  createExecutionEvidence, parseExecutionEvidence, evidenceMatchesIdentity,
  JsonFileExecutionEvidenceStore, InMemoryExecutionEvidenceStore,
  type ExecutionEvidenceRecord,
} from "./execution-evidence.js";
import { ProbeRunner } from "./probe-runner.js";
import { WorkloadAdapterRegistry, isAbsoluteOrTraversal } from "./workload-adapter.js";

/**
 * P13 (ADR 0047) supervisor + evidence + probe-runner behavior tests:
 * the trusted lifecycle around isolated execution and the identity
 * bindings that make evidence non-transferable.
 */

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "quack-sup-"));
  const events = new EventBus();
  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const store = new InMemoryExecutionEvidenceStore();
  const supervisor = new IsolationSupervisor({
    registry, events, actor: "test", workspaceRoot: root, evidenceStore: store,
  });
  return { root, events, registry, store, supervisor, cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

const workloadSource = (payload: string) => `exports.run = async (io) => (${payload});`;

test("P13.SUP-1 supervisor executes an adapter-backed workload through the process backend", async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  await writeFile(join(fx.root, "task.cjs"), workloadSource("{ done: true, actor: io.args.name }"));
  const result = await fx.supervisor.execute({
    missionId: "m1", stepIndex: 0, capability: "fixture.task", executionId: "exec-1",
    requiredLevel: "WORKER_PROCESS",
    profile: {
      filesystem: { workspaceRoot: fx.root },
      network: { mode: "DENY" },
      environment: { variables: {}, secrets: [] },
      limits: { wallClockMs: 10_000 },
    },
    workload: { kind: "module", entry: "task.cjs", args: { name: "quack" } },
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.output!["done"], true);
  assert.equal(result.output!["actor"], "quack");
  assert.equal(result.backendId, "os-process");
  assert.equal(result.evidence.identity.missionId, "m1");
  assert.equal(result.evidence.identity.capability, "fixture.task");
});

test("P13.SUP-2 backend disappearance (UNRESOLVED) DENIES with durable evidence — no fallback execution", async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  await writeFile(join(fx.root, "task.cjs"), workloadSource("{ done: true }"));
  const result = await fx.supervisor.execute({
    missionId: "m2", stepIndex: 0, capability: "fixture.task", executionId: "exec-2",
    requiredLevel: "CONTAINER_ISOLATED", // no container backend registered
    profile: {
      filesystem: { workspaceRoot: fx.root },
      network: { mode: "DENY" },
      environment: { variables: {}, secrets: [] },
      limits: { wallClockMs: 10_000 },
    },
    workload: { kind: "module", entry: "task.cjs", args: {} },
  });
  assert.equal(result.status, "DENIED", "isolation requirement without a backend denies — never downgrades");
  assert.match(String(result.error), /cannot be satisfied/);
  assert.equal(result.evidence.facts.exitState, "UNSUPPORTED");
  // Evidence is durable: the denial itself is recorded.
  const stored = await fx.store.load("exec-2");
  assert.ok(stored, "denial evidence persisted");
});

test("P13.SUP-3 supervisor timeout settles TIMED_OUT with evidence and cleanup", async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  await writeFile(join(fx.root, "spin.cjs"), "exports.run = async () => { while (true) {} };");
  const result = await fx.supervisor.execute({
    missionId: "m3", stepIndex: 0, capability: "fixture.task", executionId: "exec-3",
    requiredLevel: "WORKER_PROCESS",
    profile: {
      filesystem: { workspaceRoot: fx.root },
      network: { mode: "DENY" },
      environment: { variables: {}, secrets: [] },
      limits: { wallClockMs: 500 },
    },
    workload: { kind: "module", entry: "spin.cjs", args: {} },
  });
  assert.equal(result.status, "TIMED_OUT");
  assert.equal(result.evidence.facts.exitState, "TIMED_OUT");
});

test("P13.SUP-4 evidence binds identity: mismatched identity fails the binding check", async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const record = createExecutionEvidence({
    identity: { missionId: "m-a", stepIndex: 0, capability: "cap", executionId: "e-1", backendId: "os-process" },
    facts: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    cleanup: "CLEANED",
  });
  assert.equal(evidenceMatchesIdentity(record, { missionId: "m-a", stepIndex: 0, capability: "cap", executionId: "e-1" }), true);
  // Cross-mission / cross-step / cross-execution reuse all fail:
  assert.equal(evidenceMatchesIdentity(record, { missionId: "m-b", stepIndex: 0, capability: "cap", executionId: "e-1" }), false);
  assert.equal(evidenceMatchesIdentity(record, { missionId: "m-a", stepIndex: 7, capability: "cap", executionId: "e-1" }), false);
  assert.equal(evidenceMatchesIdentity(record, { missionId: "m-a", stepIndex: 0, capability: "cap", executionId: "e-2" }), false);
});

test("P13.SUP-5 tampered evidence fails digest validation on load", async () => {
  const record = createExecutionEvidence({
    identity: { missionId: "m", stepIndex: 0, capability: "cap", executionId: "e", backendId: "os-process" },
    facts: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), exitState: "FAILED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    cleanup: "CLEANED",
  });
  // Forge: flip the exit state to SUCCEEDED without re-digesting.
  const forged = { ...record, facts: { ...record.facts, exitState: "SUCCEEDED" as const } };
  const parsed = parseExecutionEvidence(JSON.stringify(forged));
  assert.equal(parsed.ok, false, "forged evidence fails closed");
  if (!parsed.ok) assert.match(parsed.reason, /tampered/);
});

test("P13.SUP-6 correctly-digested VERIFIED records parse (the trust boundary is construction authority)", () => {
  const base = createExecutionEvidence({
    identity: { missionId: "m", stepIndex: 0, capability: "cap", executionId: "e", backendId: "os-process" },
    facts: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    cleanup: "CLEANED",
    verification: { state: "VERIFIED", probesRun: ["output_field:x"], checkedAt: new Date().toISOString() },
  });
  // A correctly-digested VERIFIED record is structurally valid. The TRUST
  // boundary is that ONLY the trusted supervisor/probe-runner construct
  // such records: settleVerification (SUP-7) enforces identity, and
  // tampering a VERIFIED claim in requires re-digesting — which the
  // untrusted side cannot do without the record remaining internally
  // consistent with its own claimed facts (SUP-5 proves the digest wall).
  const parsed = parseExecutionEvidence(JSON.stringify(base));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.record.verification.state, "VERIFIED");
});

test("P13.SUP-7 settleVerification refuses evidence from a different execution (identity mismatch)", async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  await writeFile(join(fx.root, "ok.cjs"), workloadSource("{ ok: true }"));
  await fx.supervisor.execute({
    missionId: "m7", stepIndex: 3, capability: "fixture.task", executionId: "exec-7",
    requiredLevel: "WORKER_PROCESS",
    profile: { filesystem: { workspaceRoot: fx.root }, network: { mode: "DENY" }, environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 10_000 } },
    workload: { kind: "module", entry: "ok.cjs", args: {} },
  });
  // Attempt to verify under a DIFFERENT mission identity: fails closed.
  await assert.rejects(
    () => fx.supervisor.settleVerification({
      missionId: "OTHER-mission", stepIndex: 3, capability: "fixture.task", executionId: "exec-7",
      verification: { state: "VERIFIED", probesRun: ["no_error"], checkedAt: new Date().toISOString() },
    }),
    /identity mismatch/,
  );
});

test("P13.SUP-8 crash-window evidence (PENDING cleanup) reconciles to UNCERTAIN + UNVERIFIED", async t => {
  const root = await mkdtemp(join(tmpdir(), "quack-evi-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const store = new JsonFileExecutionEvidenceStore(root);
  const pending = createExecutionEvidence({
    identity: { missionId: "m8", stepIndex: 0, capability: "cap", executionId: "exec-8", backendId: "os-process" },
    facts: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), exitState: "FAILED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    cleanup: "PENDING",
    verification: { state: "VERIFIED", probesRun: ["no_error"], checkedAt: new Date().toISOString() },
  });
  await store.save(pending);
  // "Crash": a NEW store instance (next process) reconciles the orphan.
  const second = new JsonFileExecutionEvidenceStore(root);
  const orphaned = await second.reconcileOrphans();
  assert.equal(orphaned.length, 1);
  assert.equal(orphaned[0]!.cleanup, "UNCERTAIN", "uncertain cleanup is honest");
  assert.equal(orphaned[0]!.verification.state, "UNVERIFIED", "verification does not survive a crash window");
  const after = await second.load("exec-8");
  assert.equal(after!.verification.state, "UNVERIFIED");
});

test("P13.SUP-9 durable evidence store rejects tampered files on load", async t => {
  const root = await mkdtemp(join(tmpdir(), "quack-evi2-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  await mkdir(join(root, "execution-evidence"), { recursive: true });
  await writeFile(join(root, "execution-evidence", "exec-9.json"),
    JSON.stringify({ version: 1, identity: { missionId: "m", stepIndex: 0, capability: "c", executionId: "exec-9", backendId: "b" },
      facts: { startedAt: "x", completedAt: "y", exitState: "SUCCEEDED", isolationLevel: "l", backendGuarantees: {} },
      verification: { state: "VERIFIED", probesRun: [], checkedAt: "z" }, cleanup: "CLEANED", digest: "0".repeat(64), recordedAt: "r" }));
  const store = new JsonFileExecutionEvidenceStore(root);
  await assert.rejects(() => store.load("exec-9"), /digest mismatch|Invalid/);
});

// ---------------------------------------------------------------------------
// Probe runner: trusted verification, model self-report impossible.
// ---------------------------------------------------------------------------

test("P13.PROBE-1 output_field probe passes on matching runtime evidence", async () => {
  const runner = new ProbeRunner({ workspaceRoot: process.cwd() });
  const outcome = await runner.verify({
    strategy: { kind: "probe_external_state", capability: "cap", arguments: {}, expected: {
      description: "d", successProbes: [{ kind: "output_field", path: "result.count", equals: 3 }],
    } },
    result: { executionId: "e", providerId: "p", actionId: "a", status: "SUCCEEDED", output: { result: { count: 3 } }, evidenceIds: [] },
    facts: minimalFacts(),
    missionId: "m", executionId: "e",
  });
  assert.equal(outcome.kind, "PASSED");
  assert.deepEqual(outcome.probesRun, ["output_field:result.count"]);
});

test("P13.PROBE-2 output mismatch FAILS verification (runtime truth wins over claims)", async () => {
  const runner = new ProbeRunner({ workspaceRoot: process.cwd() });
  const outcome = await runner.verify({
    strategy: { kind: "probe_external_state", capability: "cap", arguments: {}, expected: {
      description: "d", successProbes: [{ kind: "output_field", path: "result.count", equals: 99 }],
    } },
    result: { executionId: "e", providerId: "p", actionId: "a", status: "SUCCEEDED", output: { result: { count: 3 } }, evidenceIds: [] },
    facts: minimalFacts(),
    missionId: "m", executionId: "e",
  });
  assert.equal(outcome.kind, "FAILED");
});

test("P13.PROBE-3 trust_executed never verifies (stays honestly INCONCLUSIVE/UNVERIFIED)", async () => {
  const runner = new ProbeRunner({ workspaceRoot: process.cwd() });
  const outcome = await runner.verify({
    strategy: { kind: "trust_executed", reason: "r" },
    result: { executionId: "e", providerId: "p", actionId: "a", status: "SUCCEEDED", output: {}, evidenceIds: [] },
    facts: minimalFacts(),
    missionId: "m", executionId: "e",
  });
  assert.equal(outcome.kind, "INCONCLUSIVE");
  assert.match(outcome.summary, /UNVERIFIED/);
});

test("P13.PROBE-4 external_check probes fail closed: no second execution authority in the probe runner", async () => {
  const runner = new ProbeRunner({ workspaceRoot: process.cwd() });
  const outcome = await runner.verify({
    strategy: { kind: "probe_external_state", capability: "cap", arguments: {}, expected: {
      description: "d", successProbes: [{ kind: "external_check", capability: "other.cap", arguments: {}, assertion: "x" }],
    } },
    result: { executionId: "e", providerId: "p", actionId: "a", status: "SUCCEEDED", output: {}, evidenceIds: [] },
    facts: minimalFacts(),
    missionId: "m", executionId: "e",
  });
  assert.equal(outcome.kind, "FAILED");
  assert.match(outcome.summary, /second execution authority|external_check/);
});

test("P13.PROBE-5 fs-effect probe observes only inside the governed workspace (traversal rejected)", async t => {
  const root = await mkdtemp(join(tmpdir(), "quack-fs-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  await writeFile(join(root, "effect.txt"), "data");
  const runner = new ProbeRunner({ workspaceRoot: root });
  const inside = await runner.verifyFilesystemEffect("effect.txt", { exists: true });
  assert.equal(inside.passed, true);
  const escaped = await runner.verifyFilesystemEffect("../../etc/passwd", { exists: true });
  assert.equal(escaped.passed, false, "traversal probe fails closed");
  assert.match(String(escaped.reason), /escapes|safe relative path/i);
  const absent = await runner.verifyFilesystemEffect("missing.txt", { exists: true });
  assert.equal(absent.passed, false);
});

// ---------------------------------------------------------------------------
// Workload adapter registry: the no-model-to-module-path guarantee.
// ---------------------------------------------------------------------------

test("P13.ADAPT-1 unknown capability without an adapter is UNREGISTERED (not isolation-eligible)", () => {
  const registry = new WorkloadAdapterRegistry();
  const resolution = registry.resolve("model.invented.capability", {});
  assert.equal(resolution.kind, "UNREGISTERED");
});

test("P13.ADAPT-2 adapter argument validation rejects malformed input as REJECTED (deny, never host-path)", () => {
  const registry = new WorkloadAdapterRegistry();
  registry.register({
    capability: "fixture.validated", entry: "task.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: "/trusted/src", description: "d",
    validateArguments: (args) => typeof args["n"] === "number" ? { ok: true } : { ok: false, reason: "n must be a number" },
    verification: { kind: "none", reason: "fixture adapter carries no verification" },
  });
  const good = registry.resolve("fixture.validated", { n: 1 });
  assert.equal(good.kind, "REGISTERED");
  const bad = registry.resolve("fixture.validated", { n: "inject" });
  assert.equal(bad.kind, "REJECTED", "argument rejection is a distinct DENY outcome — model-controlled arguments must never select the execution environment");
  if (bad.kind === "REJECTED") assert.match(bad.reason, /rejected by the .* adapter/);
});

test("P13.ADAPT-3 adapter registration rejects traversal entries and absolute paths", () => {
  const registry = new WorkloadAdapterRegistry();
  assert.throws(() => registry.register({
    capability: "bad", entry: "../escape.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: "/trusted", description: "d", validateArguments: () => ({ ok: true }),
    verification: { kind: "none", reason: "fixture adapter carries no verification" },
  }), /relative path without traversal/);
  assert.throws(() => registry.register({
    capability: "bad2", entry: "C:/abs/path.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: "/trusted", description: "d", validateArguments: () => ({ ok: true }),
    verification: { kind: "none", reason: "fixture adapter carries no verification" },
  }), /relative path without traversal/);
  assert.equal(isAbsoluteOrTraversal("/abs"), true);
  assert.equal(isAbsoluteOrTraversal("safe/rel.cjs"), false);
});

test("P13.ADAPT-4 duplicate adapters for one capability fail closed", () => {
  const registry = new WorkloadAdapterRegistry();
  const adapter = {
    capability: "dup", entry: "a.cjs", requiredLevel: "WORKER_PROCESS" as const,
    sourceDirectory: "/trusted", description: "d",
    validateArguments: () => ({ ok: true as const }),
    verification: { kind: "none" as const, reason: "fixture adapter carries no verification" },
  };
  registry.register(adapter);
  assert.throws(() => registry.register(adapter), /Duplicate/);
});

// ---------------------------------------------------------------------------
// Observability: metadata-only events across the supervisor lifecycle.
// ---------------------------------------------------------------------------

test("P13.OBS-1 supervisor emits backend selection and isolation events (metadata-only)", async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const seen: string[] = [];
  fx.events.onAny((event) => { seen.push(event.type); });
  await writeFile(join(fx.root, "ok.cjs"), workloadSource("{ ok: true }"));
  await fx.supervisor.execute({
    missionId: "m-obs", stepIndex: 0, capability: "cap", executionId: "exec-obs",
    requiredLevel: "WORKER_PROCESS",
    profile: { filesystem: { workspaceRoot: fx.root }, network: { mode: "DENY" }, environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 10_000 } },
    workload: { kind: "module", entry: "ok.cjs", args: {} },
  });
  assert.equal(seen.includes("isolation.backend_selected"), true);
  assert.equal(seen.includes("execution.isolation_ready"), true);
});

test("P13.OBS-2 unresolved backend emits isolation.unresolved with a denial reason", async t => {
  const fx = await fixture();
  t.after(fx.cleanup);
  const reasons: string[] = [];
  fx.events.on("isolation.unresolved", (event) => { reasons.push(String((event.payload as { reason?: string }).reason)); });
  await fx.supervisor.execute({
    missionId: "m-obs2", stepIndex: 0, capability: "cap", executionId: "exec-obs2",
    requiredLevel: "CONTAINER_ISOLATED",
    profile: { filesystem: { workspaceRoot: fx.root }, network: { mode: "DENY" }, environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 10_000 } },
    workload: { kind: "module", entry: "x.cjs", args: {} },
  });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0]!, /no registered backend|not currently available/);
});

function minimalFacts() {
  return {
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    exitState: "SUCCEEDED" as const, isolationLevel: "WORKER_PROCESS", backendGuarantees: {},
  };
}
