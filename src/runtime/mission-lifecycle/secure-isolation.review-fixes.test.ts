import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { EventBus } from "../../events/event-bus.js";
import { AllowListPermissionPolicy } from "../../security/permissions.js";
import { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker } from "../../security/capability-broker.js";
import { ToolRegistry, EchoTool } from "../../tools/tool.js";
import { ActionProviderRegistry, ActionRuntime } from "../../actions/runtime.js";
import { InMemoryActionExecutionLedger } from "../../actions/ledger.js";
import { DefaultExecutionHarness } from "./harness.js";
import { createProposal, type ActionProposal } from "./action-contract.js";
import { IsolationBackendRegistry } from "../../isolation/backend-resolver.js";
import { ProcessIsolationBackend } from "../../isolation/process-backend.js";
import { IsolationSupervisor } from "../../isolation/supervisor.js";
import { ProbeRunner } from "../../isolation/probe-runner.js";
import { WorkloadAdapterRegistry } from "../../isolation/workload-adapter.js";
import { createExecutionEvidence, InMemoryExecutionEvidenceStore, type ExecutionEvidenceRecord } from "../../isolation/execution-evidence.js";
import type { IsolationRequest, IsolationResult } from "../../isolation/contract.js";
import { InMemoryStepAttemptJournal } from "./step-attempt-journal.js";
import { GovernedMissionLoop } from "./governed-mission-loop.js";
import type { ModelRequest, ModelResponse } from "../../models/runtime.js";
import type { QuackResult, JsonObject } from "../../core/types.js";

/**
 * P13 security-review FIX tests (findings 10, 5, 6, 9 + the six required
 * adversarial behavior cases). Every test proves BEHAVIOR — denials,
 * verdicts, journal states, evidence identity — never source shape.
 */

function stubModelRuntime(scripts: readonly string[]): { runtime: { generate(request: ModelRequest, context: { missionId?: string; actor: string }): Promise<QuackResult<ModelResponse>> } } {
  let call = 0;
  return {
    runtime: {
      async generate(): Promise<QuackResult<ModelResponse>> {
        const text = scripts[Math.min(call, scripts.length - 1)]!;
        call += 1;
        return { ok: true, data: { id: "resp", providerId: "stub", model: "stub-model", text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, fallbackUsed: false } };
      },
    },
  };
}

const actJson = (capability: string): string => JSON.stringify({
  capability, arguments: {}, intent: "fixture",
});

// ---------------------------------------------------------------------------
// Fixture: full harness chain with host-dispatch counting.
// ---------------------------------------------------------------------------

interface Fixture {
  readonly harness: DefaultExecutionHarness;
  readonly events: EventBus;
  readonly adapters: WorkloadAdapterRegistry;
  readonly store: FailingEvidenceStore;
  readonly root: string;
  readonly sourceDir: string;
  readonly hostDispatches: { count: number };
  readonly provision: (missionId: string) => void;
  readonly cleanup: () => Promise<void>;
}

/** Evidence store that can be told to fail settlement saves (finding 10). */
class FailingEvidenceStore extends InMemoryExecutionEvidenceStore {
  public failSaves = false;
  public saveCount = 0;
  override async save(record: ExecutionEvidenceRecord): Promise<void> {
    if (this.failSaves) throw new Error("fixture: evidence store is down");
    this.saveCount += 1;
    return super.save(record);
  }
}

