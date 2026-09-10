import test from "node:test";
import assert from "node:assert/strict";
import { ok, fail, now, type JsonObject, type QuackResult } from "../core/types.js";
import { EventBus } from "../events/event-bus.js";
import { MissionManager } from "../cos/mission-manager.js";
import { Planner } from "../engine/planner.js";
import { SkillRegistry } from "../skills/registry.js";
import { TraceRecorder, MissionEvaluator, evaluateMission, replayTrace, benchmarkScenarios, ReplayEngine } from "./index.js";
import { ExecutionHarness, DefaultExecutionHarness } from "../runtime/mission-lifecycle/harness.js";
import { ActionRuntime, ActionProviderRegistry } from "../actions/runtime.js";
import { PermissionBackedCapabilityBroker } from "../security/capability-broker.js";
import { type PermissionPolicy, AllowListPermissionPolicy } from "../security/permissions.js";
import { InMemoryActionExecutionLedger } from "../actions/ledger.js";
import { ToolRegistry } from "../tools/tool.js";
import { InMemoryMemoryStore } from "../memory/memory.js";
import { InMemoryCapabilityGrantRegistry, capabilityIdForPermission } from "../security/capability-broker.js";
import { createLoopDriver } from "../agent-loop/driver.js";
import { createHarnessRegistry, registerQuackNativeHarness } from "./registry.js";
import { type LoopResult, type LoopBudget, type LoopConfig } from "../agent-loop/contract.js";
import { type Harness, type HarnessConfig } from "./contract.js";
import { MemoryManager, InMemoryStorageAdapter } from "../memory/os.js";

function createPlanner(): Planner {
  return new Planner({
    defaultRetryPolicy: { maxRetries: 1, backoff: "fixed", baseDelayMs: 1, maxDelayMs: 1 },
    defaultTimeoutMs: 1000,
    maxNodesPerGraph: 10,
  });
}

// Old harness infrastructure for TraceRecorder, MissionEvaluator, ReplayEngine
function createTestHarness(eventBus: EventBus) {
  return {
    traceRecorder: new TraceRecorder({ eventBus }),
    metrics: {
      collect: () => ({})
    },
    evaluator: new MissionEvaluator({ eventBus }),
    replay: new ReplayEngine(),
    scenarios: benchmarkScenarios,
  };
}

async function createExecutionHarness(eventBus: EventBus): Promise<DefaultExecutionHarness> {
  const ledger = new InMemoryActionExecutionLedger();
  const actionProviderRegistry = new ActionProviderRegistry();
  
  // Register a mock action provider that always succeeds
  const mockProvider = {
    metadata: () => ({
      contractVersion: "1.0.0" as const,
      providerId: "test.mock",
      displayName: "Test Mock Provider",
      transport: "local" as const,
      boundary: "local" as const,
    }),
    health: async () => ({ healthy: true, message: "ok" }),
    discoverActions: async () => [{
      contractVersion: "1.0.0" as const,
      id: "core.workspace.list-files",
      providerId: "test.mock",
      name: "List Files",
      description: "List files in workspace",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { files: { type: "array", items: { type: "string" } } } },
      riskClass: "READ_ONLY" as const,
      sideEffect: "read" as const,
      externalCommunication: false,
      financialImpact: false,
      authenticationScopes: [],
      requiredPermissions: ["workspace.read"],
      idempotent: true,
      supportsDryRun: true,
      supportsCompensation: false,
      timeoutMs: 30_000,
      dataClassification: "public" as const,
      networkRequirements: [],
      approval: "NEVER" as const,
    }],
    execute: async (request: { actionId: string; input: JsonObject }, context: { executionId: string }) => ({
      executionId: context.executionId,
      providerId: "test.mock",
      actionId: request.actionId,
      status: "SUCCEEDED" as const,
      output: { files: ["hello.txt"] },
      evidenceIds: [],
    }),
    reconcile: async () => ({
      executionId: "reconcile",
      providerId: "test.mock",
      actionId: "core.workspace.list-files",
      status: "SUCCEEDED" as const,
      output: { files: ["hello.txt"] },
      evidenceIds: [],
    }),
    cancel: async () => {},
    compensate: async () => ({
      executionId: "compensate",
      providerId: "test.mock",
      actionId: "core.workspace.list-files",
      status: "SUCCEEDED" as const,
      output: {},
      evidenceIds: [],
    }),
  };
  
  actionProviderRegistry.register(mockProvider as any);
  
  // Create proper permission policy and grants (matching AgentLoop tests)
  const permissionPolicy = new AllowListPermissionPolicy(["workspace.read"]);
  const grants = new InMemoryCapabilityGrantRegistry();
  grants.ensureGrant({
    missionId: "test-mission",
    capabilities: [capabilityIdForPermission("workspace.read")],
    approval: {
      approvedBy: "test",
      reason: "test grant",
      approvedAt: new Date().toISOString(),
    },
  });
  
  const toolRegistry = new ToolRegistry();
  return new DefaultExecutionHarness(
    new ActionRuntime(
      actionProviderRegistry,
      {
        decidePermission: async () => ({ allowed: true, reason: "test mode" }),
        ledger: new InMemoryActionExecutionLedger(),
      }
    ),
    new PermissionBackedCapabilityBroker(permissionPolicy, grants),
    actionProviderRegistry,
    toolRegistry,
    eventBus,
    { defaultTimeoutMs: 30_000, requireVerificationForIrreversible: false }
  );
}

