import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { now } from "../core/types.js";
import { EventBus } from "../events/event-bus.js";
import { InMemoryCodeExperimentStore, CodeImprovementController } from "../selfmod/code-improvement-controller.js";
import { ImprovementCoordinator } from "./improvement-coordinator.js";
import { ImprovementProposalBridge } from "./improvement-proposal-bridge.js";
import { type ImprovementCycleResult, type ImprovementReviewItem } from "./evidence-improvement-cycle.js";

function actionableReview(): ImprovementReviewItem {
  const timestamp = now();
  return {
    id: "review-1",
    key: "review-1",
    kind: "degraded_skill",
    status: "queued",
    objectiveId: "objective-1",
    priority: 1,
    risk: "REQUIRES_APPROVAL",
    evidenceRefs: ["evidence-1"],
    experimentIds: [],
    reason: "Observed a reproducible code-level failure.",
    retries: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    codeProposal: {
      sourceEvidenceRefs: ["evidence-1"],
      hypothesis: "The bounded implementation change removes the observed failure.",
      targetScope: ["src/app.ts"],
      expectedFiles: ["src/app.ts"],
      description: "Update the bounded implementation in src/app.ts.",
    },
  };
}

function cycleResult(items: readonly ImprovementReviewItem[]): ImprovementCycleResult {
  const timestamp = now();
  return {
    cycleId: "cycle-1",
    processedExperienceIds: ["evidence-1"],
    reviewItemsCreated: items,
    experimentsQueued: [],
    experimentsCompleted: [],
    decisions: [],
    checkpoint: { processedExperienceIds: ["evidence-1"], reviewItems: items, running: false, lastCycleAt: timestamp },
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "quack-bridge-"));
  const events = new EventBus();
  let toolCalls = 0;
  const controller = new CodeImprovementController({
    workspaceRoot: root,
    store: new InMemoryCodeExperimentStore(),
    events,
    toolExecute: async () => {
      toolCalls += 1;
      throw new Error("a pending proposal must not invoke tools");
    },
  });
  const bridge = new ImprovementProposalBridge({ controller });
  return { root, events, controller, bridge, getToolCalls: () => toolCalls };
}

test("A/B: eligible improvement output persists an awaiting-approval proposal without source mutation", async () => {
  const fixture = await setup();
  try {
    const file = join(fixture.root, "app.ts");
    await writeFile(file, "export const value = 1;\n", "utf8");
    const seen: string[] = [];
    fixture.events.onAny((event) => { seen.push(event.type); });

    const result = await fixture.bridge.createPendingProposals([actionableReview()], {
      taskId: "mission-1",
      missionId: "mission-1",
      origin: "user",
    });

    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposals[0]?.status, "PROPOSED");
    assert.equal((await fixture.controller.listExperiments()).length, 1);
    assert.equal(await readFile(file, "utf8"), "export const value = 1;\n");
    assert.equal(fixture.getToolCalls(), 0);
    assert.ok(seen.includes("proposal.awaiting_approval"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("C: vague or non-code improvement output creates no code proposal", async () => {
  const fixture = await setup();
  try {
    const review = { ...actionableReview(), codeProposal: undefined };
    const result = await fixture.bridge.createPendingProposals([review], { taskId: "mission-2", origin: "user" });
    assert.equal(result.proposals.length, 0);
    assert.equal(result.skipped, 1);
    assert.equal((await fixture.controller.listExperiments()).length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("D/E: explicit approval is required and rejection remains mutation-free", async () => {
  const fixture = await setup();
  try {
    const queued = await fixture.bridge.createPendingProposals([actionableReview()], { taskId: "mission-3", origin: "user" });
    const proposal = queued.proposals[0];
    assert.ok(proposal);
    if (!proposal) return;

    const beforeApproval = await fixture.controller.materializeApprovedProposal(proposal.id, [{ path: "src/app.ts", content: "changed" }]);
    assert.equal(beforeApproval.ok, false);
    const rejected = await fixture.controller.recordPendingProposalDecision({ experimentId: proposal.id, decision: "REJECT", actor: "human-reviewer" });
    assert.equal(rejected.ok, true);
    const afterRejection = await fixture.controller.materializeApprovedProposal(proposal.id, [{ path: "src/app.ts", content: "changed" }]);
    assert.equal(afterRejection.ok, false);
    assert.equal(fixture.getToolCalls(), 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("H: improvement-originated output cannot recursively create another proposal", async () => {
  const fixture = await setup();
  try {
    const result = await fixture.bridge.createPendingProposals([actionableReview()], { taskId: "mission-4", origin: "improvement" });
    assert.equal(result.proposals.length, 0);
    assert.equal((await fixture.controller.listExperiments()).length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("I: improvement-cycle failure is contained and does not escape mission completion", async () => {
  const fixture = await setup();
  try {
    const events: string[] = [];
    fixture.events.onAny((event) => { events.push(event.type); });
    const coordinator = new ImprovementCoordinator({
      events: fixture.events,
      experiences: {} as never,
      fitness: {} as never,
      skills: {} as never,
      config: { enabled: true, autoEvaluate: true, minimumEvidence: 1, cooldownMs: 0 },
      improvementCycle: { runImprovementCycle: async () => { throw new Error("cycle unavailable"); } } as never,
      proposalBridge: fixture.bridge,
    });

    await assert.doesNotReject(async () => coordinator.onMissionCompleted({ taskId: "mission-5", origin: "user", actor: "user", goal: "complete", evidenceCount: 1 }));
    assert.ok(events.includes("improvement.failed"));
    assert.equal((await fixture.controller.listExperiments()).length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("A: eligible mission coordinator sends actionable cycle output through the bridge", async () => {
  const fixture = await setup();
  try {
    const coordinator = new ImprovementCoordinator({
      events: fixture.events,
      experiences: {} as never,
      fitness: {} as never,
      skills: {} as never,
      config: { enabled: true, autoEvaluate: true, minimumEvidence: 1, cooldownMs: 0 },
      improvementCycle: { runImprovementCycle: async () => cycleResult([actionableReview()]) } as never,
      proposalBridge: fixture.bridge,
    });
    await coordinator.onMissionCompleted({ taskId: "mission-6", origin: "user", actor: "user", goal: "complete", evidenceCount: 1 });
    const records = await fixture.controller.listExperiments();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.status, "PROPOSED");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
