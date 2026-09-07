import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QUACK_CONTRACT_VERSION } from "../contracts/v1/contracts.js";
import { TaskGraphBuilder } from "../engine/task-graph.js";
import type { Checkpoint } from "../engine/types.js";
import { now, ok, type JsonObject } from "../core/types.js";
import type { ContextFragment, ExtensionDefinition, MemoryProvider, MemoryProviderContext } from "../extensions/types.js";
import type { MemoryItem, MemoryStoreInput } from "../memory/os.js";
import type { QuackTool } from "../tools/tool.js";
import { createQuackSystem } from "./create-system.js";

const missionId = "memory.mission";

function stored(input: MemoryStoreInput, id = "memory-record"): MemoryItem {
  return { id, type: input.type, source: input.source, timestamp: now(), confidence: input.confidence,
    accessPolicy: structuredClone(input.accessPolicy), relatedMission: input.relatedMission,
    content: input.content, metadata: structuredClone(input.metadata ?? {}) };
}

function memoryProvider(overrides: Partial<MemoryProvider> = {}): MemoryProvider {
  return {
    id: "memory.fixture", version: "1.0.0",
    retrieve: async (_query, context) => [stored({ type: "mission.short_term", source: "memory.fixture.seed", confidence: 0.9,
      accessPolicy: { visibility: "mission", allowedMissionIds: [context.missionId!], requiredCapabilities: ["permission.memory.read"] },
      relatedMission: context.missionId, content: "Remember the blue observation", metadata: { memoryScope: "task", validated: true } }, "seed-record")],
    store: async input => ok(stored(input, "completion-record")),
    ...overrides,
  };
}

function extension(memory: MemoryProvider, observed: { context?: readonly ContextFragment[]; toolCalls: number }): ExtensionDefinition {
  const tool: QuackTool<JsonObject, JsonObject> = {
    id: "memory.observe",
    describe: () => ({ id: "memory.observe", name: "Observe", description: "Records an observation.", permissions: ["memory.read"], retrySafety: "READ_ONLY" }),
    execute: async input => { observed.toolCalls++; return { output: structuredClone(input) }; },
  };
  return { manifest: { id: "memory.fixture-pack", version: "1.0.0", contractVersion: QUACK_CONTRACT_VERSION }, contributions: {
    memoryProviders: [memory], tools: [tool],
    plannerStrategies: [{ id: "memory.plan", version: "1.0.0", plan: context => {
      observed.context = structuredClone(context.context);
      return ok(new TaskGraphBuilder({ description: context.goal }).addNode("observe", { description: "Use memory",
        tools: [tool.id], toolInvocations: [{ toolId: tool.id, input: { remembered: context.context[0]?.content.content ?? null } }] }).build());
    } }],
    validationProviders: [{ id: "memory.verify", version: "1.0.0", validate: request => ({
      contractVersion: QUACK_CONTRACT_VERSION, id: "memory.verification", missionId: request.execution.missionId,
      executionId: request.execution.executionId, verifier: "memory.verify", status: observed.toolCalls === 1 ? "PASSED" : "FAILED",
      checkedAt: now(), evidenceIds: request.evidence.map(value => value.id), message: "Memory-backed observation executed once.",
    }) }],
  } };
}

function config(pack: ExtensionDefinition, dataDir?: string) {
  return {
    dataDir, missionId, extensions: [pack], plannerId: "memory.plan", validationProviderId: "memory.verify",
    memoryProviderId: "memory.fixture", memoryProviderTimeoutMs: 50, memoryProviderMaxItems: 2,
    memoryProviderMaxBytes: 4096, memoryNamespace: "memory.mission",
    permissions: ["memory.read", "memory.write"] as const,
    capabilityGrants: [{ missionId, capabilities: ["permission.memory.read", "permission.memory.write"],
      approval: { approvedBy: "test", reason: "Memory provider fixture", approvedAt: now() } }],
  };
}

async function rewindCompletedMission(dataDir: string, taskId: string, memoryStatus: "COMPLETED" | "STARTED" = "COMPLETED"): Promise<void> {
  const taskPath = join(dataDir, "tasks.json");
  const tasks = JSON.parse(await readFile(taskPath, "utf8")) as { tasks: Array<{ id: string; status: string; execution?: { sessionId: string; workflowId: string } }> };
  const task = tasks.tasks.find(value => value.id === taskId);
  assert.ok(task?.execution);
  task.status = "running";
  await writeFile(taskPath, JSON.stringify(tasks));
  const checkpointPath = join(dataDir, "sessions", task.execution.sessionId, "checkpoints.json");
  const envelope = JSON.parse(await readFile(checkpointPath, "utf8")) as { checkpoints: Checkpoint[] };
  const checkpoint = envelope.checkpoints.find(value => value.workflowId === task.execution!.workflowId);
  assert.ok(checkpoint?.recovery?.memoryWrites?.[0]);
  Object.assign(checkpoint.recovery, { status: "RUNNING" });
  if (memoryStatus === "STARTED") {
    Object.assign(checkpoint.recovery.memoryWrites[0]!, { status: "STARTED" });
    delete (checkpoint.recovery.memoryWrites[0] as { completedAt?: string }).completedAt;
    delete (checkpoint.recovery.memoryWrites[0] as { providerRecordId?: string }).providerRecordId;
  }
  await writeFile(checkpointPath, JSON.stringify(envelope));
}

