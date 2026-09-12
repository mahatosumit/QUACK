import { createHash } from "node:crypto";
import { createId, fail, ok, type JsonObject, type QuackResult } from "../../core/types.js";
import type { ActionProposal, ExecutionRiskLevel, ExecutionSandbox } from "./action-contract.js";
import { type ActionDescriptorV1 } from "../../contracts/v1/contracts.js";
import { type ToolRegistry } from "../../tools/tool.js";
import {
  createInstructionPlan,
  type ContextCandidate,
  type ContextSourceItem,
  type InstructionLayer,
  type InstructionPlan,
} from "../../instruction/index.js";

/**
 * P11 (ADR 0045): strict fail-closed parser turning a governed model
 * response into a validated {@link ActionProposal}.
 *
 * MODEL OUTPUT IS UNTRUSTED INPUT. The parser is the trust boundary between
 * "what the model said" and "what the loop will even consider proposing":
 *
 *   - the payload must be exact JSON matching `quack:action-proposal:v1`;
 *   - the capability MUST exist (action-provider descriptor id or registered
 *     tool id) — unknown capabilities are rejected, never guessed;
 *   - `requestedCapabilities` is RECORDED as data and NEVER honored —
 *     capability authority derives exclusively from the resolved
 *     descriptor's `requiredPermissions` (or tool permissions) inside the
 *     execution harness;
 *   - riskLevel / sandbox / timeoutMs / idempotencyKey are DERIVED
 *     SERVER-SIDE from the descriptor and the step identity; any
 *     model-supplied values for these fields are ignored;
 *   - oversized or malformed payloads fail closed with structured errors.
 *
 * The model may also close the mission honestly: `{"done": true}` with an
 * optional bounded `finalMessage` produces a completion intent with no
 * capability at all.
 */

/** Contract id cited by the QIE output contract for proposal dispatches. */
export const ACTION_PROPOSAL_SCHEMA_REF = "quack:action-proposal:v1";

/** Bounded argument size (chars of canonical JSON). */
export const MAX_PROPOSAL_ARGUMENT_CHARS = 8_192;

/** Bounded final-message size (chars). */
export const MAX_FINAL_MESSAGE_CHARS = 2_000;

/** Bounded intent size (chars). */
export const MAX_INTENT_CHARS = 500;

/** Bounded raw model output (chars) before any parsing. */
export const MAX_RAW_PROPOSAL_CHARS = 16_384;

export type ProposalErrorCode =
  | "mission.proposal_malformed"
  | "mission.proposal_unknown_capability"
  | "mission.proposal_oversized"
  | "mission.proposal_invalid_shape";

export interface ProposalParseFailure {
  readonly code: ProposalErrorCode;
  readonly message: string;
}

/** Validated intent of one governed step: act, or finish. */
export type ParsedProposalIntent =
  | { readonly kind: "act"; readonly proposal: ActionProposal }
  | { readonly kind: "done"; readonly finalMessage: string };

/** What the parser needs to validate capability existence and derive fields. */
export interface ProposalCapabilityIndex {
  /** Descriptor lookups by action id (action providers). */
  readonly descriptors: ReadonlyMap<string, ActionDescriptorV1>;
  /** Registered tool ids — known capabilities executable via core.tools. */
  readonly toolIds: ReadonlySet<string>;
}

export interface ParseProposalOptions {
  readonly missionId: string;
  readonly stepIndex: number;
  readonly actor: string;
  readonly index: ProposalCapabilityIndex;
}

/**
 * Derive the stable server-side idempotency key for a step. Deterministic
 * across process restarts; safe to persist in the action ledger. Note the
 * capability is part of the key: a step retries with a DIFFERENT capability
 * gets a different key, while replaying the same (step, capability) pair
 * converges on the same ledger record.
 */
export function stepIdempotencyKey(missionId: string, stepIndex: number, capability: string): string {
  return createHash("sha256").update(`${missionId}:${stepIndex}:${capability}`).digest("hex");
}

/**
 * Parse raw model text into a validated ParsedProposalIntent. Fail-closed:
 * every violation returns a structured error and NO proposal. The returned
 * error is marked recoverable so the loop can consume a bounded retry
 * before failing the mission; it never yields a partial proposal.
 */
