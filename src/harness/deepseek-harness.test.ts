import test from "node:test";
import assert from "node:assert/strict";
import { DeepSeekHarness, createDeepSeekHarness, SandboxPlugin, TrajectoryPlugin, type HarnessPlugin } from "./deepseek-harness.js";
import { DefaultHarnessRegistry, registerDeepSeekHarness } from "./registry.js";
import { runHarnessConformanceTests } from "./conformance.js";
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
          return fail({ code: "ERR_TOOL_FAILURE", message: "Simulated tool error", category: "runtime", recoverable: false });
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
    capabilities: ["tools", "checkpoint", "streaming"],
    trustClass: "SYSTEM",
    ...overrides,
  };
}

test("DeepSeekHarness satisfies core contract requirements", async () => {
  const system = createMockSystem();
  const harness = createDeepSeekHarness(system, { harnessId: "DEEPSEEK_HARNESS" });
  const ctx = createMockContext();

  // 1. Startup and metadata
  assert.ok(harness.metadata().id);
  assert.deepEqual(harness.metadata().capabilities, harness.capabilities());
  await harness.start({ harnessId: "DEEPSEEK_HARNESS" });
  assert.equal(await harness.health(), "HEALTHY");
  assert.equal((await harness.status()).activeExecutions, 0);

  // 2. Tool execution fixture
  const fixture = {
    goal: "Inspect file",
    toolInvocations: [
      { toolId: "core.workspace.list-files", input: { path: "." } },
    ],
  };
  const result = await harness.send(fixture, ctx);
  assert.equal(result.success, true);
  assert.ok(result.evidence.length > 0);
  assert.ok(result.metrics.toolCalls > 0);

  // 3. Unsupported capability requests fail closed
  const unsupported = await harness.send({ ...fixture, requiredCapabilities: ["subagents"] }, ctx);
  assert.equal(unsupported.success, false);

  // 4. Pre-cancelled dispatch fails
  const cancelled = await harness.send(fixture, { ...ctx, signal: AbortSignal.abort() });
  assert.equal(cancelled.success, false);
  assert.equal(cancelled.metrics.toolCalls, 0);

  // 5. Expired deadline fails
  const expired = await harness.send(fixture, { ...ctx, deadline: new Date(0).toISOString() });
  assert.equal(expired.success, false);
  assert.equal(expired.metrics.toolCalls, 0);

  // 6. Dispose clears active state and health
  await harness.dispose();
  assert.equal((await harness.status()).activeExecutions, 0);
  assert.notEqual(await harness.health(), "HEALTHY");
});

