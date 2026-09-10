import test from "node:test";
import assert from "node:assert/strict";
import { ok, now, type JsonObject } from "../core/types.js";
import {
  adaptComposedInstruction,
  buildInstructionRecord,
  composeInstructionPlan,
  createInstructionPlan,
  distinctTrustClasses,
  parseInstructionRecord,
  recordToJsonObject,
  type ComposedInstruction,
} from "./index.js";
import { enforceInstructionDefense } from "./injection-defense.js";
import { scoreInstructionQuality, dominantTrustLane } from "./evaluator.js";
import type { GovernedInstructionRecord } from "./records.js";
import type { ContextSourceItem } from "./types.js";
import { collectMetrics } from "../harness/metrics-collector.js";
import { evaluateMission } from "../harness/evaluator.js";
import type { MissionTrace } from "../harness/types.js";

/**
 * P8.6 tests: metadata-only instruction dispatch records + quality scoring.
 * Adversarial focus: records can never leak content, never fabricate
 * identity, never admit tampered/forged records into evaluation, and never
 * reward instruction-less missions.
 */

function item(id: string, trust: ContextSourceItem["provenance"]["trust"], data: JsonObject = { note: "x" }): ContextSourceItem {
  const category = trust === "SYSTEM_POLICY" || trust === "TRUSTED_RUNTIME" ? "system"
    : trust === "USER_INPUT" ? "user"
    : trust === "SKILL" ? "skill"
    : trust === "MEMORY" ? "memory"
    : trust === "EVIDENCE" ? "evidence"
    : trust === "TOOL_OUTPUT" ? "tool"
    : "project";
  return {
    id,
    provenance: { source: `test:${id}`, category: category as ContextSourceItem["provenance"]["category"], trust },
    data,
  };
}

function composedInstruction(overrides: Partial<ComposedInstruction> = {}): ComposedInstruction {
  const base: ComposedInstruction = {
    planVersion: 1,
    missionId: "mission-p86",
    layers: [
      { name: "identity", items: [item("id-1", "TRUSTED_RUNTIME")] },
      { name: "objective", items: [item("goal-1", "TRUSTED_RUNTIME")] },
      { name: "task", items: [item("task-1", "USER_INPUT")] },
      { name: "context", items: [item("ctx-1", "RETRIEVED_CONTEXT"), item("tool-1", "TOOL_OUTPUT")] },
      { name: "outputContract", items: [item("out-1", "TRUSTED_RUNTIME")] },
    ],
    outputContract: { kind: "plainResponse" },
    failurePolicy: { allowedModes: ["insufficient_context"], preferAdmission: true },
    budget: { maxInstructionChars: 100_000, reservedOutputChars: 1_000 },
    budgetReport: { totalChars: 500, budgetChars: 100_000, withinBudget: true, omitted: [] },
    digest: "a".repeat(64),
    ...overrides,
  };
  return base;
}

function traceWith(records: readonly GovernedInstructionRecord[] | undefined): MissionTrace {
  return {
    id: "trace-p86",
    missionInput: { missionId: "mission-p86", goal: "score instruction quality", actor: "test" },
    plansGenerated: [],
    skillsSelected: [],
    capabilitiesRequested: [],
    toolsExecuted: [],
    verificationResults: [],
    iterations: [],
    finalOutcome: { success: true, state: "COMPLETED", latencyMs: 5 },
    events: [],
    ...(records ? { instruction: records } : {}),
    startedAt: now(),
    completedAt: now(),
  } as unknown as MissionTrace;
}

// ---------------------------------------------------------------------------
// records: metadata-only construction
// ---------------------------------------------------------------------------

test("P8.6 record carries census/identity/budget metadata and zero content", () => {
  const composed = composedInstruction();
  const record = buildInstructionRecord({
    composed,
    flags: [],
    outcome: "dispatched",
    recordId: "rec-1",
    dispatchedAt: now(),
  });

  assert.equal(record.recordId, "rec-1");
  assert.equal(record.missionId, "mission-p86");
  assert.equal(record.digest, composed.digest, "digest preserved verbatim from composed instruction");
  assert.equal(record.outcome, "dispatched");
  assert.equal(record.totalItems, 6);
  assert.equal(record.omittedItemCount, 0);
  assert.ok(record.withinBudget);
  assert.deepEqual(record.layerCensus.map((c) => c.layer), ["identity", "objective", "task", "context", "outputContract"]);
  const contextCensus = record.layerCensus.find((c) => c.layer === "context");
  assert.deepEqual([...contextCensus!.trusts].sort(), ["RETRIEVED_CONTEXT", "TOOL_OUTPUT"]);

  // Metadata-only: serialized record must not contain item data or prompts.
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes("note"), "item data never enters the record");
  assert.ok(!serialized.includes("prompt"), "no prompt text in the record");
});

