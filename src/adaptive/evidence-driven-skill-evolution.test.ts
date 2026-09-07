import { createBuiltinSkillCatalog } from "../skills/builtins/index.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";
import { DeterministicObjectiveEvaluator } from "../cos/deterministic-evaluator.js";
import { InMemoryEvidenceExperienceStore } from "../cos/evidence-experience-store.js";
import { DEFAULT_NO_REGRESSION_OBJECTIVE_ID, ObjectiveRegistry } from "../cos/objectives.js";
import { ToolRegistry, EchoTool } from "../tools/tool.js";
import { WorkspaceListFilesTool } from "../tools/workspace-filesystem.js";
import { TerminalTool } from "../tools/terminal.js";
import { SkillRegistry, SkillLoader } from "../skills/index.js";
import { createAdaptiveLayer } from "./adaptive-layer.js";
import { EvidenceDrivenSkillEvolution, type CandidateSkill, type EvidenceBackedSkillProposal } from "./evidence-driven-skill-evolution.js";
import {
  type EvidenceBackedExperience,
  type MetricObservation,
  type ObjectiveSpecification,
} from "../cos/types.js";

test("failure pattern detection requires enough repeated comparable evidence", async () => {
  const harness = createHarness();
  await seedExperiences(harness.store, [
    experience("run-1", "failed", 2, { error: "contract-impact" }),
  ]);

  assert.equal((await harness.engine.detectFailurePatterns()).length, 0);
});

test("failure pattern detection groups repeated comparable failures and keeps references", async () => {
  const harness = createHarness();
  await seedExperiences(harness.store, [
    experience("run-1", "failed", 2, { error: "contract-impact" }),
    experience("run-2", "failed", 3, { error: "contract-impact" }),
    experience("run-3", "completed", 0),
  ]);

  const patterns = await harness.engine.detectFailurePatterns();
  const pattern = patterns.find((item) => item.dimension === "outcome:task.error:contract-impact");
  assert.ok(pattern);
  assert.equal(pattern.count, 2);
  assert.equal(pattern.comparablePopulation, 3);
  assert.deepEqual([...pattern.supportingExperienceIds].sort(), ["exp-run-1", "exp-run-2"]);
  assert.equal(pattern.status, "actionable");
});

test("failure pattern detection does not merge unrelated failures", async () => {
  const harness = createHarness();
  await seedExperiences(harness.store, [
    experience("run-1", "failed", 2, { error: "contract-impact" }),
    experience("run-2", "failed", 2, { error: "provider-timeout" }),
    experience("run-3", "completed", 0),
  ]);

  const patterns = await harness.engine.detectFailurePatterns();
  assert.equal(patterns.some((item) => item.dimension === "outcome:task.error:contract-impact"), false);
  assert.equal(patterns.some((item) => item.dimension === "outcome:task.error:provider-timeout"), false);
});

test("hypothesis creation preserves supporting and contradictory evidence", async () => {
  const harness = createHarness();
  await seedExperiences(harness.store, [
    experience("run-1", "failed", 2, { skill: "contract-impact-analysis" }),
    experience("run-2", "failed", 3, { skill: "contract-impact-analysis" }),
    experience("run-3", "completed", 0, { skill: "contract-impact-analysis" }),
  ]);

  const pattern = (await harness.engine.detectFailurePatterns()).find((item) => item.dimension === "skill:contract-impact-analysis");
  assert.ok(pattern);
  const hypothesis = harness.engine.createHypothesis(pattern, harness.objective);
  assert.equal(hypothesis.status, "challenged");
  assert.deepEqual([...hypothesis.evidenceFor].sort(), ["exp-run-1", "exp-run-2"]);
  assert.deepEqual(hypothesis.evidenceAgainst, ["exp-run-3"]);
});

test("insufficient pattern evidence does not validate a hypothesis", async () => {
  const harness = createHarness();
  await seedExperiences(harness.store, [
    experience("run-1", "failed", 2, { error: "contract-impact" }),
  ]);
  const patterns = await harness.engine.detectFailurePatterns({ minComparableExperiences: 1, minOccurrences: 2 });
  assert.equal(patterns.length, 0);
});

