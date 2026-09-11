import type { SemanticMemoryRecord } from "./records.js";
import type { SemanticRetrievalResult } from "./retrieval.js";

/**
 * P9.21 memory evaluation dimensions (ADR 0043).
 *
 * Extends the existing harness evaluation approach (P5/P8.6 pattern):
 * pure, deterministic scoring from METADATA-ONLY evidence — never memory
 * content. The MissionEvaluator consumes these dimensions; there is no
 * second evaluator. Dimensions are ABSENT (undefined) when a mission used
 * no semantic memory, mirroring the P8.6 absent-without-records contract.
 *
 * Measurable claims only — no invented "semantic quality" scores:
 *
 * - `scopeCorrectness`: retrieved records whose scope/owner match the
 *   retrieval context (cross-scope leakage is the failure signal).
 * - `provenanceCompleteness`: records whose provenance names a real
 *   source kind and identity.
 * - `deletionCorrectness`: deleted records that stayed deleted (no
 *   post-deletion retrieval hits).
 */

/** Memory evaluation dimensions (0–100, higher is better). */
export interface MemoryQualityDimensions {
  readonly scopeCorrectness: number;
  readonly provenanceCompleteness: number;
  readonly deletionCorrectness: number;
}

/** Metadata-only evidence the scorer consumes. */
export interface MemoryEvaluationEvidence {
  /** All records ever admitted in the observed window (metadata view). */
  readonly records: readonly SemanticMemoryRecord[];
  /** Deletion observations: memory ids requested deleted. */
  readonly deletedIds: readonly string[];
  /** Retrieval observations (hits only — scores as numbers, no vectors). */
  readonly retrievals: readonly {
    readonly scope: string;
    readonly owner: string;
    readonly hitMemoryIds: readonly string[];
  }[];
}

export interface MemoryQualityResult {
  readonly dimensions: MemoryQualityDimensions;
  /** Number of records the scores were derived from (0 = no memory data). */
  readonly recordCount: number;
}

/** Score memory behavior from metadata-only evidence. Deterministic. */
export function scoreMemoryQuality(evidence: MemoryEvaluationEvidence): MemoryQualityResult {
  const records = evidence.records;
  if (records.length === 0) {
    return {
      dimensions: { scopeCorrectness: 0, provenanceCompleteness: 0, deletionCorrectness: 0 },
      recordCount: 0,
    };
  }

  // scopeCorrectness: retrievals that returned only same-scope/owner
  // records score 100; each cross-boundary hit proportionally fails.
  let retrievalChecks = 0;
  let retrievalViolations = 0;
  const recordsById = new Map(records.map((record) => [record.memoryId, record]));
  for (const retrieval of evidence.retrievals) {
    for (const hitId of retrieval.hitMemoryIds) {
      retrievalChecks += 1;
      const record = recordsById.get(hitId);
      if (!record || record.scope !== retrieval.scope || record.owner !== retrieval.owner) {
        retrievalViolations += 1;
      }
    }
  }
  const scopeCorrectness = retrievalChecks === 0 ? 100
    : clamp(Math.round(100 * (1 - retrievalViolations / retrievalChecks)));

  // provenanceCompleteness: records with a known source kind and a
  // non-empty source identity.
  const complete = records.filter((record) =>
    ["user", "mission", "file", "workspace", "runtime"].includes(record.provenance.sourceKind)
    && record.provenance.sourceId.length > 0).length;
  const provenanceCompleteness = clamp(Math.round(100 * complete / records.length));

  // deletionCorrectness: deleted ids that never appear in a later
  // retrieval. No deletions observed is neutral (100 — nothing violated).
  const deletedSet = new Set(evidence.deletedIds);
  const leakedAfterDeletion = evidence.retrievals.reduce((total, retrieval) =>
    total + retrieval.hitMemoryIds.filter((id) => deletedSet.has(id)).length, 0);
  const deletionCorrectness = deletedSet.size === 0 ? 100
    : clamp(Math.round(100 * (1 - leakedAfterDeletion / deletedSet.size)));

  return {
    dimensions: { scopeCorrectness, provenanceCompleteness, deletionCorrectness },
    recordCount: records.length,
  };
}

/** Flatten retrieval results into evaluation evidence (scores dropped). */
export function retrievalToEvidence(retrievals: readonly SemanticRetrievalResult[]): MemoryEvaluationEvidence["retrievals"] {
  return retrievals.map((retrieval) => ({
    scope: retrieval.scope,
    owner: retrieval.owner,
    hitMemoryIds: retrieval.hits.map((hit) => hit.memory.memoryId),
  }));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