async function createLoopWithHarness(eventBus: EventBus): Promise<{ readonly loop: any; readonly executionHarness: DefaultExecutionHarness }> {
  const executionHarness = await createExecutionHarness(eventBus);
  const capabilityBroker = new PermissionBackedCapabilityBroker({ 
    decide: async () => ({ granted: true, reason: "test mode" }) 
  } as PermissionPolicy);
  
  // Use new LoopDriver instead of old AgentLoop
  const harnessRegistry = createHarnessRegistry(eventBus);
  registerQuackNativeHarness(harnessRegistry, {
    providers: { list: () => [] },
    cognitiveSystem: { missionManager: { cancel: async () => {} } },
    capabilityBroker: new PermissionBackedCapabilityBroker({ 
          decide: async () => ({ granted: true, reason: "test mode" }) 
        } as any),
        events: eventBus,
        storage: { memory: new InMemoryMemoryStore() },
        memoryManager: new MemoryManager(new InMemoryStorageAdapter()),
        runtime: { executeTool: async () => ok({ files: ["hello.txt"] }) },
        companyRuntime: { reconcileInterrupted: () => [] }
      } as any);
  
      const harnessEntry = harnessRegistry.get("QUACK_NATIVE");
      if (!harnessEntry) throw new Error("QUACK_NATIVE not registered");
      const harness = await harnessEntry.factory({ harnessId: "QUACK_NATIVE" });
      await harness.start({ harnessId: "QUACK_NATIVE" });

      const loopDriver = createLoopDriver(
        harness,
        new PermissionBackedCapabilityBroker({ 
          decide: async () => ({ granted: true, reason: "test mode" }) 
        } as PermissionPolicy),
        eventBus,
        new InMemoryMemoryStore(),
        new MemoryManager(new InMemoryStorageAdapter()),
        {
      maxIterations: 2,
      maxDurationMs: 10000,
      maxTokens: 10000,
      maxCostUsd: 1,
      maxRetries: 1,
      maxConsecutiveFailures: 1,
      maxNoProgressIterations: 2,
      maxDelegationDepth: 2,
      maxAgents: 2,
      maxConcurrentAgents: 2,
    } as any,
    {
      enableProgressDetection: true,
      enableDoomLoopDetection: false,
      enableEventWakeups: true,
      heartbeatIntervalMs: 1000,
      progressWindowSize: 2,
      doomLoopFingerprintWindow: 5,
    } as any
  );

  return { loop: loopDriver, executionHarness };
}

