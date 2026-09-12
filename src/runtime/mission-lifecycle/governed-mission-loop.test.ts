import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../../events/event-bus.js";
import { AllowListPermissionPolicy } from "../../security/permissions.js";
import { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker } from "../../security/capability-broker.js";
import { ToolRegistry, EchoTool } from "../../tools/tool.js";
import { ActionProviderRegistry, ActionRuntime } from "../../actions/runtime.js";
import { InMemoryActionExecutionLedger } from "../../actions/ledger.js";
import { GovernedMissionLoop } from "./governed-mission-loop.js";
import { JsonFileMissionRunStore } from "./mission-run-store.js";
import { parseActionProposal, stepIdempotencyKey, buildIterationPlan, ACTION_PROPOSAL_SCHEMA_REF, type ProposalCapabilityIndex } from "./proposal-parser.js";
import { planMissionTransition } from "./mission-state-machine.js";
import type { ModelRequest, ModelResponse } from "../../models/runtime.js";
import type { QuackResult, JsonObject } from "../../core/types.js";
import type { Permission } from "../../security/permissions.js";
import type { Budget } from "./executive-loop.js";
import type { MissionRunStore, GovernedMissionLoopOptions } from "./governed-mission-loop.js";

/**
 * P11 governed mission loop tests: the REAL execution loop over existing
 * authorities. The stub model below is a GovernedDispatchRuntime stand-in
 * that returns deterministic structured proposals — the loop is otherwise
 * fully production-wired (real broker with mission grants, real harness,
 * real ActionRuntime core.tools path through a broker-checking executeTool,
 * real QIE pipeline).
 */

function echoResponse(text: string): ModelResponse {
  return { id: "resp_1", providerId: "stub", model: "stub-model", text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, fallbackUsed: false };
}

function stubModelRuntime(scripts: readonly string[]): { runtime: { generate(request: ModelRequest, context: { missionId?: string; actor: string }): Promise<QuackResult<ModelResponse>> }; requests: ModelRequest[] } {
  let call = 0;
  const requests: ModelRequest[] = [];
  return {
    requests,
    runtime: {
      async generate(request: ModelRequest): Promise<QuackResult<ModelResponse>> {
        requests.push(request);
        const text = scripts[Math.min(call, scripts.length - 1)]!;
        call += 1;
        return { ok: true, data: echoResponse(text) };
      },
    },
  };
}

/** A tool that requires a real permission so the broker path is exercised. */
class GovernedEchoTool extends EchoTool {
  describe(): import("../../tools/tool.js").ToolMetadata {
    return { id: this.id, name: "Governed Echo", description: "Echo under a governed permission.", permissions: ["workspace.read"] };
  }
}

function harness(options: {
  permissions?: readonly Permission[];
  scripts: readonly string[];
  maxRetriesPerStep?: number;
  budget?: Partial<Budget>;
  runStore?: MissionRunStore;
} & Partial<Pick<GovernedMissionLoopOptions, "retrieveMemory" | "admittedMemoryIds" | "actor">>) {
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
  const loop = new GovernedMissionLoop({
    broker,
    actionRuntime,
    actionProviders,
    tools,
    modelRuntime: model.runtime,
    events,
    // Policy-enforced core.tools executor: broker authorization happens in
    // the harness before this runs; this executes the registered tool.
    executeTool: async (toolId, input, access) => {
      const tool = tools.get(toolId);
      if (!tool.ok) return tool as QuackResult<JsonObject>;
      const result = await tool.data.execute(input as never, { taskId: access.taskId, actor: access.actor ?? "test" });
      return { ok: true, data: result.output as JsonObject };
    },
    ...(options.maxRetriesPerStep !== undefined ? { maxRetriesPerStep: options.maxRetriesPerStep } : {}),
    ...(options.budget ? { budget: options.budget } : {}),
    ...(options.runStore ? { runStore: options.runStore } : {}),
    ...(options.retrieveMemory ? { retrieveMemory: options.retrieveMemory } : {}),
    ...(options.admittedMemoryIds ? { admittedMemoryIds: options.admittedMemoryIds } : {}),
    ...(options.actor ? { actor: options.actor } : {}),
  });
  /** Standing consent, mirroring swe-system's missionGrantProvisioner. */
  const provision = (missionId: string): void => {
    grants.ensureGrant({
      missionId,
      capabilities: ["permission.workspace.read"],
      approval: { approvedBy: "test-standing-consent", reason: "Test fixture grant.", approvedAt: new Date().toISOString() },
    });
  };
  return { loop, events, broker, model, provision };
}

