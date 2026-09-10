import type { TrustClass } from "./types.js";
import { trustClassRank } from "./types.js";
import type { GovernedInstructionRecord } from "./records.js";

/**
 * P8.6 instruction quality scoring (ADR 0042).
 *
 * Pure, deterministic scoring over P8.6 metadata-only dispatch records —
 * never instruction content. This mirrors the P5 pattern (dimensions scored
 * 0–100 from the durable trace alone, no provider calls, no fabricated
 * comparisons), extended to the instruction layer:
 *
 * - `instructionIntegrity`: dispatches that passed structural defense and
 *   retained digest correspondence score high; rejected/errored dispatches
 *   are the instruction-layer failure signal.
 * - `contextProvenance`: how much of the assembled instruction is
 *   authoritative-trust vs. untrusted data lanes — a mission whose context
 *   is dominated by untrusted content is a weaker instruction even when it
 *   dispatches.
 * - `budgetDiscipline`: recorded omissions with a within-budget final
 *   assembly vs. silent overflow.
 *
 * The scorer consumes ONLY records (counts, trust names, booleans). It has
 * no access to prompts, item data, or providers, and it never rewrites or
 * re-derives trust — it reads the trust distribution the defense already
 * enforced.
 */

/** Per-dimension instruction quality scores (0–100, higher is better). */
export interface InstructionQualityDimensions {
  readonly instructionIntegrity: number;
  readonly contextProvenance: number;
  readonly budgetDiscipline: number;
}

/** Aggregate result over a mission's instruction dispatch records. */
export interface InstructionQualityResult {
  readonly dimensions: InstructionQualityDimensions;
  /** Number of records the scores were derived from (0 = no instruction data). */
  readonly recordCount: number;
  /** Digests seen — identity only, never content. */
  readonly digests: readonly string[];
}

/** Trust classes that carry authoritative instruction weight (P8.1). */
const AUTHORITATIVE_TRUSTS: ReadonlySet<TrustClass> = new Set(["SYSTEM_POLICY", "TRUSTED_RUNTIME", "USER_INPUT"]);

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Score instruction quality for one mission from its dispatch records.
 * Deterministic: identical records → identical scores. A mission with zero
 * records returns a conservative neutral result (dimensions 0 with
 * recordCount 0) — absence of instruction data is never rewarded or hidden.
 */
export function scoreInstructionQuality(records: readonly GovernedInstructionRecord[]): InstructionQualityResult {
  if (records.length === 0) {
    return {
      dimensions: { instructionIntegrity: 0, contextProvenance: 0, budgetDiscipline: 0 },
      recordCount: 0,
      digests: [],
    };
  }

  // --- instructionIntegrity: dispatched records are the success case;
  // rejected/provider_error/denied are instruction-layer failures.
  const dispatched = records.filter((record) => record.outcome === "dispatched");
  const integrityRatio = dispatched.length / records.length;
  const instructionIntegrity = clamp(integrityRatio * 100);

  // --- contextProvenance: share of items in authoritative trust lanes.
  let authoritativeItems = 0;
  let totalItems = 0;
  for (const record of records) {
    for (const census of record.layerCensus) {
      // A census entry's trust set describes its items; approximate the
      // item-weighted lane distribution deterministically from the census.
      totalItems += census.itemCount;
      const hasAuthoritative = census.trusts.some((trust) => AUTHORITATIVE_TRUSTS.has(trust));
      if (hasAuthoritative) authoritativeItems += census.itemCount;
    }
  }
  const authoritativeShare = totalItems === 0 ? 0 : authoritativeItems / totalItems;
  // A fully-authoritative instruction is not the goal either — data lanes
  // are legitimate context. Score the presence of authoritative framing:
  // 0 authoritative items is the failure; a healthy mix scores high.
  const contextProvenance = clamp(authoritativeShare * 60 + (authoritativeShare > 0 ? 40 : 0));

  // --- budgetDiscipline: recorded omissions are honest selection; silent
  // overflow or core-layer overflow would have failed composition (the
  // record could not exist). Within-budget dispatches with few omissions
  // score best; heavy omission means the mission context outgrew its plan.
  const totalOmitted = records.reduce((total, record) => total + record.omittedItemCount, 0);
  const totalItemsAll = records.reduce((total, record) => total + record.totalItems, 0);
  const omissionShare = totalItemsAll === 0 ? 0 : totalOmitted / (totalOmitted + totalItemsAll);
  const allWithinBudget = records.every((record) => record.withinBudget);
  const budgetDiscipline = clamp((allWithinBudget ? 70 : 40) + (1 - omissionShare) * 30);

  const digests = [...new Set(records.map((record) => record.digest))];

  return {
    dimensions: { instructionIntegrity, contextProvenance, budgetDiscipline },
    recordCount: records.length,
    digests,
  };
}

/**
 * Highest-precedence trust lane present across a record set — a compact
 * provenance summary for trace/dashboards (metadata only).
 */
export function dominantTrustLane(records: readonly GovernedInstructionRecord[]): TrustClass | undefined {
  let best: TrustClass | undefined;
  let bestRank = Number.MAX_SAFE_INTEGER;
  for (const record of records) {
    for (const census of record.layerCensus) {
      for (const trust of census.trusts) {
        const rank = trustClassRank(trust);
        if (rank < bestRank) {
          bestRank = rank;
          best = trust;
        }
      }
    }
  }
  return best;
}
