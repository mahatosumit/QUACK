import { canonicalJson, composeInstructionPlan } from "./composer.js";
import {
  CATEGORY_TRUST_PAIRING,
  INSTRUCTION_LAYER_ORDER,
  INSTRUCTION_PLAN_VERSION,
  type ContextSourceCategory,
  type ContextSourceItem,
  type EvidenceStatus,
  type InstructionLayer,
  type InstructionLayerName,
  type InstructionPlan,
  type InstructionPlanInput,
  type InstructionPlanIssue,
  type TrustClass,
  trustClassRank,
  validateInstructionPlan,
} from "./types.js";

/**
 * P8.2 deterministic context selection (ADR 0042).
 *
 * RETRIEVAL PRODUCES CANDIDATES. THE SELECTOR SELECTS AND ASSEMBLES
 * CANDIDATES. THE P8.1 COMPOSER VALIDATES AND COMPOSES THE PLAN.
 *
 * The selector is a pure function over explicitly supplied candidates — it
 * never reads memory, filesystem, workspace, skills, MCP, tools, network,
 * or the PromptRegistry itself. All budget semantics come from the P8.1
 * budget contract; the P8.1 composer is the single budget authority (the
 * selector reuses its deterministic drop decision via the provisional
 * compose below — no duplicated budget logic, no second constants table).
 */

// ---------------------------------------------------------------------------
// Candidate contract
// ---------------------------------------------------------------------------

/**
 * A candidate context item awaiting selection. The target layer is either
 * declared explicitly or derived deterministically from the item's
 * category via {@link DEFAULT_CATEGORY_LAYER}.
 */
export interface ContextCandidate {
  readonly item: ContextSourceItem;
  /** Target instruction layer; omitted → deterministic category default. */
  readonly layer?: InstructionLayerName;
}

/**
 * Deterministic category → layer defaults. A convenience for callers; the
 * mapping is fixed and never inferred from item content.
 */
export const DEFAULT_CATEGORY_LAYER: Readonly<Record<ContextSourceCategory, InstructionLayerName>> = {
  identity: "identity",
  mission: "objective",
  task: "task",
  constraint: "constraints",
  capability: "capabilities",
  skill: "skills",
  memory: "memory",
  evidence: "evidence",
  workspace: "context",
  project: "context",
  system: "constraints",
  user: "task",
  tool: "context",
};

/** Everything the selector needs except the candidates' layer placement. */
export type SelectionInput = Omit<InstructionPlanInput, "layers"> & {
  /** Explicitly supplied candidates — the selector retrieves nothing. */
  readonly candidates: readonly ContextCandidate[];
};

// ---------------------------------------------------------------------------
// Selection report (metadata only — item content is never echoed)
// ---------------------------------------------------------------------------

/** A selected candidate, with its deterministic ordering key. */
export interface SelectedEntry {
  readonly itemId: string;
  readonly layer: InstructionLayerName;
  readonly trust: TrustClass;
  readonly code: "instruction.selected";
  /** Deterministic trust-precedence rank (lower = higher precedence). */
  readonly rank: number;
}

/** A candidate excluded because the P8.1 budget could not fit it. */
export interface TrimmedEntry {
  readonly itemId: string;
  readonly layer: InstructionLayerName;
  readonly trust: TrustClass;
  readonly code: "instruction.budget_trimmed";
  /** Item cost in canonical-JSON characters. */
  readonly chars: number;
}

/** Candidate-level rejection codes (op-level failures reuse P8.1 issue codes). */
export type SelectionRejectionCode =
  | "instruction.candidate_shape_invalid"
  | "instruction.candidate_trust_mismatch"
  | "instruction.candidate_evidence_status_invalid"
  | "instruction.layer_name_invalid"
  | "instruction.item_too_large"
  | "instruction.duplicate_item_id";

/** A candidate rejected at intake — never admitted, never silent. */
export interface RejectedEntry {
  readonly itemId: string;
  readonly code: SelectionRejectionCode;
  readonly message: string;
  readonly layer?: InstructionLayerName;
}

/** Structured disposition of every candidate. Sorted by itemId — deterministic. */
export interface SelectionReport {
  readonly selected: readonly SelectedEntry[];
  readonly trimmed: readonly TrimmedEntry[];
  readonly rejected: readonly RejectedEntry[];
}

/** Result of selection. Fail-closed: `ok: false` means no plan was produced. */
export interface SelectionResult {
  readonly ok: boolean;
  /** The assembled, P8.1-valid, budget-fitting plan (on success). */
  readonly plan?: InstructionPlan;
  readonly report?: SelectionReport;
  /** Op-level failures: duplicate ids, core budget overflow. */
  readonly issues?: readonly InstructionPlanIssue[];
}

// ---------------------------------------------------------------------------
// Intake (per-candidate eligibility)
// ---------------------------------------------------------------------------

