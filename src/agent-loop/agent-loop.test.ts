import test from "node:test";
import assert from "node:assert/strict";
import { AgentLoop } from "./index.js";
import { canonicalFixture } from "../test-support/canonical-runtime.js";
import { MissionManager } from "../cos/mission-manager.js";
import { SkillRegistry } from "../skills/registry.js";
import { EventBus } from "../events/event-bus.js";
import { InMemoryMemoryStore } from "../memory/memory.js";
import { PermissionBackedCapabilityBroker } from "../security/capability-broker.js";
import { AllowListPermissionPolicy } from "../security/permissions.js";
import { ok, now, type JsonObject } from "../core/types.js";
import type { Harness } from "../harness/contract.js";
import type { TaskGraph } from "../engine/types.js";

function createMockHarness(toolResults: Map<string, JsonObject>): Harness {
  return {
    metadata: () => ({
      id: "MOCK",
      name: "Mock Harness",
      version: "1.0.0",
      description: "Test harness",
      vendor: "QUACK",
      license: "MIT",
      capabilities: { tools: "NATIVE", mcp: "UNSUPPORTED", subagents: "UNSUPPORTED", continuableSubagents: "UNSUPPORTED", streaming: "UNSUPPORTED", structuredOutput: "UNSUPPORTED", checkpoint: "UNSUPPORTED", resume: "UNSUPPORTED", interrupt: "UNSUPPORTED", workspace: "UNSUPPORTED", isolatedEnvironment: "UNSUPPORTED", backgroundJobs: "UNSUPPORTED", humanApproval: "UNSUPPORTED" },
      minQuackVersion: "1.0.0",
      platforms: ["win32", "linux", "darwin"],
      requiredEnvVars: [],
      optionalEnvVars: [],
    }),
    health: async () => "HEALTHY",
    status: async () => ({ id: "MOCK", health: "HEALTHY", certification: "H0_DETECTED", lastHealthCheck: new Date().toISOString(), activeExecutions: 0, uptimeMs: 0 }),
    capabilities: () => ({ tools: "NATIVE", mcp: "UNSUPPORTED", subagents: "UNSUPPORTED", continuableSubagents: "UNSUPPORTED", streaming: "UNSUPPORTED", structuredOutput: "UNSUPPORTED", checkpoint: "UNSUPPORTED", resume: "UNSUPPORTED", interrupt: "UNSUPPORTED", workspace: "UNSUPPORTED", isolatedEnvironment: "UNSUPPORTED", backgroundJobs: "UNSUPPORTED", humanApproval: "UNSUPPORTED" }),
    certification: () => "H0_DETECTED",
    start: async () => {},
    send: async (input) => {
      const toolId = input.toolInvocations?.[0]?.toolId ?? "unknown";
      const result = toolResults.get(toolId) ?? { success: true };
      return {
        success: true,
        result,
        evidence: [],
        artifacts: [],
        metrics: { durationMs: 10, tokensUsed: { input: 0, output: 0, total: 0 }, costUsd: 0, toolCalls: 1, subagentSpawns: 0, retries: 0, checkpointCount: 0, modelCalls: 0 },
      };
    },
    stream: async function* (input, context) { yield { success: true, result: {}, evidence: [], artifacts: [], metrics: { durationMs: 0, tokensUsed: { input: 0, output: 0, total: 0 }, costUsd: 0, toolCalls: 0, subagentSpawns: 0, retries: 0, checkpointCount: 0, modelCalls: 0 } }; },
    checkpoint: async () => ({ id: "", missionId: "", runId: "", createdAt: new Date().toISOString(), state: {}, taskStates: {}, agentDescriptors: {}, dependencies: {}, budgetsConsumed: {}, artifactRefs: [], evidenceRefs: [], knowledgeRefs: [], providerDecisions: {}, workflowPosition: {} }),
    resume: async () => {},
    pause: async () => {},
    cancel: async () => {},
    interrupt: async () => {},
    getStatus: async () => undefined,
    spawnSubagent: async () => ({ childId: "", parentId: "", taskId: "", status: "COMPLETED", summary: "", findings: [], artifacts: [], evidence: [], confidence: 0, blockers: [], deliveryMode: "QUIET", completedAt: new Date().toISOString() }),
    startBackgroundJob: async () => "",
    getBackgroundJobStatus: async () => ({ id: "", state: "QUEUED" }),
    cancelBackgroundJob: async () => {},
    waitBackgroundJob: async () => ({ id: "", state: "QUEUED" }),
    streamBackgroundJobOutput: async function* (jobId: string): AsyncIterable<{ stdout: string; stderr: string }> { },
    shutdown: async () => {},
    dispose: async () => {},
  };
}

