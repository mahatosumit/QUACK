import { createHash } from "node:crypto";
import type { JsonObject } from "../core/types.js";
import {
  INSTRUCTION_LAYER_ORDER,
  type ComposedInstruction,
  type ComposedLayer,
  type ContextSourceItem,
  type InstructionBudget,
  type InstructionBudgetReport,
  type InstructionLayer,
  type InstructionLayerName,
  type InstructionPlan,
  type InstructionPlanIssue,
  type OmittedItem,
  type TrustClass,
  collectPlanIssues,
  trustClassRank,
} from "./types.js";

/**
 * Deterministic instruction composer (ADR 0042).
 *
 * Pure function: no filesystem, no memory, no providers, no tools, no
 * authorization. All inputs arrive explicitly via the plan; QIE never
 * retrieves implicitly. Returns a structured `ComposedInstruction` (not an
 * opaque string) so later phases can inspect, budget, and digest the
 * assembled context.
 */

/** Result of composing a plan. Fail-closed: issues mean no composition. */
export interface ComposeResult {
  readonly ok: boolean;
  readonly composed?: ComposedInstruction;
  readonly issues?: readonly InstructionPlanIssue[];
}

/** Layers whose items are never dropped for budget. */
const CORE_LAYERS: ReadonlySet<string> = new Set(["identity", "objective", "task", "outputContract"]);

/**
 * Compose a plan deterministically:
 * 1. validate (fail-closed trust pairing)
 * 2. order layers by {@link INSTRUCTION_LAYER_ORDER}
 * 3. order items within layers by (trust precedence, then item id)
 * 4. apply char budget: omit lowest-precedence optional items first,
 *    recording every omission; fail closed if core layers alone exceed
 *    the budget
 */
export function composeInstructionPlan(plan: InstructionPlan): ComposeResult {
  const issues = collectPlanIssues(plan);
  if (issues.length > 0) return { ok: false, issues };

  // Canonical layer order + deterministic within-layer ordering.
  const layersByName = new Map<string, InstructionLayer>();
  for (const layer of plan.layers) layersByName.set(layer.name, layer);
  const orderedLayers: ComposedLayer[] = [];
  for (const name of INSTRUCTION_LAYER_ORDER) {
    const layer = layersByName.get(name);
    if (!layer) continue;
    const items = orderItems(layer.items);
    orderedLayers.push({ name, items });
  }

  // Budget (omissions recorded, never silent; fail closed on core overflow).
  const budgeted = applyBudget(orderedLayers, plan.budget);
  if (!budgeted.ok) return { ok: false, issues: budgeted.issues };

  // Digest is computed over the assembled semantic content, excluding
  // volatile fields — instruction identity, not execution identity.
  const base = {
    missionId: plan.missionId,
    ...(plan.taskId ? { taskId: plan.taskId } : {}),
    layers: budgeted.layers,
    outputContract: plan.outputContract,
    failurePolicy: plan.failurePolicy,
  };
  const composed: ComposedInstruction = {
    planVersion: plan.version,
    missionId: plan.missionId,
    ...(plan.taskId ? { taskId: plan.taskId } : {}),
    layers: budgeted.layers,
    outputContract: plan.outputContract,
    failurePolicy: plan.failurePolicy,
    budget: plan.budget,
    budgetReport: budgeted.report,
    digest: sha256Hex(canonicalJson(base)),
  };
  return { ok: true, composed };
}

