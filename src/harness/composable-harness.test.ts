import test from "node:test";
import assert from "node:assert/strict";
import {
  ComposableAgentHarness,
  createComposableAgentHarness,
  SandboxPlugin,
  TrajectoryPlugin,
  SafetyGuardPlugin,
  ResourceBudgetPlugin,
  PtcBatchPlugin,
  replayTrajectory,
  TASK_PROFILES,
  type HarnessPlugin,
  type TrajectoryEvent,
} from "./composable-harness.js";
import { DefaultHarnessRegistry, registerComposableHarness } from "./registry.js";
import { runCertificationTests } from "./conformance.js";
import type { HarnessExecutionContext, HarnessTaskInput, HarnessCheckpoint } from "./contract.js";
import { ok, fail, type JsonObject } from "../core/types.js";

function createMockSystem() {
  const executedCalls: { toolId: string; input: JsonObject }[] = [];
  return {
    executedCalls,
    runtime: {
      executeTool: async (toolId: string, input: JsonObject) => {
        executedCalls.push({ toolId, input });
        if (toolId === "failing.tool") {
          return fail({
            code: "ERR_TOOL_FAILURE",
            message: "Simulated tool error",
            category: "runtime",
            recoverable: false,
          });
        }
        return ok({ message: `Executed ${toolId}`, echo: input });
      },
    },
    providers: {
      list: () => ["provider.mock", "provider.ollama"],
    },
  };
}

function createMockContext(overrides: Partial<HarnessExecutionContext> = {}): HarnessExecutionContext {
  return {
    missionId: "test-mission-001",
    runId: "run-001",
    iterationId: "iter-001",
    actor: "test-operator",
    workspaceRoot: process.cwd(),
    dataDir: process.cwd(),
    capabilities: ["tools", "checkpoint", "resume", "streaming"],
    trustClass: "SYSTEM",
    ...overrides,
  };
}

test("ComposableAgentHarness metadata and capabilities match H4_DURABLE certification", async () => {
  const system = createMockSystem();
  const harness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" });

  const meta = harness.metadata();
  assert.equal(meta.id, "COMPOSABLE_AGENT_HARNESS");
  assert.equal(harness.certification(), "H4_DURABLE");

  const caps = harness.capabilities();
  assert.equal(caps.tools, "NATIVE");
  assert.equal(caps.streaming, "NATIVE");
  assert.equal(caps.checkpoint, "NATIVE");
  assert.equal(caps.resume, "NATIVE");
  assert.equal(caps.interrupt, "NATIVE");
  assert.equal(caps.workspace, "NATIVE");
  assert.equal(caps.isolatedEnvironment, "NATIVE");
});

test("ComposableAgentHarness satisfies core contract lifecycle", async () => {
  const system = createMockSystem();
  const harness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" });
  const ctx = createMockContext();

  // 1. Startup and health
  await harness.start({ harnessId: "COMPOSABLE_AGENT_HARNESS" });
  assert.equal(await harness.health(), "HEALTHY");
  assert.equal((await harness.status()).activeExecutions, 0);

  // 2. Dispatch fixture
  const fixture: HarnessTaskInput = {
    goal: "Inspect file",
    toolInvocations: [
      { toolId: "core.workspace.list-files", input: { path: "." } },
    ],
  };
  const result = await harness.send(fixture, ctx);
  assert.equal(result.success, true);
  assert.ok(result.evidence.length > 0);
  assert.ok(result.metrics.toolCalls > 0);

  // 3. Status inspection
  const status = await harness.getStatus(ctx.missionId, ctx.runId);
  assert.ok(status);
  assert.equal(status.success, true);

  // 4. Unsupported capabilities fail closed
  const unsupported = await harness.send({ ...fixture, requiredCapabilities: ["subagents"] }, ctx);
  assert.equal(unsupported.success, false);

  // 5. Pre-cancelled dispatch fails closed
  const cancelled = await harness.send(fixture, { ...ctx, signal: AbortSignal.abort() });
  assert.equal(cancelled.success, false);
  assert.equal(cancelled.metrics.toolCalls, 0);

  // 6. Expired deadline fails closed
  const expired = await harness.send(fixture, { ...ctx, deadline: new Date(0).toISOString() });
  assert.equal(expired.success, false);
  assert.equal(expired.metrics.toolCalls, 0);

  // 7. Pause and Resume lifecycle
  await harness.pause(ctx.missionId);
  await assert.rejects(() => harness.send(fixture, ctx), /is paused/);
  await harness.cancel(ctx.missionId); // unpause

  // 8. Interrupt and Shutdown
  await harness.interrupt(ctx.missionId, ctx.runId);
  await harness.shutdown();
  assert.equal((await harness.status()).activeExecutions, 0);

  // 9. Dispose clears active state
  await harness.dispose();
  assert.notEqual(await harness.health(), "HEALTHY");
});