export function parseActionProposal(raw: string, options: ParseProposalOptions): QuackResult<ParsedProposalIntent> {
  const reject = (code: ProposalErrorCode, message: string): QuackResult<ParsedProposalIntent> =>
    fail({ code, message, category: "validation", recoverable: true });

  if (typeof raw !== "string" || raw.length === 0) {
    return reject("mission.proposal_malformed", "Model output is empty.");
  }
  if (raw.length > MAX_RAW_PROPOSAL_CHARS) {
    return reject("mission.proposal_oversized", "Model output exceeds the bounded size.");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return reject("mission.proposal_malformed", "Model output is not valid JSON.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return reject("mission.proposal_malformed", "Model output must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  // Strict shape: only known top-level fields. Unknown fields fail closed.
  const allowed = new Set(["capability", "arguments", "intent", "done", "finalMessage", "requestedCapabilities"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return reject("mission.proposal_invalid_shape", `Unknown proposal field '${key}' is rejected.`);
  }

  // Completion intent: {"done": true, "finalMessage"?}
  if (record["done"] === true) {
    const finalMessage = record["finalMessage"];
    if (finalMessage !== undefined && (typeof finalMessage !== "string" || finalMessage.length > MAX_FINAL_MESSAGE_CHARS)) {
      return reject("mission.proposal_oversized", "finalMessage must be a bounded string.");
    }
    if (record["capability"] !== undefined || record["arguments"] !== undefined) {
      return reject("mission.proposal_invalid_shape", "A completion proposal cannot also declare a capability or arguments.");
    }
    return ok({ kind: "done", finalMessage: typeof finalMessage === "string" ? finalMessage : "" });
  }
  if (record["done"] !== undefined) {
    return reject("mission.proposal_invalid_shape", "'done', when present, must be exactly true; partial completion is not a state.");
  }

  // Action intent: capability + arguments (+ intent), everything else derived.
  const capability = record["capability"];
  if (typeof capability !== "string" || capability.length === 0) {
    return reject("mission.proposal_malformed", "Proposal requires a non-empty capability string.");
  }
  const args = record["arguments"];
  if (args === undefined) return reject("mission.proposal_malformed", "Proposal requires arguments.");
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return reject("mission.proposal_malformed", "Proposal arguments must be a JSON object.");
  }
  const intent = record["intent"];
  if (intent !== undefined && (typeof intent !== "string" || intent.length === 0)) {
    return reject("mission.proposal_malformed", "intent, when present, must be a nonempty string.");
  }
  if (typeof intent === "string" && intent.length > MAX_INTENT_CHARS) {
    return reject("mission.proposal_oversized", "intent exceeds the bounded size.");
  }
  if (record["requestedCapabilities"] !== undefined) {
    if (!Array.isArray(record["requestedCapabilities"])) {
      return reject("mission.proposal_malformed", "requestedCapabilities must be an array (it is recorded, never honored).");
    }
    for (const requested of record["requestedCapabilities"]) {
      if (typeof requested !== "string") {
        return reject("mission.proposal_malformed", "requestedCapabilities entries must be strings.");
      }
    }
  }

  // Canonical size bounds BEFORE any registry lookups (cheap fail-closed).
  const canonicalArgs = JSON.stringify(sortObjectKeys(args as Record<string, unknown>)) ?? "";
  if (canonicalArgs.length > MAX_PROPOSAL_ARGUMENT_CHARS) {
    return reject("mission.proposal_oversized", "Proposal arguments exceed the bounded size.");
  }

  // Capability must exist. Unknown capabilities never pass.
  const descriptor = options.index.descriptors.get(capability);
  const isTool = options.index.toolIds.has(capability);
  if (!descriptor && !isTool) {
    return reject("mission.proposal_unknown_capability", `Capability '${capability}' is not a registered action or tool.`);
  }

  // SERVER-DERIVED fields — model declarations are ignored for authority.
  // Risk mirrors the harness mapping so the parser classifies honestly even
  // though the harness re-derives (and enforces) risk at execution time.
  const riskLevel: ExecutionRiskLevel = descriptor ? riskLevelForDescriptor(descriptor) : "REVERSIBLE"; // tools are conservative-reversible in v1
  const timeoutMs = descriptor ? Math.min(descriptor.timeoutMs, 60_000) : 30_000;
  const sandbox: ExecutionSandbox = "IN_PROCESS_TRUSTED";
  const idempotencyKey = stepIdempotencyKey(options.missionId, options.stepIndex, capability);

  const proposal: ActionProposal = {
    id: createId("proposal"),
    missionId: options.missionId,
    capability,
    ...(descriptor ? { providerId: descriptor.providerId } : {}),
    arguments: canonicalObject(args as Record<string, unknown>),
    intent: typeof intent === "string" ? intent : `Governed mission step ${options.stepIndex}: ${capability}`,
    riskLevel,
    sandbox,
    idempotencyKey,
    timeoutMs,
    selectionReason: `model proposal for step ${options.stepIndex} (parsed under ${ACTION_PROPOSAL_SCHEMA_REF})`,
    proposedAt: new Date().toISOString(),
    proposedBy: options.actor,
  };
  return ok({ kind: "act", proposal });
}

/** Descriptor risk-class → loop execution risk level (mirrors harness mapping). */
function riskLevelForDescriptor(descriptor: ActionDescriptorV1): ExecutionRiskLevel {
  switch (descriptor.riskClass) {
    case "READ_ONLY": return "READ_ONLY";
    case "LOW_RISK_WRITE": return "REVERSIBLE";
    case "EXTERNAL_COMMUNICATION": return "REVERSIBLE";
    // v1 fails closed before execution for anything stronger — the harness
    // enforces this too; the parser still classifies honestly.
    default: return "IRREVERSIBLE";
  }
}

/** Canonical (key-sorted) copy so identical semantic arguments are identical ledger inputs. */
function canonicalObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(sortObjectKeys(value)) as JsonObject;
}

function sortObjectKeys(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of keys) ordered[key] = value[key];
  return JSON.stringify(ordered);
}

