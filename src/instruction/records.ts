import { fail, ok, type IsoTimestamp, type JsonObject, type QuackResult } from "../core/types.js";
import type { ComposedInstruction, InstructionOutputKind, TrustClass } from "./types.js";
import type { InjectionFlag } from "./injection-defense.js";

/**
 * P8.6 instruction dispatch records (ADR 0042).
 *
 * A `GovernedInstructionRecord` is the durable, METADATA-ONLY account of one
 * governed instruction dispatch. It is what the harness/evaluation layer
 * consumes to score instruction quality WITHOUT ever touching instruction
 * content: the record carries identity (digest, mission/task), layer/item
 * census, trust-lane distribution, budget application, defense outcome, and
 * injection flags — never item data, never rendered prompt text.
 *
 * Records are built from a composed instruction + the defense result of the
 * actual dispatch, so they cannot disagree with what was enforced. They are
 * serializable (`JsonObject`-compatible) so they can ride inside the
 * existing MissionTrace payload (traces persist as full JSON payloads in the
 * existing trace repository — additive, no schema migration).
 */

/** Disposition of one governed instruction dispatch attempt. */
export type InstructionDispatchOutcome =
  | "dispatched"      // passed defense + adaptation, sent to the governed runtime
  | "rejected"       // failed defense or adaptation (fail-closed; never dispatched)
  | "provider_error" // dispatched; governed runtime/provider returned an error
  | "denied";        // dispatched; capability authority denied before provider contact

/** Failure-code vocabulary for rejected/errored dispatches (metadata only). */
export type InstructionRecordErrorCode =
  | "instruction.defense_shape_invalid"
  | "instruction.defense_digest_mismatch"
  | "instruction.defense_item_id_unsafe"
  | "instruction.defense_trust_pairing_violated"
  | "instruction.defense_evidence_status_invalid"
  | "instruction.duplicate_item_id"
  | "instruction.adaptation_invalid";

/** Per-layer census — counts and trust distribution, no content. */
export interface InstructionLayerCensus {
  readonly layer: string;
  readonly itemCount: number;
  /** Distinct trust classes present, sorted by P8.1 precedence rank. */
  readonly trusts: readonly TrustClass[];
}

/**
 * The metadata-only record. Field-for-field:
 * - `digest` identifies instruction content (P8.1 canonical SHA-256) — the
 *   record never contains the content itself.
 * - `injectionFlags` are the P8.5 metadata-only flags (item id, trust,
 *   category, pattern kinds) — never matched content.
 * - `omittedItemCount`/`withinBudget` come from the P8.1 budget report —
 *   selection transparency without echoing dropped items' data.
 */
export interface GovernedInstructionRecord {
  readonly recordId: string;
  readonly missionId: string;
  readonly taskId?: string;
  readonly digest: string;
  readonly planVersion: number;
  readonly outputContractKind: InstructionOutputKind;
  readonly outcome: InstructionDispatchOutcome;
  readonly errorCode?: InstructionRecordErrorCode;
  readonly layerCensus: readonly InstructionLayerCensus[];
  readonly totalItems: number;
  /** Items omitted by the P8.1 budget (recorded omissions, count only). */
  readonly omittedItemCount: number;
  readonly withinBudget: boolean;
  readonly injectionFlagCount: number;
  readonly injectionFlags: readonly InjectionFlag[];
  readonly dispatchedAt: IsoTimestamp;
}

/** Count of distinct trust classes per record — derived, not stored. */
export function distinctTrustClasses(record: GovernedInstructionRecord): readonly TrustClass[] {
  const set = new Set<TrustClass>();
  for (const census of record.layerCensus) {
    for (const trust of census.trusts) set.add(trust);
  }
  return [...set];
}

/**
 * Build a metadata-only dispatch record from a composed instruction and its
 * defense result. Pure: derives census from `composed.layers`, budget facts
 * from `composed.budgetReport`, flags from the defense result. `recordId`
 * and `dispatchedAt` are caller-supplied (execution identity, not derived
 * here — the record never fabricates identity). The digest is PRESERVED
 * verbatim from the composed instruction.
 */
export function buildInstructionRecord(input: {
  readonly composed: ComposedInstruction;
  readonly flags: readonly InjectionFlag[];
  readonly outcome: InstructionDispatchOutcome;
  readonly errorCode?: InstructionRecordErrorCode;
  readonly recordId: string;
  readonly dispatchedAt: IsoTimestamp;
}): GovernedInstructionRecord {
  const { composed } = input;
  const layerCensus: InstructionLayerCensus[] = composed.layers.map((layer) => {
    const trusts = [...new Set(layer.items.map((item) => item.provenance.trust))];
    return { layer: layer.name, itemCount: layer.items.length, trusts };
  });
  return {
    recordId: input.recordId,
    missionId: composed.missionId,
    ...(composed.taskId ? { taskId: composed.taskId } : {}),
    digest: composed.digest,
    planVersion: composed.planVersion,
    outputContractKind: composed.outputContract.kind,
    outcome: input.outcome,
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    layerCensus,
    totalItems: composed.layers.reduce((total, layer) => total + layer.items.length, 0),
    omittedItemCount: composed.budgetReport.omitted.length,
    withinBudget: composed.budgetReport.withinBudget,
    injectionFlagCount: input.flags.length,
    injectionFlags: [...input.flags],
    dispatchedAt: input.dispatchedAt,
  };
}