async function reviewFixture(): Promise<Fixture> {
  const events = new EventBus();
  const grants = new InMemoryCapabilityGrantRegistry();
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]), grants);
  const tools = new ToolRegistry();
  const hostDispatches = { count: 0 };
  class CountingEcho extends EchoTool {
    override async execute(input: never, context: never) {
      hostDispatches.count += 1;
      return super.execute(input, context);
    }
  }
  tools.register(new CountingEcho());
  const actionProviders = new ActionProviderRegistry();
  actionProviders.register({
    metadata: () => ({ contractVersion: "1.0.0", providerId: "fixture", displayName: "F", transport: "local", boundary: "local" }),
    health: async () => ({ status: "HEALTHY", checkedAt: new Date().toISOString() }),
    discoverActions: async () => [{
      contractVersion: "1.0.0", id: "fixture.task", providerId: "fixture", name: "T", description: "d",
      inputSchema: { type: "object" }, riskClass: "READ_ONLY", sideEffect: "read", externalCommunication: false,
      financialImpact: false, authenticationScopes: [], requiredPermissions: ["workspace.read"], idempotent: true,
      supportsDryRun: false, supportsCompensation: false, timeoutMs: 10_000, dataClassification: "public",
      networkRequirements: [], approval: "NEVER",
    }],
    execute: async () => { hostDispatches.count += 1; throw new Error("host path must not run adapter-backed capabilities"); },
  } as never);
  const actionRuntime = new ActionRuntime(actionProviders, {
    ledger: new InMemoryActionExecutionLedger(),
    validateExecutionContext: () => ({ allowed: true, reason: "t" }),
    decidePermission: async () => ({ allowed: true, reason: "t" }),
  });

  const root = await mkdtemp(join(tmpdir(), "quack-rev-"));
  const sourceDir = join(root, "trusted");
  await mkdir(sourceDir, { recursive: true });
  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const store = new FailingEvidenceStore();
  const supervisor = new IsolationSupervisor({ registry, events, actor: "t", workspaceRoot: root, evidenceStore: store });
  const adapters = new WorkloadAdapterRegistry();
  adapters.register({
    capability: "fixture.task",
    entry: "task.cjs",
    requiredLevel: "WORKER_PROCESS",
    sourceDirectory: sourceDir,
    description: "review fixture workload",
    validateArguments: (args) => typeof args["n"] === "number" ? { ok: true } : { ok: false, reason: "n must be a number" },
    verification: { kind: "deterministic_result", probes: [{ path: "doubled", kind: "number" }] },
  });
  await writeFile(join(sourceDir, "task.cjs"), "exports.run = async (io) => ({ doubled: Number(io.args.n ?? 0) * 2 });");
  const probeRunner = new ProbeRunner({ workspaceRoot: root, events, actor: "t" });

  const harness = new DefaultExecutionHarness(actionRuntime, broker, actionProviders, tools, events, {
    defaultTimeoutMs: 10_000, requireVerificationForIrreversible: true,
    executeTool: async () => { hostDispatches.count += 1; return { ok: true, data: {} }; },
    isolation: { supervisor, adapters, probeRunner, evidenceStore: store },
  });

  return {
    harness, events, adapters, store, root, sourceDir, hostDispatches,
    provision: (missionId) => grants.ensureGrant({
      missionId, capabilities: ["permission.workspace.read"],
      approval: { approvedBy: "t", reason: "t", approvedAt: new Date().toISOString() },
    }),
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}

const proposal = (args: JsonObject, verificationStrategy?: ActionProposal["verificationStrategy"]): ActionProposal =>
  createProposal({
    missionId: "m-rev", capability: "fixture.task", arguments: args, intent: "i", riskLevel: "READ_ONLY",
    sandbox: "IN_PROCESS_TRUSTED", idempotencyKey: "rev-key", timeoutMs: 10_000,
    ...(verificationStrategy ? { verificationStrategy } : {}),
    selectionReason: "t", proposedBy: "t",
  });

const ctx = (stepIndex?: number) => ({ missionId: "m-rev", runId: "r", iterationId: "it", actor: "t", ...(stepIndex !== undefined ? { stepIndex } : {}) });

// ---------------------------------------------------------------------------
// Required adversarial case 1: REGISTERED adapter + working host + invalid args → DENIED, zero host dispatch.
// ---------------------------------------------------------------------------

test("P13.FIX1 REGISTERED adapter + invalid arguments → DENIED with ZERO host dispatch", async t => {
  const fx = await reviewFixture();
  t.after(fx.cleanup);
  fx.provision("m-rev");

  const result = await fx.harness.execute(proposal({ n: "not-a-number" }), ctx(4));

  assert.equal(result.outcome.actionResult.status, "DENIED", "adapter REJECTED arguments → harness DENIES (never host path)");
  assert.equal(fx.hostDispatches.count, 0, "no host dispatch of any kind occurred");
  assert.match(String(result.outcome.actionResult.output?.["reason"] ?? ""), /fails closed/i);
});