test("configured admitted memory provider supplies bounded planning context and canonical completion write", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "quack-memory-binding-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const observed: { context?: readonly ContextFragment[]; toolCalls: number } = { toolCalls: 0 };
  const writes: Array<{ input: MemoryStoreInput; context: MemoryProviderContext }> = [];
  const memory = memoryProvider({ store: async (input, context) => {
    assert.throws(() => { (context as { executionId: string }).executionId = "foreign.execution"; }, TypeError);
    writes.push({ input: structuredClone(input), context: { ...context } });
    return ok(stored(input, "completion-record"));
  } });
  const namespace = "memory.fixture-context";
  const system = createQuackSystem({ ...config(extension(memory, observed), dataDir), memoryNamespace: namespace });
  t.after(() => system.runtime.shutdown());
  const result = await system.runtime.submitGoal("Use remembered observation.", "memory-user");
  assert.ok(result.ok, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.data.status, "completed", String(result.data.error?.message ?? ""));
  assert.equal(observed.context?.length, 1);
  assert.deepEqual(observed.context?.[0]?.provenance.sourceId, memory.id);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.context.executionId, result.data.id);
  assert.equal(writes[0]?.context.namespace, namespace);
  assert.equal(writes[0]?.input.type, "mission.short_term");
  assert.equal(result.data.execution?.memoryProviderId, memory.id);
  assert.equal(result.data.execution?.memoryNamespace, namespace);
  const path = join(dataDir, "sessions", result.data.execution!.sessionId, "checkpoints.json");
  const envelope = JSON.parse(await readFile(path, "utf8")) as { checkpoints: Checkpoint[] };
  const checkpoint = envelope.checkpoints.find(value => value.workflowId === result.data.execution!.workflowId);
  assert.equal(checkpoint?.recovery?.memoryWrites?.[0]?.status, "COMPLETED");
  assert.equal(checkpoint?.recovery?.memoryWrites?.[0]?.providerRecordId, "completion-record");
});

test("admitted but unselected memory provider leaves existing local memory behavior unchanged", async t => {
  const observed: { context?: readonly ContextFragment[]; toolCalls: number } = { toolCalls: 0 };
  let providerCalls = 0;
  const memory = memoryProvider({ retrieve: async () => { providerCalls++; return []; }, store: async input => { providerCalls++; return ok(stored(input)); } });
  const pack = extension(memory, observed);
  const selected = config(pack);
  const system = createQuackSystem({ ...selected, memoryProviderId: undefined });
  t.after(() => system.runtime.shutdown());
  const result = await system.runtime.submitGoal("Use local memory.", "memory-user");
  assert.ok(result.ok);
  assert.equal(providerCalls, 0);
  assert.equal((await system.memory.search({ scope: "task" })).length, 1);
});

test("configured provider failures surface structured mission errors without tool execution", async t => {
  for (const [name, memory, code] of [
    ["unavailable", memoryProvider({ retrieve: async () => { throw new Error("offline"); } }), "memory.provider_unavailable"],
    ["timeout", memoryProvider({ retrieve: async () => new Promise<never>(() => undefined) }), "memory.provider_timeout"],
    ["malformed", memoryProvider({ retrieve: async () => [{ id: "bad" }] as unknown as MemoryItem[] }), "memory.provider_invalid_response"],
  ] as const) await t.test(name, async () => {
    const observed: { toolCalls: number } = { toolCalls: 0 };
    const system = createQuackSystem({ ...config(extension(memory, observed)), memoryProviderTimeoutMs: 10 });
    try {
      const result = await system.runtime.submitGoal("Use provider memory.", "memory-user");
      assert.ok(result.ok);
      assert.equal(result.data.status, "failed");
      assert.equal(result.data.error?.code, code);
      assert.equal(observed.toolCalls, 0);
    } finally { await system.runtime.shutdown(); }
  });
});