/**
 * Serialize a record to a plain JsonObject (for trace payloads / events /
 * dashboard state). Never includes content beyond what the record already
 * carries (which is metadata-only by construction).
 */
export function recordToJsonObject(record: GovernedInstructionRecord): JsonObject {
  return JSON.parse(JSON.stringify(record)) as JsonObject;
}

/**
 * Parse + validate a persisted record (fail-closed). Rejects unknown
 * outcome/errorCode values, malformed layer census, or a non-sha256 digest,
 * so a tampered or fabricated record can never silently enter evaluation.
 */
export function parseInstructionRecord(value: unknown): QuackResult<GovernedInstructionRecord> {
  const invalid = (message: string): QuackResult<GovernedInstructionRecord> =>
    fail({ code: "instruction.record_invalid", message, category: "validation", recoverable: true });

  if (typeof value !== "object" || value === null) return invalid("record must be an object");
  const record = value as Record<string, unknown>;
  if (typeof record["recordId"] !== "string" || record["recordId"].length === 0) return invalid("recordId is required");
  if (typeof record["missionId"] !== "string" || record["missionId"].length === 0) return invalid("missionId is required");
  if (typeof record["digest"] !== "string" || !/^[0-9a-f]{64}$/.test(record["digest"])) return invalid("digest must be a sha256 hex string");
  if (typeof record["planVersion"] !== "number") return invalid("planVersion is required");
  if (typeof record["outputContractKind"] !== "string") return invalid("outputContractKind is required");
  const outcome = record["outcome"];
  const OUTCOMES = new Set(["dispatched", "rejected", "provider_error", "denied"]);
  if (typeof outcome !== "string" || !OUTCOMES.has(outcome)) return invalid(`unknown outcome ${String(outcome)}`);
  const ERROR_CODES = new Set([
    "instruction.defense_shape_invalid",
    "instruction.defense_digest_mismatch",
    "instruction.defense_item_id_unsafe",
    "instruction.defense_trust_pairing_violated",
    "instruction.defense_evidence_status_invalid",
    "instruction.duplicate_item_id",
    "instruction.adaptation_invalid",
  ]);
  const errorCode = record["errorCode"];
  if (errorCode !== undefined && (typeof errorCode !== "string" || !ERROR_CODES.has(errorCode))) {
    return invalid(`unknown errorCode ${String(errorCode)}`);
  }
  if (!Array.isArray(record["layerCensus"])) return invalid("layerCensus is required");
  for (const entry of record["layerCensus"]) {
    if (typeof entry !== "object" || entry === null || typeof (entry as Record<string, unknown>)["layer"] !== "string"
      || typeof (entry as Record<string, unknown>)["itemCount"] !== "number" || !Array.isArray((entry as Record<string, unknown>)["trusts"])) {
      return invalid("layerCensus entry is malformed");
    }
  }
  if (typeof record["totalItems"] !== "number" || typeof record["omittedItemCount"] !== "number"
    || typeof record["withinBudget"] !== "boolean" || typeof record["injectionFlagCount"] !== "number"
    || !Array.isArray(record["injectionFlags"]) || typeof record["dispatchedAt"] !== "string") {
    return invalid("record budget/flag/dispatch fields are malformed");
  }
  if (record["injectionFlagCount"] !== record["injectionFlags"].length) {
    return invalid("injectionFlagCount does not match injectionFlags length");
  }
  return ok({
    recordId: record["recordId"] as string,
    missionId: record["missionId"] as string,
    ...(typeof record["taskId"] === "string" ? { taskId: record["taskId"] as string } : {}),
    digest: record["digest"] as string,
    planVersion: record["planVersion"] as number,
    outputContractKind: record["outputContractKind"] as InstructionOutputKind,
    outcome: outcome as InstructionDispatchOutcome,
    ...(errorCode !== undefined ? { errorCode: errorCode as InstructionRecordErrorCode } : {}),
    layerCensus: record["layerCensus"] as unknown as InstructionLayerCensus[],
    totalItems: record["totalItems"] as number,
    omittedItemCount: record["omittedItemCount"] as number,
    withinBudget: record["withinBudget"] as boolean,
    injectionFlagCount: record["injectionFlagCount"] as number,
    injectionFlags: record["injectionFlags"] as unknown as InjectionFlag[],
    dispatchedAt: record["dispatchedAt"] as string,
  });
}
