import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryAuditLog } from "./audit-log.js";
import { type QuackEvent } from "../events/event-bus.js";

const makeEvent = (overrides?: Partial<QuackEvent>): QuackEvent => ({
  id: "evt_1",
  type: "task.created",
  timestamp: new Date().toISOString(),
  actor: "test",
  payload: {},
  ...overrides,
});

describe("InMemoryAuditLog", () => {
  it("append adds event", async () => {
    const log = new InMemoryAuditLog();
    const event = makeEvent();
    await log.append(event);
    const events = await log.readAll();
    assert.equal(events.length, 1);
    assert.equal(events[0].id, event.id);
  });

  it("readAll returns all events", async () => {
    const log = new InMemoryAuditLog();
    const e1 = makeEvent({ id: "evt_1" });
    const e2 = makeEvent({ id: "evt_2" });
    const e3 = makeEvent({ id: "evt_3" });
    await log.append(e1);
    await log.append(e2);
    await log.append(e3);
    const events = await log.readAll();
    assert.equal(events.length, 3);
  });

  it("maintains order", async () => {
    const log = new InMemoryAuditLog();
    const e1 = makeEvent({ id: "first" });
    const e2 = makeEvent({ id: "second" });
    const e3 = makeEvent({ id: "third" });
    await log.append(e1);
    await log.append(e2);
    await log.append(e3);
    const events = await log.readAll();
    assert.equal(events[0].id, "first");
    assert.equal(events[1].id, "second");
    assert.equal(events[2].id, "third");
  });
});