test("ComposableAgentHarness plugin lifecycle hooks execute in order with reversibility", async () => {
  const system = createMockSystem();
  const hookLog: string[] = [];

  const testPlugin: HarnessPlugin = {
    id: "plugin.test-lifecycle",
    name: "Lifecycle Test Plugin",
    version: "1.0.0",
    onInit: () => { hookLog.push("onInit"); },
    onTaskStart: () => { hookLog.push("onTaskStart"); },
    onBeforeAction: async (action) => {
      hookLog.push(`onBeforeAction:${action.toolId}`);
      return { allow: true };
    },
    onAfterAction: (action) => { hookLog.push(`onAfterAction:${action.toolId}`); },
    onTaskComplete: () => { hookLog.push("onTaskComplete"); },
    onTeardown: () => { hookLog.push("onTeardown"); },
  };

  const harness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" }, {
    plugins: [testPlugin],
  });

  await harness.start({ harnessId: "COMPOSABLE_AGENT_HARNESS" });
  assert.ok(hookLog.includes("onInit"));

  const input: HarnessTaskInput = {
    goal: "Test plugin execution",
    toolInvocations: [
      { toolId: "core.workspace.list-files", input: { path: "." } },
    ],
  };

  const output = await harness.send(input, createMockContext());
  assert.equal(output.success, true);

  assert.deepEqual(hookLog, [
    "onInit",
    "onTaskStart",
    "onBeforeAction:core.workspace.list-files",
    "onAfterAction:core.workspace.list-files",
    "onTaskComplete",
  ]);

  await harness.shutdown();
  assert.ok(hookLog.includes("onTeardown"));
});

test("ComposableAgentHarness plugin hook denial halts execution safely", async () => {
  const system = createMockSystem();
  const denyingPlugin: HarnessPlugin = {
    id: "plugin.gatekeeper",
    name: "Gatekeeper Plugin",
    version: "1.0.0",
    onBeforeAction: async (action) => {
      if (action.toolId === "restricted.tool") {
        return { allow: false, reason: "Restricted tool call blocked by gatekeeper" };
      }
      return { allow: true };
    },
  };

  const harness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" }, {
    plugins: [denyingPlugin],
  });
  await harness.start({ harnessId: "COMPOSABLE_AGENT_HARNESS" });

  const input: HarnessTaskInput = {
    goal: "Execute restricted action",
    toolInvocations: [
      { toolId: "restricted.tool", input: {} },
    ],
  };

  const output = await harness.send(input, createMockContext());
  assert.equal(output.success, false);
  assert.ok(output.error?.includes("Restricted tool call blocked by gatekeeper"));
  assert.equal(system.executedCalls.length, 0); // Not dispatched to runtime
});

test("ComposableAgentHarness task profiles filter allowed tools (MINIMAL, STANDARD, CREATOR, PTC)", async () => {
  const system = createMockSystem();

  // 1. MINIMAL profile: read-only tools allowed, write rejected
  const minimalHarness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" }, {
    profile: "MINIMAL",
  });
  await minimalHarness.start({ harnessId: "COMPOSABLE_AGENT_HARNESS" });
  assert.equal(minimalHarness.getProfile().mode, "MINIMAL");

  const writeInput: HarnessTaskInput = {
    goal: "Modify a file",
    toolInvocations: [
      { toolId: "core.workspace.write-file", input: { path: "hello.txt", content: "test" } },
    ],
  };

  const minimalResult = await minimalHarness.send(writeInput, createMockContext());
  assert.equal(minimalResult.success, false);
  assert.ok(minimalResult.error?.includes("disallowed under MINIMAL profile"));

  // 2. CREATOR profile: write-file is explicitly allowed
  const creatorHarness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" }, {
    profile: "CREATOR",
  });
  await creatorHarness.start({ harnessId: "COMPOSABLE_AGENT_HARNESS" });
  const creatorResult = await creatorHarness.send(writeInput, createMockContext({ runId: "creator-run" }));
  assert.equal(creatorResult.success, true);
  assert.equal(system.executedCalls.length, 1);

  // 3. Dynamic setProfile
  minimalHarness.setProfile("STANDARD");
  assert.equal(minimalHarness.getProfile().mode, "STANDARD");
  assert.ok(TASK_PROFILES.STANDARD.description.length > 0);
});

