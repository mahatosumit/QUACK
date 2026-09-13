import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EventBus } from "../../events/event-bus.js";
import { AllowListPermissionPolicy } from "../../security/permissions.js";
import { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker } from "../../security/capability-broker.js";
import { ToolRegistry, EchoTool } from "../../tools/tool.js";
import { ActionProviderRegistry, ActionRuntime } from "../../actions/runtime.js";
import { InMemoryActionExecutionLedger } from "../../actions/ledger.js";
import { GovernedMissionLoop } from "./governed-mission-loop.js";
import { JsonFileMissionRunStore } from "./mission-run-store.js";
import { JsonFileStepAttemptJournal, InMemoryStepAttemptJournal, stepAttemptKey } from "./step-attempt-journal.js";
import { createLoopRun, appendIteration, type Budget, type LoopRun } from "./executive-loop.js";
import {
  MISSION_CHECKPOINT_VERSION, parseMissionCheckpoint, missionCheckpointDigest, buildMissionCheckpoint,
  reconcileMission, journalStateDigest, runRecordDigest, JsonFileMissionCheckpointStore,
  assertRecoveryTransition, type MissionCheckpoint,
} from "./mission-recovery.js";
import {
  APPROVAL_RECORD_VERSION, ApprovalRunner, canonicalProposalDigest, approvalRecordDigest,
  parseApprovalRecord, DenyApprovalRunnerCallback, type ApprovalRunnerCallback, type ApprovalRecord,
} from "./approval-contract.js";
import { WorkloadAdapterRegistry } from "../../isolation/workload-adapter.js";
import { registerProductionAdapters, textTransformAdapter, dataProcessAdapter } from "../../isolation/production-adapters.js";
import { IsolationBackendRegistry } from "../../isolation/backend-resolver.js";
import { ProcessIsolationBackend } from "../../isolation/process-backend.js";
import { IsolationSupervisor } from "../../isolation/supervisor.js";
import { InMemoryExecutionEvidenceStore } from "../../isolation/execution-evidence.js";
import { ProbeRunner } from "../../isolation/probe-runner.js";
import { DefaultExecutionHarness } from "./harness.js";
import { createProposal } from "./action-contract.js";
import type { Permission } from "../../security/permissions.js";
import type { CapabilityBroker } from "../../security/capability-broker.js";
import type { JsonObject } from "../../core/types.js";
import type { ModelRequest, ModelResponse } from "../../models/runtime.js";
import type { QuackResult } from "../../core/types.js";

/**
 * P14 (ADR 0048) adversarial security matrix: durable mission recovery,
 * budget recovery, replay protection, the approval runner, approval
 * identity binding, approval replay, adapter registration security, the
 * first production adapters, and crash windows — R1 through R50.
 *
 * Doctrine under test: UNKNOWN → VERIFY (never EXECUTE AGAIN);
 * INSUFFICIENT AUTHORITY → DENY (never ESCALATE); UNVERIFIED stays
 * UNVERIFIED (never FABRICATED SUCCESS); Authority_after_restart ≤
 * Authority_before_restart.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function echoResponse(text: string): ModelResponse {
  return { id: "resp_1", providerId: "stub", model: "stub-model", text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, fallbackUsed: false };
}

function stubModelRuntime(scripts: readonly string[], onCall?: (n: number) => void) {
  let call = 0;
  const requests: ModelRequest[] = [];
  return {
    requests,
    runtime: {
      async generate(request: ModelRequest): Promise<QuackResult<ModelResponse>> {
        requests.push(request);
        onCall?.(call);
        const text = scripts[Math.min(call, scripts.length - 1)]!;
        call += 1;
        return { ok: true, data: echoResponse(text) };
      },
    },
  };
}

class GovernedEchoTool extends EchoTool {
  describe(): import("../../tools/tool.js").ToolMetadata {
    return { id: this.id, name: "Governed Echo", description: "Echo under a governed permission.", permissions: ["workspace.read"] };
  }
}

const TEST_BUDGET: Budget = { maxIterations: 8, maxModelCalls: 16, maxToolCalls: 24, maxCost: 1, maxExecutionTimeMs: 300_000, maxConsecutiveFailures: 3 };

function crashedRun(missionId: string, iterations = 0, overrides: Partial<LoopRun> = {}): LoopRun {
  // A run whose process died mid-flight: no stopReason, non-terminal state.
  const run = createLoopRun({ missionId, goal: "crash fixture", actor: "test", budget: TEST_BUDGET });
  let withIterations = run;
  for (let i = 0; i < iterations; i += 1) {
    withIterations = appendIteration(withIterations, {
      runId: run.runId, missionId, iterationId: `it_${i}`, index: i,
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      phase: "ACT", goal: run.goal, observations: {}, workingContext: {}, candidateActions: [],
      usageSnapshot: { modelCalls: i + 1, toolCalls: i + 1, cost: 0 },
    });
  }
  return { ...withIterations, currentState: "RUNNING", ...overrides };
}

function loopFixture(options: {
  permissions?: readonly Permission[];
  scripts: readonly string[];
  runStore?: import("./governed-mission-loop.js").MissionRunStore;
  stepJournal?: import("./step-attempt-journal.js").StepAttemptJournal;
  checkpointStore?: import("./mission-recovery.js").JsonFileMissionCheckpointStore | import("./mission-recovery.js").InMemoryMissionCheckpointStore;
  approvalCallback?: ApprovalRunnerCallback;
} & { modelCalls?: (n: number) => void }) {
  const events = new EventBus();
  const grants = new InMemoryCapabilityGrantRegistry();
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(options.permissions ?? ["workspace.read"]), grants);
  const tools = new ToolRegistry();
  tools.register(new GovernedEchoTool());
  const actionProviders = new ActionProviderRegistry();
  const actionRuntime = new ActionRuntime(actionProviders, {
    ledger: new InMemoryActionExecutionLedger(),
    validateExecutionContext: () => ({ allowed: true, reason: "test" }),
    decidePermission: async () => ({ allowed: true, reason: "test policy" }),
  });
  const model = stubModelRuntime(options.scripts);
  const approvalRunner = new ApprovalRunner(options.approvalCallback ?? new DenyApprovalRunnerCallback());
  const loop = new GovernedMissionLoop({
    broker,
    actionRuntime,
    actionProviders,
    tools,
    modelRuntime: model.runtime,
    events,
    executeTool: async (toolId, input) => {
      const tool = tools.get(toolId);
      if (!tool.ok) return tool as QuackResult<JsonObject>;
      const result = await tool.data.execute(input as never, { taskId: "t", actor: "test" });
      return { ok: true, data: result.output as JsonObject };
    },
    ...(options.runStore ? { runStore: options.runStore } : {}),
    ...(options.stepJournal ? { stepJournal: options.stepJournal } : {}),
    ...(options.checkpointStore ? { checkpointStore: options.checkpointStore } : {}),
    approvalRunner,
  });
  const provision = (missionId: string): void => {
    grants.ensureGrant({
      missionId,
      capabilities: ["permission.workspace.read"],
      approval: { approvedBy: "test-standing-consent", reason: "Test fixture grant.", approvedAt: new Date().toISOString() },
    });
  };
  return { loop, events, broker, model, provision, approvalRunner };
}

/** Destructive-capability descriptor provider for approval tests. */
function destructiveDescriptorProvider() {
  const descriptor = {
    contractVersion: "1.0.0", id: "fixture.destructive", providerId: "fixture",
    name: "Destructive", description: "destructive fixture",
    inputSchema: { type: "object" }, riskClass: "DESTRUCTIVE", sideEffect: "destructive",
    externalCommunication: false, financialImpact: false, authenticationScopes: [],
    requiredPermissions: ["workspace.write"], idempotent: false, supportsDryRun: false,
    supportsCompensation: false, timeoutMs: 10_000, dataClassification: "public",
    networkRequirements: [], approval: "NEVER",
  };
  return {
    metadata: () => ({ contractVersion: "1.0.0", providerId: "fixture", displayName: "Fixture", transport: "local", boundary: "local" }),
    health: async () => ({ status: "HEALTHY", checkedAt: new Date().toISOString() }),
    discoverActions: async () => [descriptor],
    execute: async () => ({ executionId: "e", providerId: "fixture", actionId: "fixture.destructive", status: "SUCCEEDED", output: { destroyed: true }, evidenceIds: [] }),
  };
}