/** Snapshot of action/tool availability for parser validation. */
export async function buildCapabilityIndex(
  actionProviders: readonly { discoverActions(options?: { signal?: AbortSignal }): Promise<readonly ActionDescriptorV1[]> }[],
  toolRegistry: ToolRegistry,
  signal?: AbortSignal,
): Promise<ProposalCapabilityIndex> {
  const descriptors = new Map<string, ActionDescriptorV1>();
  for (const provider of actionProviders) {
    const actions = await provider.discoverActions({ signal }).catch(() => [] as readonly ActionDescriptorV1[]);
    for (const descriptor of actions) descriptors.set(descriptor.id, descriptor);
  }
  const toolIds = new Set<string>(toolRegistry.list().map((metadata) => metadata.id));
  return { descriptors, toolIds };
}

// ---------------------------------------------------------------------------
// Deterministic QIE layer construction for the governed loop.
// ---------------------------------------------------------------------------

export interface GovernedMissionContextInput {
  readonly missionId: string;
  readonly taskId?: string;
  readonly objective: string;
  readonly actor: string;
  /** Host-owned constraints (safety, scope) — TRUSTED_RUNTIME lane. */
  readonly constraints?: readonly string[];
  /** P9 governed retrieval hits already reduced to QIE candidates (MEMORY trust). */
  readonly memoryCandidates?: readonly ContextCandidate[];
}

/**
 * Deterministically construct the InstructionPlan for one governed
 * iteration. Layers are host-owned TRUSTED_RUNTIME (source must be
 * registered in the firewall's runtimeSources) except memory candidates
 * (MEMORY trust, admitted through the P8.3 firewall by the loop before
 * selection). Fails closed when the plan itself fails QIE validation.
 */
export function buildIterationPlan(input: GovernedMissionContextInput, stepIndex: number): QuackResult<InstructionPlan> {
  const runtimeSource = "governed-mission-loop";
  const layers: InstructionLayer[] = [];
  const push = (name: InstructionLayer["name"], items: readonly ContextSourceItem[]): void => {
    if (items.length > 0) layers.push({ name, items });
  };

  push("identity", [{
    id: `identity:${input.missionId}`,
    provenance: { source: runtimeSource, category: "identity", trust: "TRUSTED_RUNTIME" },
    data: { actor: input.actor },
  }]);
  push("objective", [{
    id: `objective:${input.missionId}`,
    provenance: { source: runtimeSource, category: "mission", trust: "TRUSTED_RUNTIME" },
    data: { objective: input.objective, step: stepIndex },
  }]);
  if (input.constraints && input.constraints.length > 0) {
    push("constraints", input.constraints.map((text, i) => ({
      id: `constraint:${input.missionId}:${i}`,
      provenance: { source: runtimeSource, category: "constraint", trust: "TRUSTED_RUNTIME" as const },
      data: { text },
    })));
  }
  if (input.memoryCandidates && input.memoryCandidates.length > 0) {
    // Memory candidates carry their own MEMORY provenance from P9 — trust
    // lanes are never upgraded here. The loop admits them through the
    // P8.3 firewall (with admittedMemory backing) before selection.
    layers.push({ name: "memory", items: input.memoryCandidates.map((candidate) => candidate.item) });
  }

  return createInstructionPlan({
    missionId: input.missionId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    layers,
    budget: { maxInstructionChars: 24_000, reservedOutputChars: 4_000, maxItemChars: 2_000 },
    outputContract: { kind: "toolIntent", schemaRef: ACTION_PROPOSAL_SCHEMA_REF, requirements: {
      format: "single JSON object matching quack:action-proposal:v1",
      capability: "registered action or tool id only",
      completion: "done=true with bounded finalMessage when the objective is met",
    } },
    failurePolicy: { allowedModes: ["insufficient_context", "capability_unavailable", "capability_denied"], preferAdmission: false },
  });
}