test("SandboxPlugin prevents path traversal and cleans up active runs", async () => {
  const system = createMockSystem();
  const harness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" });
  await harness.start({ harnessId: "COMPOSABLE_AGENT_HARNESS" });

  // 1. Path traversal via '..' is blocked
  const traversalInput: HarnessTaskInput = {
    goal: "Read forbidden file",
    toolInvocations: [
      { toolId: "core.workspace.read-file", input: { path: "../../etc/shadow" } },
    ],
  };
  const result = await harness.send(traversalInput, createMockContext());
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("path traversal detected"));
  assert.equal(system.executedCalls.length, 0);

  // 2. Active run count is 0 after completion
  assert.equal(harness.sandboxPlugin.getActiveRunCount(), 0);
});

test("TrajectoryPlugin records append-only events and supports export and query", async () => {
  const system = createMockSystem();
  const harness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" });
  await harness.start({ harnessId: "COMPOSABLE_AGENT_HARNESS" });

  const missionId = "flight-mission-42";
  const runId = "flight-run-1";

  await harness.send({
    goal: "Flight recorder verification",
    toolInvocations: [
      { toolId: "core.workspace.list-files", input: { path: "." } },
    ],
  }, createMockContext({ missionId, runId }));

  const events = harness.trajectoryPlugin.getEvents(missionId, runId);
  assert.ok(events.length >= 5);
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("MISSION_STARTED"));
  assert.ok(kinds.includes("ACTION_PROPOSED"));
  assert.ok(kinds.includes("TOOL_STARTED"));
  assert.ok(kinds.includes("TOOL_OUTPUT"));
  assert.ok(kinds.includes("OBSERVATION"));
  assert.ok(kinds.includes("MISSION_COMPLETED"));

  const json = harness.trajectoryPlugin.exportJson(missionId, runId);
  const parsed = JSON.parse(json);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, events.length);
});

test("Deterministic Trajectory Replay reconstructs executions without side-effects", () => {
  const mockEvents: TrajectoryEvent[] = [
    {
      id: "traj-1",
      timestamp: "2026-09-18T12:00:00.000Z",
      missionId: "replay-mission",
      runId: "run-1",
      kind: "MISSION_STARTED",
      data: { goal: "Replay test" },
    },
    {
      id: "traj-2",
      timestamp: "2026-09-18T12:00:01.000Z",
      missionId: "replay-mission",
      runId: "run-1",
      kind: "TOOL_OUTPUT",
      data: {
        toolId: "core.workspace.list-files",
        success: true,
        output: { files: ["index.ts", "package.json"] },
      },
    },
    {
      id: "traj-3",
      timestamp: "2026-09-18T12:00:02.000Z",
      missionId: "replay-mission",
      runId: "run-1",
      kind: "MISSION_STATE_CHANGED",
      data: { from: "PLANNING", to: "EXECUTING" },
    },
  ];

  const report = replayTrajectory(mockEvents);
  assert.equal(report.simulated, true);
  assert.equal(report.missionId, "replay-mission");
  assert.equal(report.replayedEventsCount, 3);
  assert.equal(report.toolCallsReconstructed, 1);
  assert.equal(report.toolResults[0]?.toolId, "core.workspace.list-files");
  assert.equal(report.toolResults[0]?.success, true);
  assert.equal(report.stateTransitions.length, 1);
  assert.equal(report.stateTransitions[0]?.to, "EXECUTING");
});

test("SafetyGuardPlugin enforces CapabilityBroker policy decisions", async () => {
  const system = createMockSystem();
  let policyDecision: "ALLOW" | "DENY" = "DENY";

  const mockBroker = {
    checkCapability: async (request: JsonObject) => {
      if (policyDecision === "DENY") {
        return { decision: "DENY" as const, reason: "Security policy prohibits operation" };
      }
      return { decision: "ALLOW" as const };
    },
  };

  const safetyPlugin = new SafetyGuardPlugin(mockBroker);
  const harness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" }, {
    plugins: [safetyPlugin],
  });
  await harness.start({ harnessId: "COMPOSABLE_AGENT_HARNESS" });

  const input: HarnessTaskInput = {
    goal: "Run governed action",
    toolInvocations: [
      { toolId: "core.workspace.list-files", input: { path: "." } },
    ],
  };

  // 1. Denied by broker
  const deniedResult = await harness.send(input, createMockContext());
  assert.equal(deniedResult.success, false);
  assert.ok(deniedResult.error?.includes("Security policy prohibits operation"));
  assert.equal(system.executedCalls.length, 0);

  // 2. Allowed by broker
  policyDecision = "ALLOW";
  const allowedResult = await harness.send(input, createMockContext({ runId: "run-allowed" }));
  assert.equal(allowedResult.success, true);
  assert.equal(system.executedCalls.length, 1);
});

