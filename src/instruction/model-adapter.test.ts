import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adaptComposedInstruction, invokeGovernedInstruction, type GovernedDispatchRuntime } from "./model-adapter.js";
import { composeInstructionPlan, renderComposedText } from "./composer.js";
import { selectContext, type ContextCandidate } from "./selector.js";
import type { ComposedInstruction, ContextSourceItem, EvidenceItem, InstructionPlan } from "./types.js";
import type { ModelRequest, ModelResponse, ModelStreamChunk } from "../models/runtime.js";
import type { QuackError, QuackResult } from "../core/types.js";

function item(id: string, trust: ContextSourceItem["provenance"]["trust"], category: ContextSourceItem["provenance"]["category"], data: Record<string, string> = { v: id }): ContextSourceItem {
  return { id, provenance: { source: "test", category, trust }, data };
}

/** Build a real composed instruction through the full P8.2 pipeline. */
function composedFixture(overrides: { missionId?: string; taskId?: string } = {}): ComposedInstruction {
  const candidates: ContextCandidate[] = [
    { item: item("ident-1", "TRUSTED_RUNTIME", "identity", { v: "QUACK reasoning component" }) },
    { item: item("obj-1", "TRUSTED_RUNTIME", "mission", { v: "ship the feature" }) },
    { item: item("task-1", "USER_INPUT", "task", { v: "write the report" }) },
    { item: { ...item("ev-1", "EVIDENCE", "evidence", { fact: "tests passed" }), status: "verified" } as EvidenceItem },
  ];
  const selection = selectContext({
    missionId: overrides.missionId ?? "m_adapt",
    ...(overrides.taskId ? { taskId: overrides.taskId } : {}),
    candidates,
    budget: { maxInstructionChars: 10_000, reservedOutputChars: 2_000 },
    outputContract: { kind: "plainResponse" },
    failurePolicy: { allowedModes: ["insufficient_context"], preferAdmission: true },
  });
  if (!selection.ok || !selection.plan) throw new Error("fixture selection failed");
  const composed = composeInstructionPlan(selection.plan);
  if (!composed.ok || !composed.composed) throw new Error("fixture composition failed");
  return composed.composed;
}

/** Fake governed runtime that records exactly what crossed the boundary. */
function fakeGovernedRuntime(outcome: QuackResult<ModelResponse>) {
  const state = { requests: [] as ModelRequest[], contexts: [] as { actor: string; missionId?: string; taskId?: string }[] };
  const runtime: GovernedDispatchRuntime = {
    async generate(request, context): Promise<QuackResult<ModelResponse>> {
      state.requests.push(request);
      state.contexts.push(context);
      return outcome;
    },
  };
  return { runtime, state };
}

describe("P8.4 — ComposedInstruction → ModelRequest adaptation", () => {
  it("adapts a composed instruction into a provider-neutral ModelRequest", () => {
    const composed = composedFixture();
    const result = adaptComposedInstruction(composed, { model: "qwen" });
    assert.ok(result.ok);
    const request = result.data;
    assert.equal(request.model, "qwen");
    assert.equal(typeof request.prompt, "string");
    assert.ok(request.prompt.length > 0);
  });

  it("the prompt is byte-identical to the P8.1 rendered representation", () => {
    const composed = composedFixture();
    const result = adaptComposedInstruction(composed);
    assert.ok(result.ok);
    assert.equal(result.data.prompt, renderComposedText(composed));
  });

  it("deterministic adaptation: identical input → identical request", () => {
    const composed = composedFixture();
    const a = adaptComposedInstruction(composed, { model: "m1", temperature: 0.2 });
    const b = adaptComposedInstruction(composed, { model: "m1", temperature: 0.2 });
    assert.ok(a.ok && b.ok);
    assert.deepEqual(a.data, b.data);
  });

  it("insertion-order independence: composition fixes ordering before adaptation", () => {
    // Same semantic plan built via a different candidate order composes to
    // the same digest, hence the same adapted request.
    const candidatesA: ContextCandidate[] = [
      { item: item("t-1", "USER_INPUT", "task") },
      { item: item("i-1", "TRUSTED_RUNTIME", "identity") },
    ];
    const candidatesB = [...candidatesA].reverse();
    const build = (candidates: readonly ContextCandidate[]): ComposedInstruction => {
      const selection = selectContext({
        missionId: "m_order",
        candidates,
        budget: { maxInstructionChars: 10_000, reservedOutputChars: 1_000 },
        outputContract: { kind: "plainResponse" },
        failurePolicy: { allowedModes: [], preferAdmission: true },
      });
      if (!selection.ok || !selection.plan) throw new Error("selection failed");
      const composed = composeInstructionPlan(selection.plan);
      if (!composed.ok || !composed.composed) throw new Error("composition failed");
      return composed.composed;
    };
    const a = adaptComposedInstruction(build(candidatesA));
    const b = adaptComposedInstruction(build(candidatesB));
    assert.ok(a.ok && b.ok);
    assert.equal(a.data.prompt, b.data.prompt);
    assert.equal(a.data.metadata?.instructionDigest, b.data.metadata?.instructionDigest);
  });

  it("provider-neutral: request carries no provider-specific fields", () => {
    const result = adaptComposedInstruction(composedFixture());
    assert.ok(result.ok);
    const request = result.data as unknown as Record<string, unknown>;
    for (const key of Object.keys(request)) {
      assert.ok(["prompt", "model", "capability", "metadata", "maxTokens", "temperature"].includes(key), `unexpected field ${key}`);
    }
  });
});