test("P8.6 record count fields track budget report and defense flags", () => {
  const composed = composedInstruction({
    budgetReport: {
      totalChars: 900,
      budgetChars: 1000,
      withinBudget: true,
      omitted: [
        { layerName: "context", itemId: "tool-1", trust: "TOOL_OUTPUT", reason: "budget" },
        { layerName: "context", itemId: "ctx-1", trust: "RETRIEVED_CONTEXT", reason: "budget" },
      ],
    },
  });
  const record = buildInstructionRecord({
    composed,
    flags: [{ itemId: "tool-1", trust: "TOOL_OUTPUT", category: "tool", patterns: ["authority_claim"] }],
    outcome: "dispatched",
    recordId: "rec-2",
    dispatchedAt: now(),
  });
  assert.equal(record.omittedItemCount, 2);
  assert.equal(record.injectionFlagCount, 1);
  assert.equal(record.injectionFlags[0].itemId, "tool-1");
  assert.deepEqual(record.injectionFlags[0].patterns, ["authority_claim"], "flag carries kind names, never content");
});

test("P8.6 record round-trips through JSON and parseInstructionRecord", () => {
  const record = buildInstructionRecord({
    composed: composedInstruction({ taskId: "task-p86" }),
    flags: [],
    outcome: "dispatched",
    recordId: "rec-3",
    dispatchedAt: now(),
  });
  const parsed = parseInstructionRecord(recordToJsonObject(record));
  assert.ok(parsed.ok);
  assert.equal(parsed.data!.recordId, "rec-3");
  assert.equal(parsed.data!.taskId, "task-p86");
  assert.deepEqual(parsed.data!.layerCensus, record.layerCensus);
});

// ---------------------------------------------------------------------------
// records: adversarial — tampered/forged records fail closed
// ---------------------------------------------------------------------------

test("P8.6 parseInstructionRecord rejects unknown outcome (tampered record)", () => {
  const record = recordToJsonObject(buildInstructionRecord({
    composed: composedInstruction(), flags: [], outcome: "dispatched", recordId: "r", dispatchedAt: now(),
  }));
  const tampered = { ...record, outcome: "executed_anyway" } as JsonObject;
  const parsed = parseInstructionRecord(tampered);
  assert.ok(!parsed.ok);
  assert.equal(parsed.error!.code, "instruction.record_invalid");
});

test("P8.6 parseInstructionRecord rejects non-sha256 digests (forged identity)", () => {
  const record = recordToJsonObject(buildInstructionRecord({
    composed: composedInstruction(), flags: [], outcome: "dispatched", recordId: "r", dispatchedAt: now(),
  }));
  const forged = { ...record, digest: "deadbeef" } as JsonObject;
  assert.ok(!parseInstructionRecord(forged).ok, "a forged digest cannot enter evaluation");
});

test("P8.6 parseInstructionRecord rejects flag-count/record mismatch", () => {
  const record = recordToJsonObject(buildInstructionRecord({
    composed: composedInstruction(), flags: [], outcome: "dispatched", recordId: "r", dispatchedAt: now(),
  }));
  const mismatched = { ...record, injectionFlagCount: 3 } as JsonObject;
  assert.ok(!parseInstructionRecord(mismatched).ok, "flag count must match flag list");
});

test("P8.6 parseInstructionRecord rejects malformed census and missing fields", () => {
  const record = recordToJsonObject(buildInstructionRecord({
    composed: composedInstruction(), flags: [], outcome: "dispatched", recordId: "r", dispatchedAt: now(),
  }));
  assert.ok(!parseInstructionRecord({ ...record, layerCensus: [{ layer: 42 }] } as unknown as JsonObject).ok);
  assert.ok(!parseInstructionRecord({ ...record, missionId: "" } as JsonObject).ok);
  assert.ok(!parseInstructionRecord(null).ok);
});

// ---------------------------------------------------------------------------
// evaluator: quality scoring
// ---------------------------------------------------------------------------

test("P8.6 zero records yields a neutral, honest result (never rewarded)", () => {
  const result = scoreInstructionQuality([]);
  assert.equal(result.recordCount, 0);
  assert.deepEqual(result.digests, []);
  assert.equal(result.dimensions.instructionIntegrity, 0);
});

