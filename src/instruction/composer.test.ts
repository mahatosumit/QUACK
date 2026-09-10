import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeInstructionPlan, renderComposedText, canonicalJson } from "./composer.js";
import {
  CATEGORY_TRUST_PAIRING,
  INSTRUCTION_LAYER_ORDER,
  TRUST_CLASS_PRECEDENCE,
  collectPlanIssues,
  createInstructionPlan,
  instructionSourceFromPrompt,
  resolvePrecedence,
  trustClassRank,
  validateInstructionPlan,
  type ContextSourceItem,
  type EvidenceItem,
  type InstructionLayer,
  type InstructionPlan,
  type InstructionPlanInput,
} from "./types.js";
import { createPromptRegistry } from "../adaptive/prompt-registry.js";

/** Deterministic helper: build an item in one line. */
function item(id: string, trust: ContextSourceItem["provenance"]["trust"], category: ContextSourceItem["provenance"]["category"], data: Record<string, string> = { v: id }): ContextSourceItem {
  return { id, provenance: { source: "test", category, trust }, data };
}

const BASE_BUDGET = { maxInstructionChars: 10_000, reservedOutputChars: 2_000 };

function planInput(layers: readonly InstructionLayer[], overrides: Partial<InstructionPlanInput> = {}): InstructionPlanInput {
  return {
    missionId: "m_test",
    layers,
    budget: BASE_BUDGET,
    outputContract: { kind: "plainResponse" },
    failurePolicy: { allowedModes: ["insufficient_context"], preferAdmission: true },
    ...overrides,
  };
}

function validLayers(): InstructionLayer[] {
  return [
    { name: "identity", items: [item("id-1", "TRUSTED_RUNTIME", "identity")] },
    { name: "objective", items: [item("obj-1", "TRUSTED_RUNTIME", "mission")] },
    { name: "task", items: [item("task-1", "USER_INPUT", "task")] },
    { name: "memory", items: [item("mem-1", "MEMORY", "memory")] },
    { name: "evidence", items: [{ ...item("ev-1", "EVIDENCE", "evidence"), status: "verified" } as EvidenceItem] },
  ];
}

describe("QIE P8.1 — construction", () => {
  it("creates a valid InstructionPlan", () => {
    const result = createInstructionPlan(planInput(validLayers()));
    assert.ok(result.ok);
    assert.equal(result.data.version, 1);
    assert.equal(result.data.missionId, "m_test");
  });

  it("enforces required fields (missionId, budget, outputContract, failurePolicy)", () => {
    // Missing missionId
    assert.ok(!validateInstructionPlan({ ...planInput(validLayers()), missionId: "" } as unknown as InstructionPlan).ok);
    // Missing budget numbers
    const badBudget = planInput(validLayers(), { budget: { maxInstructionChars: 0, reservedOutputChars: 0 } });
    assert.ok(!validateInstructionPlan({ ...badBudget, budget: {} } as unknown as InstructionPlan).ok);
    // Missing outputContract kind
    assert.ok(!validateInstructionPlan({ ...planInput(validLayers()), outputContract: {} } as unknown as InstructionPlan).ok);
    // Missing failurePolicy allowedModes
    assert.ok(!validateInstructionPlan({ ...planInput(validLayers()), failurePolicy: {} } as unknown as InstructionPlan).ok);
  });

  it("rejects unsupported plan versions", () => {
    const issues = collectPlanIssues({ ...planInput(validLayers()), version: 99 } as unknown as InstructionPlan);
    assert.ok(issues.some((i) => i.code === "instruction.plan_version_unsupported"));
  });
});

