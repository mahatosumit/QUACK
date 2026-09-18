import { fail, ok, type JsonObject, type QuackResult } from "../core/types.js";

/**
 * QUACK Instruction Engine (QIE) — canonical contract types.
 *
 * QIE compiles structured runtime state into deterministic, provider-neutral
 * instruction plans. It is an instruction/context compiler ONLY (ADR 0042):
 * not a model runtime, not a planner, not a memory system, not a capability
 * broker, not an authorization system, and it never calls providers or
 * executes tools. P8.1 defines the contract and the deterministic composer;
 * context selection (P8.2), integrations (P8.3), and model wiring (P8.4)
 * build on these types. QIE never retrieves context implicitly — all
 * inputs arrive explicitly from callers.
 */

/** Contract version for InstructionPlan serialization. */
export const INSTRUCTION_PLAN_VERSION = 1;

/**
 * Categories describing WHERE a context item came from. Later QIE phases
 * apply policy per category; P8.1 requires that the category survive
 * composition so policy can be applied.
 */
export type ContextSourceCategory =
  | "identity"
  | "mission"
  | "task"
  | "constraint"
  | "capability"
  | "skill"
  | "memory"
  | "workspace"
  | "project"
  | "evidence"
  | "system"
  | "user"
  | "tool";

/**
 * Trust classification of an instruction/context source, derived from
 * existing QUACK governance semantics (see {@link TRUST_CLASS_PRECEDENCE}).
 * Trust is declared and validated at the contract boundary — it can never
 * be inferred from content, and untrusted classes cannot be relabeled as
 * authoritative runtime instructions.
 */
export type TrustClass =
  | "SYSTEM_POLICY"
  | "TRUSTED_RUNTIME"
  | "USER_INPUT"
  | "EVIDENCE"
  | "SKILL"
  | "MEMORY"
  | "TOOL_OUTPUT"
  | "RETRIEVED_CONTEXT";

/**
 * Deterministic precedence order over trust classes (index = rank, lower
 * wins). Derived from existing QUACK governance:
 * - security/policy authority is non-negotiable (fail-closed broker;
 *   "system-instructions" is already a protected capability)
 * - runtime mission/task state is authoritative mission semantics
 * - user intent shapes the mission but can never redefine policy, identity,
 *   or capabilities
 * - verified evidence beats claims but cannot override intent
 * - skill prose is gated guidance, never policy
 * - memory and tool output are contextual data
 * - external/retrieved content is always data, never instruction
 */
export const TRUST_CLASS_PRECEDENCE: readonly TrustClass[] = [
  "SYSTEM_POLICY",
  "TRUSTED_RUNTIME",
  "USER_INPUT",
  "EVIDENCE",
  "SKILL",
  "MEMORY",
  "TOOL_OUTPUT",
  "RETRIEVED_CONTEXT",
];

/**
 * Allowed trust classes per source category — the fail-closed
 * category↔trust pairing. A `tool` item claiming `TRUSTED_RUNTIME`, or a
 * `user` item claiming `SYSTEM_POLICY`, is rejected at the contract
 * boundary before composition.
 */
export const CATEGORY_TRUST_PAIRING: Readonly<Record<ContextSourceCategory, readonly TrustClass[]>> = {
  system: ["SYSTEM_POLICY", "TRUSTED_RUNTIME"],
  identity: ["TRUSTED_RUNTIME"],
  mission: ["TRUSTED_RUNTIME", "USER_INPUT", "MEMORY"],
  task: ["TRUSTED_RUNTIME", "USER_INPUT"],
  constraint: ["SYSTEM_POLICY", "TRUSTED_RUNTIME", "USER_INPUT"],
  capability: ["TRUSTED_RUNTIME"],
  skill: ["SKILL"],
  memory: ["MEMORY"],
  workspace: ["TRUSTED_RUNTIME", "MEMORY", "RETRIEVED_CONTEXT"],
  project: ["TRUSTED_RUNTIME", "MEMORY", "RETRIEVED_CONTEXT"],
  evidence: ["EVIDENCE"],
  user: ["USER_INPUT"],
  tool: ["TOOL_OUTPUT"],
};

/** Provenance every QIE item must carry so later phases can apply policy. */
export interface ContextProvenance {
  /** Stable identifier of the producing source (e.g. "mission-manager"). */
  readonly source: string;
  /** Where this item came from. */
  readonly category: ContextSourceCategory;
  /** Declared trust class, validated against {@link CATEGORY_TRUST_PAIRING}. */
  readonly trust: TrustClass;
}

