import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { QUACK_CONTRACT_VERSION, type ActionDescriptorV1, type ActionProviderV1, type ExecutionContextV1 } from "../contracts/index.js";
import { createSqliteStorage } from "../storage/sqlite.js";
import { removeTestDirectory } from "../test-support/isolated-system.js";
import { createPlannedActionRecord, transitionActionRecord } from "./ledger.js";
import { ActionProviderRegistry, ActionRuntime, type ActionAuditEvent } from "./runtime.js";

const context: ExecutionContextV1 = {
  contractVersion: QUACK_CONTRACT_VERSION,
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
  actor: "tester",
};

test("action runtime validates schema before provider side effects", async () => {
  const provider = new FakeActionProvider(readDescriptor());
  const runtime = createRuntime(provider);
  const result = await runtime.execute("fake", { actionId: "read", input: {} }, context);
  assert.equal(result.status, "DENIED");
  assert.equal(provider.executions, 0);
});

test("high-risk actions fail closed without an approver", async () => {
  const provider = new FakeActionProvider(writeDescriptor());
  const runtime = createRuntime(provider);
  const result = await runtime.execute("fake", {
    actionId: "send",
    input: { message: "hello" },
    idempotencyKey: "once",
  }, context);
  assert.equal(result.status, "DENIED");
  assert.match(String(result.output?.["reason"]), /no approver/i);
  assert.equal(provider.executions, 0);
});

test("approved write executes once and returns cached idempotent result", async () => {
  const provider = new FakeActionProvider(writeDescriptor());
  const audits: ActionAuditEvent[] = [];
  const registry = new ActionProviderRegistry();
  registry.register(provider);
  const runtime = new ActionRuntime(registry, {
    decidePermission: async () => ({ allowed: true, reason: "test" }),
    requestApproval: async () => ({ approved: true, actor: "human", reason: "approved" }),
    audit: (event) => { audits.push(event); },
  });
  const request = { actionId: "send", input: { message: "hello" }, idempotencyKey: "once" } as const;
  const first = await runtime.execute("fake", request, context);
  const second = await runtime.execute("fake", request, { ...context, executionId: "execution-2" });
  assert.equal(first.status, "SUCCEEDED");
  assert.deepEqual(second, first);
  assert.equal(provider.executions, 1);
  assert.ok(audits.some((event) => event.phase === "APPROVED"));
  assert.ok(audits.some((event) => event.phase === "SUCCEEDED"));
});

test("durable ledger prevents duplicate writes across process recreation", async () => {
  const dataDir = join(tmpdir(), createId("quack_action_ledger"));
  try {
    const storage = createSqliteStorage(join(dataDir, "quack.sqlite"));
    const provider = new FakeActionProvider(writeDescriptor());
    const request = { actionId: "send", input: { message: "hello" }, idempotencyKey: "durable-once" } as const;
    const first = runtimeWithLedger(provider, storage.actionExecutions);
    const firstResult = await first.execute("fake", request, context);
    const restarted = runtimeWithLedger(provider, createSqliteStorage(join(dataDir, "quack.sqlite")).actionExecutions);
    const replay = await restarted.execute("fake", request, { ...context, executionId: "execution-after-restart" });
    assert.equal(firstResult.status, "SUCCEEDED");
    assert.deepEqual(replay, firstResult);
    assert.equal(provider.executions, 1);
  } finally {
    await removeTestDirectory(dataDir);
  }
});

test("ambiguous persisted write is blocked when provider cannot reconcile", async () => {
  const dataDir = join(tmpdir(), createId("quack_action_ambiguous"));
  try {
    const storage = createSqliteStorage(join(dataDir, "quack.sqlite"));
    const provider = new FakeActionProvider(writeDescriptor());
    const request = { actionId: "send", input: { message: "hello" }, idempotencyKey: "ambiguous-once" } as const;
    const planned = createPlannedActionRecord(writeDescriptor(), request, "crashed-execution", context.missionId);
    await storage.actionExecutions.save(transitionActionRecord(planned, "EXECUTING", { startedAt: new Date().toISOString() }));
    const result = await runtimeWithLedger(provider, storage.actionExecutions).execute("fake", request, context);
    assert.equal(result.status, "FAILED");
    assert.match(String(result.output?.["error"]), /cannot reconcile/i);
    assert.equal(provider.executions, 0);
    assert.equal((await storage.actionExecutions.get("crashed-execution"))?.state, "UNKNOWN_EXTERNAL_STATE");
  } finally {
    await removeTestDirectory(dataDir);
  }
});

function createRuntime(provider: ActionProviderV1): ActionRuntime {
  const registry = new ActionProviderRegistry();
  registry.register(provider);
  return new ActionRuntime(registry, {
    decidePermission: async () => ({ allowed: true, reason: "test" }),
  });
}

function runtimeWithLedger(provider: ActionProviderV1, ledger: import("./ledger.js").ActionExecutionLedger): ActionRuntime {
  const registry = new ActionProviderRegistry();
  registry.register(provider);
  return new ActionRuntime(registry, {
    ledger,
    decidePermission: async () => ({ allowed: true, reason: "test" }),
    requestApproval: async () => ({ approved: true, actor: "owner", reason: "approved", approvalId: "approval-1" }),
  });
}
function readDescriptor(): ActionDescriptorV1 {
  return {
    contractVersion: QUACK_CONTRACT_VERSION,
    id: "read",
    providerId: "fake",
    name: "Read",
    description: "Read a value",
    inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false },
    riskClass: "READ_ONLY",
    sideEffect: "read",
    externalCommunication: false,
    financialImpact: false,
    authenticationScopes: [],
    requiredPermissions: ["workspace.read"],
    idempotent: true,
    supportsDryRun: true,
    supportsCompensation: false,
    timeoutMs: 1_000,
    dataClassification: "internal",
    networkRequirements: [],
    approval: "NEVER",
  };
}

function writeDescriptor(): ActionDescriptorV1 {
  return {
    ...readDescriptor(),
    id: "send",
    name: "Send",
    description: "Send a message",
    inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false },
    riskClass: "EXTERNAL_COMMUNICATION",
    sideEffect: "write",
    externalCommunication: true,
    requiredPermissions: ["external.write"],
    idempotent: false,
    supportsDryRun: false,
    approval: "POLICY",
  };
}

class FakeActionProvider implements ActionProviderV1 {
  executions = 0;
  constructor(private readonly descriptor: ActionDescriptorV1) {}
  metadata() { return { contractVersion: QUACK_CONTRACT_VERSION, providerId: "fake", displayName: "Fake", transport: "local", boundary: "local" } as const; }
  async health() { return { status: "HEALTHY", checkedAt: new Date().toISOString() } as const; }
  async discoverActions() { return [this.descriptor]; }
  async execute(request: { readonly actionId: string }, execution: ExecutionContextV1) {
    this.executions += 1;
    return { executionId: execution.executionId, providerId: "fake", actionId: request.actionId, status: "SUCCEEDED", output: { ok: true }, evidenceIds: [] } as const;
  }
}