describe("QIE P8.1 — determinism", () => {
  it("identical plans produce identical composition and digest", () => {
    const a = composeInstructionPlan({ ...planInput(validLayers()), version: 1 });
    const b = composeInstructionPlan({ ...planInput(validLayers()), version: 1 });
    assert.ok(a.ok && b.ok);
    assert.equal(a.composed!.digest, b.composed!.digest);
    assert.equal(renderComposedText(a.composed!), renderComposedText(b.composed!));
  });

  it("object key insertion order does not change digest or composition", () => {
    const p1 = { ...planInput([{ name: "task", items: [{ id: "t", provenance: { source: "s", category: "task" as const, trust: "USER_INPUT" as const }, data: { a: "1", b: "2" } }] }]), version: 1 } as InstructionPlan;
    const p2 = { ...planInput([{ name: "task", items: [{ id: "t", provenance: { source: "s", category: "task" as const, trust: "USER_INPUT" as const }, data: { b: "2", a: "1" } }] }]), version: 1 } as InstructionPlan;
    const a = composeInstructionPlan(p1);
    const b = composeInstructionPlan(p2);
    assert.ok(a.ok && b.ok);
    assert.equal(a.composed!.digest, b.composed!.digest);
  });

  it("layer input order does not change composed order", () => {
    const reversed = [...validLayers()].reverse();
    const a = composeInstructionPlan({ ...planInput(validLayers()), version: 1 });
    const b = composeInstructionPlan({ ...planInput(reversed), version: 1 });
    assert.ok(a.ok && b.ok);
    assert.deepEqual(a.composed!.layers.map((l) => l.name), b.composed!.layers.map((l) => l.name));
  });
});

describe("QIE P8.1 — ordering & precedence", () => {
  it("layers compose in the canonical INSTRUCTION_LAYER_ORDER", () => {
    const all: InstructionLayer[] = [
      { name: "failurePolicy", items: [item("f-1", "SYSTEM_POLICY", "system")] },
      { name: "identity", items: [item("i-1", "TRUSTED_RUNTIME", "identity")] },
      { name: "evidence", items: [{ ...item("e-1", "EVIDENCE", "evidence"), status: "unverified" } as EvidenceItem] },
      { name: "objective", items: [item("o-1", "TRUSTED_RUNTIME", "mission")] },
      { name: "task", items: [item("t-1", "TRUSTED_RUNTIME", "task")] },
    ];
    const result = composeInstructionPlan({ ...planInput(all), version: 1 });
    assert.ok(result.ok);
    const names = result.composed!.layers.map((l) => l.name);
    const expectedOrder = INSTRUCTION_LAYER_ORDER.filter((n) => names.includes(n));
    assert.deepEqual(names, expectedOrder);
  });

  it("items within a layer sort by (trust precedence, item id)", () => {
    const layers: InstructionLayer[] = [
      { name: "context", items: [
        item("z-low", "RETRIEVED_CONTEXT", "workspace"),
        item("a-high", "TRUSTED_RUNTIME", "workspace"),
        item("m-mid", "MEMORY", "workspace"),
      ] },
    ];
    const result = composeInstructionPlan({ ...planInput(layers), version: 1 });
    assert.ok(result.ok);
    const ids = result.composed!.layers[0].items.map((i) => i.id);
    assert.deepEqual(ids, ["a-high", "m-mid", "z-low"]);
  });

  it("resolvePrecedence follows the documented hierarchy", () => {
    // Security/policy authority is non-negotiable.
    const policy = item("p", "SYSTEM_POLICY", "system");
    const user = item("u", "USER_INPUT", "user");
    assert.equal(resolvePrecedence(policy, user).id, "p");
    // Tool output loses to trusted runtime.
    const toolOut = item("t", "TOOL_OUTPUT", "tool");
    const runtime = item("r", "TRUSTED_RUNTIME", "task");
    assert.equal(resolvePrecedence(toolOut, runtime).id, "r");
    // Retrieved context loses to memory.
    const retrieved = item("rc", "RETRIEVED_CONTEXT", "workspace");
    const memory = item("m", "MEMORY", "memory");
    assert.equal(resolvePrecedence(retrieved, memory).id, "m");
    // Equal trust ties break by stable id.
    const a1 = item("aa", "USER_INPUT", "task");
    const b1 = item("bb", "USER_INPUT", "task");
    assert.equal(resolvePrecedence(a1, b1).id, "aa");
  });

  it("user text can never outrank system policy or trusted runtime", () => {
    for (const [name] of Object.entries(CATEGORY_TRUST_PAIRING)) {
      if (name === "user" || name === "tool" || name === "skill" || name === "memory" || name === "evidence" || name === "workspace" || name === "project") {
        // These categories can never claim SYSTEM_POLICY/TRUSTED_RUNTIME
        // unless the pairing explicitly allows it (workspace/project allow
        // TRUSTED_RUNTIME for runtime-authored state).
      }
    }
    const userItem = item("u", "USER_INPUT", "user");
    const systemItem = item("s", "SYSTEM_POLICY", "system");
    assert.ok(trustClassRank(userItem.provenance.trust) > trustClassRank(systemItem.provenance.trust));
    assert.ok(TRUST_CLASS_PRECEDENCE.indexOf("SYSTEM_POLICY") < TRUST_CLASS_PRECEDENCE.indexOf("USER_INPUT"));
    assert.ok(TRUST_CLASS_PRECEDENCE.indexOf("TRUSTED_RUNTIME") < TRUST_CLASS_PRECEDENCE.indexOf("USER_INPUT"));
  });
});