/**
 * A single piece of context supplied to QIE. P8.1 defines the
 * representation; retrieval (memory, workspace, skills, tools) is owned by
 * callers and later QIE phases — QIE never retrieves implicitly.
 */
export interface ContextSourceItem {
  /** Stable, unique item id (ordering + duplicate-detection key). */
  readonly id: string;
  readonly provenance: ContextProvenance;
  /** Item content as structured data — data to compose, never instructions TO QIE. */
  readonly data: JsonObject;
}

/**
 * Fixed instruction layer order — the single source of truth for
 * deterministic composition ordering.
 */
export const INSTRUCTION_LAYER_ORDER = [
  "identity",
  "objective",
  "task",
  "constraints",
  "capabilities",
  "skills",
  "context",
  "memory",
  "evidence",
  "outputContract",
  "failurePolicy",
] as const;

export type InstructionLayerName = (typeof INSTRUCTION_LAYER_ORDER)[number];

/** A thematic instruction layer holding ordered context items. */
export interface InstructionLayer {
  readonly name: InstructionLayerName;
  readonly items: readonly ContextSourceItem[];
}

/**
 * Whether an evidence item was verified. Prevents later phases from
 * exposing an unverified claim as a verified fact.
 */
export type EvidenceStatus = "verified" | "unverified" | "inferred" | "missing";

/** Evidence-classified item in the evidence layer. */
export interface EvidenceItem extends ContextSourceItem {
  readonly status: EvidenceStatus;
}

/**
 * Minimal instruction/context budget — char-based and model-agnostic.
 * Token estimation and model-aware adaptation are deferred (P8.4); the
 * existing `ModelInfo.contextWindow = 8192` registry default is NOT QIE
 * truth.
 */
export interface InstructionBudget {
  /** Maximum assembled instruction characters (sum of item data). */
  readonly maxInstructionChars: number;
  /** Characters reserved for model output. */
  readonly reservedOutputChars: number;
  /** Optional upper bound per context item (enforced by future selection, P8.2+). */
  readonly maxItemChars?: number;
}

/**
 * What the runtime expects the model to return. Representation only —
 * enforcement is P8.4. Shapes align with existing contract schemas
 * (`ProviderModelRequestV1.responseSchema`, tool intents) rather than
 * duplicating them.
 */
export type InstructionOutputKind =
  | "plainResponse"
  | "structuredResponse"
  | "toolIntent"
  | "clarification"
  | "plan"
  | "verificationResult"
  | "failureResult"
  | "completionResult";

/** Output contract representation for a plan. */
export interface InstructionOutputContract {
  readonly kind: InstructionOutputKind;
  /** Schema reference (e.g. an existing contract id) — never an inline schema copy. */
  readonly schemaRef?: string;
  /** Deterministically serialized contract hints. */
  readonly requirements?: Readonly<Record<string, string>>;
}

/**
 * How a plan expects failure/uncertainty to be represented. Reuses
 * existing `QuackError` semantics at enforcement time (P8.4); P8.1 is
 * representation only.
 */
export type InstructionFailureMode =
  | "insufficient_context"
  | "capability_unavailable"
  | "capability_denied"
  | "verification_required"
  | "clarification_required"
  | "uncertain_result";

export interface InstructionFailurePolicy {
  /** Failure/uncertainty modes the model may legitimately return. */
  readonly allowedModes: readonly InstructionFailureMode[];
  /** Fail closed: never fabricate when information is missing. */
  readonly preferAdmission: boolean;
}

/** Full provider-neutral instruction plan. */
export interface InstructionPlan {
  readonly version: typeof INSTRUCTION_PLAN_VERSION;
  /** Plan identity — semantic identity, not runtime-execution identity. */
  readonly missionId: string;
  readonly taskId?: string;
  /** Layers in any order; the composer imposes deterministic order. */
  readonly layers: readonly InstructionLayer[];
  readonly budget: InstructionBudget;
  readonly outputContract: InstructionOutputContract;
  readonly failurePolicy: InstructionFailurePolicy;
}

// ---------------------------------------------------------------------------
// Composed output (deterministic result of the composer)
// ---------------------------------------------------------------------------

/** A composed (ordered) layer. */
export interface ComposedLayer {
  readonly name: InstructionLayerName;
  readonly items: readonly ContextSourceItem[];
}

