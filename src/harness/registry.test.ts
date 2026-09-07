import test from "node:test";
import assert from "node:assert/strict";
import { QuackNativeHarness, DefaultHarnessRegistry } from "./registry.js";
import { runCertificationTests, runHarnessConformanceTests } from "./conformance.js";
import { ok, fail, type JsonObject } from "../core/types.js";
import type { HarnessExecutionContext, HarnessConfig } from "./contract.js";

const config: HarnessConfig = { harnessId: "QUACK_NATIVE" };
const context: HarnessExecutionContext = { missionId: "mission", runId: "run", iterationId: "iteration", actor: "fixture",
  workspaceRoot: process.cwd(), dataDir: process.cwd(), capabilities: [], trustClass: "SYSTEM" };

test("native harness preserves all explicit arguments and reports operations without goal verification", async () => {
  const calls: { id: string; input: JsonObject }[] = [];
  const harness = new QuackNativeHarness({ runtime: { executeTool: async (id, input) => { calls.push({ id, input }); return ok({ echoed: input }); } } }, config);
  await harness.start(config);
  const invocations: { toolId: string; input: JsonObject }[] = [{ toolId: "fixture.first", input: { path: "a space/file.txt", flag: false, nested: { values: [1, "two"] } } }, { toolId: "fixture.second", input: { value: 0 } }];
  const result = await harness.send({ goal: "execute fixture", toolInvocations: invocations }, context);
  assert.equal(result.success, true);
  assert.deepEqual(calls, invocations.map((item) => ({ id: item.toolId, input: item.input })));
  assert.equal(result.result?.goalVerified, false);
  assert.equal(result.metrics.toolCalls, 2);
  assert.equal(result.metrics.modelCalls, 0);
  assert.equal(result.metrics.tokensUsed.total, 0);
  assert.equal(result.metrics.costUsd, 0);
  assert.equal(await harness.getStatus("mission", "run"), result);
  assert.equal(await harness.getStatus("missing", "run"), undefined);
  await harness.dispose();
});

test("native harness never invents arguments and rejects expired, invalid, cancelled or unsupported dispatch", async () => {
  let calls = 0;
  const harness = new QuackNativeHarness({ runtime: { executeTool: async () => { calls++; return ok({}); } } }, config);
  await harness.start(config);
  assert.equal((await harness.send({ goal: "inspect workspace", requiredCapabilities: ["tools"] }, context)).success, false);
  const input = { goal: "fixture", toolInvocations: [{ toolId: "fixture", input: {} }] };
  for (const invalidContext of [{ ...context, signal: AbortSignal.abort() }, { ...context, deadline: "invalid" }, { ...context, deadline: new Date(0).toISOString() }]) {
    assert.equal((await harness.send(input, invalidContext)).success, false);
  }
  assert.equal((await harness.send({ ...input, requiredCapabilities: ["subagents"] }, context)).success, false);
  assert.equal(calls, 0);
  await harness.dispose();
});

test("native harness stops after the first failed operation and never reports partial success", async () => {
  const calls: string[] = [];
  const harness = new QuackNativeHarness({ runtime: { executeTool: async (id) => {
    calls.push(id);
    return id === "fail" ? fail({ code: "fixture.failed", message: "fixture failure", category: "tool", recoverable: false }) : ok({});
  } } }, config);
  await harness.start(config);
  const result = await harness.send({ goal: "fixture", toolInvocations: ["first", "fail", "last"].map((toolId) => ({ toolId, input: {} })) }, context);
  assert.equal(result.success, false);
  assert.deepEqual(calls, ["first", "fail"]);
  assert.equal(result.metrics.toolCalls, 2);
  await harness.dispose();
});

test("native harness exposes active work and drains before shutdown instead of claiming cancellation", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const controller = new AbortController();
  const harness = new QuackNativeHarness({ runtime: { executeTool: async () => { await pending; return ok({}); } } }, config);
  await harness.start(config);
  const execution = harness.send({ goal: "fixture", toolInvocations: [{ toolId: "fixture", input: {} }] }, { ...context, signal: controller.signal });
  assert.equal((await harness.status()).activeExecutions, 1);
  await assert.rejects(() => harness.shutdown(), /active/);
  controller.abort();
  release();
  assert.equal((await execution).success, false);
  assert.equal((await harness.status()).activeExecutions, 0);
  await harness.dispose();
});

test("unsupported native controls, child execution and background status reject", async () => {
  const harness = new QuackNativeHarness({ runtime: { executeTool: async () => ok({}) } }, config);
  assert.equal(harness.certification(), "H0_DETECTED");
  const child = { taskId: "child", goal: "fixture", role: "fixture", capabilities: [], allowedTools: [], deniedTools: [], depth: 1, maxDepth: 1, parentId: "parent", missionId: "mission" };
  await assert.rejects(() => harness.spawnSubagent(child), /does not support subagents/);
  await assert.rejects(() => harness.spawnSubagent({ ...child, continuation: "CONTINUABLE" }), /does not support subagents/);
  await assert.rejects(() => harness.checkpoint("mission", "run"), /does not support checkpoint/);
  await assert.rejects(() => harness.resume({} as never), /does not support resume/);
  await assert.rejects(() => harness.pause("mission"), /does not support pause/);
  await assert.rejects(() => harness.cancel("mission"), /does not support cancel/);
  await assert.rejects(() => harness.interrupt("mission", "run"), /does not support interrupt/);
  await assert.rejects(() => harness.startBackgroundJob({} as never), /does not support backgroundJobs/);
  await assert.rejects(() => harness.getBackgroundJobStatus("unknown"), /does not support backgroundJobs/);
  await assert.rejects(() => harness.cancelBackgroundJob("unknown"), /does not support backgroundJobs/);
  await assert.rejects(() => harness.waitBackgroundJob("unknown"), /does not support backgroundJobs/);
  await assert.rejects(async () => { for await (const _ of harness.streamBackgroundJobOutput("unknown")) {} }, /does not support backgroundJobs/);
});

test("registration and shallow conformance cannot certify production execution", async () => {
  const harness = new QuackNativeHarness({ runtime: { executeTool: async () => ok({}) } }, config);
  const registry = new DefaultHarnessRegistry();
  registry.register({ id: "QUACK_NATIVE", factory: async () => harness, metadata: harness.metadata(), healthCheck: async () => "HEALTHY", certification: "H6_PRODUCTION_CERTIFIED", priority: 1, tags: [] });
  assert.equal(registry.getCertification("QUACK_NATIVE"), "H0_DETECTED");
  assert.equal(await registry.certify("QUACK_NATIVE", "H6_PRODUCTION_CERTIFIED"), false);
  assert.equal((await runCertificationTests(harness, config, "H6_PRODUCTION_CERTIFIED")).overallPass, false);
  assert.equal((await runHarnessConformanceTests(harness, config)).overallPass, false, "Missing executable fixture is not evidence of conformance");
});
