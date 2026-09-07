import test from "node:test";
import assert from "node:assert/strict";
import { CompanyTaskScheduler, type CompanyTaskSchedulerOptions } from "./scheduler.js";
import { MissionCompanyPlanner } from "./planner.js";
import { type MissionCompanyRuntime } from "./runtime.js";
import { type MissionCompanyPlanV1 } from "./types.js";

const planFor = () => new MissionCompanyPlanner().plan({ missionId: "scheduler-test", objective: "Research scheduling behavior" });
const schedulerFor = (plan: MissionCompanyPlanV1) => new CompanyTaskScheduler({ get: () => ({ plan }) } as unknown as MissionCompanyRuntime);

test("company scheduler retains request validation before rejecting direct execution", async () => {
  const plan = planFor();
  const scheduler = schedulerFor(plan);
  const invalid: CompanyTaskSchedulerOptions[] = [{ maxConcurrency: NaN }, { maxConcurrency: Infinity }, { maxRetries: NaN }, { maxRetries: 1.5 }, { timeoutMs: NaN }, { timeoutMs: 0 }];
  let calls = 0;
  for (const options of invalid) {
    await assert.rejects(() => scheduler.execute(plan, async () => {
      calls += 1;
      return { evidenceRefs: [] };
    }, options));
  }
  assert.equal(calls, 0);
});

test("company scheduler fails closed without invoking an arbitrary executor or status callback", async () => {
  const plan = planFor();
  const scheduler = schedulerFor(plan);
  let executorCalls = 0;
  let transitionCalls = 0;

  await assert.rejects(() => scheduler.execute(plan, async () => {
    executorCalls += 1;
    return { evidenceRefs: [] };
  }, { onTransition: () => { transitionCalls += 1; } }), /direct execution is unsupported/);

  assert.equal(executorCalls, 0);
  assert.equal(transitionCalls, 0);
});

test("company scheduler rejects cancelled legacy execution instead of manufacturing cancellation state", async () => {
  const plan = planFor();
  const scheduler = schedulerFor(plan);
  const controller = new AbortController();
  controller.abort(new Error("test cancellation"));
  let executorCalls = 0;

  await assert.rejects(() => scheduler.execute(plan, async () => {
    executorCalls += 1;
    return { evidenceRefs: [] };
  }, { signal: controller.signal }), /direct execution is unsupported/);

  assert.equal(executorCalls, 0);
});