const VALID_LAYER_NAMES: ReadonlySet<string> = new Set<string>(INSTRUCTION_LAYER_ORDER);
const EVIDENCE_STATUSES: ReadonlySet<string> = new Set<string>(["verified", "unverified", "inferred", "missing"]);

interface Admitted {
  readonly layer: InstructionLayerName;
  readonly item: ContextSourceItem;
}

interface IntakeOutcome {
  readonly admitted: readonly Admitted[];
  readonly rejected: readonly RejectedEntry[];
}

/** Per-candidate eligibility. Malformed candidates are rejected with reasons; selection proceeds. */
function intake(candidates: readonly ContextCandidate[], maxItemChars: number | undefined): IntakeOutcome {
  const admitted: Admitted[] = [];
  const rejected: RejectedEntry[] = [];

  candidates.forEach((candidate, index) => {
    const fallbackId = `candidate:${String(index)}`;
    const reject = (code: SelectionRejectionCode, message: string, layer?: InstructionLayerName): void => {
      rejected.push({ itemId: fallbackId, code, message, ...(layer ? { layer } : {}) });
    };

    const item = candidate?.item;
    if (!item || typeof item.id !== "string" || item.id.length === 0) {
      reject("instruction.candidate_shape_invalid", "candidate item requires a non-empty string id");
      return;
    }
    const rejectWithId = (code: SelectionRejectionCode, message: string, layer?: InstructionLayerName): void => {
      rejected.push({ itemId: item.id, code, message, ...(layer ? { layer } : {}) });
    };

    // Resolve target layer: explicit declaration wins, else category default.
    const category: ContextSourceCategory | undefined = item.provenance?.category;
    const defaultLayer = category ? DEFAULT_CATEGORY_LAYER[category] : undefined;
    const layer = candidate.layer ?? defaultLayer;
    if (candidate.layer !== undefined && !VALID_LAYER_NAMES.has(candidate.layer)) {
      rejectWithId("instruction.layer_name_invalid", `unknown layer ${String(candidate.layer)}`);
      return;
    }
    if (!layer) {
      rejectWithId("instruction.layer_name_invalid", `no target layer for category ${String(category)}`);
      return;
    }

    // Provenance: non-empty source, known category, fail-closed trust pairing.
    const provenance = item.provenance;
    if (!provenance || typeof provenance.source !== "string" || provenance.source.length === 0 || !category
      || !CATEGORY_TRUST_PAIRING[category]) {
      rejectWithId("instruction.candidate_shape_invalid", "item provenance requires a source and a known category", layer);
      return;
    }
    if (!CATEGORY_TRUST_PAIRING[category].includes(provenance.trust)) {
      rejectWithId(
        "instruction.candidate_trust_mismatch",
        `category ${String(category)} may not claim trust ${String(provenance.trust)}`,
        layer,
      );
      return;
    }

    // Data is structured context, never instructions — but must be an object.
    if (!item.data || typeof item.data !== "object" || Array.isArray(item.data)) {
      rejectWithId("instruction.candidate_shape_invalid", "item data must be a JSON object", layer);
      return;
    }

    // Evidence status: required for the evidence layer (P8.1) AND for
    // evidence-category items wherever they land (verified claims must
    // stay distinguishable from unverified ones).
    const needsStatus = layer === "evidence" || category === "evidence";
    const declaredStatus = (item as { status?: unknown }).status;
    if (needsStatus && (typeof declaredStatus !== "string" || !EVIDENCE_STATUSES.has(declaredStatus))) {
      rejectWithId("instruction.candidate_evidence_status_invalid", `evidence item must declare a valid status (got ${String(declaredStatus)})`, layer);
      return;
    }

    // Per-item budget cap from the SAME P8.1 budget contract.
    if (maxItemChars !== undefined && canonicalJson(item.data).length > maxItemChars) {
      rejectWithId("instruction.item_too_large", `item requires ${String(canonicalJson(item.data).length)} chars, max ${String(maxItemChars)}`, layer);
      return;
    }

    admitted.push({ layer, item });
  });

  return { admitted, rejected };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Select and assemble candidates into a deterministic, P8.1-valid
 * InstructionPlan:
 * 1. per-candidate eligibility (rejections are recorded, never silent)
 * 2. duplicate-id check (fail-closed: conflicting same-ID candidates make
 *    the whole selection fail — never silently merged)
 * 3. provisional plan → the P8.1 composer applies the budget as the single
 *    budget authority (lowest-precedence optional items omitted first,
 *    core layers never dropped, core overflow fails closed)
 * 4. the final plan is the composer-trimmed, ordered layer set
 *
 * Deterministic: identical input (any insertion order) → byte-for-byte
 * identical result. No clock, randomness, or environment dependence.
 */
export function selectContext(input: SelectionInput): SelectionResult {
  const intakeResult = intake(input.candidates, input.budget?.maxItemChars);
  const rejected = [...intakeResult.rejected];

  // Duplicate ids among admitted candidates fail closed (op-level).
  const byId = new Map<string, Admitted[]>();
  for (const entry of intakeResult.admitted) {
    const list = byId.get(entry.item.id) ?? [];
    list.push(entry);
    byId.set(entry.item.id, list);
  }
  const duplicates = [...byId.values()].filter((list) => list.length > 1);
  if (duplicates.length > 0) {
    const issues: InstructionPlanIssue[] = [];
    const seen = new Set<string>();
    for (const list of duplicates) {
      for (const entry of list) {
        if (!seen.has(entry.item.id)) {
          seen.add(entry.item.id);
          issues.push({ code: "instruction.duplicate_item_id", message: `duplicate item id ${entry.item.id}`, itemId: entry.item.id });
        }
        rejected.push({ itemId: entry.item.id, code: "instruction.duplicate_item_id", message: "conflicting same-id candidates fail closed", ...(entry.layer ? { layer: entry.layer } : {}) });
      }
    }
    rejected.sort(byItemId);
    return { ok: false, report: { selected: [], trimmed: [], rejected }, issues };
  }

  // Assemble the provisional plan from ALL admitted candidates, then let
  // the P8.1 composer apply the budget — single budget authority, single
  // drop rule (lowest precedence first, deterministic tie-break).
  const layersByName = new Map<string, ContextSourceItem[]>();
  for (const entry of intakeResult.admitted) {
    const list = layersByName.get(entry.layer) ?? [];
    list.push(entry.item);
    layersByName.set(entry.layer, list);
  }
  const provisional: InstructionPlan = {
    version: INSTRUCTION_PLAN_VERSION,
    missionId: input.missionId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    layers: [...layersByName.entries()].map(([name, items]) => ({ name: name as InstructionLayerName, items })),
    budget: input.budget,
    outputContract: input.outputContract,
    failurePolicy: input.failurePolicy,
  };

  const provisionalValidation = validateInstructionPlan(provisional);
  if (!provisionalValidation.ok) {
    // Unreachable post-intake (defense in depth): report rather than assert.
    const issues = collectFromValidation(provisionalValidation);
    return { ok: false, report: { selected: [], trimmed: [], rejected }, issues };
  }

  const composed = composeInstructionPlan(provisional);
  if (!composed.ok || !composed.composed) {
    // Core overflow (or composer-internal validation) fails closed.
    return { ok: false, report: { selected: [], trimmed: [], rejected }, issues: composed.issues ?? [] };
  }

  // Final plan = the composer-trimmed, deterministically ordered layers.
  const plan: InstructionPlan = {
    version: INSTRUCTION_PLAN_VERSION,
    missionId: provisional.missionId,
    ...(provisional.taskId ? { taskId: provisional.taskId } : {}),
    layers: composed.composed.layers,
    budget: provisional.budget,
    outputContract: provisional.outputContract,
    failurePolicy: provisional.failurePolicy,
  };
  const finalValidation = validateInstructionPlan(plan);
  if (!finalValidation.ok) {
    const issues = collectFromValidation(finalValidation);
    return { ok: false, report: { selected: [], trimmed: [], rejected }, issues };
  }

  const selected: SelectedEntry[] = [];
  for (const layer of plan.layers) {
    for (const item of layer.items) {
      selected.push({
        itemId: item.id,
        layer: layer.name,
        trust: item.provenance.trust,
        code: "instruction.selected",
        rank: trustClassRank(item.provenance.trust),
      });
    }
  }
  const trimmed: TrimmedEntry[] = composed.composed.budgetReport.omitted.map((omitted) => ({
    itemId: omitted.itemId,
    layer: omitted.layerName,
    trust: omitted.trust,
    code: "instruction.budget_trimmed",
    chars: canonicalJson(findAdmittedItem(intakeResult.admitted, omitted)?.data ?? {}).length,
  }));

  selected.sort((a, b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
  trimmed.sort((a, b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
  rejected.sort(byItemId);

  return { ok: true, plan, report: { selected, trimmed, rejected } };
}

function byItemId(a: { itemId: string }, b: { itemId: string }): number {
  return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
}

function findAdmittedItem(admitted: readonly Admitted[], target: { itemId: string }): ContextSourceItem | undefined {
  return admitted.find((entry) => entry.item.id === target.itemId)?.item;
}

/** Reconstruct the full issue list for an op-level failure path. */
function collectFromValidation(failed: { readonly ok: false; readonly error: { code: string; message: string } }): InstructionPlanIssue[] {
  return [{ code: "instruction.plan_shape_invalid" as const, message: failed.error.message }];
}