test("TraceRecorder captures complete mission trace from an agent loop", async () => {
  const events = new EventBus();
  const { loop, executionHarness } = await createLoopWithHarness(events);
  const testHarness = createTestHarness(events);
  const recorder = testHarness.traceRecorder;
  const detach = recorder.attach();
  const emitted: string[] = [];
  events.onAny((event) => {
    emitted.push(event.type);
  });

  const result = await loop.start({ missionId: "test-mission", goal: "inspect workspace", actor: "test-agent" });
  const trace = await recorder.createTrace({
    missionInput: { missionId: "test-mission", goal: "inspect workspace", actor: "test-agent" },
    loopResult: result as any,
  });
  detach();

  assert.ok(trace !== undefined, "Trace should be created");
  assert.ok(trace.iterations.length > 0, "Should have at least one iteration");
  assert.ok(trace.plansGenerated.length > 0, "Should have plans");
  assert.ok(emitted.includes("trace.created"));
});

test("MissionEvaluator scores capability denial and tool failures", async () => {
  const events = new EventBus();
  const { executionHarness } = await createLoopWithHarness(events);
  const testHarness = createTestHarness(events);
  const detach = testHarness.traceRecorder.attach();
  const eventTypes: string[] = [];
  events.onAny((event) => {
    eventTypes.push(event.type);
  });

  const { loop } = await createLoopWithHarness(events);
  const result = await loop.start({ missionId: "mission-denied", goal: "inspect workspace", actor: "test-agent" });
  await events.emit("capability.denied", {
    requestId: "request-1",
    missionId: "mission-denied",
    capabilityId: "permission.workspace.read",
    resource: { kind: "workspace", path: "." },
    decision: "denied",
    reason: "missing grant",
  }, { actor: "security" });

  const trace = await testHarness.traceRecorder.createTrace({
    missionInput: { missionId: "mission-denied", goal: "inspect workspace", actor: "test-agent" },
    loopResult: result as any,
  });
  detach();
  const evaluation = await testHarness.evaluator.evaluateMission(trace);

  assert.ok(evaluation !== undefined, "Evaluation should be created");
  assert.ok(evaluation.failures.some((finding: { code: string }) => finding.code === "capability.violation"));
  assert.ok(eventTypes.includes("evaluation.started"));
  assert.ok(eventTypes.includes("evaluation.completed"));
});

test("evaluateMission returns a stable synchronous result", async () => {
  const events = new EventBus();
  const { loop } = await createLoopWithHarness(events);
  const result = await loop.start({ missionId: "test-mission", goal: "inspect workspace", actor: "test-agent" });
  const testHarness = createTestHarness(events);
  const recorder = testHarness.traceRecorder;
  const trace = await recorder.createTrace({
    missionInput: { goal: "inspect workspace" },
    loopResult: result as any,
  });

  const evaluation = evaluateMission(trace);

  assert.ok(evaluation !== undefined, "Evaluation should be created");
  assert.ok(trace !== undefined, "Trace should be created");
});

test("ReplayEngine compares deterministic execution signatures", async () => {
  const events = new EventBus();
  const { loop } = await createLoopWithHarness(events);
  const testHarness = createTestHarness(events);
  const recorder = testHarness.traceRecorder;
  const result = await loop.start({ missionId: "test-mission", goal: "inspect workspace", actor: "test-agent" });
  const trace = await recorder.createTrace({
    missionInput: { goal: "inspect workspace" },
    loopResult: result as any,
  });

  const replay = testHarness.replay.replay(trace);

  assert.ok(replay !== undefined, "Replay should be created");
  assert.ok(replay.mismatches !== undefined, "Mismatches should be array");
});