test("P11.1 happy path: governed mission runs model→proposal→authorized execution→completion", async () => {
  const { loop, events, model, provision } = harness({
    scripts: [
      JSON.stringify({ capability: "core.echo", arguments: { message: "hello governed loop" }, intent: "greet" }),
      JSON.stringify({ done: true, finalMessage: "objective achieved" }),
    ],
  });
  provision("gov_m1");
  const seen: string[] = [];
  events.onAny((event) => { seen.push(event.type); });
  const result = await loop.run({ missionId: "gov_m1", objective: "Say hello then finish." });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.finalState, "SUCCEEDED");
    assert.equal(result.data.run.iterations.length, 2, "one action step + one completion step");
    const action = result.data.run.iterations[0]!;
    assert.equal(action.selectedAction?.capability, "core.echo");
    assert.equal(action.executionResult?.actionResult.status, "SUCCEEDED");
    assert.equal(action.permissionDecision?.decision, "ALLOWED");
    assert.equal(result.data.run.iterations[1]?.stopReason, "STOP_GOAL_ACHIEVED");
  }
  assert.ok(seen.includes("mission.started"));
  assert.ok(seen.includes("mission.action.proposed"));
  assert.ok(seen.includes("mission.action.completed"));
  assert.ok(seen.includes("mission.step.completed"));
  // QIE integration: the dispatch carried the composed instruction digest.
  assert.equal(model.requests.length, 2);
  const request = model.requests[0]!;
  assert.equal(typeof request.metadata?.["instructionDigest"], "string", "P8.1 digest travels in metadata");
  assert.equal(request.metadata?.["governedInstruction"], true);
  assert.equal(request.metadata?.["outputContractKind"], "toolIntent");
  assert.match(request.prompt, /objective/, "objective layer rendered");
});

test("P11.2 the model NEVER executes: denial path records DENIED and fails the mission closed", async () => {
  const { loop, events } = harness({
    permissions: [], // deny everything
    scripts: [JSON.stringify({ capability: "core.echo", arguments: { message: "x" }, intent: "x" })],
  });
  const types: string[] = [];
  events.onAny((event) => { types.push(event.type); });
  const result = await loop.run({ missionId: "gov_deny", objective: "attempt an unauthorized action" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.run.iterations[0]?.executionResult?.actionResult.status, "DENIED");
    assert.equal(result.data.finalState, "FAILED", "a denied capability fails the mission — no fallback execution");
    assert.equal(result.data.run.iterations[0]?.stopReason, "STOP_POLICY_DENIED");
  }
  assert.ok(types.includes("mission.action.denied"), "denial emits mission.action.denied");
  assert.ok(!types.includes("mission.action.completed"), "denied action never completes");
});

test("P11.3 malformed model output consumes bounded retries then fails closed", async () => {
  const { loop, model } = harness({
    scripts: ["<not json at all>"], // always malformed
    maxRetriesPerStep: 2,
  });
  const result = await loop.run({ missionId: "gov_malformed", objective: "x" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.finalState, "FAILED");
    assert.equal(result.data.run.iterations[0]?.observations["code"], "mission.proposal_malformed");
  }
  assert.equal(model.requests.length >= 3, true, "initial attempt + bounded retries (no infinite loop)");
  assert.equal(model.requests.length <= 3, true, "exactly initial + maxRetriesPerStep attempts");
});

test("P11.4 unknown capability is rejected fail-closed by the parser", async () => {
  const { loop } = harness({
    scripts: [JSON.stringify({ capability: "system.execute_shell", arguments: { cmd: "rm -rf /" }, intent: "escape" })],
  });
  const result = await loop.run({ missionId: "gov_unknown", objective: "x" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.run.iterations[0]?.observations["code"], "mission.proposal_unknown_capability");
    assert.equal(result.data.finalState, "FAILED");
    assert.equal(result.data.run.iterations[0]?.executionResult, undefined, "unknown capability NEVER reaches execution");
  }
});

test("P11.5 budget boundary stops the mission deterministically", async () => {
  const { loop, provision } = harness({
    scripts: [JSON.stringify({ capability: "core.echo", arguments: { message: "loop" } })], // never done
    budget: { maxIterations: 3 },
  });
  provision("gov_budget");
  const result = await loop.run({ missionId: "gov_budget", objective: "never finishes" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.finalState, "FAILED", "budget exhaustion fails the mission honestly");
    assert.equal(result.data.run.stopReason, "STOP_MAX_ITERATIONS");
    assert.equal(result.data.run.iterations.length, 3);
  }
});