// ---------------------------------------------------------------------------
// Required adversarial case 2: required PROCESS_ISOLATED policy + no adapter → DENIED.
// ---------------------------------------------------------------------------

test("P13.FIX2 required isolation policy + NO registered adapter → DENIED (never in-process host)", async t => {
  const fx = await reviewFixture();
  t.after(fx.cleanup);
  fx.provision("m-rev");

  // Harness whose config demands WORKER_PROCESS isolation with an EMPTY
  // adapter registry: the capability is discoverable + authorized, but
  // nothing can provide the demanded isolation.
  const events = new EventBus();
  const grants = new InMemoryCapabilityGrantRegistry();
  grants.ensureGrant({ missionId: "m-rev", capabilities: ["permission.workspace.read"], approval: { approvedBy: "t", reason: "t", approvedAt: new Date().toISOString() } });
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]), grants);
  const tools = new ToolRegistry();
  tools.register(new EchoTool());
  const actionProviders = new ActionProviderRegistry();
  actionProviders.register({
    metadata: () => ({ contractVersion: "1.0.0", providerId: "fixture", displayName: "F", transport: "local", boundary: "local" }),
    health: async () => ({ status: "HEALTHY", checkedAt: new Date().toISOString() }),
    discoverActions: async () => [{
      contractVersion: "1.0.0", id: "fixture.task", providerId: "fixture", name: "T", description: "d",
      inputSchema: { type: "object" }, riskClass: "READ_ONLY", sideEffect: "read", externalCommunication: false,
      financialImpact: false, authenticationScopes: [], requiredPermissions: ["workspace.read"], idempotent: true,
      supportsDryRun: false, supportsCompensation: false, timeoutMs: 10_000, dataClassification: "public",
      networkRequirements: [], approval: "NEVER",
    }],
    execute: async () => { throw new Error("host path must not execute a policy-isolated capability"); },
  } as never);
  const actionRuntime = new ActionRuntime(actionProviders, {
    decidePermission: async () => ({ allowed: true, reason: "t" }),
  });
  const harness = new DefaultExecutionHarness(actionRuntime, broker, actionProviders, tools, events, {
    defaultTimeoutMs: 10_000, requireVerificationForIrreversible: true,
    executeTool: async () => { throw new Error("host tool path must not execute a policy-isolated capability"); },
    requiredIsolation: "WORKER_PROCESS",
    isolation: {
      supervisor: new IsolationSupervisor({
        registry: (() => { const r = new IsolationBackendRegistry(); r.register(new ProcessIsolationBackend()); return r; })(),
        events, actor: "t", workspaceRoot: fx.root, evidenceStore: new InMemoryExecutionEvidenceStore(),
      }),
      adapters: new WorkloadAdapterRegistry(), // EMPTY: no adapter for fixture.task
    },
  });

  const result = await harness.execute(proposal({ n: 1 }), ctx(0));

  assert.equal(result.outcome.actionResult.status, "DENIED", "required isolation without adapter denies — never silently uses the host implementation");
  assert.match(String(result.outcome.actionResult.output?.["reason"] ?? ""), /no registered workload adapter|fails closed/i);
  assert.equal(fx.hostDispatches.count, 0);
});

// ---------------------------------------------------------------------------
// Required adversarial case 3: resolver rejects BEST_EFFORT process backend for required isolation.
// ---------------------------------------------------------------------------