test("DeepSeekHarness metadata and capabilities match H4_DURABLE certification", async () => {
  const system = createMockSystem();
  const harness = createDeepSeekHarness(system, { harnessId: "DEEPSEEK_HARNESS" });

  const meta = harness.metadata();
  assert.equal(meta.id, "DEEPSEEK_HARNESS");
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

test("DeepSeekHarness plugin lifecycle hooks execute in order", async () => {
  const system = createMockSystem();
  const hookLog: string[] = [];

  const testPlugin: HarnessPlugin = {
    id: "plugin.test-telemetry",
    name: "Test Telemetry Plugin",
    version: "1.0.0",
    onInit: () => { hookLog.push("onInit"); },
    onTaskStart: () => { hookLog.push("onTaskStart"); },
    onBeforeAction: async (action: any) => {
      hookLog.push(`onBeforeAction:${action.toolId}`);
      return { allow: true };
    },
    onAfterAction: (action: any) => { hookLog.push(`onAfterAction:${action.toolId}`); },
    onTaskComplete: () => { hookLog.push("onTaskComplete"); },
    onTeardown: () => { hookLog.push("onTeardown"); },
  };

  const harness = createDeepSeekHarness(system, { harnessId: "DEEPSEEK_HARNESS" }, {
    plugins: [testPlugin],
  });

  await harness.start({ harnessId: "DEEPSEEK_HARNESS" });
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

test("DeepSeekHarness task profiles filter allowed tools (Minimal vs Creator)", async () => {
  const system = createMockSystem();
  const harness = createDeepSeekHarness(system, { harnessId: "DEEPSEEK_HARNESS" }, {
    profile: "Minimal", // Minimal disallows write-file
  });
  await harness.start({ harnessId: "DEEPSEEK_HARNESS" });

  // 1. Attempt write-file under Minimal profile -> Rejected
  const writeInput: HarnessTaskInput = {
    goal: "Modify a file",
    toolInvocations: [
      { toolId: "core.workspace.write-file", input: { path: "test.txt", content: "data" } },
    ],
  };

  const writeResult = await harness.send(writeInput, createMockContext());
  assert.equal(writeResult.success, false);
  assert.ok(writeResult.error?.includes("disallowed under Minimal profile"));

  // 2. Switch to Creator profile -> Allowed
  harness.setProfile("Creator");
  assert.equal(harness.getProfile().mode, "Creator");

  const creatorResult = await harness.send(writeInput, createMockContext({ runId: "run-002" }));
  assert.equal(creatorResult.success, true);
  assert.equal(system.executedCalls.length, 1);
});

test("DeepSeekHarness sandbox plugin prevents path traversal attacks", async () => {
  const system = createMockSystem();
  const harness = createDeepSeekHarness(system, { harnessId: "DEEPSEEK_HARNESS" });
  await harness.start({ harnessId: "DEEPSEEK_HARNESS" });

  const traversalInput: HarnessTaskInput = {
    goal: "Read sensitive host file",
    toolInvocations: [
      { toolId: "core.workspace.read-file", input: { path: "../../windows/system32/cmd.exe" } },
    ],
  };

  const output = await harness.send(traversalInput, createMockContext());
  assert.equal(output.success, false);
  assert.ok(output.error?.includes("path traversal detected"));
  assert.equal(system.executedCalls.length, 0); // never dispatched to runtime
});

test("DeepSeekHarness trajectory plugin records append-only session events", async () => {
  const system = createMockSystem();
  const harness = createDeepSeekHarness(system, { harnessId: "DEEPSEEK_HARNESS" });
  await harness.start({ harnessId: "DEEPSEEK_HARNESS" });

  const missionId = "trajectory-mission";
  const runId = "trajectory-run";

  await harness.send({
    goal: "Session logging test",
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
});

test("DeepSeekHarness creates checkpoints and supports cold resumption", async () => {
  const system = createMockSystem();
  const harness = createDeepSeekHarness(system, { harnessId: "DEEPSEEK_HARNESS" }, {
    profile: "Creator",
  });
  await harness.start({ harnessId: "DEEPSEEK_HARNESS" });

  const missionId = "durable-mission-99";
  const runId = "run-99";

  await harness.send({
    goal: "Checkpoint test",
    toolInvocations: [
      { toolId: "core.workspace.list-files", input: { path: "." } },
    ],
  }, createMockContext({ missionId, runId }));

  // Create checkpoint
  const cp: HarnessCheckpoint = await harness.checkpoint(missionId, runId);
  assert.ok(cp.id);
  assert.equal(cp.missionId, missionId);
  assert.equal(cp.state["profile"], "Creator");

  // Create clean second harness in Minimal mode
  const secondHarness = createDeepSeekHarness(system, { harnessId: "DEEPSEEK_HARNESS" }, {
    profile: "Minimal",
  });
  await secondHarness.start({ harnessId: "DEEPSEEK_HARNESS" });
  assert.equal(secondHarness.getProfile().mode, "Minimal");

  // Resume from checkpoint -> Profile restored to Creator
  await secondHarness.resume(cp);
  assert.equal(secondHarness.getProfile().mode, "Creator");
});

test("DeepSeekHarness streaming yields output asynchronously", async () => {
  const system = createMockSystem();
  const harness = createDeepSeekHarness(system, { harnessId: "DEEPSEEK_HARNESS" });
  await harness.start({ harnessId: "DEEPSEEK_HARNESS" });

  const outputs = [];
  for await (const output of harness.stream({
    goal: "Streaming test",
    toolInvocations: [
      { toolId: "core.workspace.list-files", input: { path: "." } },
    ],
  }, createMockContext())) {
    outputs.push(output);
  }

  assert.equal(outputs.length, 1);
  assert.equal(outputs[0]?.success, true);
});

test("registerDeepSeekHarness correctly registers in HarnessRegistry with H4_DURABLE", async () => {
  const registry = new DefaultHarnessRegistry();
  const system = createMockSystem();

  registerDeepSeekHarness(registry, system);

  const entry = registry.get("DEEPSEEK_HARNESS");
  assert.ok(entry, "DEEPSEEK_HARNESS must be registered");
  assert.equal(entry.id, "DEEPSEEK_HARNESS");
  assert.equal(entry.certification, "H0_DETECTED");
  assert.equal(entry.priority, 150);

  const instance = await entry.factory({ harnessId: "DEEPSEEK_HARNESS" });
  assert.equal(instance.certification(), "H4_DURABLE");

  // Selection by capability
  const selected = registry.select({
    requiredCapabilities: ["checkpoint", "resume", "streaming", "tools"],
  });
  assert.equal(selected.harnessId, "DEEPSEEK_HARNESS");
});