test("capability gap reuses existing suitable skill instead of proposing duplicate", async () => {
  const harness = createHarness();
  const pattern = samplePattern("dimension:architecture");
  const hypothesis = harness.engine.createHypothesis(pattern, harness.objective);

  const gap = harness.engine.identifyCapabilityGap({
    hypothesis,
    pattern,
    neededBehavior: "architecture dependency graph analysis",
    requiredTools: [],
  });

  assert.equal(gap.status, "covered_by_existing_skill");
  assert.equal(gap.existingSkillsConsidered.some((skill) => skill.skillId === "architecture-review" && skill.sufficient), true);
  assert.equal(harness.engine.proposeSkillFromGap(gap, hypothesis), undefined);
});

test("missing capability creates a gap and evidence-backed skill proposal", async () => {
  const harness = createHarness();
  const pattern = samplePattern("outcome:task.error:contract-impact");
  const hypothesis = harness.engine.createHypothesis(pattern, harness.objective);
  const gap = harness.engine.identifyCapabilityGap({
    hypothesis,
    pattern,
    neededBehavior: "contract impact analysis for exported TypeScript API changes",
    requiredTools: ["core.workspace.list-files"],
  });
  const proposal = harness.engine.proposeSkillFromGap(gap, hypothesis);

  assert.equal(gap.status, "open");
  assert.ok(proposal);
  assert.equal(proposal.supportingEvidence.length, 2);
  assert.equal(proposal.requiredTools[0], "core.workspace.list-files");
});

test("explicit user-request proposal is supported but still unevidenced", () => {
  const proposal = createHarness().engine.proposeSkillFromUser({
    desiredBehavior: "summarize API contract changes",
    requiredTools: ["core.workspace.list-files"],
  });

  assert.equal(proposal.proposedBy, "user");
  assert.equal(proposal.status, "draft");
  assert.equal(proposal.supportingEvidence.length, 0);
});

test("candidate validation accepts a bounded generated skill", () => {
  const harness = createHarness();
  const candidate = harness.engine.createCandidateSkill(sampleProposal(), {
    id: "contract-impact-analysis",
  });

  const validation = harness.engine.validateCandidateSkill(candidate);
  assert.equal(validation.valid, true);
  assert.equal(validation.warnings.some((warning) => warning.includes("untrusted")), true);
});

test("candidate validation rejects malformed skill IDs", () => {
  const harness = createHarness();
  const candidate = harness.engine.createCandidateSkill(sampleProposal(), { id: "Bad Skill" });
  const validation = harness.engine.validateCandidateSkill(candidate);

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /Skill id/);
});

test("candidate validation rejects missing tools and undeclared tool permissions", () => {
  const harness = createHarness();
  const missing = harness.engine.createCandidateSkill({ ...sampleProposal(), requiredTools: ["missing.tool"] });
  assert.match(harness.engine.validateCandidateSkill(missing).errors.join("\n"), /not registered/);

  const privileged = harness.engine.createCandidateSkill({ ...sampleProposal(), requiredTools: ["core.terminal.execute"] }, {
    id: "terminal-backed-candidate",
  });
  assert.match(harness.engine.validateCandidateSkill(privileged).errors.join("\n"), /undeclared permission terminal\.execute/);
});

test("candidate validation rejects prohibited capability and self-authorization", () => {
  const harness = createHarness();
  const candidate = harness.engine.createCandidateSkill(sampleProposal(), {
    id: "policy-mutator",
    requestedCapabilities: ["evaluator.modify", "system-instructions"],
    selfAuthorizedPermissions: ["workspace.write"],
  });

  const errors = harness.engine.validateCandidateSkill(candidate).errors.join("\n");
  assert.match(errors, /self-authorize/);
  assert.match(errors, /evaluator\.modify/);
  assert.match(errors, /system-instructions/);
});

test("candidate validation rejects protected core mutation and active skill overwrite", () => {
  const harness = createHarness();
  const overwrite = harness.engine.createCandidateSkill(sampleProposal(), { id: "architecture-review" });
  assert.match(harness.engine.validateCandidateSkill(overwrite).errors.join("\n"), /already exists/);

  const coreEdit = harness.engine.createCandidateSkill(sampleProposal(), {
    id: "core-editor",
    protectedCoreChanges: ["WorkflowEngine"],
  });
  assert.match(harness.engine.validateCandidateSkill(coreEdit).errors.join("\n"), /protected core/);
});

test("candidate validation rejects nonexistent skill dependencies", () => {
  const harness = createHarness();
  const candidate = withManifest(harness.engine.createCandidateSkill(sampleProposal(), {
    id: "dependency-candidate",
  }), { dependencies: ["missing-skill"] });

  const validation = harness.engine.validateCandidateSkill(candidate);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /dependency missing-skill/);
});