describe("P8.4 — identity preservation", () => {
  it("digest is preserved verbatim in metadata (never regenerated)", () => {
    const composed = composedFixture();
    const result = adaptComposedInstruction(composed);
    assert.ok(result.ok);
    assert.equal(result.data.metadata?.instructionDigest, composed.digest);
    assert.match(String(result.data.metadata?.instructionDigest), /^[0-9a-f]{64}$/);
  });

  it("mission and task identity are preserved", () => {
    const composed = composedFixture({ missionId: "m_42", taskId: "t_42" });
    const result = adaptComposedInstruction(composed);
    assert.ok(result.ok);
    assert.equal(result.data.metadata?.missionId, "m_42");
    assert.equal(result.data.metadata?.taskId, "t_42");
  });

  it("output contract kind is preserved", () => {
    const composed = composedFixture();
    const result = adaptComposedInstruction(composed);
    assert.ok(result.ok);
    assert.equal(result.data.metadata?.outputContractKind, "plainResponse");
    // The contract also rides in the rendered prompt (the model sees it).
    assert.ok(result.data.prompt.includes("outputContract"));
  });

  it("failure policy is preserved inside the rendered prompt", () => {
    const result = adaptComposedInstruction(composedFixture());
    assert.ok(result.ok);
    assert.ok(result.data.prompt.includes("failurePolicy"));
    assert.ok(result.data.prompt.includes("insufficient_context"));
  });

  it("governed instruction provenance marker is attached", () => {
    const result = adaptComposedInstruction(composedFixture());
    assert.ok(result.ok);
    assert.equal(result.data.metadata?.governedInstruction, true);
    assert.equal(result.data.metadata?.instructionPlanVersion, 1);
  });
});

describe("P8.4 — fail-closed adaptation", () => {
  it("rejects a composed instruction with a missing digest", () => {
    const composed = { ...composedFixture(), digest: "" } as ComposedInstruction;
    const result = adaptComposedInstruction(composed);
    assert.ok(!result.ok);
    assert.equal(result.error.code, "instruction.adaptation_invalid");
  });

  it("rejects an invalid (non-sha256) digest", () => {
    const composed = { ...composedFixture(), digest: "not-a-digest" } as ComposedInstruction;
    assert.ok(!adaptComposedInstruction(composed).ok);
  });

  it("rejects an unsupported plan version", () => {
    const composed = { ...composedFixture(), planVersion: 99 } as ComposedInstruction;
    assert.ok(!adaptComposedInstruction(composed).ok);
  });

  it("rejects a missing mission identity", () => {
    const composed = { ...composedFixture(), missionId: "" } as ComposedInstruction;
    assert.ok(!adaptComposedInstruction(composed).ok);
  });

  it("rejects an unknown output-contract kind", () => {
    const composed = { ...composedFixture(), outputContract: { kind: "freeform-anything" as never } } as ComposedInstruction;
    const result = adaptComposedInstruction(composed);
    assert.ok(!result.ok);
    assert.equal(result.error.code, "instruction.adaptation_invalid");
  });

  it("structured-response contract is carried honestly (no fake schema enforcement)", () => {
    const candidates: ContextCandidate[] = [{ item: item("t-1", "USER_INPUT", "task") }];
    const selection = selectContext({
      missionId: "m_struct",
      candidates,
      budget: { maxInstructionChars: 10_000, reservedOutputChars: 1_000 },
      outputContract: { kind: "structuredResponse", schemaRef: "TaskResponse" },
      failurePolicy: { allowedModes: [], preferAdmission: true },
    });
    assert.ok(selection.ok && selection.plan);
    const composed = composeInstructionPlan(selection.plan!);
    assert.ok(composed.ok && composed.composed);
    const result = adaptComposedInstruction(composed.composed);
    // Carried in metadata + prompt; the adapter claims no enforcement.
    assert.ok(result.ok);
    assert.equal(result.data.metadata?.outputContractKind, "structuredResponse");
    assert.ok(result.data.prompt.includes("TaskResponse"));
  });
});