/** Deterministic within-layer ordering: (trust precedence, item id). */
function orderItems(items: readonly ContextSourceItem[]): readonly ContextSourceItem[] {
  return [...items].sort((a, b) => {
    const delta = trustClassRank(a.provenance.trust) - trustClassRank(b.provenance.trust);
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// Budget (char-based, model-agnostic; token adaptation is P8.4)
// ---------------------------------------------------------------------------

interface BudgetOutcome {
  readonly ok: boolean;
  readonly layers: readonly ComposedLayer[];
  readonly report: InstructionBudgetReport;
  readonly issues: readonly InstructionPlanIssue[];
}

function applyBudget(layers: readonly ComposedLayer[], budget: InstructionBudget): BudgetOutcome {
  const omitted: OmittedItem[] = [];
  let working = layers;
  let totalChars = sumChars(layers);

  // Drop lowest-precedence optional items first (highest trust rank first),
  // ties by reverse id; deterministic. Core layers are never dropped.
  while (totalChars > budget.maxInstructionChars) {
    const candidate = findDropCandidate(working);
    if (!candidate) break;
    working = removeItem(working, candidate.layerName, candidate.itemId);
    omitted.push({ layerName: candidate.layerName, itemId: candidate.itemId, trust: candidate.trust, reason: "budget" });
    totalChars -= candidate.chars;
  }

  const withinBudget = totalChars <= budget.maxInstructionChars;
  return {
    ok: withinBudget,
    layers: working,
    report: { totalChars, budgetChars: budget.maxInstructionChars, withinBudget, omitted },
    issues: withinBudget ? [] : [{
      code: "instruction.budget_exceeded" as const,
      message: `core instruction layers require ${String(totalChars)} chars, budget ${String(budget.maxInstructionChars)}`,
    }],
  };
}

interface DropCandidate {
  readonly layerName: InstructionLayerName;
  readonly itemId: string;
  readonly trust: TrustClass;
  readonly chars: number;
}

/** Highest-rank (lowest-precedence) optional item; ties by id descending. */
function findDropCandidate(layers: readonly ComposedLayer[]): DropCandidate | undefined {
  let best: DropCandidate | undefined;
  for (const layer of layers) {
    if (CORE_LAYERS.has(layer.name)) continue;
    for (const item of layer.items) {
      const chars = canonicalJson(item.data).length;
      const candidate: DropCandidate = { layerName: layer.name, itemId: item.id, trust: item.provenance.trust, chars };
      if (!best) { best = candidate; continue; }
      const rankDelta = trustClassRank(candidate.trust) - trustClassRank(best.trust);
      if (rankDelta > 0 || (rankDelta === 0 && candidate.itemId > best.itemId)) best = candidate;
    }
  }
  return best;
}

/** Pure removal returning a new layer array (no mutation). */
function removeItem(layers: readonly ComposedLayer[], layerName: string, itemId: string): readonly ComposedLayer[] {
  return layers.map((layer) =>
    layer.name === layerName
      ? { name: layer.name, items: layer.items.filter((i) => i.id !== itemId) }
      : layer,
  );
}

function sumChars(layers: readonly ComposedLayer[]): number {
  let total = 0;
  for (const layer of layers) {
    for (const item of layer.items) total += canonicalJson(item.data).length;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Rendering (deterministic flatten; P8.4 wires to ModelRequest)
// ---------------------------------------------------------------------------

/**
 * Flatten a composed instruction to text for the future
 * `ModelRequest.prompt` surface. Deterministic: same composed input → same
 * text. Untrusted content is labeled so the model can distinguish data
 * from authoritative runtime instructions.
 */
export function renderComposedText(composed: ComposedInstruction): string {
  const sections: string[] = [
    `# QUACK Instructions (v${String(composed.planVersion)})`,
  ];
  for (const layer of composed.layers) {
    sections.push(`## ${layer.name}`);
    for (const item of layer.items) {
      sections.push(`${trustTag(item.provenance.trust)} ${item.id}: ${canonicalJson(item.data)}`);
    }
  }
  sections.push("## outputContract");
  sections.push(canonicalJson(contractData(composed)));
  sections.push("## failurePolicy");
  sections.push(canonicalJson(failurePolicyData(composed)));
  return sections.join("\n");
}

function contractData(composed: ComposedInstruction): JsonObject {
  return { kind: composed.outputContract.kind, ...(composed.outputContract.schemaRef ? { schemaRef: composed.outputContract.schemaRef } : {}) };
}

function failurePolicyData(composed: ComposedInstruction): JsonObject {
  return { allowedModes: composed.failurePolicy.allowedModes, preferAdmission: composed.failurePolicy.preferAdmission };
}

function trustTag(trust: TrustClass): string {
  if (trust === "SYSTEM_POLICY" || trust === "TRUSTED_RUNTIME") return "[TRUSTED]";
  if (trust === "USER_INPUT") return "[USER]";
  return "[DATA]";
}

// ---------------------------------------------------------------------------
// Canonical serialization + digest (deterministic, key-order-insensitive)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: recursively sorts object keys so digest/composition are
 * insensitive to object key insertion order (per the existing `canonical()`
 * pattern in src/engine/execution-recovery.ts).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  if (typeof value === "number") {
    // Guard against non-finite numbers which JSON.stringify would render inconsistently.
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }
  return JSON.stringify(value);
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