test("P13.FIX3 resolver rejects a BEST_EFFORT-process backend for a real isolation requirement", async () => {
  const { IsolationBackendRegistry: Registry } = await import("../../isolation/backend-resolver.js");
  const { effectiveGuarantees } = await import("../../isolation/contract.js");
  const registry = new Registry();
  registry.register({
    id: "best-effort-proc",
    supportedLevels: ["WORKER_PROCESS"],
    guarantees: {
      filesystem: "BEST_EFFORT" as const, network: "UNSUPPORTED" as const, process: "BEST_EFFORT" as const,
      environment: "ENFORCED" as const, resources: "BEST_EFFORT" as const, secrets: "UNSUPPORTED" as const,
    },
    availability: async () => ({ available: true, reason: "fixture" }),
    execute: async () => { throw new Error("must never execute"); },
  } as never);
  const resolution = await registry.resolve("WORKER_PROCESS", {
    level: "WORKER_PROCESS",
    filesystem: { workspaceRoot: process.cwd() },
    network: { mode: "DENY" },
    environment: { variables: {}, secrets: [] },
    limits: { wallClockMs: 5_000 },
  });
  assert.equal(resolution.kind, "UNRESOLVED", "BEST_EFFORT process backend cannot host a real isolation requirement (finding 11 kept)");
  void effectiveGuarantees;
});

// ---------------------------------------------------------------------------
// Required adversarial case 4: symlink entry → DENIED (materialization boundary).
// ---------------------------------------------------------------------------