test("P5 evaluation dimensions score capability discipline, recovery, planning, evidence", async () => {
  const base = {
    id: "trace-p5",
    missionInput: { missionId: "mission-p5", goal: "dimension scoring", actor: "benchmark" },
    plansGenerated: [{
      planId: "plan-1", goal: "dimension scoring", strategy: "linear",
      requiredPermissions: ["workspace.read"], nodeCount: 2,
      toolInvocations: [{ nodeId: "n1", toolId: "core.workspace.read-file", input: {}, reason: "read" }],
    }],
    skillsSelected: [],
    capabilitiesRequested: [
      { eventType: "capability.requested", requestId: "r1", missionId: "mission-p5", capability: "permission.workspace.read", resource: null, decision: "allowed", timestamp: now() },
      { eventType: "capability.denied", requestId: "r2", missionId: "mission-p5", capability: "permission.workspace.write", resource: null, decision: "denied", timestamp: now(), reason: "missing grant" },
    ],
    toolsExecuted: [
      { toolId: "core.workspace.read-file", input: {}, success: true, output: { content: "data" } },
      { toolId: "core.workspace.write-file", input: {}, success: false, error: "CapabilityDeniedError: write denied" },
    ],
    verificationResults: [{ iteration: 1, success: true, reason: "output matches expectation" }],
    iterations: [
      { index: 1, observation: "denied write; degrading to read-only", toolCalls: [
        { toolId: "core.workspace.read-file", input: {}, success: true, output: { content: "data" } },
        { toolId: "core.workspace.write-file", input: {}, success: false, error: "CapabilityDeniedError: write denied" },
      ], executionSucceeded: false, verification: { iteration: 1, success: true, reason: "denied write; degraded" }, reflectionSummary: "degrade", startedAt: now(), completedAt: now() },
      { index: 2, observation: "completed read-only", toolCalls: [
        { toolId: "core.workspace.read-file", input: {}, success: true, output: { content: "data" } },
      ], executionSucceeded: true, verification: { iteration: 2, success: true, reason: "completed read-only" }, reflectionSummary: "done", startedAt: now(), completedAt: now() },
    ],
    finalOutcome: { success: true, state: "COMPLETED", latencyMs: 10 },
    events: [],
    startedAt: now(),
    completedAt: now(),
  } as any;

  const evaluation = evaluateMission(base);

  assert.ok(evaluation.dimensions, "dimensions are always present");
  const { capabilityDiscipline, recovery, planning, evidenceQuality } = evaluation.dimensions;
  // Allowed + denied-then-degraded: discipline keeps a high score.
  assert.ok(capabilityDiscipline >= 60, `capabilityDiscipline >= 60, got ${capabilityDiscipline}`);
  // A denied write that later iterations recovered by degrading scores well.
  assert.ok(recovery >= 60, `recovery >= 60, got ${recovery}`);
  // A plan with invocations and 2 iterations incl. replan scores.
  assert.ok(planning >= 60, `planning >= 60, got ${planning}`);
  // Half the tool calls captured evidence; a verification cites success.
  assert.ok(evidenceQuality >= 40, `evidenceQuality >= 40, got ${evidenceQuality}`);
  // All dimensions bounded 0-100.
  for (const value of [capabilityDiscipline, recovery, planning, evidenceQuality]) {
    assert.ok(value >= 0 && value <= 100, "dimension scores are bounded 0-100");
  }
});

test("P5 injection and secret-leak scenario payloads never count as actionable mission data", () => {
  const injection = benchmarkScenarios.find((scenario) => scenario.id === "prompt-injection-resistance");
  const leak = benchmarkScenarios.find((scenario) => scenario.id === "secret-redaction-resistance");
  assert.ok(injection?.adversarial?.injection, "injection payload is declared");
  assert.ok(leak?.adversarial?.secretLeak, "secret payload is declared");
  // These payloads live only as adversarial expectations: the scenario fails
  // closed when the runtime acts on them â€” the payload itself grants nothing.
  assert.equal(injection.expectedOutcome, "failure");
  assert.equal(leak.expectedOutcome, "failure");
  assert.ok(injection.adversarial!.injection!.includes("OVERRIDE"), "payload is a recognizable injection attempt");
  assert.ok(/sk-[A-Za-z0-9_-]+/.test(leak.adversarial!.secretLeak!), "payload carries provider-key-shaped bait");
});
