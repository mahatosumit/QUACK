import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedQuackSystem } from "../test-support/isolated-system.js";
import { buildDashboardState } from "./web/index.js";
import type { MissionTrace } from "../harness/types.js";
import type { GovernedInstructionRecord } from "../instruction/records.js";

test("DeveloperDashboard renders agent skill and observability snapshot", async () => {
  const fixture = await createIsolatedQuackSystem();
  const { system } = fixture;
  try {
  await system.events.emit("capability.denied", {
    capabilityId: "permission.workspace.read",
    decision: "denied",
    resource: { kind: "workspace" },
  }, { actor: "test" });
  await system.events.emit("evaluation.completed", { success: false, score: 20 }, { actor: "test" });

  const snapshot = system.dashboard.snapshot();
  assert.ok(snapshot.agentStatus.some((agent) => agent.id === "coding-agent"));
  assert.ok(snapshot.skillExecution.length > 0);
  assert.equal(snapshot.capabilityDecisions.length, 1);
  assert.equal(snapshot.evaluations.length, 1);
  assert.match(system.dashboard.renderText(), /QUACK Developer Dashboard/);
  } finally {
    await fixture.cleanup();
  }
});

test("P8.7 dashboard state aggregates instruction dispatch telemetry from trace records", () => {
  const instructionRecord = (outcome: GovernedInstructionRecord["outcome"], missionId: string): GovernedInstructionRecord => ({
    recordId: `rec-${outcome}-${missionId}`,
    missionId,
    digest: "a".repeat(64),
    planVersion: 1,
    outputContractKind: "plainResponse",
    outcome,
    layerCensus: [{ layer: "identity", itemCount: 1, trusts: ["TRUSTED_RUNTIME"] }],
    totalItems: 1,
    omittedItemCount: 0,
    withinBudget: true,
    injectionFlagCount: 0,
    injectionFlags: [],
    dispatchedAt: new Date().toISOString(),
  });
  const traceWith = (missionId: string, records: readonly GovernedInstructionRecord[]): MissionTrace => ({
    id: `trace-${missionId}`,
    missionInput: { missionId, goal: "instruction telemetry", actor: "test" },
    plansGenerated: [],
    skillsSelected: [],
    capabilitiesRequested: [],
    toolsExecuted: [],
    verificationResults: [],
    iterations: [],
    finalOutcome: { success: true, state: "COMPLETED", latencyMs: 1 },
    events: [],
    instruction: records,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  } as unknown as MissionTrace);

  const state = buildDashboardState({
    missions: [],
    agents: [],
    skills: [],
    evaluations: [],
    events: [],
    traces: [
      traceWith("mission-a", [instructionRecord("dispatched", "mission-a"), instructionRecord("denied", "mission-a")]),
      traceWith("mission-b", [instructionRecord("rejected", "mission-b")]),
      // A mission with no instruction records contributes nothing.
      traceWith("mission-c", []),
    ],
  });

  const instruction = state.harness.instruction;
  assert.equal(instruction.dispatchCount, 3);
  assert.equal(instruction.dispatchedCount, 1);
  assert.equal(instruction.rejectedCount, 1);
  assert.equal(instruction.deniedCount, 1);
  assert.equal(instruction.providerErrorCount, 0);
  assert.equal(instruction.missionCount, 2, "mission-c contributes no instruction identity");
  assert.equal(instruction.injectionFlagCount, 0);
});

test("P8.7 dashboard state reports zero instruction telemetry when no records exist", () => {
  const state = buildDashboardState({
    missions: [],
    agents: [],
    skills: [],
    evaluations: [],
    events: [],
    traces: [],
  });
  assert.deepEqual(state.harness.instruction, {
    dispatchCount: 0,
    dispatchedCount: 0,
    rejectedCount: 0,
    deniedCount: 0,
    providerErrorCount: 0,
    injectionFlagCount: 0,
    missionCount: 0,
  });
});