test("P13.FIX4 symlink entry is DENIED at materialization — never copied into the isolated workspace", async t => {
  const events = new EventBus();
  const root = await mkdtemp(join(tmpdir(), "quack-fix4-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  // Trusted source dir holds the real module; the ADAPTER entry is a symlink to it.
  const sourceDir = join(root, "trusted");
  const outsideDir = join(root, "outside");
  await mkdir(sourceDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(join(outsideDir, "evil.cjs"), "exports.run = async () => ({ pwned: true });");
  await symlink(join(outsideDir, "evil.cjs"), join(sourceDir, "linked.cjs"));

  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const supervisor = new IsolationSupervisor({
    registry, events, actor: "t", workspaceRoot: root, evidenceStore: new InMemoryExecutionEvidenceStore(),
  });
  const result = await supervisor.execute({
    missionId: "m-fix4", stepIndex: 2, capability: "fixture.task", executionId: "exec-fix4",
    requiredLevel: "WORKER_PROCESS",
    profile: { filesystem: { workspaceRoot: root }, network: { mode: "DENY" }, environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 10_000 } },
    workload: { kind: "module", entry: "linked.cjs", args: {} },
    sourceDirectory: sourceDir,
  });
  assert.equal(result.status, "DENIED", "symlinked entry never crosses into the isolated workspace");
  assert.match(String(result.error), /symlink/i);
});

// ---------------------------------------------------------------------------
// Required adversarial cases 5+6 (finding 10): evidence stepIndex alignment,
// mismatch rejected, settlement failure downgrades verdict.
// ---------------------------------------------------------------------------

test("P13.FIX5 evidence stepIndex aligns with the runtime mission step (no constant, no model value)", async t => {
  const fx = await reviewFixture();
  t.after(fx.cleanup);
  fx.provision("m-rev");

  const result = await fx.harness.execute(proposal({ n: 21 }), ctx(7)); // step 7, not 0

  assert.equal(result.outcome.actionResult.status, "SUCCEEDED");
  assert.equal(result.outcome.actionResult.providerId, "isolation:os-process");
  const evidence = await fx.store.load(result.outcome.executionId);
  assert.ok(evidence, "evidence recorded");
  assert.equal(evidence!.identity.stepIndex, 7, "evidence carries the RUNTIME stepIndex (7), never a constant");
});

test("P13.FIX6 mismatched stepIndex evidence is rejected at settlement (fail closed)", async t => {
  const fx = await reviewFixture();
  t.after(fx.cleanup);
  fx.provision("m-rev");

  const result = await fx.harness.execute(proposal({ n: 1 }), ctx(3));
  assert.equal(result.outcome.actionResult.status, "SUCCEEDED");
  const evidence = await fx.store.load(result.outcome.executionId);
  assert.ok(evidence);
  assert.equal(evidence!.identity.stepIndex, 3);

  // Settlement claiming a DIFFERENT step index must refuse.
  await assert.rejects(
    () => new IsolationSupervisor({
      registry: new IsolationBackendRegistry(), events: new EventBus(), actor: "t", workspaceRoot: fx.root,
      evidenceStore: fx.store,
    }).settleVerification({
      missionId: "m-rev", stepIndex: 99, capability: "fixture.task", executionId: result.outcome.executionId,
      verification: { state: "VERIFIED", probesRun: ["no_error"], checkedAt: new Date().toISOString() },
    }),
    /identity mismatch/,
  );
});

test("P13.FIX7 settlement failure downgrades the reported verdict — never PASSED/VERIFIED", async t => {
  const fx = await reviewFixture();
  t.after(fx.cleanup);
  fx.provision("m-rev");
  fx.store.failSaves = true; // durable settlement will fail AFTER probes pass

  const result = await fx.harness.execute(
    proposal({ n: 2 }, {
      kind: "probe_external_state", capability: "fixture.task", arguments: { n: 2 },
      expected: { description: "d", successProbes: [{ kind: "output_field", path: "doubled", equals: 4 }] },
    }),
    ctx(1),
  );

  assert.equal(result.outcome.actionResult.status, "SUCCEEDED", "the workload itself succeeded");
  assert.notEqual(result.verification.status, "PASSED", "verification NEVER reports PASSED when settlement failed");
  assert.notEqual(result.verification.status, "FAILED", "probes genuinely passed — the downgrade is INCONCLUSIVE, not FAILED");
  assert.equal(result.verification.status, "INCONCLUSIVE");
  assert.match(String(result.verification.message ?? ""), /settlement failed|cannot confirm/i);
});

test("P13.FIX8 no false VERIFIED evidence after a journal/store failure", async t => {
  const fx = await reviewFixture();
  t.after(fx.cleanup);
  fx.provision("m-rev");
  fx.store.failSaves = true;

  const result = await fx.harness.execute(
    proposal({ n: 5 }, {
      kind: "probe_external_state", capability: "fixture.task", arguments: { n: 5 },
      expected: { description: "d", successProbes: [{ kind: "output_field", path: "doubled", equals: 10 }] },
    }),
    ctx(2),
  );
  // The store was failing the WHOLE time — even the execution-phase saves
  // failed, so no durable evidence exists claiming anything.
  assert.equal(result.verification.status, "INCONCLUSIVE");
  const evidence = await fx.store.load(result.outcome.executionId);
  assert.equal(evidence, undefined, "no durable evidence record exists to falsely claim VERIFIED");
});

// ---------------------------------------------------------------------------
// Finding 10 (loop level): journal settlement failure → AMBIGUOUS, not COMPLETED.
// ---------------------------------------------------------------------------

test("P13.FIX9 governed loop: journal-settlement failure classifies the step AMBIGUOUS and stops the mission", async t => {
  class FailingJournal extends InMemoryStepAttemptJournal {
    public failSettles = false;
    override async settle(attemptKey: string, settlement: { readonly state: "COMPLETED" | "FAILED" | "AMBIGUOUS"; readonly executionState?: string }): Promise<void> {
      if (this.failSettles) throw new Error("fixture: journal is down");
      return super.settle(attemptKey, settlement);
    }
  }
  const journal = new FailingJournal();
  const events = new EventBus();
  const grants = new InMemoryCapabilityGrantRegistry();
  grants.ensureGrant({ missionId: "m-fix9", capabilities: ["permission.workspace.read"], approval: { approvedBy: "t", reason: "t", approvedAt: new Date().toISOString() } });
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]), grants);
  const tools = new ToolRegistry();
  class LoopEchoTool extends EchoTool {
    override describe(): import("../../tools/tool.js").ToolMetadata {
      return { id: this.id, name: "Governed Echo", description: "Echo under a governed permission.", permissions: ["workspace.read"] };
    }
  }
  tools.register(new LoopEchoTool());
  const actionProviders = new ActionProviderRegistry();
  const actionRuntime = new ActionRuntime(actionProviders, { decidePermission: async () => ({ allowed: true, reason: "t" }) });

  const stub = stubModelRuntime([actJson("core.echo")]);
  const loop = new GovernedMissionLoop({
    broker, actionRuntime, actionProviders, tools, modelRuntime: stub.runtime, events,
    executeTool: async (toolId, input) => {
      const tool = tools.get(toolId);
      if (!tool.ok) return tool as QuackResult<JsonObject>;
      const result = await tool.data.execute(input as never, { taskId: "t", actor: "t" });
      return { ok: true, data: result.output as JsonObject };
    },
    stepJournal: journal, maxRetriesPerStep: 0,
  });

  journal.failSettles = true;
  const result = await loop.run({ missionId: "m-fix9", objective: "objective" });
  assert.equal(result.ok, true);
  if (result.ok) {
    const lastStep = result.data.run.iterations.at(-1);
    assert.ok(lastStep);
    assert.equal(lastStep!.observations["executionState"], "EXECUTION_AMBIGUOUS", "journal failure downgrades the recorded state to AMBIGUOUS");
    assert.equal(lastStep!.observations["journalSettlement"], "FAILED", "settlement failure is surfaced, never swallowed");
    assert.equal(lastStep!.stopReason, "STOP_UNRECOVERABLE_ERROR", "the mission fails closed instead of proceeding on an unconfirmable journal");
    assert.notEqual(lastStep!.observations["executionState"], "EXECUTION_COMPLETED");
    assert.notEqual(lastStep!.observations["executionState"], "EXECUTION_VERIFIED");
  }
});

