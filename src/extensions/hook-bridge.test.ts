import test from "node:test";
import assert from "node:assert/strict";
import { EventBus } from "../events/event-bus.js";
import { RuntimeHookBridge, CANONICAL_HOOK_WIRINGS } from "./hook-bridge.js";
import type { GovernedHook, HookDispatchRecord } from "./hooks.js";
import type { CapabilityBroker, CapabilityDecision, CapabilityRequest } from "../security/capability-broker.js";

class FixedBroker implements CapabilityBroker {
  constructor(private readonly granted: boolean) {}
  async resolve(request: CapabilityRequest): Promise<CapabilityDecision> {
    return { requestId: request.id, capabilityId: request.capabilityId, granted: this.granted, reason: this.granted ? "allowed" : "denied" };
  }
}

test("runtime events dispatch matching admitted hooks in registration order with provenance", async () => {
  const events = new EventBus();
  const order: string[] = [];
  const records: HookDispatchRecord[] = [];
  const hooks: GovernedHook[] = [
    { pluginId: "plugin.first", pluginVersion: "1.0.0", kind: "tool", permissions: [], handler: () => { order.push("first"); } },
    { pluginId: "plugin.second", pluginVersion: "1.0.0", kind: "tool", permissions: [], handler: () => { order.push("second"); } },
    { pluginId: "plugin.mission", pluginVersion: "1.0.0", kind: "mission", permissions: [], handler: () => { order.push("mission"); } },
  ];
  const bridge = new RuntimeHookBridge({ eventBus: events, capabilityBroker: new FixedBroker(true), hooks,
    onDispatchRecord: record => records.push(record) });

  await events.emit("tool.requested", { toolId: "fixture.tool" }, { taskId: "task-1", actor: "observer" });
  await events.emit("task.completed", { summary: "done" }, { taskId: "task-1", actor: "runtime" });

  bridge.stop();
  assert.deepEqual(order, ["first", "second", "mission"]);
  assert.equal(records.length, 3);
  assert.ok(records.every(record => record.status === "EXECUTED"));
  assert.equal(records[0].pluginId, "plugin.first");
  assert.equal(records[0].kind, "tool");
  assert.equal(records[0].taskId, "task-1");
  assert.equal(records[0].actor, "observer");
  assert.equal(records[2].kind, "mission");
});

test("denied hooks never run and denial is contained", async () => {
  const events = new EventBus();
  let calls = 0;
  const hooks: GovernedHook[] = [
    { pluginId: "plugin.denied", pluginVersion: "1.0.0", kind: "tool", permissions: ["workspace.read"], handler: () => { calls += 1; } },
  ];
  const bridge = new RuntimeHookBridge({ eventBus: events, capabilityBroker: new FixedBroker(false), hooks });
  await events.emit("tool.requested", { toolId: "fixture.tool" }, { taskId: "task-1", actor: "observer" });
  bridge.stop();

  assert.equal(calls, 0);
  const [record] = bridge.listRecords();
  assert.ok(record);
  assert.equal(record.status, "DENIED");
});

test("failing hooks are contained and do not break event flow", async () => {
  const events = new EventBus();
  const hooks: GovernedHook[] = [
    { pluginId: "plugin.broken", pluginVersion: "1.0.0", kind: "mission", permissions: [], handler: () => { throw new Error("hook bug"); } },
    { pluginId: "plugin.healthy", pluginVersion: "1.0.0", kind: "mission", permissions: [], handler: () => undefined },
  ];
  const bridge = new RuntimeHookBridge({ eventBus: events, capabilityBroker: new FixedBroker(true), hooks });

  // The emit itself must not reject even though a hook threw.
  await events.emit("task.started", { taskId: "task-1" }, { taskId: "task-1", actor: "runtime" });
  bridge.stop();

  const statuses = bridge.listRecords().map(record => record.status);
  assert.deepEqual(statuses.sort(), ["EXECUTED", "FAILED"]);
});

test("hook payloads are frozen and hooks observe only event data", async () => {
  const events = new EventBus();
  let observed: Record<string, unknown> | undefined;
  const hooks: GovernedHook[] = [
    { pluginId: "plugin.observer", pluginVersion: "1.0.0", kind: "tool", permissions: [], handler: payload => {
      observed = payload as Record<string, unknown>;
      assert.throws(() => { (payload as Record<string, unknown>)["toolId"] = "mutated"; }, TypeError);
    } },
  ];
  const bridge = new RuntimeHookBridge({ eventBus: events, capabilityBroker: new FixedBroker(true), hooks });
  await events.emit("tool.requested", { toolId: "fixture.tool" }, { taskId: "task-1", actor: "observer" });
  bridge.stop();

  assert.ok(observed);
  assert.equal(observed["toolId"], "fixture.tool");
});

test("bridge stop() detaches all listeners", async () => {
  const events = new EventBus();
  let calls = 0;
  const hooks: GovernedHook[] = [
    { pluginId: "plugin.stopped", pluginVersion: "1.0.0", kind: "mission", permissions: [], handler: () => { calls += 1; } },
  ];
  const bridge = new RuntimeHookBridge({ eventBus: events, capabilityBroker: new FixedBroker(true), hooks });
  bridge.stop();
  await events.emit("task.created", { taskId: "task-1" }, { taskId: "task-1" });
  assert.equal(calls, 0);
  assert.equal(bridge.listRecords().length, 0);
});

test("canonical wirings cover mission, tool, capability, and memory hook kinds", () => {
  const kinds = new Set(CANONICAL_HOOK_WIRINGS.map(wiring => wiring.hookKind));
  assert.ok(kinds.has("mission"));
  assert.ok(kinds.has("tool"));
  assert.ok(kinds.has("capability"));
  assert.ok(kinds.has("memory"));
});