test("ResourceBudgetPlugin enforces maximum tool calls ceiling", async () => {
  const system = createMockSystem();
  const budgetPlugin = new ResourceBudgetPlugin(2); // Max 2 tool calls

  const harness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" }, {
    plugins: [budgetPlugin],
  });
  await harness.start({ harnessId: "COMPOSABLE_AGENT_HARNESS" });

  const input: HarnessTaskInput = {
    goal: "Batch calls",
    toolInvocations: [
      { toolId: "core.workspace.list-files", input: { path: "." } },
      { toolId: "core.workspace.list-files", input: { path: "./src" } },
      { toolId: "core.workspace.list-files", input: { path: "./dist" } }, // Exceeds budget of 2
    ],
  };

  const result = await harness.send(input, createMockContext());
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("Resource budget exceeded: maximum tool calls (2) reached."));
  assert.equal(system.executedCalls.length, 2); // exactly 2 ran before blocking
});

test("PtcBatchPlugin validates batch structure and rejects malformed items", () => {
  const plugin = new PtcBatchPlugin();

  // Valid batch
  const valid = plugin.validateBatch([
    { toolId: "core.workspace.list-files", input: { path: "." } },
    { toolId: "core.git.status", input: {} },
  ]);
  assert.equal(valid.valid, true);

  // Empty batch -> invalid
  const empty = plugin.validateBatch([]);
  assert.equal(empty.valid, false);

  // Malformed item -> invalid
  const malformed = plugin.validateBatch([
    { toolId: "", input: {} },
  ]);
  assert.equal(malformed.valid, false);
});

test("ComposableAgentHarness checkpointing and cold resumption restores state", async () => {
  const system = createMockSystem();
  const harness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" }, {
    profile: "CREATOR",
  });
  await harness.start({ harnessId: "COMPOSABLE_AGENT_HARNESS" });

  const missionId = "durable-session-100";
  const runId = "run-100";

  await harness.send({
    goal: "Pre-checkpoint operation",
    toolInvocations: [
      { toolId: "core.workspace.list-files", input: { path: "." } },
    ],
  }, createMockContext({ missionId, runId }));

  // Create checkpoint
  const cp: HarnessCheckpoint = await harness.checkpoint(missionId, runId);
  assert.ok(cp.id);
  assert.equal(cp.missionId, missionId);
  assert.equal(cp.state["profile"], "CREATOR");

  // Create new cold harness initialized with MINIMAL profile
  const coldHarness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" }, {
    profile: "MINIMAL",
  });
  await coldHarness.start({ harnessId: "COMPOSABLE_AGENT_HARNESS" });
  assert.equal(coldHarness.getProfile().mode, "MINIMAL");

  // Resume restores CREATOR state
  await coldHarness.resume(cp);
  assert.equal(coldHarness.getProfile().mode, "CREATOR");
});

test("ComposableAgentHarness passes complete automated H4_DURABLE certification suite", async () => {
  const system = createMockSystem();
  const harness = createComposableAgentHarness(system, { harnessId: "COMPOSABLE_AGENT_HARNESS" });

  const fixture = {
    input: {
      goal: "H4 validation task",
      toolInvocations: [
        { toolId: "core.workspace.list-files", input: { path: "." } },
      ],
    },
    context: createMockContext(),
    assertOutput: (output: any) => {
      assert.equal(output.success, true);
    },
  };

  const suiteResult = await runCertificationTests(
    harness,
    { harnessId: "COMPOSABLE_AGENT_HARNESS" },
    "H4_DURABLE",
    fixture,
  );

  assert.equal(suiteResult.harnessId, "COMPOSABLE_AGENT_HARNESS");
  assert.equal(suiteResult.failedTests, 0, `Expected 0 failed tests, got: ${JSON.stringify(suiteResult.results.filter(r => !r.passed))}`);
  assert.equal(suiteResult.overallPass, true);
  assert.equal(suiteResult.totalTests, 15, "Expected all 15 H4 certification gates to run");
});

test("registerComposableHarness registers COMPOSABLE_AGENT_HARNESS in DefaultHarnessRegistry", async () => {
  const registry = new DefaultHarnessRegistry();
  const system = createMockSystem();

  registerComposableHarness(registry, system);

  const entry = registry.get("COMPOSABLE_AGENT_HARNESS");
  assert.ok(entry, "COMPOSABLE_AGENT_HARNESS must be registered");
  assert.equal(entry.id, "COMPOSABLE_AGENT_HARNESS");
  assert.equal(entry.certification, "H0_DETECTED");
  assert.equal(entry.priority, 150);

  const instance = await entry.factory({ harnessId: "COMPOSABLE_AGENT_HARNESS" });
  assert.equal(instance.certification(), "H4_DURABLE");

  const selected = registry.select({
    requiredCapabilities: ["checkpoint", "resume", "streaming", "tools"],
  });
  assert.equal(selected.harnessId, "COMPOSABLE_AGENT_HARNESS");
});