test("versioning preserves parent and does not overwrite active versions", () => {
  const harness = createHarness();
  const proposal = { ...sampleProposal(), parentSkillId: "architecture-review", parentVersion: "1.0.0" };
  const candidate = harness.engine.createCandidateSkill(proposal, {
    id: "contract-impact-analysis",
  });

  assert.equal(candidate.parentVersion, "1.0.0");
  assert.equal(candidate.manifest.version, "1.1.0");
  assert.equal(harness.engine.getCandidateHistory("contract-impact-analysis").length, 1);
  assert.throws(() => harness.engine.promoteCandidate(candidate, {
    id: "bad",
    experimentId: "exp",
    candidateId: candidate.id,
    controlExperienceId: "control",
    candidateExperienceId: "candidate",
    objectiveId: DEFAULT_NO_REGRESSION_OBJECTIVE_ID,
    decision: "REJECT",
    reason: "not promoted",
    results: [],
    evidenceRefs: [],
    createdAt: "2026-08-05T00:00:00.000Z",
  }), /cannot be promoted/);
});

test("control/candidate experiment promotes only improved comparable candidates", () => {
  const harness = createHarness();
  const candidate = validCandidate(harness);
  const result = harness.engine.runControlCandidateExperiment({
    candidate,
    objective: harness.objective,
    baseline: experience("baseline", "completed", 2),
    control: experience("control", "completed", 2, { variantRole: "control" }),
    candidateExperience: experience("candidate", "completed", 0, { variantRole: "candidate" }),
  });

  assert.equal(result.decision, "PROMOTE");
  assert.equal(harness.skills.get("contract-impact-analysis")?.manifest.version, "0.1.0");
  assert.equal(harness.adaptive.experimentManager.getExperiment(result.experimentId)?.winner, "candidate");

  const available = harness.skills.getAll().map((record) => harness.skills.get(record.id)!);
  const contextualPlan = harness.skills.planForGoal("write markdown documentation", available);
  assert.equal(contextualPlan.skills.some((skill) => skill.skillId === "contract-impact-analysis"), false);
});

test("control/candidate experiment rejects regressions", () => {
  const harness = createHarness();
  const candidate = validCandidate(harness);
  const result = harness.engine.runControlCandidateExperiment({
    candidate,
    objective: harness.objective,
    baseline: experience("baseline", "completed", 0),
    control: experience("control", "completed", 0, { variantRole: "control" }),
    candidateExperience: experience("candidate", "completed", 2, { variantRole: "candidate" }),
  });

  assert.equal(result.decision, "REJECT");
  assert.equal(harness.skills.get("contract-impact-analysis"), undefined);
  assert.equal(harness.engine.getCandidateHistory("contract-impact-analysis").length, 1);
});

test("control/candidate experiment collects more data for insufficient evidence", () => {
  const harness = createHarness();
  const result = harness.engine.runControlCandidateExperiment({
    candidate: validCandidate(harness),
    objective: harness.objective,
    control: experience("control", "completed", 0, { variantRole: "control" }),
    candidateExperience: experience("candidate", "completed", 0, { variantRole: "candidate" }),
  });

  assert.equal(result.decision, "COLLECT_MORE_DATA");
});

test("control/candidate experiment does not promote inconclusive candidates", () => {
  const harness = createHarness();
  const candidateExperience = withInvalidObservation(experience("candidate", "completed", 0, { variantRole: "candidate" }));
  const result = harness.engine.runControlCandidateExperiment({
    candidate: validCandidate(harness),
    objective: harness.objective,
    baseline: experience("baseline", "completed", 0),
    control: experience("control", "completed", 0, { variantRole: "control" }),
    candidateExperience,
  });

  assert.equal(result.decision, "REQUIRE_HUMAN_REVIEW");
  assert.equal(harness.skills.get("contract-impact-analysis"), undefined);
});

test("experiment requires control and candidate attribution", () => {
  const harness = createHarness();
  const result = harness.engine.runControlCandidateExperiment({
    candidate: validCandidate(harness),
    objective: harness.objective,
    baseline: experience("baseline", "completed", 0),
    control: experience("control", "completed", 0),
    candidateExperience: experience("candidate", "completed", 0, { variantRole: "candidate" }),
  });

  assert.equal(result.decision, "REQUIRE_HUMAN_REVIEW");
  assert.match(result.reason, /control variant/);
});

