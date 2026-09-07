import test from "node:test";
import assert from "node:assert/strict";
import { GovernedHookExecutor, type GovernedHook } from "./hooks.js";
import type { CapabilityBroker, CapabilityDecision, CapabilityRequest } from "../security/capability-broker.js";

class FixedBroker implements CapabilityBroker {
  readonly requests: CapabilityRequest[] = [];

  constructor(private readonly granted: boolean) {}

  async resolve(request: CapabilityRequest): Promise<CapabilityDecision> {
    this.requests.push(request);
    return { requestId: request.id, capabilityId: request.capabilityId, granted: this.granted, reason: this.granted ? "allowed" : "denied by fixture" };
  }
}

function hook(overrides: Partial<GovernedHook> = {}): GovernedHook {
  return {
    pluginId: "fixture.plugin", pluginVersion: "1.0.0", kind: "tool", permissions: ["workspace.read"],
    handler: () => undefined, ...overrides,
  };
}

test("a governed hook executes only after capability resolution and records provenance", async () => {
  const broker = new FixedBroker(true);
  const executor = new GovernedHookExecutor(broker);
  const seen: JsonObject[] = [];
  const record = await executor.dispatch(hook({ handler: (event) => { seen.push(event); } }), { taskId: "task-1" },
    { missionId: "mission-1", taskId: "task-1", actor: "observer" });

  assert.equal(record.status, "EXECUTED");
  assert.equal(record.pluginId, "fixture.plugin");
  assert.equal(record.pluginVersion, "1.0.0");
  assert.equal(record.kind, "tool");
  assert.equal(record.missionId, "mission-1");
  assert.equal(record.taskId, "task-1");
  assert.equal(record.actor, "observer");
  assert.equal(broker.requests.length, 1);
  assert.equal(broker.requests[0].capabilityId, "permission.workspace.read");
  assert.equal(broker.requests[0].missionId, "mission-1");
  assert.equal(seen.length, 1);
});

test("a denied hook never contacts the handler and records DENIED", async () => {
  const broker = new FixedBroker(false);
  const executor = new GovernedHookExecutor(broker);
  let calls = 0;
  const record = await executor.dispatch(hook({ handler: () => { calls += 1; } }), { taskId: "task-1" }, { missionId: "mission-1" });

  assert.equal(record.status, "DENIED");
  assert.equal(record.reason, "denied by fixture");
  assert.equal(calls, 0);
  assert.equal(broker.requests.length, 1);
});

test("every declared permission must resolve; one denial fails closed", async () => {
  const resolved: string[] = [];
  const broker = new class extends FixedBroker {
    override async resolve(request: CapabilityRequest): Promise<CapabilityDecision> {
      const decision = await super.resolve(request);
      resolved.push(request.permission!);
      if (resolved.length > 1) return { ...decision, granted: false, reason: "second denied" };
      return decision;
    }
  }(true);
  const executor = new GovernedHookExecutor(broker);
  let calls = 0;
  const record = await executor.dispatch(hook({ permissions: ["workspace.read", "memory.read"], handler: () => { calls += 1; } }), {}, {});

  assert.equal(record.status, "DENIED");
  assert.equal(record.reason, "second denied");
  assert.equal(calls, 0);
  assert.deepEqual(resolved, ["workspace.read", "memory.read"]);
});

test("a hook receives a frozen event payload and cannot mutate host data", async () => {
  const executor = new GovernedHookExecutor(new FixedBroker(true));
  const event = { taskId: "task-1", nested: { value: 1 } };
  let captured: unknown;
  const record = await executor.dispatch(hook({ handler: (payload) => {
    captured = payload;
    assert.throws(() => { (payload as { taskId: string }).taskId = "mutated"; }, TypeError);
  } }), event, {});

  assert.equal(record.status, "EXECUTED");
  assert.ok(Object.isFrozen(captured));
  assert.ok(Object.isFrozen((captured as { nested: object }).nested));
  assert.equal((event as { taskId: string }).taskId, "task-1");
});

test("hook timeout fails deterministically without crashing the host", async () => {
  const executor = new GovernedHookExecutor(new FixedBroker(true), { timeoutMs: 20 });
  const record = await executor.dispatch(hook({ handler: () => new Promise(() => undefined) }), {}, {});
  assert.equal(record.status, "TIMED_OUT");
  assert.match(record.reason, /timed out after 20ms/);
});

test("hook handler failure is recorded as FAILED and contained", async () => {
  const executor = new GovernedHookExecutor(new FixedBroker(true));
  const record = await executor.dispatch(hook({ handler: () => { throw new Error("plugin bug"); } }), {}, {});
  assert.equal(record.status, "FAILED");
  assert.equal(record.reason, "plugin bug");
});

test("cancelled hooks never run the handler", async () => {
  const executor = new GovernedHookExecutor(new FixedBroker(true));
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const record = await executor.dispatch(hook({ handler: () => { calls += 1; } }), {},
    { signal: controller.signal });
  assert.equal(record.status, "CANCELLED");
  assert.equal(calls, 0);
});

test("expired hook deadline never runs the handler", async () => {
  const executor = new GovernedHookExecutor(new FixedBroker(true));
  let calls = 0;
  const record = await executor.dispatch(hook({ handler: () => { calls += 1; } }), {},
    { deadline: "2000-01-01T00:00:00.000Z" });
  assert.equal(record.status, "CANCELLED");
  assert.match(record.reason, /deadline expired/);
  assert.equal(calls, 0);
});

test("dispatchAll filters by kind and preserves registration order", async () => {
  const executor = new GovernedHookExecutor(new FixedBroker(true));
  const order: string[] = [];
  const hooks: GovernedHook[] = [
    hook({ pluginId: "fixture.a", kind: "runtime", handler: () => { order.push("a"); } }),
    hook({ pluginId: "fixture.b", kind: "tool", handler: () => { order.push("b"); } }),
    hook({ pluginId: "fixture.c", kind: "tool", handler: () => { order.push("c"); } }),
  ];
  const records = await executor.dispatchAll(hooks, "tool", {}, {});
  assert.deepEqual(order, ["b", "c"]);
  assert.equal(records.length, 2);
  assert.equal(records[0].pluginId, "fixture.b");
  assert.equal(records[1].pluginId, "fixture.c");
});

test("attempted authority escalation: hooks never receive host registries or brokers", async () => {
  const executor = new GovernedHookExecutor(new FixedBroker(true));
  const record = await executor.dispatch(hook({ handler: (event) => {
    const keys = Object.keys(event);
    assert.equal(keys.length, 1);
    assert.equal(keys[0], "taskId");
  } }), { taskId: "task-1" }, {});

  assert.equal(record.status, "EXECUTED");
});

type JsonObject = Record<string, unknown>;