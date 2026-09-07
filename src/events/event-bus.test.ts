import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { EventBus } from "./event-bus.js";

describe("EventBus", () => {
  it("emit calls registered handlers", async () => {
    const bus = new EventBus();
    const handler = mock.fn();
    bus.on("task.created", handler);
    await bus.emit("task.created", { text: "hello" });
    assert.equal(handler.mock.callCount(), 1);
  });

  it("onAny catches all events", async () => {
    const bus = new EventBus();
    const handler = mock.fn();
    bus.onAny(handler);
    await bus.emit("task.created", { text: "a" });
    await bus.emit("task.completed", { text: "b" });
    assert.equal(handler.mock.callCount(), 2);
  });

  it("off removes a handler", async () => {
    const bus = new EventBus();
    const handler = mock.fn();
    const off = bus.on("task.created", handler);
    off();
    await bus.emit("task.created", { text: "x" });
    assert.equal(handler.mock.callCount(), 0);
  });

  it("multiple handlers for same event type", async () => {
    const bus = new EventBus();
    const h1 = mock.fn();
    const h2 = mock.fn();
    bus.on("task.created", h1);
    bus.on("task.created", h2);
    await bus.emit("task.created", { text: "both" });
    assert.equal(h1.mock.callCount(), 1);
    assert.equal(h2.mock.callCount(), 1);
  });

  it("handler receives correct event data", async () => {
    const bus = new EventBus();
    const handler = mock.fn();
    bus.on("task.created", handler);
    const event = await bus.emit("task.created", { text: "data" }, { actor: "test-user", taskId: "t-1" });
    assert.equal(event.type, "task.created");
    assert.deepEqual(event.payload, { text: "data" });
    assert.equal(event.actor, "test-user");
    assert.equal(event.taskId, "t-1");
    assert.ok(event.id);
    assert.ok(event.timestamp);
  });

  it("offAny removes all-catch handler", async () => {
    const bus = new EventBus();
    const handler = mock.fn();
    const off = bus.onAny(handler);
    off();
    await bus.emit("task.created", { text: "x" });
    assert.equal(handler.mock.callCount(), 0);
  });

  it("drain waits for fire-and-forget listener work", async () => {
    const bus = new EventBus();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    bus.on("task.created", async () => blocked);

    void bus.emit("task.created", { text: "pending" });
    let drained = false;
    const wait = bus.drain().then(() => { drained = true; });
    await Promise.resolve();
    assert.equal(drained, false);

    release();
    await wait;
    assert.equal(drained, true);
  });
});