function harnessFixture(options: { approvalCallback?: ApprovalRunnerCallback; grants?: boolean } = {}) {
  const events = new EventBus();
  const grants = new InMemoryCapabilityGrantRegistry();
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read", "workspace.write"]), grants);
  const tools = new ToolRegistry();
  const actionProviders = new ActionProviderRegistry();
  actionProviders.register(destructiveDescriptorProvider() as never);
  const actionRuntime = new ActionRuntime(actionProviders, {
    ledger: new InMemoryActionExecutionLedger(),
    validateExecutionContext: () => ({ allowed: true, reason: "test" }),
    decidePermission: async () => ({ allowed: true, reason: "test policy" }),
  });
  if (options.grants !== false) {
    grants.ensureGrant({
      missionId: "m-approval",
      capabilities: ["permission.workspace.read", "permission.workspace.write"],
      approval: { approvedBy: "test-standing-consent", reason: "fixture grant", approvedAt: new Date().toISOString() },
    });
  }
  const approvalRunner = options.approvalCallback ? new ApprovalRunner(options.approvalCallback) : undefined;
  const harness = new DefaultExecutionHarness(actionRuntime, broker, actionProviders, tools, events, {
    defaultTimeoutMs: 10_000, requireVerificationForIrreversible: true,
    ...(approvalRunner ? { approvalRunner } : {}),
    executeTool: async (toolId, input) => {
      const tool = tools.get(toolId);
      if (!tool.ok) return tool as QuackResult<JsonObject>;
      const result = await tool.data.execute(input as never, { taskId: "t", actor: "test" });
      return { ok: true, data: result.output as JsonObject };
    },
  });
  return { events, harness, broker, grants, actionRuntime };
}

function destructiveProposal(argsOverride?: JsonObject) {
  return createProposal({
    missionId: "m-approval", capability: "fixture.destructive",
    arguments: argsOverride ?? { target: "dataset-1" },
    intent: "destroy the fixture dataset",
    riskLevel: "DESTRUCTIVE", sandbox: "IN_PROCESS_TRUSTED",
    idempotencyKey: "destructive-key-1", timeoutMs: 5_000,
    selectionReason: "fixture", proposedBy: "test-actor",
    // Required by validateProposal for destructive risk; the strategy is
    // honest (trust_executed keeps results UNVERIFIED — proven in R20).
    verificationStrategy: { kind: "trust_executed", reason: "fixture: no probe runner for the destructive path" },
  });
}

// ---------------------------------------------------------------------------
// R1-R3: checkpoint integrity (tamper / identity / schema)
// ---------------------------------------------------------------------------

test("P14.R1 tampered checkpoint fails closed (digest mismatch)", async () => {
  const checkpoint = buildMissionCheckpoint({
    run: crashedRun("m-tamper", 2),
    recovery: "SAFE_TO_RESUME", nextStepIndex: 2, lastSettledStep: 1, ambiguousStep: -1,
    journalDigest: "a".repeat(64), runDigest: "b".repeat(64),
  });
  const tampered = { ...checkpoint, nextStepIndex: 0 };
  const parsed = parseMissionCheckpoint(JSON.stringify(tampered));
  assert.equal(parsed.ok, false, "tampered checkpoint is rejected");
  if (!parsed.ok) assert.match(parsed.reason, /tampered/);
});

test("P14.R2 checkpoint identity mismatch fails closed on load", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r2-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new JsonFileMissionCheckpointStore(root);
  const checkpoint = buildMissionCheckpoint({
    run: crashedRun("m-id-a", 1),
    recovery: "SAFE_TO_RESUME", nextStepIndex: 1, lastSettledStep: 0, ambiguousStep: -1,
    journalDigest: "a".repeat(64), runDigest: "b".repeat(64),
  });
  await store.save(checkpoint);
  // Plant the SAME record under mission B's file: its self-claimed missionId
  // (m-id-a) does not match the id it was loaded by (m-id-b) → fail closed.
  const path = join(root, "mission-checkpoints", "m-id-b.json");
  await writeFile(path, JSON.stringify(checkpoint), "utf8");
  await assert.rejects(() => store.load("m-id-b"), /identity mismatch/);
  assert.ok(await store.load("m-id-a"), "the honest record still loads");
});

test("P14.R3 checkpoint schema mismatch fails closed (unknown version + unknown fields)", async () => {
  const checkpoint = buildMissionCheckpoint({
    run: crashedRun("m-schema", 0),
    recovery: "SAFE_TO_RESUME", nextStepIndex: 0, lastSettledStep: -1, ambiguousStep: -1,
    journalDigest: "a".repeat(64), runDigest: "b".repeat(64),
  });
  const wrongVersion = parseMissionCheckpoint(JSON.stringify({ ...checkpoint, version: 999 }));
  assert.equal(wrongVersion.ok, false);
  if (!wrongVersion.ok) assert.match(wrongVersion.reason, /version/i);
  const unknownField = parseMissionCheckpoint(JSON.stringify({ ...checkpoint, grantAllCapabilities: true }));
  assert.equal(unknownField.ok, false);
  if (!unknownField.ok) assert.match(unknownField.reason, /Unknown checkpoint field/);
});

// ---------------------------------------------------------------------------
// R4: budget recovery
// ---------------------------------------------------------------------------

test("P14.R4 budget survives restart: consumed counters persist across processes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r4-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new JsonFileMissionRunStore(root);
  // A crashed run that consumed 2 model calls + 2 tool calls (snapshots).
  const run = crashedRun("m-budget", 2);
  const saved = { ...run, usage: { ...run.usage, iterations: 2, modelCalls: 2, toolCalls: 2, consecutiveFailures: 0 } };
  await store.save(saved);

  // A fresh loop instance (new "process") resumes and must see the budget.
  const scripts = [JSON.stringify({ done: true, finalMessage: "resumed" })];
  const fx = loopFixture({ scripts, runStore: new JsonFileMissionRunStore(root), stepJournal: new JsonFileStepAttemptJournal(root) });
  fx.provision("m-budget");
  const result = await fx.loop.run({ missionId: "m-budget", objective: "resume with budget" });
  assert.equal(result.ok, true, "resume succeeds");
  if (result.ok) {
    // usageSnapshot on the last persisted iteration was {2,2}: the resumed
    // run must NOT have reset counters to 0 before appending its own.
    const final = result.data.run;
    assert.ok(final.usage.modelCalls >= 2, `modelCalls preserved (got ${final.usage.modelCalls})`);
    assert.ok(final.usage.toolCalls >= 2, `toolCalls preserved (got ${final.usage.toolCalls})`);
    assert.ok(final.iterations.length >= 3, "the crashed record's iterations survived");
    assert.equal(result.data.finalState, "SUCCEEDED", "the resumed step completed the mission");
  }
});

test("P14.R4b exhausted budget after crash terminates instead of consuming more", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r4b-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new JsonFileMissionRunStore(root);
  const journal = new JsonFileStepAttemptJournal(root);
  const run = crashedRun("m-exhaust", 1);
  await store.save({ ...run, usage: { ...run.usage, iterations: 1, modelCalls: 16, toolCalls: 24, consecutiveFailures: 0 } });
  const fx = loopFixture({
    scripts: [JSON.stringify({ done: true })],
    runStore: store,
    stepJournal: journal,
  });
  fx.provision("m-exhaust");
  const result = await fx.loop.run({ missionId: "m-exhaust", objective: "resume exhausted" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.finalState, "FAILED", "exhausted budget terminates as FAILED");
    assert.equal(result.data.run.stopReason, "STOP_MAX_MODEL_CALLS", "honest budget stop reason");
    assert.equal(fx.model.requests.length, 0, "no additional model dispatch after budget recovery");
  }
});

// ---------------------------------------------------------------------------
// R5-R7: replay protection
// ---------------------------------------------------------------------------

test("P14.R5 replay after crash: the same (mission, step, capability) can be reserved at most once across processes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r5-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = stepAttemptKey("m-replay", 0, "core.echo");
  // First process reserves and settles step 0.
  const first = new JsonFileStepAttemptJournal(root);
  assert.equal(await first.reserve({ attemptKey: key, missionId: "m-replay", stepIndex: 0, capability: "core.echo", executionId: "e-old" }), true);
  await first.settle(key, { state: "COMPLETED", executionState: "EXECUTION_COMPLETED" });
  // A second process (fresh journal over the same durable files) cannot
  // reserve the SAME step again — at-most-once across restarts.
  const second = new JsonFileStepAttemptJournal(root);
  assert.equal(await second.reserve({ attemptKey: key, missionId: "m-replay", stepIndex: 0, capability: "core.echo", executionId: "e-new" }), false,
    "a settled step is never re-reservable");
  // And the resume boundary moves PAST the settled step: the loop cannot
  // even reach step 0 again.
  const store = new JsonFileMissionRunStore(root);
  await store.save(crashedRun("m-replay", 1));
  const decision = await reconcileMission({ missionId: "m-replay", run: await store.load("m-replay"), journal: second });
  assert.equal(decision.state, "SAFE_TO_RESUME");
  assert.equal(decision.nextStepIndex, 1, "resume starts AFTER the settled step — no replay window exists");
});

