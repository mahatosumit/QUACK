import test from "node:test";
import assert from "node:assert/strict";
import { now, ok, type JsonObject } from "../core/types.js";
import type { MemoryProvider } from "../extensions/types.js";
import { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker } from "../security/capability-broker.js";
import { AllowListPermissionPolicy } from "../security/permissions.js";
import type { MemoryItem, MemoryStoreInput } from "./os.js";
import { MemoryBindingError, type MemoryOperationContext } from "./memory.js";
import { MemoryProviderBinding } from "./provider-binding.js";

const context: MemoryOperationContext = {
  missionId: "fixture.mission", taskId: "fixture.task", executionId: "fixture.execution",
  sessionId: "fixture.session", actor: "fixture.actor", namespace: "memory.mission", operationId: "fixture.operation",
};

function broker(permissions: readonly ("memory.read" | "memory.write")[] = ["memory.read", "memory.write"]) {
  const grants = new InMemoryCapabilityGrantRegistry();
  grants.ensureGrant({ missionId: context.missionId, capabilities: permissions.map(value => `permission.${value}`),
    approval: { approvedBy: "test", reason: "Memory binding fixture", approvedAt: now() } });
  return new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(permissions), grants);
}

function item(input: MemoryStoreInput, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return { id: "fixture.record", type: input.type, source: input.source, timestamp: now(), confidence: input.confidence,
    accessPolicy: structuredClone(input.accessPolicy), relatedMission: input.relatedMission,
    content: input.content, metadata: structuredClone(input.metadata ?? {}), ...overrides };
}

function provider(overrides: Partial<MemoryProvider> = {}): MemoryProvider {
  return {
    id: "fixture.memory", version: "1.0.0",
    store: async input => ok(item(input)),
    retrieve: async (_query, providerContext) => [item({ type: "mission.short_term", source: "fixture.seed", confidence: 0.8,
      accessPolicy: { visibility: "mission", allowedMissionIds: [providerContext.missionId!], requiredCapabilities: ["permission.memory.read"] },
      relatedMission: providerContext.missionId, content: "Relevant durable observation", metadata: { memoryScope: "task" } })],
    ...overrides,
  };
}

function binding(memory = provider(), permissions: readonly ("memory.read" | "memory.write")[] = ["memory.read", "memory.write"], timeoutMs = 100) {
  return new MemoryProviderBinding({ provider: memory, capabilityBroker: broker(permissions), namespace: "memory.mission",
    timeoutMs, maxItems: 2, maxBytes: 4096 });
}

test("configured provider reads and writes with bounded host context and provenance", async () => {
  const calls: Array<{ operationId: string; input: MemoryStoreInput }> = [];
  const memory = provider({ store: async (input, providerContext) => {
    calls.push({ operationId: providerContext.operationId, input: structuredClone(input) });
    return ok(item(input));
  } });
  const bound = binding(memory);
  const stored = await bound.write({ scope: "task", content: "Verified result",
    metadata: { memoryClass: "working", source: "runtime.verification" } }, context);
  assert.equal(stored.metadata.memoryProviderId, memory.id);
  assert.equal(calls[0]?.operationId, context.operationId);
  assert.equal(calls[0]?.input.type, "mission.short_term");
  const fragments = await bound.loadContext({ execution: { contractVersion: "1.0.0", missionId: context.missionId,
    taskId: context.taskId, executionId: context.executionId, actor: context.actor }, sessionId: context.sessionId,
    goal: "durable observation", namespace: "memory.mission", maxBytes: 4096, maxItems: 2, maxTokens: 1024 });
  assert.equal(fragments.length, 1);
  assert.deepEqual(fragments[0]?.provenance, { sourceId: memory.id, recordId: "fixture.record", observedAt: fragments[0]?.provenance.observedAt });
  assert.equal((fragments[0]?.content as JsonObject).content, "Relevant durable observation");
});

test("memory authority denial fails explicitly before provider execution", async () => {
  let called = false;
  const bound = binding(provider({ retrieve: async () => { called = true; return []; } }), ["memory.write"]);
  await assert.rejects(bound.search({ text: "anything" }, context), error => error instanceof MemoryBindingError && error.code === "memory.policy_denied");
  assert.equal(called, false);
});

test("provider timeout and unavailability are bounded structured failures", async (t) => {
  await t.test("timeout", async () => {
    const bound = binding(provider({ retrieve: async () => new Promise<never>(() => undefined) }), undefined, 10);
    await assert.rejects(bound.search({ text: "anything" }, context), error => error instanceof MemoryBindingError && error.code === "memory.provider_timeout");
  });
  await t.test("unavailable", async () => {
    const bound = binding(provider({ retrieve: async () => { throw new Error("offline"); } }));
    await assert.rejects(bound.search({ text: "anything" }, context), error => error instanceof MemoryBindingError && error.code === "memory.provider_unavailable");
  });
});

test("malformed oversized and duplicate provider output fails closed", async (t) => {
  for (const [name, retrieve] of [
    ["malformed", async () => [{ id: "bad" }] as unknown as MemoryItem[]],
    ["oversized", async (_query: unknown, providerContext: { missionId?: string }) => Array.from({ length: 3 }, (_, index) => item({
      type: "mission.short_term", source: "fixture", confidence: 1, accessPolicy: { visibility: "mission", allowedMissionIds: [providerContext.missionId!] },
      relatedMission: providerContext.missionId, content: String(index), metadata: {} }, { id: `record-${index}` }))],
    ["duplicate", async (_query: unknown, providerContext: { missionId?: string }) => [0, 1].map(() => item({
      type: "mission.short_term", source: "fixture", confidence: 1, accessPolicy: { visibility: "mission", allowedMissionIds: [providerContext.missionId!] },
      relatedMission: providerContext.missionId, content: "same", metadata: {} }))],
  ] as const) await t.test(name, async () => {
    const bound = binding(provider({ retrieve: retrieve as MemoryProvider["retrieve"] }));
    await assert.rejects(bound.search({ text: "anything", limit: 2 }, context), error => error instanceof MemoryBindingError && error.code === "memory.provider_invalid_response");
  });
});

test("provider cannot mutate host-owned write identity and validated knowledge requires evidence", async () => {
  const bound = binding(provider({ store: async input => ok(item(input, { relatedMission: "foreign.mission" })) }));
  await assert.rejects(bound.write({ scope: "task", content: "Result", metadata: {} }, context),
    error => error instanceof MemoryBindingError && error.code === "memory.provider_identity_mutation");
  await assert.rejects(binding().write({ scope: "global", content: "Claim", metadata: { memoryClass: "validated-knowledge" } }, context),
    error => error instanceof MemoryBindingError && error.code === "memory.knowledge_unvalidated");
});

test("unsupported optional provider operation fails explicitly", async () => {
  await assert.rejects(binding().forget("fixture.record", context),
    error => error instanceof MemoryBindingError && error.code === "memory.operation_unsupported");
});