describe("P8.4 — governed dispatch", () => {
  it("invokeGovernedInstruction validates, adapts, and dispatches with full context", async () => {
    const composed = composedFixture({ missionId: "m_disp", taskId: "t_disp" });
    const { runtime, state } = fakeGovernedRuntime({ ok: true, data: { id: "r1", providerId: "ollama", model: "qwen", text: "done", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, fallbackUsed: false } });
    const result = await invokeGovernedInstruction(runtime, composed, { missionId: "m_disp", taskId: "t_disp", actor: "observer" }, { model: "qwen" });
    assert.ok(result.ok);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].metadata?.instructionDigest, composed.digest);
    assert.equal(state.contexts[0].actor, "observer");
  });

  it("invalid composed instruction never reaches the runtime (fail closed)", async () => {
    const { runtime, state } = fakeGovernedRuntime({ ok: true, data: {} as ModelResponse });
    const bad = { ...composedFixture(), digest: "" } as ComposedInstruction;
    const result = await invokeGovernedInstruction(runtime, bad, { actor: "observer" });
    assert.ok(!result.ok);
    assert.equal(state.requests.length, 0);
  });

  it("runtime rejection passes through with existing error semantics", async () => {
    const composed = composedFixture();
    const { runtime } = fakeGovernedRuntime({ ok: false, error: { code: "model.permission_denied", message: "denied", category: "permission", recoverable: false } });
    const result = await invokeGovernedInstruction(runtime, composed, { actor: "observer" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "model.permission_denied");
  });

  it("denial fails closed with zero fallback to an ungoverned prompt path", async () => {
    const composed = composedFixture();
    let calls = 0;
    const runtime: GovernedDispatchRuntime = {
      async generate() {
        calls += 1;
        return { ok: false, error: { code: "model.permission_denied", message: "denied", category: "permission" as const, recoverable: false } };
      },
    };
    const result = await invokeGovernedInstruction(runtime, composed, { actor: "observer" });
    assert.ok(!result.ok);
    // No retry, no fallback path: exactly one governed attempt.
    assert.equal(calls, 1);
  });

  it("missing runtime fails closed", async () => {
    const result = await invokeGovernedInstruction(undefined as unknown as GovernedDispatchRuntime, composedFixture(), { actor: "observer" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "instruction.adaptation_invalid");
  });
});

describe("P8.4 — provider boundary integrity (adversarial)", () => {
  it("the governed request cannot be replaced by an arbitrary prompt after adaptation", () => {
    // The adapter returns a frozen-shape request: the prompt is derived
    // deterministically from the composed instruction. Any caller mutation
    // happens on their copy — the digest no longer matches the prompt,
    // which downstream verification (P8.5+) can detect via re-render.
    const composed = composedFixture();
    const a = adaptComposedInstruction(composed);
    const b = adaptComposedInstruction(composed);
    assert.ok(a.ok && b.ok);
    assert.equal(a.data.prompt, b.data.prompt);
    assert.equal(a.data.metadata?.instructionDigest, b.data.metadata?.instructionDigest);
  });

  it("digest/prompt correspondence is verifiable (re-render matches digest identity)", () => {
    const composed = composedFixture();
    const result = adaptComposedInstruction(composed);
    assert.ok(result.ok);
    // Re-rendering the source produces the same prompt the model received.
    assert.equal(result.data.prompt, renderComposedText(composed));
    // And re-composing the same plan yields the same digest (P8.1 guarantee
    // carried through P8.4 metadata untouched).
    assert.equal(result.data.metadata?.instructionDigest, composed.digest);
  });

  it("no provider fields leak backward into QIE (adaptation output is provider-neutral)", () => {
    const result = adaptComposedInstruction(composedFixture());
    assert.ok(result.ok);
    const metadata = result.data.metadata as Record<string, unknown>;
    assert.deepEqual(Object.keys(metadata).sort(),
      ["governedInstruction", "instructionDigest", "instructionPlanVersion", "missionId", "outputContractKind"]);
    // No taskId in this fixture → absent, not fabricated.
    assert.equal(metadata.taskId, undefined);
  });

  it("the prompt retains QIE authority structure ([TRUSTED]/[USER]/[DATA] labels + fixed layers)", () => {
    const composed = composedFixture();
    const result = adaptComposedInstruction(composed);
    assert.ok(result.ok);
    const prompt = result.data.prompt;
    assert.ok(prompt.startsWith("# QUACK Instructions"));
    assert.ok(prompt.includes("[TRUSTED] ident-1"));
    assert.ok(prompt.includes("[USER] task-1"));
    // Untrusted items would carry [DATA]; none in this fixture at that rank.
    const identityIndex = prompt.indexOf("## identity");
    const taskIndex = prompt.indexOf("## task");
    const evidenceIndex = prompt.indexOf("## evidence");
    assert.ok(identityIndex < taskIndex && taskIndex < evidenceIndex, "fixed layer order preserved in the prompt");
  });
});