/** An item omitted from composition, with the deterministic reason. */
export interface OmittedItem {
  readonly layerName: InstructionLayerName;
  readonly itemId: string;
  readonly trust: TrustClass;
  readonly reason: "budget";
}

/** Budget application report — omissions are recorded, never silent. */
export interface InstructionBudgetReport {
  readonly totalChars: number;
  readonly budgetChars: number;
  readonly withinBudget: boolean;
  readonly omitted: readonly OmittedItem[];
}

/**
 * Structured composition result. Deterministic for identical plans;
 * `digest` is sha256 over canonical semantic content (see composer).
 */
export interface ComposedInstruction {
  readonly planVersion: number;
  readonly missionId: string;
  readonly taskId?: string;
  readonly layers: readonly ComposedLayer[];
  readonly outputContract: InstructionOutputContract;
  readonly failurePolicy: InstructionFailurePolicy;
  readonly budget: InstructionBudget;
  readonly budgetReport: InstructionBudgetReport;
  /** Deterministic content digest — instruction identity, not execution identity. */
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// PromptRegistry adapter (reuse, ADR 0042 — no second registry)
// ---------------------------------------------------------------------------

/** Minimal shape QIE needs from the existing versioned prompt registry. */
export interface InstructionSource {
  readonly source: string;
  /** Versioned prompt content; never executed, never authoritative policy. */
  readonly content: JsonObject;
  readonly provenance: ContextProvenance;
}

/**
 * Adapter input: the active-version view of a registry prompt. Built from
 * `createPromptRegistry().getActiveVersion(id)` by the caller; QIE does not
 * hold or wrap the registry itself (single owner: `src/adaptive`).
 */
export interface RegistryPromptVersionView {
  readonly name: string;
  readonly version: number;
  readonly content: string;
  readonly category: string;
}

/** Wraps a registry prompt's active version as a QIE instruction source. */
export function instructionSourceFromPrompt(prompt: RegistryPromptVersionView): InstructionSource {
  return {
    source: `prompt-registry:${prompt.name}`,
    content: { prompt: prompt.content, version: prompt.version },
    provenance: { source: "prompt-registry", category: "skill", trust: "SKILL" },
  };
}

// ---------------------------------------------------------------------------
// Validation (fail-closed)
// ---------------------------------------------------------------------------

export type InstructionPlanIssueCode =
  | "instruction.plan_shape_invalid"
  | "instruction.plan_version_unsupported"
  | "instruction.layer_name_invalid"
  | "instruction.duplicate_item_id"
  | "instruction.provenance_invalid"
  | "instruction.trust_category_mismatch"
  | "instruction.evidence_status_invalid"
  | "instruction.budget_exceeded";

export interface InstructionPlanIssue {
  readonly code: InstructionPlanIssueCode;
  readonly message: string;
  readonly itemId?: string;
}

const VALID_LAYER_NAMES: ReadonlySet<string> = new Set<string>(INSTRUCTION_LAYER_ORDER);
const EVIDENCE_STATUSES: ReadonlySet<string> = new Set(["verified", "unverified", "inferred", "missing"]);

/**
 * Collect all plan issues (fail-closed). Duplicate item ids, invalid trust
 * pairings, and evidence items without a declared status make a plan
 * invalid — nothing is silently repaired.
 */
export function collectPlanIssues(plan: InstructionPlan): readonly InstructionPlanIssue[] {
  const issues: InstructionPlanIssue[] = [];

  if (!plan || typeof plan.missionId !== "string" || plan.missionId.length === 0) {
    return [{ code: "instruction.plan_shape_invalid", message: "plan requires a non-empty missionId" }];
  }
  if (plan.version !== INSTRUCTION_PLAN_VERSION) {
    issues.push({ code: "instruction.plan_version_unsupported", message: `unsupported plan version ${String(plan.version)}` });
  }
  if (!Array.isArray(plan.layers)) {
    return [...issues, { code: "instruction.plan_shape_invalid", message: "plan.layers must be an array" }];
  }
  if (!plan.budget || typeof plan.budget.maxInstructionChars !== "number" || typeof plan.budget.reservedOutputChars !== "number") {
    issues.push({ code: "instruction.plan_shape_invalid", message: "plan.budget requires maxInstructionChars and reservedOutputChars" });
  }
  if (!plan.outputContract || typeof plan.outputContract.kind !== "string") {
    issues.push({ code: "instruction.plan_shape_invalid", message: "plan.outputContract requires a kind" });
  }
  if (!plan.failurePolicy || !Array.isArray(plan.failurePolicy.allowedModes)) {
    issues.push({ code: "instruction.plan_shape_invalid", message: "plan.failurePolicy requires allowedModes" });
  }

  const seenIds = new Set<string>();
  for (const layer of plan.layers) {
    if (!layer || !VALID_LAYER_NAMES.has(layer.name)) {
      issues.push({ code: "instruction.layer_name_invalid", message: `unknown layer ${String(layer?.name)}` });
      continue;
    }
    if (!Array.isArray(layer.items)) {
      issues.push({ code: "instruction.plan_shape_invalid", message: `layer ${String(layer.name)} items must be an array` });
      continue;
    }
    for (const item of layer.items) {
      if (!item || typeof item.id !== "string" || item.id.length === 0) {
        issues.push({ code: "instruction.plan_shape_invalid", message: `layer ${String(layer.name)} contains an item without an id` });
        continue;
      }
      if (seenIds.has(item.id)) {
        issues.push({ code: "instruction.duplicate_item_id", message: `duplicate item id ${item.id}`, itemId: item.id });
      }
      seenIds.add(item.id);

      const provenance = item.provenance;
      if (!provenance || typeof provenance.source !== "string" || provenance.source.length === 0
        || !CATEGORY_TRUST_PAIRING[provenance.category as ContextSourceCategory]) {
        issues.push({
          code: "instruction.provenance_invalid",
          message: `item ${item.id} has invalid provenance (source/category)`,
          itemId: item.id,
        });
        continue;
      }
      const pairing = CATEGORY_TRUST_PAIRING[provenance.category as ContextSourceCategory];
      if (!pairing.includes(provenance.trust)) {
        issues.push({
          code: "instruction.trust_category_mismatch",
          message: `item ${item.id} category ${String(provenance.category)} may not claim trust ${String(provenance.trust)}`,
          itemId: item.id,
        });
        continue;
      }
      if (layer.name === "evidence" && !EVIDENCE_STATUSES.has((item as EvidenceItem).status)) {
        issues.push({
          code: "instruction.evidence_status_invalid",
          message: `evidence item ${item.id} must declare a valid status (got ${String((item as EvidenceItem).status)})`,
          itemId: item.id,
        });
      }
    }
  }

  return issues;
}

/**
 * Validate a plan. Ok means zero issues; the full issue list is available
 * from {@link collectPlanIssues}.
 */
export function validateInstructionPlan(plan: InstructionPlan): QuackResult<readonly InstructionPlanIssue[]> {
  const issues = collectPlanIssues(plan);
  if (issues.length > 0) {
    return fail({
      code: issues[0].code,
      message: `${issues[0].message}${issues.length > 1 ? ` (+${issues.length - 1} more issues)` : ""}`,
      category: "validation",
      recoverable: true,
    });
  }
  return ok(issues);
}

/** Factory input for {@link createInstructionPlan}. */
export type InstructionPlanInput = Omit<InstructionPlan, "version">;

/**
 * Create and validate an InstructionPlan. Fails closed on the first issue
 * class; returns the fully validated, versioned plan on success.
 */
export function createInstructionPlan(input: InstructionPlanInput): QuackResult<InstructionPlan> {
  const plan: InstructionPlan = { ...input, version: INSTRUCTION_PLAN_VERSION };
  const validation = validateInstructionPlan(plan);
  if (!validation.ok) return validation as QuackResult<InstructionPlan>;
  return ok(plan);
}

// ---------------------------------------------------------------------------
// Precedence (deterministic conflict resolution)
// ---------------------------------------------------------------------------

/** Rank of a trust class (lower = higher precedence). */
export function trustClassRank(trust: TrustClass): number {
  const idx = TRUST_CLASS_PRECEDENCE.indexOf(trust);
  return idx === -1 ? TRUST_CLASS_PRECEDENCE.length : idx;
}

/**
 * Deterministic precedence between two items — answers "if two instruction
 * sources conflict, which one wins". Ties break by stable item id so
 * ordering never depends on input sequence. No caller-supplied value can
 * reorder the hierarchy.
 */
export function resolvePrecedence(a: ContextSourceItem, b: ContextSourceItem): ContextSourceItem {
  const rankDelta = trustClassRank(a.provenance.trust) - trustClassRank(b.provenance.trust);
  if (rankDelta !== 0) return rankDelta < 0 ? a : b;
  return a.id <= b.id ? a : b;
}