// ---------------------------------------------------------------------------
// Finding 6: symlink/junction/realpath adversarial probes.
// ---------------------------------------------------------------------------

test("P13.FIX10 fs-effect probe rejects a symlink that resolves outside the workspace", async t => {
  const root = await mkdtemp(join(tmpdir(), "quack-fix10-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const outside = join(root, "..", "quack-fix10-outside-target");
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "secret.txt"), "outside");
  try {
    await symlink(join(outside, "secret.txt"), join(root, "leak.txt"));
    const runner = new ProbeRunner({ workspaceRoot: root });
    const leaked = await runner.verifyFilesystemEffect("leak.txt", { exists: true });
    assert.equal(leaked.passed, false, "symlink escape rejected — lexically inside, resolved outside");
    assert.match(String(leaked.reason), /outside|symlink/i);
  } finally {
    await rm(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined);
  }
});

test("P13.FIX11 fs-effect probe rejects a nested symlink (directory component) escape", async t => {
  const root = await mkdtemp(join(tmpdir(), "quack-fix11-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const outside = join(root, "..", "quack-fix11-outside-dir");
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "x.txt"), "outside");
  try {
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub", "real.txt"), "inside");
    // Nested: sub -> symlinked directory pointing outside
    await symlink(outside, join(root, "linkeddir"));
    const runner = new ProbeRunner({ workspaceRoot: root });
    const nested = await runner.verifyFilesystemEffect("linkeddir/x.txt", { exists: true });
    assert.equal(nested.passed, false, "nested symlink directory escape rejected");
    const legit = await runner.verifyFilesystemEffect("sub/real.txt", { exists: true });
    assert.equal(legit.passed, true, "real nested paths still pass");
  } finally {
    await rm(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined);
  }
});