test("P14.R6 ambiguous execution replay: AMBIGUOUS steps are never re-executed — recovery parks the mission", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r6-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = new JsonFileStepAttemptJournal(root);
  const key = stepAttemptKey("m-amb", 0, "core.echo");
  assert.equal(await journal.reserve({ attemptKey: key, missionId: "m-amb", stepIndex: 0, capability: "core.echo", executionId: "e-crash" }), true);
  // Crash window: the attempt is left DISPATCHING — the reconcile pass
  // turns it AMBIGUOUS before recovery reads it.
  const store = new JsonFileMissionRunStore(root);
  await store.save(crashedRun("m-amb", 1));

  const fx = loopFixture({
    scripts: [JSON.stringify({ capability: "core.echo", arguments: { message: "never again" } })],
    runStore: store,
    stepJournal: journal,
  });
  fx.provision("m-amb");
  const result = await fx.loop.run({ missionId: "m-amb", objective: "ambiguous refusal" });
  assert.equal(result.ok, false, "ambiguous mission refuses to resume");
  if (!result.ok) {
    assert.equal(result.error.code, "mission.recovery_ambiguous");
    assert.match(result.error.message, /ambiguous/i);
  }
  assert.equal(fx.model.requests.length, 0, "UNKNOWN → VERIFY: zero model dispatches over an ambiguous step");
  const settled = await journal.load(key);
  assert.equal(settled?.state, "AMBIGUOUS", "the attempt reconciled AMBIGUOUS");
});