test("production integration links experience store to pattern, candidate, experiment, and registry", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_adaptive_workspace"));
  const dataDir = join(tmpdir(), createId("quack_adaptive_state"));
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "index.ts"), "export const value = 1;\n", "utf8");

  try {
    const system = createQuackSystem({
      workspaceRoot,
      dataDir,
      permissions: ["workspace.read"],
    });
    await system.learningExperiences.save(experience("run-1", "failed", 2, { error: "contract-impact" }));
    await system.learningExperiences.save(experience("run-2", "failed", 3, { error: "contract-impact" }));
    await system.learningExperiences.save(experience("run-3", "completed", 0));

    const pattern = (await system.adaptiveSkillEvolution.detectFailurePatterns())
      .find((item) => item.dimension === "outcome:task.error:contract-impact");
    assert.ok(pattern);
    const objective = system.objectives.get(DEFAULT_NO_REGRESSION_OBJECTIVE_ID)!;
    const hypothesis = system.adaptiveSkillEvolution.createHypothesis(pattern, objective);
    const gap = system.adaptiveSkillEvolution.identifyCapabilityGap({
      hypothesis,
      pattern,
      neededBehavior: "contract impact analysis for exported TypeScript API changes",
      requiredTools: ["core.workspace.list-files"],
    });
    const proposal = system.adaptiveSkillEvolution.proposeSkillFromGap(gap, hypothesis);
    assert.ok(proposal);
    const candidate = system.adaptiveSkillEvolution.createCandidateSkill(proposal, { id: "contract-impact-analysis" });

    const experiment = system.adaptiveSkillEvolution.runControlCandidateExperiment({
      candidate,
      objective,
      baseline: experience("baseline", "completed", 2),
      control: experience("control", "completed", 2, { variantRole: "control" }),
      candidateExperience: experience("candidate", "completed", 0, { variantRole: "candidate" }),
    });

    assert.equal(experiment.decision, "PROMOTE");
    assert.equal(system.skills.search("contract impact").some((skill) => skill.id === "contract-impact-analysis"), true);

    const denied = await system.runtime.executeTool(
      "core.workspace.read-file",
      { path: "..\\outside.txt" },
      { taskId: "adaptive-test", actor: "candidate-skill" },
    );
    assert.equal(denied.ok, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

function createHarness(): {
  readonly engine: EvidenceDrivenSkillEvolution;
  readonly store: InMemoryEvidenceExperienceStore;
  readonly objective: ObjectiveSpecification;
  readonly skills: SkillRegistry;
  readonly adaptive: ReturnType<typeof createAdaptiveLayer>;
} {
  const store = new InMemoryEvidenceExperienceStore();
  const tools = new ToolRegistry();
  tools.register(new EchoTool());
  tools.register(new WorkspaceListFilesTool({ workspaceRoot: process.cwd() }));
  tools.register(new TerminalTool({ workspaceRoot: process.cwd() }));
  const skills = new SkillRegistry();
  const loader = new SkillLoader(createBuiltinSkillCatalog());
  for (const skill of loader.loadBuiltins()) skills.register(skill);
  const adaptive = createAdaptiveLayer();
  const objective = new ObjectiveRegistry().get(DEFAULT_NO_REGRESSION_OBJECTIVE_ID)!;
  return {
    engine: new EvidenceDrivenSkillEvolution({
      experiences: store,
      skills,
      tools,
      adaptiveLayer: adaptive,
      evaluator: new DeterministicObjectiveEvaluator(),
      allowedPermissions: ["workspace.read"],
    }),
    store,
    objective,
    skills,
    adaptive,
  };
}

async function seedExperiences(store: InMemoryEvidenceExperienceStore, experiences: EvidenceBackedExperience[]): Promise<void> {
  for (const item of experiences) await store.save(item);
}

function validCandidate(harness: ReturnType<typeof createHarness>): CandidateSkill {
  const candidate = harness.engine.createCandidateSkill(sampleProposal(), {
    id: "contract-impact-analysis",
  });
  const validation = harness.engine.validateCandidateSkill(candidate);
  assert.equal(validation.valid, true);
  return { ...candidate, validation };
}

function sampleProposal(): EvidenceBackedSkillProposal {
  return {
    id: "proposal-1",
    hypothesisId: "hypothesis-1",
    capabilityGapId: "gap-1",
    supportingEvidence: ["exp-run-1", "exp-run-2"],
    desiredBehavior: "contract impact analysis for exported TypeScript API changes",
    triggerContext: ["contract", "impact", "exports"],
    requiredTools: ["core.workspace.list-files"],
    expectedMetricEffect: "Reduce regressions for exported API changes.",
    constraints: ["No protected core mutation."],
    origin: "generated_by_quack",
    proposedBy: "evidence",
    status: "proposed",
    createdAt: "2026-08-05T00:00:00.000Z",
  };
}

function samplePattern(dimension: string) {
  return {
    id: "pattern-1",
    objectiveId: DEFAULT_NO_REGRESSION_OBJECTIVE_ID,
    key: `${DEFAULT_NO_REGRESSION_OBJECTIVE_ID}|${dimension}`,
    classification: "runtime-outcome",
    dimension,
    supportingExperienceIds: ["exp-run-1", "exp-run-2"],
    opposingExperienceIds: [],
    count: 2,
    comparablePopulation: 3,
    confidence: 0.67,
    status: "actionable" as const,
    attribution: { selectedSkills: [] },
    createdAt: "2026-08-05T00:00:00.000Z",
  };
}

function experience(
  runId: string,
  status: "completed" | "failed",
  failedSteps: number,
  options: { readonly error?: string; readonly skill?: string; readonly variantRole?: "production" | "control" | "candidate" } = {},
): EvidenceBackedExperience {
  const objective = new ObjectiveRegistry().get(DEFAULT_NO_REGRESSION_OBJECTIVE_ID)!;
  const observations = observationsFor(runId, status, failedSteps, objective);
  const evaluation = new DeterministicObjectiveEvaluator().evaluate({
    objective,
    runId,
    observations,
    baselineRunId: "baseline",
    baselineObservations: observationsFor("baseline", "completed", 1, objective),
    execution: {
      runtimeId: "test-runtime",
      selectedSkills: options.skill ? [{ skillId: options.skill, version: "0.1.0" }] : [],
      variant: options.variantRole ? { id: `variant-${options.variantRole}`, role: options.variantRole } : undefined,
    },
  });
  return {
    id: `exp-${runId}`,
    objective,
    execution: {
      runtimeId: "test-runtime",
      selectedSkills: options.skill ? [{ skillId: options.skill, version: "0.1.0" }] : [],
      variant: options.variantRole ? { id: `variant-${options.variantRole}`, role: options.variantRole } : undefined,
    },
    runId,
    taskId: `task-${runId}`,
    actions: ["test action"],
    outcomes: [
      `task.status:${status}`,
      ...(options.error ? [`task.error:${options.error}`] : []),
    ],
    metricObservations: observations,
    evaluation,
    evidence: evaluation.evidence,
    resultStatus: status,
    traceRefs: [`task-${runId}`],
    createdAt: `2026-08-05T00:00:${runId.length.toString().padStart(2, "0")}.000Z`,
  };
}

function observationsFor(
  runId: string,
  status: "completed" | "failed",
  failedSteps: number,
  objective: ObjectiveSpecification,
): MetricObservation[] {
  return [
    {
      id: `obs-completed-${runId}`,
      objectiveId: objective.id,
      metricId: "runtime.task.completed",
      runId,
      source: "test",
      value: status === "completed",
      valid: true,
      observedAt: "2026-08-05T00:00:00.000Z",
      sequence: 0,
    },
    {
      id: `obs-failed-${runId}`,
      objectiveId: objective.id,
      metricId: "runtime.failed_steps",
      runId,
      source: "test",
      value: failedSteps,
      valid: true,
      observedAt: "2026-08-05T00:00:00.000Z",
      sequence: 1,
    },
  ];
}

function withInvalidObservation(experience: EvidenceBackedExperience): EvidenceBackedExperience {
  return {
    ...experience,
    metricObservations: [
      { ...experience.metricObservations[0], valid: false, value: undefined, error: "invalid" },
      ...experience.metricObservations.slice(1),
    ],
  };
}

function withManifest(candidate: CandidateSkill, manifest: Partial<CandidateSkill["manifest"]>): CandidateSkill {
  return {
    ...candidate,
    manifest: {
      ...candidate.manifest,
      ...manifest,
    },
  };
}