test("P13.FIX12 fs-effect probe: a realpath outside the workspace fails even when the lexical string is inside", async t => {
  const root = await mkdtemp(join(tmpdir(), "quack-fix12-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  // Windows junction-style: symlink the workspace ROOT itself pointing to a
  // sibling directory and probe through it.
  const sibling = join(root, "..", `quack-fix12-sib-${Date.now()}`);
  await mkdir(sibling, { recursive: true });
  await writeFile(join(sibling, "f.txt"), "x");
  try {
    await symlink(sibling, join(root, "mirror"), "dir");
    const runner = new ProbeRunner({ workspaceRoot: root });
    const result = await runner.verifyFilesystemEffect("mirror/f.txt", { exists: true });
    assert.equal(result.passed, false, "realpath containment catches the mirror escape");
  } finally {
    await rm(sibling, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined);
  }
});

test("P13.FIX13 fs-effect probe keeps rejecting lexical traversal and honors absence", async t => {
  const root = await mkdtemp(join(tmpdir(), "quack-fix13-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  await writeFile(join(root, "present.txt"), "x");
  const runner = new ProbeRunner({ workspaceRoot: root });
  assert.equal((await runner.verifyFilesystemEffect("../../etc/passwd", { exists: true })).passed, false, "traversal still rejected");
  assert.equal((await runner.verifyFilesystemEffect("missing.txt", { exists: false })).passed, true, "declared-absent missing path passes");
  assert.equal((await runner.verifyFilesystemEffect("missing.txt", { exists: true })).passed, false, "declared-present missing path fails");
  assert.equal((await runner.verifyFilesystemEffect("C:/windows/system32", { exists: true })).passed, false, "absolute Windows path rejected");
});

// ---------------------------------------------------------------------------
// Finding 5: trusted-store separation of the isolated workspace root.
// ---------------------------------------------------------------------------

test("P13.FIX14 isolated workspaces never contain trusted stores (dedicated root, separate lifecycle)", async () => {
  // The production composition constructs the supervisor workspace root via
  // createIsolatedWorkspaceRoot() — dedicated, under os.tmpdir, NOT dataDir.
  // Here we prove the BEHAVIOR contract of the supervisor against a
  // dataDir-shaped root: trusted store paths are never materialized into
  // the isolated workspace, and the isolated dir lifecycle is separate.
  const events = new EventBus();
  const dataDir = await mkdtemp(join(tmpdir(), "quack-fix14-data-"));
  const isolatedRoot = await mkdtemp(join(tmpdir(), "quack-fix14-iso-"));
  try {
    // Trusted stores living under dataDir:
    await mkdir(join(dataDir, "security"), { recursive: true });
    await mkdir(join(dataDir, "step-attempts"), { recursive: true });
    await mkdir(join(dataDir, "execution-evidence"), { recursive: true });
    await writeFile(join(dataDir, "security", "capability-grants.json"), "{}");

    const sourceDir = join(dataDir, "trusted-modules"); // deployer-controlled source is fine under dataDir
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "task.cjs"), "exports.run = async () => ({ ok: true });");

    const registry = new IsolationBackendRegistry();
    registry.register(new ProcessIsolationBackend());
    const supervisor = new IsolationSupervisor({
      registry, events, actor: "t", workspaceRoot: isolatedRoot,
      evidenceStore: new InMemoryExecutionEvidenceStore(),
    });

    const result = await supervisor.execute({
      missionId: "m-fix14", stepIndex: 0, capability: "fixture.task", executionId: "exec-fix14",
      requiredLevel: "WORKER_PROCESS",
      profile: { filesystem: { workspaceRoot: isolatedRoot }, network: { mode: "DENY" }, environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 10_000 } },
      workload: { kind: "module", entry: "task.cjs", args: {} },
      sourceDirectory: sourceDir,
    });
    assert.equal(result.status, "SUCCEEDED");

    // Isolated per-execution dirs live under the DEDICATED root; after
    // terminal cleanup none of them carries trusted store files.
    const isolatedLeftovers = (await readdir(isolatedRoot)).filter((name) => name.startsWith("quack-isolated-"));
    for (const leftover of isolatedLeftovers) {
      const listing = await readdir(join(isolatedRoot, leftover));
      for (const file of listing) {
        assert.notEqual(file, "capability-grants.json", "trusted grant store never appears in an isolated workspace");
        assert.notEqual(file, "quack.sqlite", "trusted database never appears in an isolated workspace");
      }
    }
    // Trusted stores still intact under dataDir:
    assert.equal(existsSync(join(dataDir, "security", "capability-grants.json")), true, "trusted stores untouched");
    // And no isolated-workspace dir was ever created inside dataDir:
    const dataEntries = await readdir(dataDir);
    assert.equal(dataEntries.some((name) => name.startsWith("quack-isolated-")), false,
      "isolated workspaces are never created beside trusted stores");
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(isolatedRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("P13.FIX15 supervisor never exposes trusted dataDir paths to isolated execution (workspace root only)", async t => {
  // Caller-managed mode: the profile workspace root IS the governed
  // workspace. The supervisor passes ONLY that root to the backend; the
  // trusted dataDir never appears in the request the backend receives.
  const root = await mkdtemp(join(tmpdir(), "quack-fix15-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  await writeFile(join(root, "task.cjs"), "exports.run = async (io) => ({ root: io.workspaceRoot });");

  let observedProfileRoot: string | undefined;
  class RecordingBackend extends ProcessIsolationBackend {
    declare readonly id: "os-process";
    override async execute(request: IsolationRequest): Promise<IsolationResult> {
      observedProfileRoot = request.profile.filesystem.workspaceRoot;
      return super.execute(request);
    }
  }
  const registry = new IsolationBackendRegistry();
  const backend = new RecordingBackend();
  registry.register(backend);
  const supervisor = new IsolationSupervisor({
    registry, events: new EventBus(), actor: "t", workspaceRoot: root,
    evidenceStore: new InMemoryExecutionEvidenceStore(),
  });
  const result = await supervisor.execute({
    missionId: "m-fix15", stepIndex: 0, capability: "fixture.task", executionId: "exec-fix15",
    requiredLevel: "WORKER_PROCESS",
    profile: { filesystem: { workspaceRoot: root }, network: { mode: "DENY" }, environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 10_000 } },
    workload: { kind: "module", entry: "task.cjs", args: {} },
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(observedProfileRoot, resolve(root), "the backend saw ONLY the governed workspace root");
  assert.notEqual(observedProfileRoot, process.cwd(), "trusted host paths never cross as workspace identity");
});

// ---------------------------------------------------------------------------
// Finding 9: documented SHA-256 trust boundary — behavior consequences.
// ---------------------------------------------------------------------------

test("P13.FIX16 evidence SHA-256 boundary: a store-write attacker can forge a parseable record, but it can never settle ANOTHER execution (identity binding is the wall)", async () => {
  const record = createExecutionEvidence({
    identity: { missionId: "m", stepIndex: 1, capability: "cap", executionId: "e-1", backendId: "os-process" },
    facts: { startedAt: "t1", completedAt: "t2", exitState: "FAILED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    cleanup: "CLEANED",
  });
  // Attack: WITH store write access, flip the outcome and re-digest
  // correctly (the documented SHA-256 boundary: this is NOT an
  // authentication mechanism).
  const { createHash } = await import("node:crypto");
  const { serializeExecutionEvidence } = await import("../../isolation/execution-evidence.js");
  const base = JSON.parse(JSON.stringify(record)) as unknown as Record<string, unknown>;
  delete base["digest"];
  const withSucceeded = { ...base, facts: { ...(base.facts as Record<string, unknown>), exitState: "SUCCEEDED" } };
  const correctlyDigested = { ...withSucceeded, digest: createHash("sha256").update(serializeExecutionEvidence(withSucceeded as never)).digest("hex") };
  const { parseExecutionEvidence } = await import("../../isolation/execution-evidence.js");
  const parsed = parseExecutionEvidence(JSON.stringify(correctlyDigested));
  // Documented honesty: a correctly re-digested forgery parses — SHA-256 is
  // content identity, not authenticity.
  assert.equal(parsed.ok, true, "documented boundary: a store-write attacker CAN forge a parseable record");

  // The actual wall: the forged record can never satisfy a DIFFERENT
  // execution's verification settlement — identity binding refuses it.
  const store = new InMemoryExecutionEvidenceStore();
  if (parsed.ok) await store.save(parsed.record);
  const supervisor = new IsolationSupervisor({
    registry: new IsolationBackendRegistry(), events: new EventBus(), actor: "t", workspaceRoot: process.cwd(),
    evidenceStore: store,
  });
  await assert.rejects(
    () => supervisor.settleVerification({
      missionId: "DIFFERENT", stepIndex: 1, capability: "cap", executionId: "e-1",
      verification: { state: "VERIFIED", probesRun: [], checkedAt: new Date().toISOString() },
    }),
    /identity mismatch/,
    "the forged record cannot verify a different execution — identity binding is the authentication boundary",
  );
});