describe("QIE P8.1 — provenance survival", () => {
  it("source categories and trust survive composition", () => {
    const result = composeInstructionPlan({ ...planInput(validLayers()), version: 1 });
    assert.ok(result.ok);
    for (const layer of result.composed!.layers) {
      for (const composedItem of layer.items) {
        const source = validLayers().flatMap((l) => l.items).find((i) => i.id === composedItem.id)!;
        assert.equal(composedItem.provenance.category, source.provenance.category);
        assert.equal(composedItem.provenance.trust, source.provenance.trust);
      }
    }
  });

  it("render labels trusted vs user vs data content", () => {
    const layers: InstructionLayer[] = [
      { name: "identity", items: [item("i", "TRUSTED_RUNTIME", "identity")] },
      { name: "task", items: [item("t", "USER_INPUT", "task")] },
      { name: "context", items: [item("c", "RETRIEVED_CONTEXT", "workspace")] },
    ];
    const result = composeInstructionPlan({ ...planInput(layers), version: 1 });
    assert.ok(result.ok);
    const text = renderComposedText(result.composed!);
    assert.match(text, /\[TRUSTED\] i:/);
    assert.match(text, /\[USER\] t:/);
    assert.match(text, /\[DATA\] c:/);
  });
});

describe("QIE P8.1 — conflicts & security boundary", () => {
  it("untrusted source cannot claim authoritative runtime trust", () => {
    // tool output claiming TRUSTED_RUNTIME
    const bad = planInput([
      { name: "context", items: [item("t-evil", "TRUSTED_RUNTIME", "tool")] },
    ]);
    const issues = collectPlanIssues({ ...bad, version: 1 });
    assert.ok(issues.some((i) => i.code === "instruction.trust_category_mismatch" && i.itemId === "t-evil"));
    const composed = composeInstructionPlan({ ...bad, version: 1 });
    assert.ok(!composed.ok);
  });

  it("user input cannot claim system policy", () => {
    const bad = planInput([
      { name: "constraints", items: [item("u-evil", "SYSTEM_POLICY", "user")] },
    ]);
    const issues = collectPlanIssues({ ...bad, version: 1 });
    assert.ok(issues.some((i) => i.code === "instruction.trust_category_mismatch"));
  });

  it("duplicate item ids fail closed (no silent dedup)", () => {
    const dup = planInput([
      { name: "task", items: [item("same-id", "USER_INPUT", "task"), item("same-id", "USER_INPUT", "task")] },
    ]);
    const issues = collectPlanIssues({ ...dup, version: 1 });
    assert.ok(issues.some((i) => i.code === "instruction.duplicate_item_id"));
  });

  it("evidence items must declare a status", () => {
    const noStatus = planInput([
      { name: "evidence", items: [item("ev-bad", "EVIDENCE", "evidence")] },
    ]);
    const issues = collectPlanIssues({ ...noStatus, version: 1 });
    assert.ok(issues.some((i) => i.code === "instruction.evidence_status_invalid"));
    const withStatus = planInput([
      { name: "evidence", items: [{ ...item("ev-ok", "EVIDENCE", "evidence"), status: "verified" } as EvidenceItem] },
    ]);
    assert.ok(composeInstructionPlan({ ...withStatus, version: 1 }).ok);
  });

  it("unknown layer names are rejected", () => {
    const bad = planInput([
      { name: "instructions-from-nowhere" as unknown as InstructionLayer["name"], items: [item("x", "TRUSTED_RUNTIME", "system")] },
    ]);
    const issues = collectPlanIssues({ ...bad, version: 1 });
    assert.ok(issues.some((i) => i.code === "instruction.layer_name_invalid"));
  });
});