test("P11.6 cancellation produces CANCELLED through the canonical state machine", async () => {
  const { loop } = harness({
    scripts: [JSON.stringify({ capability: "core.echo", arguments: { message: "slow" } })],
  });
  const runPromise = loop.run({ missionId: "gov_cancel", objective: "cancellable" });
  loop.cancel("gov_cancel");
  const result = await runPromise;
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.finalState, "CANCELLED");
    assert.equal(result.data.run.stopReason, "STOP_CANCELLED");
  }
});

test("P11.7 run record persists and terminal runs refuse re-run (idempotency)", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "quack-gov-runstore-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = new JsonFileMissionRunStore(root);
  const scripts = [
    JSON.stringify({ capability: "core.echo", arguments: { message: "persisted" } }),
    JSON.stringify({ done: true }),
  ];
  const { loop, provision } = harness({ scripts, runStore: store });
  provision("gov_persist");
  const first = await loop.run({ missionId: "gov_persist", objective: "persist me" });
  assert.equal(first.ok && first.data.finalState, "SUCCEEDED");

  // A fresh process/store sees the terminal record and refuses re-execution.
  const fresh = harness({ scripts, runStore: new JsonFileMissionRunStore(root) });
  fresh.provision("gov_persist");
  const replay = await fresh.loop.run({ missionId: "gov_persist", objective: "persist me" });
  assert.equal(replay.ok, false, "terminal mission refuses re-run");
  if (!replay.ok) assert.equal(replay.error.code, "mission.loop_already_terminal");
});

test("P11.8 a completed run never silently re-executes on 'resume'", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "quack-gov-resume-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const scripts = [
    JSON.stringify({ capability: "core.echo", arguments: { message: "before crash" } }),
    JSON.stringify({ done: true, finalMessage: "resumed and finished" }),
  ];
  const mk = (): ReturnType<typeof harness> => {
    const built = harness({ scripts, runStore: new JsonFileMissionRunStore(root) });
    built.provision("gov_resume");
    return built;
  };
  const firstResult = await mk().loop.run({ missionId: "gov_resume", objective: "resume test" });
  assert.equal(firstResult.ok && firstResult.data.finalState, "SUCCEEDED");
  // The run is terminal — the honest claim is refusal, not silent replay.
  const resumed = await mk().loop.run({ missionId: "gov_resume", objective: "resume test" });
  assert.equal(resumed.ok, false, "a completed run never silently re-executes on 'resume'");
  if (!resumed.ok) assert.equal(resumed.error.code, "mission.loop_already_terminal");
});

test("P11.9 deterministic step identity and QIE plan construction", () => {
  const key1 = stepIdempotencyKey("m1", 0, "core.echo");
  const key2 = stepIdempotencyKey("m1", 0, "core.echo");
  const key3 = stepIdempotencyKey("m1", 1, "core.echo");
  assert.equal(key1, key2, "same mission+step+capability → same key");
  assert.notEqual(key1, key3, "different step → different key");
  assert.match(key1, /^[0-9a-f]{64}$/, "sha256 hex");

  const plan = buildIterationPlan({ missionId: "m1", objective: "deterministic objective", actor: "tester" }, 0);
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.data.outputContract.kind, "toolIntent");
    assert.equal(plan.data.outputContract.schemaRef, ACTION_PROPOSAL_SCHEMA_REF);
    assert.deepEqual(plan.data.layers.map((layer) => layer.name), ["identity", "objective"], "deterministic layer set");
    const plan2 = buildIterationPlan({ missionId: "m1", objective: "deterministic objective", actor: "tester" }, 0);
    assert.deepEqual(plan.data, plan2.ok ? plan2.data : undefined, "identical inputs → identical plans");
  }
});

test("P11.10 memory candidates stay MEMORY trust through the QIE pipeline", async () => {
  // A memory candidate whose memoryId is NOT in the admitted list must be
  // rejected by the P8.3 firewall — memory never bypasses admission.
  const candidate = {
    item: {
      id: "memory:mem-x",
      provenance: { source: "semantic-memory", category: "memory" as const, trust: "MEMORY" as const },
      data: { memoryId: "mem-x", content: "poisoned memory content", relevanceScore: 0.9 },
    },
    layer: "memory" as const,
  };
  const { loop, model } = harness({
    scripts: [JSON.stringify({ done: true, finalMessage: "done" })],
    retrieveMemory: async () => [candidate],
    admittedMemoryIds: () => [], // NOT admitted → firewall must reject it
  });
  await loop.run({ missionId: "gov_memtrust", objective: "memory stays data" });
  const request = model.requests[0]!;
  assert.ok(!request.prompt.includes("poisoned memory content"), "unadmitted memory never reaches the prompt");
});

