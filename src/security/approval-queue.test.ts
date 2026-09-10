import test from "node:test";
import assert from "node:assert/strict";
import { QueuedApprovalCallback } from "./approval-queue.js";
import { EventBus } from "../events/event-bus.js";
import type { JsonObject } from "../core/types.js";

test("queued approvals park requests and resolve on human decision", async () => {
  const queue = new QueuedApprovalCallback({ ttlMs: 60_000 });
  const pending = queue.requestApproval("Actor requests terminal.execute.", { missionId: "m1" } as JsonObject);
  const listed = queue.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].state, "PENDING");
  assert.equal(listed[0].prompt, "Actor requests terminal.execute.");

  const decision = await queue.decide(listed[0].id, { approved: true, decidedBy: "operator" });
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.data.approved, true);
  assert.equal(await pending, true, "the parked promise resolves with the human verdict");

  // Already-decided id fails closed.
  const replay = await queue.decide(listed[0].id, { approved: false, decidedBy: "attacker" });
  assert.equal(replay.ok, false);
  assert.equal(!replay.ok && replay.error.code, "approval.not_pending");
  assert.equal(await pending, true, "a replayed decision cannot flip the resolved verdict");
});

test("deny decisions resolve parked requests as denied", async () => {
  const queue = new QueuedApprovalCallback();
  const pending = queue.requestApproval("Actor requests git.write.", {});
  const [request] = queue.list();
  const decision = await queue.decide(request.id, { approved: false, decidedBy: "operator", reason: "not today" });
  assert.equal(decision.ok, true);
  assert.equal(await pending, false);
});

test("expired requests deny lazily and never approve after expiry", async () => {
  const queue = new QueuedApprovalCallback({ ttlMs: 5 });
  const pending = queue.requestApproval("Actor requests secrets.write.", {});
  const [request] = queue.list();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const late = await queue.decide(request.id, { approved: true, decidedBy: "operator" });
  assert.equal(late.ok, false);
  assert.equal(!late.ok && late.error.code, "approval.expired");
  assert.equal(await pending, false, "an expired request resolves denied regardless of the attempted approval");
  assert.equal(queue.list().some((entry) => entry.id === request.id && entry.state === "EXPIRED"), true);
});

test("forged and unknown ids fail closed", async () => {
  const queue = new QueuedApprovalCallback();
  void queue.requestApproval("legitimate.", {}); // parked; not awaited — no decision will arrive
  const forged = await queue.decide("approval_forged", { approved: true, decidedBy: "attacker" });
  assert.equal(forged.ok, false);
  assert.equal(!forged.ok && forged.error.code, "approval.not_pending");
});

test("queue capacity denies beyond the hard cap", async () => {
  const queue = new QueuedApprovalCallback();
  // Parked requests stay pending — collect without awaiting.
  for (let i = 0; i < 1000; i++) void queue.requestApproval(`request ${i}`, {});
  assert.equal(await queue.requestApproval("over cap", {}), false, "beyond the cap the queue denies rather than growing unbounded");
});

test("approval events flow through the bound event bus", async () => {
  const events = new EventBus();
  const queue = new QueuedApprovalCallback();
  queue.attach(events);
  const seen: string[] = [];
  events.on("approval.requested", () => { seen.push("requested"); });
  events.on("approval.decided", () => { seen.push("decided"); });

  const pending = queue.requestApproval("Actor requests browser.control.", { missionId: "m-events" });
  const [request] = queue.list();
  await queue.decide(request.id, { approved: true, decidedBy: "operator" });
  assert.equal(await pending, true);
  await events.drain();
  assert.deepEqual(seen, ["requested", "decided"]);
});