describe("QIE P8.1 — budget", () => {
  it("budget configuration is represented in the composed report", () => {
    const result = composeInstructionPlan({ ...planInput(validLayers(), { budget: { maxInstructionChars: 10_000, reservedOutputChars: 500 } }), version: 1 });
    assert.ok(result.ok);
    assert.equal(result.composed!.budget.reservedOutputChars, 500);
    assert.ok(result.composed!.budgetReport.withinBudget);
    assert.equal(result.composed!.budgetReport.omitted.length, 0);
  });

  it("omits lowest-precedence optional items first and records omissions", () => {
    const big = (prefix: string, chars: number): ContextSourceItem => ({
      id: prefix,
      provenance: { source: "test", category: "workspace", trust: "RETRIEVED_CONTEXT" },
      data: { payload: "x".repeat(chars) },
    });
    const layers: InstructionLayer[] = [
      { name: "identity", items: [item("i", "TRUSTED_RUNTIME", "identity")] },
      { name: "objective", items: [item("o", "TRUSTED_RUNTIME", "mission")] },
      { name: "context", items: [big("big-low", 400), big("aaa-high", 100)] },
    ];
    // big-low (400 chars, lowest precedence) alone exceeds the remaining
    // budget; dropping it brings core layers within 150 chars.
    const result = composeInstructionPlan({ ...planInput(layers, { budget: { maxInstructionChars: 150, reservedOutputChars: 50 } }), version: 1 });
    assert.ok(result.ok);
    assert.equal(result.composed!.budgetReport.omitted.length, 1);
    // Lowest precedence dropped first.
    assert.equal(result.composed!.budgetReport.omitted[0].itemId, "big-low");
    assert.ok(result.composed!.budgetReport.omitted.every((o) => o.reason === "budget"));
  });

  it("fails closed when core layers alone exceed the budget", () => {
    const layers: InstructionLayer[] = [
      { name: "identity", items: [item("i", "TRUSTED_RUNTIME", "identity", { v: "x".repeat(500) })] },
    ];
    const result = composeInstructionPlan({ ...planInput(layers, { budget: { maxInstructionChars: 10, reservedOutputChars: 5 } }), version: 1 });
    assert.ok(!result.ok);
    assert.ok(result.issues!.some((i) => i.code === "instruction.budget_exceeded"));
  });
});

describe("QIE P8.1 — output contract", () => {
  it("output contracts serialize deterministically", () => {
    const c1 = { kind: "structuredResponse" as const, schemaRef: "TaskResponse", requirements: { b: "2", a: "1" } };
    const c2 = { kind: "structuredResponse" as const, schemaRef: "TaskResponse", requirements: { a: "1", b: "2" } };
    assert.equal(canonicalJson(c1), canonicalJson(c2));
    const result1 = composeInstructionPlan({ ...planInput(validLayers(), { outputContract: c1 }), version: 1 });
    const result2 = composeInstructionPlan({ ...planInput(validLayers(), { outputContract: c2 }), version: 1 });
    assert.ok(result1.ok && result2.ok);
    assert.equal(result1.composed!.digest, result2.composed!.digest);
  });
});

describe("QIE P8.1 — no side effects (purity)", () => {
  it("composer does not mutate the input plan (deep-frozen input unchanged)", () => {
    const input: InstructionPlan = { ...planInput(validLayers()), version: 1 };
    deepFreeze(input);
    const result = composeInstructionPlan(input);
    assert.ok(result.ok);
    // deepFreeze would have thrown on any mutation attempt.
    assert.equal(result.composed!.missionId, "m_test");
  });
});

describe("QIE P8.1 — PromptRegistry adapter (reuse, not duplication)", () => {
  it("adapts a registry prompt's active version into an InstructionSource", () => {
    const registry = createPromptRegistry();
    const prompt = registry.createPrompt("summarize-task", "Summarize the mission context.", "reasoning");
    const active = registry.getActiveVersion(prompt.id);
    assert.ok(active);
    const source = instructionSourceFromPrompt({
      name: prompt.name,
      version: active.version,
      content: active.content,
      category: prompt.category,
    });
    assert.equal(source.source, "prompt-registry:summarize-task");
    assert.equal(source.provenance.category, "skill");
    assert.equal(source.provenance.trust, "SKILL");
    assert.equal(source.content.version, 1);
  });

  it("registry versioning, rollback, and comparison are preserved untouched", () => {
    const registry = createPromptRegistry();
    const prompt = registry.createPrompt("p", "v1", "reasoning");
    registry.addVersion(prompt.id, "v2");
    const rolled = registry.rollback(prompt.id, 1);
    assert.equal(rolled.version, 1);
    assert.equal(registry.getActiveVersion(prompt.id)?.version, 1);
  });
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
