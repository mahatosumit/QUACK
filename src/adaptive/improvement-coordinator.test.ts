import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuackSystem } from "../distributions/swe-system.js";
import { type ImprovementCoordinatorConfig, type ImprovementTriggerContext } from "./improvement-coordinator.js";

async function fixture(t: TestContext, improvement: Partial<ImprovementCoordinatorConfig> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "quack-improvement-test-"));
  // Drain async event sinks (audit writer) before cleanup: appends race
  // directory removal on Windows otherwise (ENOTEMPTY).
  t.after(async () => { await system.events.drain(); await rm(dataDir, { recursive: true, force: true }); });
  const system = createQuackSystem({ dataDir, improvement: {
    enabled: true, autoEvaluate: true, minimumEvidence: 3, cooldownMs: 0, ...improvement,
  } });
  const events: string[] = [];
  const detach = system.events.onAny(event => { events.push(event.type); });
  t.after(detach);
  return { system, events };
}

const completed: ImprovementTriggerContext = {
  taskId: "verified-test-task", missionId: "verified-test-mission", origin: "user",
  actor: "test", goal: "Evaluate the recorded test evidence", evidenceCount: 3,
};

for (const [label, config, context, reason] of [
  ["disabled", { enabled: false }, completed, "improvement.disabled"],
  ["automatic evaluation disabled", { autoEvaluate: false }, completed, "improvement.autoEvaluate.disabled"],
  ["insufficient evidence", { minimumEvidence: 4 }, completed, "evidence.below.minimum"],
  ["improvement-origin work", {}, { ...completed, origin: "improvement" }, "recursion.guard"],
] as const) {
  test(`coordinator skips ${label} without starting an improvement cycle`, async t => {
    const { system, events } = await fixture(t, config);
    const eligibility = system.improvementCoordinator.evaluateEligibility(context);
    assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.reasons.some(value => value.startsWith(reason)));
    await system.improvementCoordinator.onMissionCompleted(context);
    assert.ok(events.includes("improvement.eligibility_checked"));
    assert.ok(events.includes("improvement.skipped"));
    assert.ok(!events.includes("improvement.started"));
  });
}

test("eligible completion runs the real bounded cycle and records its checkpoint", async t => {
  const { system, events } = await fixture(t, { cooldownMs: 60000 });
  await system.improvementCoordinator.onMissionCompleted(completed);
  assert.ok(events.includes("improvement.started"));
  assert.ok(events.includes("improvement.cycle.completed"));
  assert.ok(events.includes("improvement.completed"));
  assert.ok(system.improvementCoordinator.getLastCycleAt());
  assert.ok(!events.includes("proposal.created"), "empty evidence store must not invent proposals");
  const next = system.improvementCoordinator.evaluateEligibility(completed);
  assert.equal(next.eligible, false);
  assert.ok(next.reasons.some(reason => reason.startsWith("cooldown.active")));
});

test("cycle failure is recorded without throwing from the completion hook", async t => {
  const { system, events } = await fixture(t);
  t.mock.method(system.improvementCycle, "runImprovementCycle", async () => { throw new Error("test cycle failure"); });
  await assert.doesNotReject(() => system.improvementCoordinator.onMissionCompleted(completed));
  assert.ok(events.includes("improvement.failed"));
  assert.ok(!events.includes("improvement.completed"));
  assert.equal(system.improvementCoordinator.getLastCycleAt(), undefined);
});

test("a mission without an executor cannot trigger the verified-completion hook", async t => {
  // workflowVerification: "none" keeps this fixture in the no-verifier
  // state: without a certification path the mission must fail closed and
  // the improvement loop must never observe a completion.
  const dataDir = await mkdtemp(join(tmpdir(), "quack-improvement-none-"));
  t.after(async () => { await system.events.drain(); await rm(dataDir, { recursive: true, force: true }); });
  const system = createQuackSystem({ dataDir, workflowVerification: "none", improvement: {
    enabled: true, autoEvaluate: true, minimumEvidence: 0, cooldownMs: 0,
  } });
  const events: string[] = [];
  const detach = system.events.onAny(event => { events.push(event.type); });
  t.after(detach);
  const result = await system.runtime.submitGoal("Unimplemented arbitrary work", "test");
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "failed");
  assert.ok(!events.includes("improvement.eligibility_checked"));
  assert.ok(!events.includes("improvement.started"));
});