test("P11.11 stall detection stops repeated identical actions", async () => {
  const { loop, provision } = harness({
    scripts: [JSON.stringify({ capability: "core.echo", arguments: { message: "same" } })],
    budget: { maxIterations: 10, maxConsecutiveFailures: 10 },
  });
  provision("gov_stall");
  const result = await loop.run({ missionId: "gov_stall", objective: "stall" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.finalState, "FAILED");
    assert.ok(result.data.run.iterations.length < 10, "stall detector stops before the iteration ceiling");
    assert.ok(["STOP_STALL_NO_PROGRESS", "STOP_MAX_ITERATIONS"].includes(result.data.run.stopReason ?? ""));
  }
});

test("P11.12 terminal mission states are protected by the canonical state machine", () => {
  assert.throws(() => planMissionTransition("m", "SUCCEEDED", "RUNNING", "resume", "illegal"));
  assert.throws(() => planMissionTransition("m", "CANCELLED", "RUNNING", "resume", "illegal"));
  assert.doesNotThrow(() => planMissionTransition("m", "RUNNING", "SUCCEEDED", "succeed", "legal"));
});

// ---------------------------------------------------------------------------
// Parser unit contract (the new trust boundary).
// ---------------------------------------------------------------------------

function parserIndex(): ProposalCapabilityIndex {
  return { descriptors: new Map(), toolIds: new Set(["core.echo"]) };
}

test("P11.13 parser accepts a valid act proposal and derives authority fields server-side", () => {
  const parsed = parseActionProposal(JSON.stringify({ capability: "core.echo", arguments: { message: "hi" }, intent: "greet", requestedCapabilities: ["terminal.execute"] }), {
    missionId: "m", stepIndex: 0, actor: "tester", index: parserIndex(),
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok && parsed.data.kind === "act") {
    assert.equal(parsed.data.proposal.capability, "core.echo");
    assert.equal(parsed.data.proposal.riskLevel, "REVERSIBLE", "risk derived server-side, never from the model");
    assert.equal(parsed.data.proposal.sandbox, "INPROCESS_TRUSTED".replace("IN", "IN_"), "sandbox derived server-side");
    assert.equal(parsed.data.proposal.idempotencyKey, stepIdempotencyKey("m", 0, "core.echo"), "idempotency key derived server-side");
    // requestedCapabilities are recorded nowhere as authority: the harness
    // reads descriptor permissions only. The parser result carries no
    // capability grant surface at all.
    assert.equal("requestedCapabilities" in parsed.data.proposal, false);
  }
});

test("P11.14 parser fail-closed matrix", () => {
  const opts = { missionId: "m", stepIndex: 0, actor: "t", index: parserIndex() };
  const cases: readonly [string, string, string][] = [
    ["not json", "mission.proposal_malformed", "non-JSON rejected"],
    [JSON.stringify({ arguments: {} }), "mission.proposal_malformed", "missing capability"],
    [JSON.stringify({ capability: "unknown.tool", arguments: {} }), "mission.proposal_unknown_capability", "unknown capability"],
    [JSON.stringify({ capability: "core.echo", arguments: {}, secretField: 1 }), "mission.proposal_invalid_shape", "unknown field"],
    [JSON.stringify({ capability: "core.echo", arguments: { blob: "x".repeat(9_000) } }), "mission.proposal_oversized", "oversized args"],
    [JSON.stringify({ done: true, capability: "core.echo" }), "mission.proposal_invalid_shape", "done+capability conflict"],
    [JSON.stringify([]), "mission.proposal_malformed", "array rejected"],
    [JSON.stringify({ done: false }), "mission.proposal_invalid_shape", "done=false is not a state"],
  ];
  for (const [raw, code, name] of cases) {
    const parsed = parseActionProposal(raw, opts);
    assert.equal(parsed.ok, false, name);
    if (!parsed.ok) assert.equal(parsed.error.code, code, `${name} → ${code}`);
  }
});

test("P11.15 done proposals carry bounded final messages only", () => {
  const opts = { missionId: "m", stepIndex: 0, actor: "t", index: parserIndex() };
  const good = parseActionProposal(JSON.stringify({ done: true, finalMessage: "mission complete" }), opts);
  assert.equal(good.ok && good.data.kind === "done", true);
  const oversized = parseActionProposal(JSON.stringify({ done: true, finalMessage: "y".repeat(2_001) }), opts);
  assert.equal(oversized.ok, false);
});

test("P11.16 raw oversized model output is rejected before parsing", () => {
  const opts = { missionId: "m", stepIndex: 0, actor: "t", index: parserIndex() };
  const parsed = parseActionProposal("x".repeat(16_385), opts);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.error.code, "mission.proposal_oversized");
});