const TEST_TASK_GRAPH: TaskGraph = {
  id: "graph-1",
  description: "test",
  nodes: [
    {
      id: "node-1",
      description: "test node",
      dependencies: [],
      resources: [],
      priority: "medium",
      estimatedCost: 0,
      estimatedDurationMs: 100,
      requiredTools: ["core.workspace.list-files"],
      toolInvocations: [{ toolId: "core.workspace.list-files", input: { path: ".", depth: 1 } }],
      requiredProviderCapabilities: [],
      timeoutMs: 5000,
      retryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 },
      status: "pending",
      retryCount: 0,
    }
  ],
  edges: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  metadata: {},
};

function createTestLoop(options: { readonly configured?: ReturnType<typeof canonicalFixture>; readonly includeRuntime?: boolean } = {}) {
  const configured = options.configured ?? canonicalFixture();
  const toolResults = new Map<string, JsonObject>();
  toolResults.set("core.workspace.list-files", { files: ["test.txt"] });
  
  const harness = createMockHarness(toolResults);
  
  const loop = new AgentLoop({
    runtime: options.includeRuntime === false ? undefined : configured.runtime,
    missionManager: new MissionManager(),
    skills: new SkillRegistry(),
    planner: { createPlan: () => ({ id: "plan-1", goal: "test", strategy: "test", taskGraph: TEST_TASK_GRAPH, riskEstimate: { level: "low", factors: [], mitigation: [] }, costEstimate: { estimatedTokens: 0, estimatedCostUsd: 0, estimatedDurationMs: 0, confidence: 0 }, requiresPermissions: [], contextSummary: "", createdAt: new Date().toISOString() }) },
    harness,
    eventBus: configured.events,
    memory: configured.memory,
    capabilityBroker: configured.broker,
    onMissionCompleted: async () => {},
    workspaceRoot: "",
    dataDir: "",
  });
  
  return { loop, configured };
}

test("AgentLoop compatibility surface delegates to the canonical runtime", async () => {
  const { loop, configured } = createTestLoop();
  const events: string[] = [];
  configured.events.onAny((event) => { events.push(event.type); });
  const result = await loop.start({ goal: "test goal", actor: "observer", missionId: "measurement" });
  assert.equal(result.state, "COMPLETED");
  assert.equal(result.stopReason, "GOAL_REACHED");
  assert.ok(result.iterations.length > 0);
  assert.ok(result.iterations[0]?.executionResult.workflowState, "canonical loop must execute a workflow");
  assert.equal(result.iterations[0]?.verificationResult.success, true, "mission completion requires verification");
  assert.equal(configured.runtime.getLoopResult(result.runId)?.runId, result.runId);
  assert.ok(events.includes("task.started"), "runtime must own mission start");
  assert.ok(events.includes("capability.requested"), "tool dispatch must request broker authority");
});

test("AgentLoop compatibility rejects standalone legacy execution", async () => {
  const { loop } = createTestLoop({ includeRuntime: false });
  await assert.rejects(() => loop.start({ goal: "test goal" }), /with QuackRuntime/);
});

test("AgentLoop compatibility cannot complete a mission without runtime verification", async () => {
  const { loop } = createTestLoop({ configured: canonicalFixture({ omitVerifier: true }) });
  const result = await loop.start({ goal: "test goal", actor: "observer", missionId: "measurement" });
  assert.equal(result.state, "FAILED");
  assert.equal(result.iterations[0]?.verificationResult.success, false);
});

test("AgentLoop getStatus returns current state", async () => {
  const { loop } = createTestLoop();
  assert.equal(loop.getStatus(), "IDLE");
  
  const promise = loop.start({ goal: "test goal", actor: "observer", missionId: "measurement" });
  await promise;
  assert.equal(loop.getStatus(), "COMPLETED");
});

test("AgentLoop cancel aborts execution", async () => {
  const { loop } = createTestLoop();
  const promise = loop.start({ goal: "test goal", actor: "observer", missionId: "measurement" });
  await loop.cancel("TEST_CANCEL");
  const result = await promise;
  assert.equal(result.state, "CANCELLED");
  assert.equal(result.stopReason, "CANCELLED");
});

test("AgentLoop pause/resume throws unsupported", async () => {
  const { loop } = createTestLoop();
  await assert.rejects(() => loop.pause(), /unsupported/);
  await assert.rejects(() => loop.resume(), /unsupported/);
});

test("AgentLoop injectEvent delivers to wakeup manager", async () => {
  const { loop } = createTestLoop();
  await loop.injectEvent({
    type: "TOOL_COMPLETION",
    source: "test",
    missionId: "test",
    runId: "test",
    timestamp: new Date().toISOString(),
    payload: {},
  });
  assert.ok(true);
});