test("P8.6 all-dispatched records score full integrity; a rejection lowers it", () => {
  const good = buildInstructionRecord({
    composed: composedInstruction(), flags: [], outcome: "dispatched", recordId: "a", dispatchedAt: now(),
  });
  const allGood = scoreInstructionQuality([good]);
  assert.equal(allGood.dimensions.instructionIntegrity, 100);

  const rejected = buildInstructionRecord({
    composed: composedInstruction({ digest: "c".repeat(64) }), flags: [], outcome: "rejected",
    errorCode: "instruction.defense_digest_mismatch", recordId: "b", dispatchedAt: now(),
  });
  const mixed = scoreInstructionQuality([good, rejected]);
  assert.equal(mixed.dimensions.instructionIntegrity, 50);
  assert.equal(mixed.digests.length, 2, "digests recorded for audit, identity only");
});

test("P8.6 authoritative-lane presence raises contextProvenance", () => {
  const authoritative = buildInstructionRecord({
    composed: composedInstruction(), flags: [], outcome: "dispatched", recordId: "a", dispatchedAt: now(),
  });
  // Same shape but strip authoritative lanes: only data lanes remain.
  const dataOnly = buildInstructionRecord({
    composed: composedInstruction({
      layers: [
        { name: "context", items: [item("ctx-1", "RETRIEVED_CONTEXT"), item("tool-1", "TOOL_OUTPUT")] },
      ],
    }),
    flags: [], outcome: "dispatched", recordId: "b", dispatchedAt: now(),
  });
  const withAuthority = scoreInstructionQuality([authoritative]).dimensions.contextProvenance;
  const withoutAuthority = scoreInstructionQuality([dataOnly]).dimensions.contextProvenance;
  assert.ok(withAuthority > withoutAuthority, `authoritative framing must score higher (${withAuthority} vs ${withoutAuthority})`);
  assert.equal(withoutAuthority, 0, "zero authoritative items scores zero");
});

test("P8.6 heavy omission lowers budgetDiscipline; within-budget raises it", () => {
  const lean = buildInstructionRecord({
    composed: composedInstruction(), flags: [], outcome: "dispatched", recordId: "a", dispatchedAt: now(),
  });
  const heavy = buildInstructionRecord({
    composed: composedInstruction({
      budgetReport: {
        totalChars: 900, budgetChars: 1000, withinBudget: true,
        omitted: Array.from({ length: 12 }, (_, i) => ({ layerName: "context", itemId: `drop-${i}`, trust: "RETRIEVED_CONTEXT" as const, reason: "budget" as const })),
      },
    }),
    flags: [], outcome: "dispatched", recordId: "b", dispatchedAt: now(),
  });
  const leanScore = scoreInstructionQuality([lean]).dimensions.budgetDiscipline;
  const heavyScore = scoreInstructionQuality([heavy]).dimensions.budgetDiscipline;
  assert.ok(leanScore > heavyScore, `fewer omissions must score higher (${leanScore} vs ${heavyScore})`);
  assert.ok(leanScore >= 90 && leanScore <= 100);
});

test("P8.6 scoring is deterministic across record order and repeats", () => {
  const a = buildInstructionRecord({ composed: composedInstruction(), flags: [], outcome: "dispatched", recordId: "a", dispatchedAt: now() });
  const b = buildInstructionRecord({ composed: composedInstruction({ digest: "b".repeat(64) }), flags: [], outcome: "dispatched", recordId: "b", dispatchedAt: now() });
  const first = scoreInstructionQuality([a, b]);
  const second = scoreInstructionQuality([b, a]);
  const third = scoreInstructionQuality([a, b]);
  assert.deepEqual(first.dimensions, second.dimensions, "order-independent dimensions");
  assert.deepEqual(first.dimensions, third.dimensions, "repeat-stable dimensions");
  assert.deepEqual([...first.digests].sort(), [...second.digests].sort(), "digest set order-independent");
});

test("P8.6 dominantTrustLane reports the highest-precedence lane present", () => {
  const record = buildInstructionRecord({
    composed: composedInstruction(), flags: [], outcome: "dispatched", recordId: "a", dispatchedAt: now(),
  });
  assert.equal(dominantTrustLane([record]), "TRUSTED_RUNTIME");
  assert.equal(dominantTrustLane([]), undefined);
});

// ---------------------------------------------------------------------------
// harness integration: metrics + evaluation dimensions
// ---------------------------------------------------------------------------

test("P8.6 collectMetrics derives the instruction census from records", () => {
  const dispatched = buildInstructionRecord({
    composed: composedInstruction(), flags: [], outcome: "dispatched", recordId: "a", dispatchedAt: now(),
  });
  const flagged = buildInstructionRecord({
    composed: composedInstruction({ digest: "b".repeat(64) }),
    flags: [{ itemId: "tool-1", trust: "TOOL_OUTPUT", category: "tool", patterns: ["role_marker"] }],
    outcome: "rejected", errorCode: "instruction.defense_item_id_unsafe", recordId: "b", dispatchedAt: now(),
  });
  const metrics = collectMetrics(traceWith([dispatched, flagged]));
  assert.equal(metrics.instructionDispatchCount, 2);
  assert.equal(metrics.instructionDispatchedCount, 1);
  assert.equal(metrics.instructionRejectedCount, 1);
  assert.equal(metrics.instructionInjectionFlagCount, 1);
});