test("provider output cannot replace host mission or execution identity", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "quack-memory-identity-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const observed: { toolCalls: number } = { toolCalls: 0 };
  const memory = memoryProvider({ store: async input => ok(stored(input, "tampered") as MemoryItem & { relatedMission: string }) });
  const original = memory.store.bind(memory);
  memory.store = async (input, context) => {
    const result = await original(input, context);
    return result.ok ? ok({ ...result.data, relatedMission: "foreign.mission" }) : result;
  };
  const system = createQuackSystem(config(extension(memory, observed), dataDir));
  t.after(() => system.runtime.shutdown());
  const result = await system.runtime.submitGoal("Reject provider mutation.", "memory-user");
  assert.ok(result.ok);
  assert.equal(result.data.status, "failed");
  assert.equal(result.data.error?.code, "memory.provider_identity_mutation");
  assert.equal(result.data.execution?.missionId, missionId);
  assert.equal(result.data.execution?.executionId, result.data.id);
});

test("extension policy and configured provider selection remain fail closed", async () => {
  const observed: { toolCalls: number } = { toolCalls: 0 };
  const pack = extension(memoryProvider(), observed);
  const denied: ExtensionDefinition = { ...pack, contributions: { ...pack.contributions, policyProviders: [{
    id: "memory.policy", version: "1.0.0", restrict: request => request.context?.providerId
      ? { decision: "DENY", reason: "Memory policy denied provider access." }
      : { decision: "ALLOW", reason: "No additional restriction." },
  }] } };
  const system = createQuackSystem(config(denied));
  try {
    const result = await system.runtime.submitGoal("Policy denied memory.", "memory-user");
    assert.ok(result.ok);
    assert.equal(result.data.status, "failed");
    assert.equal(result.data.error?.code, "memory.policy_denied");
    assert.equal(observed.toolCalls, 0);
  } finally { await system.runtime.shutdown(); }
  assert.throws(() => createQuackSystem({ ...config(pack), memoryProviderId: "memory.missing" }), /not registered/);
});

test("resume reuses acknowledged memory writes and does not depend on volatile provider state", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "quack-memory-resume-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let writes = 0;
  const memory = memoryProvider({ store: async input => { writes++; return ok(stored(input, "completion-record")); } });
  const firstObserved: { toolCalls: number } = { toolCalls: 0 };
  const first = createQuackSystem(config(extension(memory, firstObserved), dataDir));
  const submitted = await first.runtime.submitGoal("Resume memory mission.", "memory-user");
  assert.ok(submitted.ok);
  assert.equal(submitted.data.status, "completed");
  assert.equal(writes, 1);
  await first.runtime.shutdown();
  await rewindCompletedMission(dataDir, submitted.data.id);

  const unavailable = memoryProvider({ retrieve: async () => { throw new Error("volatile provider offline"); },
    store: async () => { writes++; throw new Error("must not repeat acknowledged write"); } });
  const recoveredObserved: { toolCalls: number } = { toolCalls: 0 };
  const recovered = createQuackSystem(config(extension(unavailable, recoveredObserved), dataDir));
  t.after(() => recovered.runtime.shutdown());
  const result = await recovered.runtime.resumeMission(submitted.data.id);
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) assert.equal(result.data.status, "completed");
  assert.equal(writes, 1);
  assert.equal(recoveredObserved.toolCalls, 0);
});

test("ambiguous or changed memory binding on resume fails closed without duplicate write", async t => {
  for (const mode of ["ambiguous", "removed", "namespace"] as const) await t.test(mode, async t => {
    const dataDir = await mkdtemp(join(tmpdir(), `quack-memory-${mode}-`));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    let writes = 0;
    const memory = memoryProvider({ store: async input => { writes++; return ok(stored(input, "completion-record")); } });
    const observed: { toolCalls: number } = { toolCalls: 0 };
    const first = createQuackSystem(config(extension(memory, observed), dataDir));
    const submitted = await first.runtime.submitGoal("Protect memory write.", "memory-user");
    assert.ok(submitted.ok);
    assert.equal(writes, 1);
    await first.runtime.shutdown();
    await rewindCompletedMission(dataDir, submitted.data.id, mode === "ambiguous" ? "STARTED" : "COMPLETED");
    const nextObserved: { toolCalls: number } = { toolCalls: 0 };
    const configured = config(extension(memory, nextObserved), dataDir);
    const reopened = createQuackSystem(mode === "removed" ? { ...configured, memoryProviderId: undefined }
      : mode === "namespace" ? { ...configured, memoryNamespace: "memory.changed" } : configured);
    t.after(() => reopened.runtime.shutdown());
    const result = await reopened.runtime.resumeMission(submitted.data.id);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, mode === "ambiguous" ? "recovery.reconciliation_required" : "recovery.invalid_checkpoint");
    assert.equal(writes, 1);
    assert.equal(nextObserved.toolCalls, 0);
  });
});