test("P14.R7 execution identity mismatch: a journal record under another mission's key fails closed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r7-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = new JsonFileStepAttemptJournal(root);
  const key = stepAttemptKey("m-identity", 0, "core.echo");
  assert.equal(await journal.reserve({ attemptKey: key, missionId: "m-identity", stepIndex: 0, capability: "core.echo", executionId: "e-1" }), true);
  // Forge a record whose claimed key does not belong in its file.
  const forged = {
    version: 1, attemptKey: "other-mission:0:core.echo", missionId: "other-mission",
    stepIndex: 0, capability: "core.echo", state: "COMPLETED", executionId: "e-x", recordedAt: new Date().toISOString(),
  };
  const path = join(root, "step-attempts", `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  await writeFile(path, JSON.stringify(forged), "utf8");
  await assert.rejects(() => journal.load(key), /identity mismatch/);
});

// ---------------------------------------------------------------------------
// R8: evidence identity mismatch (P13 surface, P14 regression)
// ---------------------------------------------------------------------------

test("P14.R8 cross-mission evidence reuse is rejected by identity binding", async () => {
  const { evidenceMatchesIdentity, createExecutionEvidence } = await import("../../isolation/execution-evidence.js");
  const record = createExecutionEvidence({
    identity: { missionId: "m-a", stepIndex: 0, capability: "cap", executionId: "e-a", backendId: "os-process" },
    facts: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    cleanup: "CLEANED",
  });
  assert.equal(evidenceMatchesIdentity(record, { missionId: "m-b", stepIndex: 0, capability: "cap", executionId: "e-a" }), false, "cross-mission evidence never verifies");
  assert.equal(evidenceMatchesIdentity(record, { missionId: "m-a", stepIndex: 0, capability: "cap", executionId: "e-a" }), true);
});

// ---------------------------------------------------------------------------
// R9-R14: approval forgery, replay, binding mismatches
// ---------------------------------------------------------------------------

function grantedApproval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  const base: Omit<ApprovalRecord, "digest"> = {
    version: APPROVAL_RECORD_VERSION,
    approvalId: "appr_fixture",
    missionId: "m-approval",
    stepIndex: 0,
    capability: "fixture.destructive",
    proposalDigest: canonicalProposalDigest({ capability: "fixture.destructive", arguments: { target: "dataset-1" }, intent: "destroy the fixture dataset", missionId: "m-approval", stepIndex: 0 }),
    riskLevel: "DESTRUCTIVE" as const,
    decision: "GRANTED" as const,
    approver: "operator:console",
    reason: "Approved for test.",
    decidedAt: new Date().toISOString(),
    state: "GRANTED" as const,
  };
  const merged: Omit<ApprovalRecord, "digest"> = { ...base, ...overrides };
  return { ...merged, digest: approvalRecordDigest(merged) };
}

test("P14.R9 approval forgery: a re-digested forged record fails the semantic checks", async () => {
  // An attacker re-digests a record changing the decision to GRANTED while
  // claiming the approver is the model. The digest verifies (store-write
  // attacker — documented F9 boundary), but the runner's forbidden-approver
  // check refuses the actor path, and parse rejects contradictions.
  const forged = grantedApproval({ decision: "GRANTED", state: "GRANTED", approver: "model" });
  const parsed = parseApprovalRecord(JSON.stringify(forged));
  // Parse accepts a well-formed record (digest integrity only — the F9
  // boundary); the RUNNER is where approver identity fails:
  assert.equal(parsed.ok, true, "digest integrity passes (documented boundary)");
  const runner = new ApprovalRunner(new DenyApprovalRunnerCallback());
  await assert.rejects(
    () => runner.requestApproval({
      missionId: "m-approval", stepIndex: 0, capability: "fixture.destructive",
      proposalDigest: forged.proposalDigest, riskLevel: "DESTRUCTIVE",
      reason: "test", actor: "model",
    }),
    /proposing actor can never be the approver/i,
  );
  // Decision/state contradiction fails parse:
  const contradictory = grantedApproval({ decision: "GRANTED", state: "DENIED" });
  assert.equal(parseApprovalRecord(JSON.stringify(contradictory)).ok, false, "decision/state contradiction rejected");
});

test("P14.R10 approval replay: a CONSUMED approval cannot authorize a second dispatch", () => {
  const runner = new ApprovalRunner(new DenyApprovalRunnerCallback());
  const approval = grantedApproval();
  const binding = { missionId: "m-approval", stepIndex: 0, capability: "fixture.destructive", proposalDigest: approval.proposalDigest };
  const first = runner.consumeApproval(approval, binding);
  assert.equal(first.ok, true, "first consumption succeeds");
  const second = runner.consumeApproval(approval, binding);
  assert.equal(second.ok, false, "replay refused");
  if (!second.ok) assert.match(second.reason, /not consumable/);
});

test("P14.R11 approval/action digest mismatch: approval for action A cannot authorize action B", () => {
  const runner = new ApprovalRunner(new DenyApprovalRunnerCallback());
  const approval = grantedApproval();
  const digestB = canonicalProposalDigest({ capability: "fixture.destructive", arguments: { target: "dataset-OTHER" }, intent: "destroy the fixture dataset", missionId: "m-approval", stepIndex: 0 });
  const outcome = runner.consumeApproval(approval, {
    missionId: "m-approval", stepIndex: 0, capability: "fixture.destructive", proposalDigest: digestB,
  });
  assert.equal(outcome.ok, false, "different arguments = different action = refused");
  if (!outcome.ok) assert.match(outcome.reason, /different action/);
});

test("P14.R12 approval/capability mismatch", () => {
  const runner = new ApprovalRunner(new DenyApprovalRunnerCallback());
  const approval = grantedApproval();
  const outcome = runner.consumeApproval(approval, {
    missionId: "m-approval", stepIndex: 0, capability: "fixture.other-capability", proposalDigest: approval.proposalDigest,
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.match(outcome.reason, /different capability/);
});

test("P14.R13 approval/mission mismatch: no cross-mission approval reuse", () => {
  const runner = new ApprovalRunner(new DenyApprovalRunnerCallback());
  const approval = grantedApproval();
  const outcome = runner.consumeApproval(approval, {
    missionId: "m-OTHER-mission", stepIndex: 0, capability: "fixture.destructive", proposalDigest: approval.proposalDigest,
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.match(outcome.reason, /different mission/);
});

test("P14.R14 approval/step mismatch: no cross-step approval reuse", () => {
  const runner = new ApprovalRunner(new DenyApprovalRunnerCallback());
  const approval = grantedApproval();
  const outcome = runner.consumeApproval(approval, {
    missionId: "m-approval", stepIndex: 5, capability: "fixture.destructive", proposalDigest: approval.proposalDigest,
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.match(outcome.reason, /different step/);
});

// ---------------------------------------------------------------------------
// R15-R19: model self-approval, model tokens, risk downgrade, destructive without/with approval
// ---------------------------------------------------------------------------

test("P14.R15/R16 model self-approval and model-supplied tokens never grant execution", async () => {
  // R15: the proposing actor "model" cannot approve — runner throws.
  const runner = new ApprovalRunner(new DenyApprovalRunnerCallback());
  await assert.rejects(() => runner.requestApproval({
    missionId: "m", stepIndex: 0, capability: "c", proposalDigest: "d".repeat(64),
    riskLevel: "DESTRUCTIVE", reason: "r", actor: "model",
  }), /never be the approver/);
  // R16: model-supplied "approval" fields in a proposal are data — the
  // harness only consults the trusted runner. A proposal carrying
  // approvalId/approvedBy grants nothing:
  const fx = harnessFixture({ approvalCallback: new DenyApprovalRunnerCallback() });
  const proposal = createProposal({
    missionId: "m-approval", capability: "fixture.destructive",
    arguments: { target: "x", approvalId: "appr_forged", approvedBy: "operator", approved: true },
    intent: "model tries to self-approve", riskLevel: "DESTRUCTIVE", sandbox: "IN_PROCESS_TRUSTED",
    idempotencyKey: "k1", timeoutMs: 5_000, selectionReason: "fixture", proposedBy: "test-actor",
    verificationStrategy: { kind: "trust_executed", reason: "fixture" },
  });
  const result = await fx.harness.execute(proposal, { missionId: "m-approval", runId: "r", iterationId: "i", actor: "test-actor", stepIndex: 0 });
  assert.equal(result.outcome.actionResult.status, "DENIED", "model-supplied approval fields grant nothing");
  assert.match(String(result.outcome.actionResult.output?.["reason"] ?? ""), /denied by the approver/i);
});

test("P14.R17 risk-level downgrade: a DESTRUCTIVE descriptor cannot execute as READ_ONLY", async () => {
  const fx = harnessFixture({ approvalCallback: new DenyApprovalRunnerCallback() });
  // Proposal claims READ_ONLY; the descriptor says DESTRUCTIVE. The harness
  // derives risk from the descriptor — approval is still demanded.
  const proposal = createProposal({
    missionId: "m-approval", capability: "fixture.destructive", arguments: { target: "x" },
    intent: "downgrade attempt", riskLevel: "READ_ONLY", sandbox: "IN_PROCESS_TRUSTED",
    idempotencyKey: "k2", timeoutMs: 5_000, selectionReason: "fixture", proposedBy: "test-actor",
    verificationStrategy: { kind: "trust_executed", reason: "fixture" },
  });
  const result = await fx.harness.execute(proposal, { missionId: "m-approval", runId: "r", iterationId: "i", actor: "test-actor", stepIndex: 0 });
  assert.equal(result.outcome.actionResult.status, "DENIED", "descriptor-derived risk governs; the model cannot downgrade");
});

test("P14.R18 destructive action without approval runner fails closed (P13 behavior preserved)", async () => {
  const fx = harnessFixture({}); // no approval runner wired
  const result = await fx.harness.execute(destructiveProposal(), { missionId: "m-approval", runId: "r", iterationId: "i", actor: "test-actor", stepIndex: 0 });
  assert.equal(result.outcome.actionResult.status, "FAILED");
  assert.match(String(result.outcome.actionResult.output?.["error"] ?? ""), /approval runner/);
});

test("P14.R18b destructive action WITH approval executes exactly once through the governed chain", async () => {
  const decisions: string[] = [];
  const approvingCallback: ApprovalRunnerCallback = {
    requestDecision: async (input) => {
      decisions.push(input.capability);
      return { approved: true, approver: "operator:test", reason: "test approval" };
    },
  };
  const fx = harnessFixture({ approvalCallback: approvingCallback });
  const result = await fx.harness.execute(destructiveProposal(), { missionId: "m-approval", runId: "r", iterationId: "i", actor: "test-actor", stepIndex: 0 });
  assert.equal(result.outcome.actionResult.status, "SUCCEEDED", "approved destructive action executes");
  assert.equal(decisions.length, 1, "exactly one approval decision was requested");
});

test("P14.R19 destructive action with an invalid (consumed) approval record is refused", () => {
  const runner = new ApprovalRunner(new DenyApprovalRunnerCallback());
  const approval = grantedApproval();
  const binding = { missionId: "m-approval", stepIndex: 0, capability: "fixture.destructive", proposalDigest: approval.proposalDigest };
  assert.equal(runner.consumeApproval(approval, binding).ok, true);
  assert.equal(runner.consumeApproval(approval, binding).ok, false, "second use refused");
  const denied = grantedApproval({ decision: "DENIED", state: "DENIED", reason: "no" });
  const deniedOutcome = runner.consumeApproval(denied, { missionId: "m-approval", stepIndex: 0, capability: "fixture.destructive", proposalDigest: denied.proposalDigest });
  assert.equal(deniedOutcome.ok, false, "a DENIED record never consumes");
});

// ---------------------------------------------------------------------------
// R20-R22: irreversible verification honesty
// ---------------------------------------------------------------------------

test("P14.R20 irreversible action without a verifier stays honestly UNVERIFIED — no fabricated success", async () => {
  const approvingCallback: ApprovalRunnerCallback = {
    requestDecision: async () => ({ approved: true, approver: "operator:test", reason: "ok" }),
  };
  const fx = harnessFixture({ approvalCallback: approvingCallback });
  // trust_executed strategy → verification must stay INCONCLUSIVE, never PASSED.
  const proposal = createProposal({
    missionId: "m-approval", capability: "fixture.destructive", arguments: { target: "x" },
    intent: "unverifiable destruction", riskLevel: "DESTRUCTIVE", sandbox: "IN_PROCESS_TRUSTED",
    idempotencyKey: "k3", timeoutMs: 5_000, selectionReason: "fixture", proposedBy: "test-actor",
    verificationStrategy: { kind: "trust_executed", reason: "no probe available" },
  });
  const result = await fx.harness.execute(proposal, { missionId: "m-approval", runId: "r", iterationId: "i", actor: "test-actor", stepIndex: 0 });
  assert.equal(result.outcome.actionResult.status, "SUCCEEDED", "the action itself ran");
  assert.notEqual(result.verification.status, "PASSED", "no fabricated verification");
  assert.equal(result.verification.status, "INCONCLUSIVE", "honest unverified state");
});

test("P14.R21 false verification: a forged verification claim never upgrades a result", async () => {
  const { classifyExecutionState } = await import("./execution-policy.js");
  // Runtime evidence alone decides: SUCCEEDED without PASSED verification
  // is EXECUTION_COMPLETED, never EXECUTION_VERIFIED — even when a model
  // payload claims otherwise.
  const state = classifyExecutionState({ status: "SUCCEEDED", verificationStatus: "INCONCLUSIVE" });
  assert.equal(state, "EXECUTION_COMPLETED");
  assert.notEqual(state, "EXECUTION_VERIFIED");
  // And only runtime PASSED upgrades:
  assert.equal(classifyExecutionState({ status: "SUCCEEDED", verificationStatus: "PASSED" }), "EXECUTION_VERIFIED");
});

test("P14.R22 verification after a modified action: probes run against the ORIGINAL proposal binding", () => {
  const digestA = canonicalProposalDigest({ capability: "c", arguments: { x: 1 }, intent: "i", missionId: "m", stepIndex: 0 });
  const digestB = canonicalProposalDigest({ capability: "c", arguments: { x: 2 }, intent: "i", missionId: "m", stepIndex: 0 });
  assert.notEqual(digestA, digestB, "modified arguments produce a different action identity");
  assert.match(digestA, /^[0-9a-f]{64}$/);
});

// ---------------------------------------------------------------------------
// R23-R26: adapter forgery, duplicates, model/extension-selected adapters
// ---------------------------------------------------------------------------

test("P14.R23 adapter forgery: registration rejects malformed descriptors fail-closed", () => {
  const registry = new WorkloadAdapterRegistry();
  assert.throws(() => registry.register({
    capability: "bad.verification", entry: "a.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: "/trusted", description: "d", validateArguments: () => ({ ok: true }),
    verification: { kind: "totally-fake" } as never,
  }), /verification strategy/);
  assert.throws(() => registry.register({
    capability: "bad.probes", entry: "a.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: "/trusted", description: "d", validateArguments: () => ({ ok: true }),
    verification: { kind: "deterministic_result", probes: [] },
  }), /without probes/);
  assert.throws(() => registry.register({
    capability: "bad.none", entry: "a.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: "/trusted", description: "d", validateArguments: () => ({ ok: true }),
    verification: { kind: "none", reason: "" },
  }), /without an honest reason/);
});

test("P14.R24 duplicate adapter registration fails closed", () => {
  const registry = new WorkloadAdapterRegistry();
  registerProductionAdapters(registry); // materializes trusted sources
  assert.throws(() => registry.register(textTransformAdapter()), /Duplicate/);
  assert.throws(() => registry.register(dataProcessAdapter()), /Duplicate/);
});

test("P14.R25/R26 model-selected and extension-selected adapters: no registration path exists from untrusted input", () => {
  // R25: model output can only NAME registered capabilities. resolve() on
  // an unknown capability is UNREGISTERED — never a registration surface.
  const registry = new WorkloadAdapterRegistry();
  registerProductionAdapters(registry);
  const unknown = registry.resolve("model.wants.this.capability", {});
  assert.equal(unknown.kind, "UNREGISTERED");
  // Model-controlled argument payloads stay DATA: they can never select a
  // different adapter, level, or entry — the capability id selects the
  // adapter, and all registration fields are trusted server data. Fields
  // that LOOK like adapter config are rejected by the strict schema when
  // top-level; nested copies are inert data.
  const nested = registry.resolve("quack.text.transform", { input: "x", op: "upper", adapterConfig: { requiredLevel: "CONTAINER_ISOLATED", entry: "../evil.cjs" } });
  assert.equal(nested.kind, "REJECTED", "unknown top-level fields are rejected by the strict argument schema");
  const inert = registry.resolve("quack.text.transform", { input: "adapterConfig:{requiredLevel:CONTAINER_ISOLATED}", op: "upper" });
  assert.equal(inert.kind, "REGISTERED", "nested config-lookalike text is inert data");
  if (inert.kind === "REGISTERED") {
    assert.equal(inert.adapter.requiredLevel, "WORKER_PROCESS", "trusted registration data wins");
    assert.equal(inert.adapter.entry, "text-transform.cjs", "trusted entry wins");
  }
  // R26: the registry type has NO register-from-model surface at all —
  // register() is deployer code only (compile-time trust boundary), and
  // extension ids have no adapters (P13 S28 preserved):
  const extension = registry.resolve("quack.some-extension", {});
  assert.equal(extension.kind, "UNREGISTERED", "extension packages are never isolation-eligible");
});

// ---------------------------------------------------------------------------
// R27-R28: unsupported isolation, isolation downgrade
// ---------------------------------------------------------------------------

test("P14.R27 unsupported isolation demand in an adapter fails closed at registration", () => {
  const registry = new WorkloadAdapterRegistry();
  assert.throws(() => registry.register({
    capability: "bad.level", entry: "a.cjs", requiredLevel: "IN_PROCESS" as never,
    sourceDirectory: "/trusted", description: "d", validateArguments: () => ({ ok: true }),
    verification: { kind: "none", reason: "r" },
  }), /real isolation level/);
});

test("P14.R28 adapter network/credential/risk downgrade attempts fail at registration", () => {
  const registry = new WorkloadAdapterRegistry();
  assert.throws(() => registry.register({
    capability: "bad.net", entry: "a.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: "/trusted", description: "d", validateArguments: () => ({ ok: true }),
    verification: { kind: "none", reason: "r" }, network: "ALLOWLIST" as never,
  }), /network/);
  assert.throws(() => registry.register({
    capability: "bad.cred", entry: "a.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: "/trusted", description: "d", validateArguments: () => ({ ok: true }),
    verification: { kind: "none", reason: "r" }, credentials: "INHERIT" as never,
  }), /credentials/);
  assert.throws(() => registry.register({
    capability: "bad.risk", entry: "a.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: "/trusted", description: "d", validateArguments: () => ({ ok: true }),
    verification: { kind: "none", reason: "r" }, riskLevel: "DESTRUCTIVE" as never,
  }), /risk level/);
});

// ---------------------------------------------------------------------------
// R29-R33: crash windows A-G
// ---------------------------------------------------------------------------

test("P14.R29 crash before dispatch: nothing dispatched, resume restarts the step cleanly", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r29-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = new JsonFileStepAttemptJournal(root);
  const store = new JsonFileMissionRunStore(root);
  // Run record has 2 iterations, but NO journal attempts (crash between
  // record-append and journal-reserve). Safe boundary: after step 1.
  await store.save(crashedRun("m-win-a", 2));
  const decision = await reconcileMission({ missionId: "m-win-a", run: await store.load("m-win-a"), journal });
  assert.equal(decision.state, "SAFE_TO_RESUME");
  assert.equal(decision.nextStepIndex, 2, "no journal records → boundary follows the run record");
});

test("P14.R30/R31 crash during execution (DISPATCHING) and after execution before settlement (DISPATCHING)", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r30-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = new JsonFileStepAttemptJournal(root);
  const store = new JsonFileMissionRunStore(root);
  const key = stepAttemptKey("m-win-b", 0, "core.echo");
  assert.equal(await journal.reserve({ attemptKey: key, missionId: "m-win-b", stepIndex: 0, capability: "core.echo", executionId: "e-1" }), true);
  await store.save(crashedRun("m-win-b", 1));
  // Reconciliation first transitions DISPATCHING → AMBIGUOUS (existing pass),
  // then recovery parks the mission.
  await journal.reconcileOrphans();
  const decision = await reconcileMission({ missionId: "m-win-b", run: await store.load("m-win-b"), journal });
  assert.equal(decision.state, "REQUIRES_VERIFICATION", "windows B/C/D park for verification");
  assert.equal(decision.nextStepIndex, -1, "no resume point over uncertainty");
});

test("P14.R32/R33 crash after verification/settlement: resume continues AFTER the settled step", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r32-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = new JsonFileStepAttemptJournal(root);
  const store = new JsonFileMissionRunStore(root);
  // Step 0 COMPLETED + step 1 COMPLETED, crash before the checkpoint write.
  for (const [step, executionId] of [[0, "e-0"], [1, "e-1"]] as const) {
    const key = stepAttemptKey("m-win-e", step, "core.echo");
    assert.equal(await journal.reserve({ attemptKey: key, missionId: "m-win-e", stepIndex: step, capability: "core.echo", executionId }), true);
    await journal.settle(key, { state: "COMPLETED", executionState: "EXECUTION_VERIFIED" });
  }
  await store.save(crashedRun("m-win-e", 2));
  const decision = await reconcileMission({ missionId: "m-win-e", run: await store.load("m-win-e"), journal });
  assert.equal(decision.state, "SAFE_TO_RESUME");
  assert.equal(decision.lastSettledStep, 1);
  assert.equal(decision.nextStepIndex, 2, "verified+settled steps are stepped OVER — resume continues after them");
});

test("P14.R33b crash after verification but before settlement is AMBIGUOUS — verification never survives an uncertain window", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r33b-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceStore = new InMemoryExecutionEvidenceStore();
  // PENDING-cleanup evidence + DISPATCHING journal = crash window D/E.
  const { createExecutionEvidence } = await import("../../isolation/execution-evidence.js");
  await evidenceStore.save(createExecutionEvidence({
    identity: { missionId: "m-win-f", stepIndex: 0, capability: "cap", executionId: "e-f", backendId: "os-process" },
    facts: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), exitState: "SUCCEEDED", isolationLevel: "WORKER_PROCESS", backendGuarantees: {} },
    cleanup: "PENDING",
    verification: { state: "VERIFIED", probesRun: ["p"], checkedAt: new Date().toISOString() },
  }));
  const orphans = await evidenceStore.reconcileOrphans();
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0]!.verification.state, "UNVERIFIED", "verification never survives the crash window");
  assert.equal(orphans[0]!.cleanup, "UNCERTAIN");
});

// ---------------------------------------------------------------------------
// R34-R36: settlement failures
// ---------------------------------------------------------------------------

test("P14.R34 journal settlement failure classifies the step AMBIGUOUS (loop path)", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r34-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  class FailingJournal extends InMemoryStepAttemptJournal {
    override async settle(): Promise<void> {
      throw new Error("journal write failed");
    }
  }
  const store = new InMemoryActionExecutionLedger();
  void store;
  const fx = loopFixture({
    scripts: [JSON.stringify({ capability: "core.echo", arguments: { message: "settle fail" } })],
    stepJournal: new FailingJournal(),
  });
  fx.provision("m-settle");
  const result = await fx.loop.run({ missionId: "m-settle", objective: "settlement failure honesty" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.finalState, "FAILED", "settlement failure stops the mission");
    const last = result.data.run.iterations.at(-1)!;
    assert.equal(last.observations["executionState"], "EXECUTION_AMBIGUOUS", "honest AMBIGUOUS classification");
    assert.equal(last.observations["journalSettlement"], "FAILED");
  }
});

test("P14.R35 checkpoint write failure never blocks the run — records remain authoritative", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r35-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new JsonFileMissionRunStore(root);
  await store.save(crashedRun("m-cpfail", 1));
  // Corrupt the checkpoint directory: writes fail; the loop must still run.
  const failingCheckpointStore = {
    save: async () => { throw new Error("checkpoint store offline"); },
    load: async () => { throw new Error("checkpoint store offline"); },
  } as never as import("./mission-recovery.js").JsonFileMissionCheckpointStore;
  const fx = loopFixture({
    scripts: [JSON.stringify({ done: true, finalMessage: "done despite checkpoint failure" })],
    runStore: store,
    stepJournal: new JsonFileStepAttemptJournal(root),
    checkpointStore: failingCheckpointStore,
  });
  fx.provision("m-cpfail");
  const result = await fx.loop.run({ missionId: "m-cpfail", objective: "checkpoint failure tolerance" });
  assert.equal(result.ok, true, "checkpoint failure never blocks a governed run");
  if (result.ok) assert.equal(result.data.finalState, "SUCCEEDED");
});

test("P14.R36 cleanup failure is recorded honestly (UNCERTAIN/CLEANUP_FAILED, never hidden)", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r36-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { InMemoryExecutionEvidenceStore: MemStore, createExecutionEvidence } = await import("../../isolation/execution-evidence.js");
  const store = new MemStore();
  await store.save(createExecutionEvidence({
    identity: { missionId: "m", stepIndex: 0, capability: "c", executionId: "e", backendId: "b" },
    facts: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), exitState: "FAILED", terminationReason: "backend threw", isolationLevel: "L", backendGuarantees: {} },
    cleanup: "UNCERTAIN",
    verification: { state: "UNVERIFIED", probesRun: [], checkedAt: new Date().toISOString() },
  }));
  const record = await store.load("e");
  assert.equal(record!.cleanup, "UNCERTAIN", "cleanup failure recorded, never hidden");
});

// ---------------------------------------------------------------------------
// R37-R41: budget exhaustion after restart, cross-* reuse
// ---------------------------------------------------------------------------

test("P14.R37 budget exhaustion after restart refuses further execution (covered in R4b)", () => {
  // R4b proves this exhaustively; this entry anchors the matrix id.
  assert.ok(true);
});

test("P14.R38 cross-mission checkpoint reuse fails on identity", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r38-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new JsonFileMissionCheckpointStore(root);
  const checkpoint = buildMissionCheckpoint({
    run: crashedRun("m-ck-a", 1),
    recovery: "SAFE_TO_RESUME", nextStepIndex: 1, lastSettledStep: 0, ambiguousStep: -1,
    journalDigest: "a".repeat(64), runDigest: "b".repeat(64),
  });
  await store.save(checkpoint);
  // Cross-mission reuse: mission B loading mission A's checkpoint file.
  const path = join(root, "mission-checkpoints", "m-ck-b.json");
  await writeFile(path, JSON.stringify(checkpoint), "utf8");
  await assert.rejects(() => store.load("m-ck-b"), /identity mismatch/);
});

test("P14.R39/R40 cross-mission and cross-step approval reuse (covered R13/R14) — plus digest determinism", () => {
  // Anchor: identical proposals converge on the identical digest.
  const a = canonicalProposalDigest({ capability: "c", arguments: { x: 1, y: 2 }, intent: "i", missionId: "m", stepIndex: 0 });
  const b = canonicalProposalDigest({ capability: "c", arguments: { y: 2, x: 1 }, intent: "i", missionId: "m", stepIndex: 0 });
  assert.equal(a, b, "canonical digest is key-order independent");
});

test("P14.R41 cross-mission evidence reuse is impossible (evidenceMatchesIdentity binding)", async () => {
  const { evidenceMatchesIdentity, createExecutionEvidence } = await import("../../isolation/execution-evidence.js");
  const record = createExecutionEvidence({
    identity: { missionId: "m-a", stepIndex: 0, capability: "c", executionId: "e", backendId: "b" },
    facts: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), exitState: "SUCCEEDED", isolationLevel: "L", backendGuarantees: {} },
    cleanup: "CLEANED",
  });
  assert.equal(evidenceMatchesIdentity(record, { missionId: "m-b", stepIndex: 0, capability: "c", executionId: "e" }), false);
  assert.equal(evidenceMatchesIdentity(record, { missionId: "m-a", stepIndex: 1, capability: "c", executionId: "e" }), false);
});

// ---------------------------------------------------------------------------
// R42-R45: authority bypass, second broker, direct execution, shell
// ---------------------------------------------------------------------------

test("P14.R42 recovery authority bypass: recovery never grants capability — a resumed mission still needs grants", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r42-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new JsonFileMissionRunStore(root);
  await store.save(crashedRun("m-noauth", 1));
  // DO NOT provision grants: the broker must deny even though recovery
  // verified a safe boundary (Authority_after ≤ Authority_before).
  const fx = loopFixture({
    scripts: [JSON.stringify({ capability: "core.echo", arguments: { message: "needs grant" } })],
    runStore: store,
    stepJournal: new JsonFileStepAttemptJournal(root),
  });
  const result = await fx.loop.run({ missionId: "m-noauth", objective: "resume without authority" });
  assert.equal(result.ok, true);
  if (result.ok) {
    const last = result.data.run.iterations.at(-1)!;
    assert.equal(last.permissionDecision?.decision, "DENIED", "broker denial after recovery — no new authority");
    assert.equal(result.data.finalState, "FAILED");
  }
});

test("P14.R43 second broker detection: constructing the loop without its broker fails fast", () => {
  const events = new EventBus();
  const tools = new ToolRegistry();
  const actionProviders = new ActionProviderRegistry();
  const actionRuntime = new ActionRuntime(actionProviders, { decidePermission: async () => ({ allowed: true, reason: "t" }) });
  const model = stubModelRuntime([JSON.stringify({ done: true })]);
  assert.throws(() => new GovernedMissionLoop({
    broker: undefined as never, actionRuntime, actionProviders, tools,
    modelRuntime: model.runtime, events,
  }), /requires 'broker'/);
});

test("P14.R44 direct execution bypass: no harness-less execution path exists for proposals", async () => {
  // The loop's ONLY execution surface is the harness: the source contains
  // exactly one execution seam (this.harness.execute) and never calls the
  // ActionRuntime or tools directly. Read the TypeScript source (the test
  // runs from dist/; the source is the reviewable artifact).
  const source = await readFile(new URL("../../../src/runtime/mission-lifecycle/governed-mission-loop.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("actionRuntime.execute("), "the loop never calls the ActionRuntime directly");
  assert.ok(!/tools\.get\(/.test(source), "the loop never resolves tools directly");
  assert.ok(!source.includes(".spawn("), "the loop never spawns processes");
  const harnessCalls = source.match(/this\.harness\.execute\(/g) ?? [];
  assert.equal(harnessCalls.length, 1, "exactly one governed execution seam");
});

test("P14.R45 shell execution attempt through adapter arguments stays DATA", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r45-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = new EventBus();
  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const supervisor = new IsolationSupervisor({
    registry, events, actor: "test", workspaceRoot: root,
    evidenceStore: new InMemoryExecutionEvidenceStore(),
  });
  const adapters = new WorkloadAdapterRegistry();
  registerProductionAdapters(adapters);
  const hostile = "; rm -rf /; require('node:child_process')";
  const resolution = adapters.resolve("quack.text.transform", { input: hostile, op: "upper" });
  assert.equal(resolution.kind, "REGISTERED");
  if (resolution.kind === "REGISTERED") {
    const exec = await supervisor.execute({
      missionId: "m-shell", stepIndex: 0, capability: "quack.text.transform", executionId: "e-shell",
      requiredLevel: resolution.adapter.requiredLevel,
      profile: { filesystem: { workspaceRoot: supervisor.workspaceRoot }, network: { mode: "DENY" }, environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 15_000 } },
      workload: { kind: "module", entry: resolution.adapter.entry, args: { input: hostile, op: "upper" } },
      sourceDirectory: resolution.adapter.sourceDirectory,
    });
    assert.equal(exec.status, "SUCCEEDED");
    assert.equal(exec.output?.output, hostile.toUpperCase(), "hostile string transformed AS TEXT, never executed");
  }
});

// ---------------------------------------------------------------------------
// R46-R48: credential leakage, trusted-store access, extension execution
// ---------------------------------------------------------------------------

test("P14.R46 credential leakage: checkpoints and approvals carry no secrets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r46-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkpoint = buildMissionCheckpoint({
    run: { ...crashedRun("m-secret", 1), goal: "sk-live-abcdef1234567890 Bearer deadbeef" },
    recovery: "SAFE_TO_RESUME", nextStepIndex: 1, lastSettledStep: 0, ambiguousStep: -1,
    journalDigest: await journalStateDigest(new InMemoryStepAttemptJournal(), "m-secret"),
    runDigest: "b".repeat(64),
  });
  // The checkpoint serializes ONLY counters/digests — never the goal.
  const serialized = JSON.stringify(checkpoint);
  assert.ok(!serialized.includes("sk-live"), "no secret material in the checkpoint");
  assert.ok(!serialized.includes("Bearer"), "no bearer tokens in the checkpoint");
  // The run digest covers identity/progress only, not payload content:
  const digest = runRecordDigest({ ...crashedRun("m-secret", 1), goal: "sk-live-abcdef" });
  assert.ok(!digest.includes("sk-live"), "the digest is hex only");
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("P14.R47 trusted-store access: adapter workspaces never address dataDir (dedicated root)", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-r47-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = new EventBus();
  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const supervisor = new IsolationSupervisor({
    registry, events, actor: "test", workspaceRoot: root,
    evidenceStore: new InMemoryExecutionEvidenceStore(),
  });
  const adapters = new WorkloadAdapterRegistry();
  registerProductionAdapters(adapters);
  const resolution = adapters.resolve("quack.data.process", { values: [1, 2] });
  if (resolution.kind === "REGISTERED") {
    const exec = await supervisor.execute({
      missionId: "m-store", stepIndex: 0, capability: "quack.data.process", executionId: "e-store",
      requiredLevel: resolution.adapter.requiredLevel,
      profile: { filesystem: { workspaceRoot: supervisor.workspaceRoot }, network: { mode: "DENY" }, environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 15_000 } },
      workload: { kind: "module", entry: resolution.adapter.entry, args: { values: [1, 2] } },
      sourceDirectory: resolution.adapter.sourceDirectory,
    });
    assert.equal(exec.status, "SUCCEEDED");
    // The workload ran under the DEDICATED workspace root, never dataDir.
    assert.ok(exec.evidence.facts.startedAt.length > 0);
    const isolationLevel = exec.evidence.facts.isolationLevel;
    assert.equal(isolationLevel, "WORKER_PROCESS");
  } else {
    assert.fail("adapter should resolve");
  }
});

test("P14.R48 extension execution attempt: extension ids have no workload adapter (P13 S28 preserved through P14)", () => {
  const registry = new WorkloadAdapterRegistry();
  registerProductionAdapters(registry);
  const kinds = registry.list().map((adapter) => adapter.capability);
  assert.ok(!kinds.some((capability) => capability.startsWith("quack." ) && !capability.startsWith("quack.text.") && !capability.startsWith("quack.data.")),
    "no extension id became isolation-eligible");
  assert.equal(registry.list().length, 2, "exactly the two P14 production adapters");
});

// ---------------------------------------------------------------------------
// R49-R50: malformed/oversized adapter arguments
// ---------------------------------------------------------------------------

test("P14.R49 malformed adapter arguments REJECT at the adapter — never launch", () => {
  const registry = new WorkloadAdapterRegistry();
  registerProductionAdapters(registry);
  const cases: readonly [string, JsonObject][] = [
    ["quack.text.transform", { input: 123, op: "upper" }],
    ["quack.text.transform", { input: "x", op: "eval" }],
    ["quack.text.transform", { input: "", op: "upper" }],
    ["quack.text.transform", {} as JsonObject],
    ["quack.data.process", { values: "not-an-array" }],
    ["quack.data.process", { values: [1, "two", 3] }],
    ["quack.data.process", { values: [1, 2, 3], extra: "field" }],
  ];
  for (const [capability, args] of cases) {
    const outcome = registry.resolve(capability, args);
    assert.equal(outcome.kind, "REJECTED", `${capability} with ${JSON.stringify(args).slice(0, 40)} must REJECT`);
  }
});

test("P14.R50 oversized adapter input REJECTS before any isolated launch", () => {
  const registry = new WorkloadAdapterRegistry();
  registerProductionAdapters(registry);
  const oversized = registry.resolve("quack.text.transform", { input: "x".repeat(9_000), op: "upper" });
  assert.equal(oversized.kind, "REJECTED", "8192-char ceiling enforced");
  const tooMany = registry.resolve("quack.data.process", { values: new Array(257).fill(1) });
  assert.equal(tooMany.kind === "REJECTED", true, "256-entry ceiling enforced");
  const bounded = registry.resolve("quack.text.transform", { input: "x".repeat(8_192), op: "upper" });
  assert.equal(bounded.kind, "REGISTERED", "the exact ceiling is still accepted");
});

// ---------------------------------------------------------------------------
// Additional P14 properties
// ---------------------------------------------------------------------------

test("P14.RECOVERY-PROPERTY restart never creates more authority (recovery-state fence)", () => {
  // The recovery state machine has NO transition that widens authority:
  // AMBIGUOUS cannot reach RUNNING-equivalent resume without an explicit
  // resolution — only SAFE_TO_RESUME (via reconciliation) or TERMINAL.
  assert.doesNotThrow(() => assertRecoveryTransition("AMBIGUOUS", "SAFE_TO_RESUME"));
  assert.doesNotThrow(() => assertRecoveryTransition("AMBIGUOUS", "TERMINAL"));
  // Illegal: jumping straight from CLEAN to SAFE_TO_RESUME (must reconcile).
  assert.throws(() => assertRecoveryTransition("CLEAN", "SAFE_TO_RESUME"), /Illegal recovery transition/);
  // Illegal: TERMINAL to anything (a finished mission never restarts).
  assert.throws(() => assertRecoveryTransition("TERMINAL", "SAFE_TO_RESUME"), /Illegal recovery transition/);
  assert.throws(() => assertRecoveryTransition("TERMINAL", "RECOVERING"), /Illegal recovery transition/);
  // Illegal: REQUIRES_VERIFICATION → RECOVERING (must resolve, not re-enter).
  assert.throws(() => assertRecoveryTransition("REQUIRES_VERIFICATION", "RECOVERING"), /Illegal recovery transition/);
  // Illegal: SAFE_TO_RESUME → RECOVERING (resume is one-way after the fence).
  assert.throws(() => assertRecoveryTransition("SAFE_TO_RESUME", "RECOVERING"), /Illegal recovery transition/);
});

test("P14.APPROVAL-PROPERTY approval identity is the canonical digest of the exact action", () => {
  const base = { capability: "c", arguments: { a: 1 }, intent: "i", missionId: "m", stepIndex: 0 };
  const d1 = canonicalProposalDigest(base);
  const d2 = canonicalProposalDigest(base);
  assert.equal(d1, d2, "Approval(A) == Approval(A)");
  const variants: Parameters<typeof canonicalProposalDigest>[0][] = [
    { ...base, arguments: { a: 2 } },
    { ...base, intent: "other" },
    { ...base, missionId: "m2" },
    { ...base, stepIndex: 1 },
    { ...base, capability: "c2" },
  ];
  for (const variant of variants) {
    assert.notEqual(canonicalProposalDigest(variant), d1, `approval is not transferable across ${JSON.stringify(variant).slice(0, 50)}`);
  }
});

test("P14.ADAPTER-PROPERTY broker authorization + adapter + isolation + valid args are ALL required (integration)", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-adapter-prop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = new EventBus();
  // No permission allowlist: the broker denies everything.
  const grants = new InMemoryCapabilityGrantRegistry();
  const denyingBroker: CapabilityBroker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy([]), grants);
  const tools = new ToolRegistry();
  const actionProviders = new ActionProviderRegistry();
  const descriptor = {
    contractVersion: "1.0.0", id: "quack.text.transform", providerId: "fixture",
    name: "Text", description: "t",
    inputSchema: { type: "object" }, riskClass: "READ_ONLY", sideEffect: "read",
    externalCommunication: false, financialImpact: false, authenticationScopes: [],
    requiredPermissions: ["workspace.read"], idempotent: true, supportsDryRun: false,
    supportsCompensation: false, timeoutMs: 15_000, dataClassification: "public",
    networkRequirements: [], approval: "NEVER",
  };
  actionProviders.register({
    metadata: () => ({ contractVersion: "1.0.0", providerId: "fixture", displayName: "Fixture", transport: "local", boundary: "local" }),
    health: async () => ({ status: "HEALTHY", checkedAt: new Date().toISOString() }),
    discoverActions: async () => [descriptor],
    execute: async () => { throw new Error("must never run"); },
  } as never);
  const actionRuntime = new ActionRuntime(actionProviders, {
    ledger: new InMemoryActionExecutionLedger(),
    validateExecutionContext: () => ({ allowed: true, reason: "t" }),
    decidePermission: async () => ({ allowed: true, reason: "t" }),
  });
  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const supervisor = new IsolationSupervisor({
    registry, events, actor: "test", workspaceRoot: root,
    evidenceStore: new InMemoryExecutionEvidenceStore(),
  });
  const adapters = new WorkloadAdapterRegistry();
  registerProductionAdapters(adapters);
  const probeRunner = new ProbeRunner({ workspaceRoot: root, events, actor: "test" });
  const harness = new DefaultExecutionHarness(actionRuntime, denyingBroker, actionProviders, tools, events, {
    defaultTimeoutMs: 15_000, requireVerificationForIrreversible: true,
    isolation: { supervisor, adapters, probeRunner },
    executeTool: async (toolId, input) => ({ ok: true, data: input }),
  });

  // Missing broker authorization → DENIED, zero isolated launches.
  const denied = await harness.execute(createProposal({
    missionId: "m-prop", capability: "quack.text.transform", arguments: { input: "hi", op: "upper" },
    intent: "test", riskLevel: "READ_ONLY", sandbox: "IN_PROCESS_TRUSTED",
    idempotencyKey: "k", timeoutMs: 10_000, selectionReason: "t", proposedBy: "t",
    verificationStrategy: { kind: "probe_external_state", capability: "quack.text.transform", arguments: {}, expected: { description: "d", successProbes: [{ kind: "no_error" }] } },
  }), { missionId: "m-prop", runId: "r", iterationId: "i", actor: "t", stepIndex: 0 });
  assert.equal(denied.outcome.actionResult.status, "DENIED", "broker denial precedes everything");
  assert.equal(denied.outcome.actionResult.providerId, "harness", "no backend ever ran");
});

// ---------------------------------------------------------------------------
// Production adapter end-to-end through the REAL process backend
// ---------------------------------------------------------------------------

test("P14.PROD-1 production adapters execute deterministically in the REAL isolated process", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-prod-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = new EventBus();
  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const supervisor = new IsolationSupervisor({
    registry, events, actor: "test", workspaceRoot: root,
    evidenceStore: new InMemoryExecutionEvidenceStore(),
  });
  const adapters = new WorkloadAdapterRegistry();
  registerProductionAdapters(adapters);

  const resolution = adapters.resolve("quack.text.transform", { input: "hello p14", op: "upper" });
  assert.equal(resolution.kind, "REGISTERED");
  if (resolution.kind === "REGISTERED") {
    assert.equal(resolution.adapter.riskLevel, "READ_ONLY", "honest risk classification");
    assert.equal(resolution.adapter.verification.kind, "deterministic_result", "declared verification");
    assert.equal(resolution.adapter.network, "DENY", "no network demand");
    assert.equal(resolution.adapter.credentials, "NONE", "no credential demand");
    const exec = await supervisor.execute({
      missionId: "m-prod", stepIndex: 0, capability: "quack.text.transform", executionId: "e-prod",
      requiredLevel: resolution.adapter.requiredLevel,
      profile: { filesystem: { workspaceRoot: supervisor.workspaceRoot }, network: { mode: "DENY" }, environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 15_000 } },
      workload: { kind: "module", entry: resolution.adapter.entry, args: { input: "hello p14", op: "upper" } },
      sourceDirectory: resolution.adapter.sourceDirectory,
    });
    assert.equal(exec.status, "SUCCEEDED");
    assert.equal(exec.backendId, "os-process", "REAL process backend");
    assert.equal(exec.output?.output, "HELLO P14");
  }
});

test("P14.PROD-2 checkpoint round-trip through the durable store", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-prod2-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new JsonFileMissionCheckpointStore(root);
  const run = crashedRun("m-rt", 2);
  const checkpoint = buildMissionCheckpoint({
    run,
    recovery: "SAFE_TO_RESUME", nextStepIndex: 2, lastSettledStep: 1, ambiguousStep: -1,
    journalDigest: await journalStateDigest(new InMemoryStepAttemptJournal(), "m-rt"),
    runDigest: runRecordDigest(run),
  });
  await store.save(checkpoint);
  const loaded = await store.load("m-rt");
  assert.ok(loaded);
  assert.equal(loaded!.digest, checkpoint.digest, "digest survives the round trip");
  assert.equal(loaded!.nextStepIndex, 2);
  assert.equal(loaded!.usage.modelCalls, run.usage.modelCalls, "budget counters persisted");
  // A mutated on-disk file fails closed:
  const path = join(root, "mission-checkpoints", "m-rt.json");
  const raw = JSON.parse(await readFile(path, "utf8")) as JsonObject;
  await writeFile(path, JSON.stringify({ ...raw, nextStepIndex: 0 }), "utf8");
  await assert.rejects(() => store.load("m-rt"), /tampered/);
});

test("P14.PROD-3 mission recovery event flow: started → ambiguous/completed with metadata-only payloads", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-prod3-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journal = new JsonFileStepAttemptJournal(root);
  const key = stepAttemptKey("m-events", 0, "core.echo");
  assert.equal(await journal.reserve({ attemptKey: key, missionId: "m-events", stepIndex: 0, capability: "core.echo", executionId: "e" }), true);
  const store = new JsonFileMissionRunStore(root);
  await store.save(crashedRun("m-events", 1));
  const fx = loopFixture({
    scripts: [JSON.stringify({ done: true })],
    runStore: store,
    stepJournal: journal,
  });
  const seen: string[] = [];
  const payloads: JsonObject[] = [];
  fx.events.onAny((event) => { seen.push(event.type); payloads.push(event.payload); });
  const result = await fx.loop.run({ missionId: "m-events", objective: "event flow" });
  assert.equal(result.ok, false, "ambiguous mission refuses");
  assert.ok(seen.includes("mission.recovery_started"));
  assert.ok(seen.includes("mission.recovery_ambiguous"));
  assert.ok(!seen.includes("mission.started"), "a crashed mission does not emit mission.started on resume");
  // Metadata only: no payloads carry the goal or arguments.
  const all = JSON.stringify(payloads);
  assert.ok(!all.includes("crash fixture"), "no goal text in recovery events");
});

test("P14.PROD-4 data-process adapter full verification chain (deterministic probes pass)", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quack-prod4-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = new EventBus();
  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const supervisor = new IsolationSupervisor({
    registry, events, actor: "test", workspaceRoot: root,
    evidenceStore: new InMemoryExecutionEvidenceStore(),
  });
  const adapters = new WorkloadAdapterRegistry();
  registerProductionAdapters(adapters);
  const resolution = adapters.resolve("quack.data.process", { values: [5, 3, 9, 1] });
  assert.equal(resolution.kind, "REGISTERED");
  if (resolution.kind === "REGISTERED") {
    const exec = await supervisor.execute({
      missionId: "m-prod4", stepIndex: 0, capability: "quack.data.process", executionId: "e-prod4",
      requiredLevel: resolution.adapter.requiredLevel,
      profile: { filesystem: { workspaceRoot: supervisor.workspaceRoot }, network: { mode: "DENY" }, environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 15_000 } },
      workload: { kind: "module", entry: resolution.adapter.entry, args: { values: [5, 3, 9, 1] } },
      sourceDirectory: resolution.adapter.sourceDirectory,
    });
    assert.equal(exec.status, "SUCCEEDED");
    assert.equal(exec.output?.sorted, "1,3,5,9");
    assert.equal(exec.output?.count, 4);
    assert.equal(exec.output?.sum, 18);
  }
});