test("P8.6 evaluation gains instruction dimensions only when records exist", () => {
  const dispatched = buildInstructionRecord({
    composed: composedInstruction(), flags: [], outcome: "dispatched", recordId: "a", dispatchedAt: now(),
  });
  const withRecords = evaluateMission(traceWith([dispatched]));
  assert.ok(withRecords.dimensions.instruction, "instruction dimensions present");
  assert.equal(withRecords.dimensions.instruction!.instructionIntegrity, 100);

  const withoutRecords = evaluateMission(traceWith(undefined));
  assert.equal(withoutRecords.dimensions.instruction, undefined, "no fabricated instruction score");
  assert.ok(!("instruction" in withoutRecords.dimensions) || withoutRecords.dimensions.instruction === undefined);
});

test("P8.6 rejected instruction dispatches surface as evaluation failures", () => {
  const rejected = buildInstructionRecord({
    composed: composedInstruction(), flags: [], outcome: "rejected",
    errorCode: "instruction.defense_digest_mismatch", recordId: "b", dispatchedAt: now(),
  });
  const evaluation = evaluateMission(traceWith([rejected]));
  assert.ok(evaluation.failures.some((failure) => failure.code === "instruction.rejected"));
  assert.ok(evaluation.failures.some((failure) => failure.code === "iteration.missing" || failure.code === "instruction.rejected"));
});

test("P8.6 traces without instruction records keep the legacy evaluation contract", () => {
  const evaluation = evaluateMission(traceWith(undefined));
  assert.equal(evaluation.dimensions.capabilityDiscipline, 100);
  assert.equal(evaluation.dimensions.instruction, undefined);
  // Existing P5 metric fields still present.
  assert.equal(evaluation.metrics.instructionDispatchCount, 0);
});

// ---------------------------------------------------------------------------
// end-to-end: compose → defense → adapt → record → evaluate
// ---------------------------------------------------------------------------

test("P8.6 full pipeline: composed instruction survives defense, adapts, and produces an evaluable record", () => {
  // Compose for real so the digest corresponds — records must describe
  // actual enforced instructions, not fixtures with invented digests.
  const planInput = {
    missionId: "mission-p86-e2e",
    layers: [
      { name: "identity", items: [item("id-1", "TRUSTED_RUNTIME")] },
      { name: "objective", items: [item("goal-1", "TRUSTED_RUNTIME")] },
      { name: "task", items: [item("task-1", "USER_INPUT")] },
      { name: "context", items: [item("ctx-1", "RETRIEVED_CONTEXT"), item("tool-1", "TOOL_OUTPUT")] },
      { name: "outputContract", items: [item("out-1", "TRUSTED_RUNTIME")] },
    ],
    budget: { maxInstructionChars: 100_000, reservedOutputChars: 1_000 },
    outputContract: { kind: "plainResponse" },
    failurePolicy: { allowedModes: ["insufficient_context"], preferAdmission: true },
  };
  const planResult = createInstructionPlan(planInput as never);
  assert.ok(planResult.ok, `fixture plan must validate (${JSON.stringify((planResult as { error?: { message: string } }).error)})`);
  const composedResult = composeInstructionPlan(planResult.data as never);
  assert.ok(composedResult.ok && composedResult.composed, "fixture plan must compose");
  const composed = composedResult.composed!;

  const defense = enforceInstructionDefense(composed);
  assert.ok(defense.ok, `defense must pass for a well-formed instruction (${JSON.stringify(defense.error)})`);

  const adapted = adaptComposedInstruction(composed);
  assert.ok(adapted.ok);
  assert.equal((adapted.data.metadata as JsonObject)["instructionDigest"], composed.digest);

  const record = buildInstructionRecord({
    composed,
    flags: defense.flags,
    outcome: "dispatched",
    recordId: "e2e-1",
    dispatchedAt: now(),
  });
  const evaluation = evaluateMission(traceWith([record]));
  assert.ok(evaluation.dimensions.instruction, "end-to-end record reaches instruction dimensions");
  assert.deepEqual([...distinctTrustClasses(record)].sort(), ["RETRIEVED_CONTEXT", "TOOL_OUTPUT", "TRUSTED_RUNTIME", "USER_INPUT"]);
});
