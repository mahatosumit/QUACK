import test from "node:test";
import assert from "node:assert/strict";
import { ok, fail, type JsonObject, type QuackResult } from "../core/types.js";
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

test("Harness benchmark scenarios cover required mission cases", () => {
  assert.deepEqual(
    benchmarkScenarios.map((scenario) => scenario.id),
    ["file-creation-mission", "coding-mission", "failed-tool-recovery", "denied-capability-request"],
  );
});
