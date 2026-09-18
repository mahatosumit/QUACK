import { ok, type QuackResult } from "../../core/types.js";
import {
  SEMANTIC_MEMORY_BOUNDS,
  type SemanticMemoryRecord,
  type SemanticMemoryScope,
} from "./records.js";
import { type SemanticMemoryIndex } from "./vector-index.js";

/**
 * P9.11 governed semantic retrieval (ADR 0043).
 *
 *   query → policy filtering → semantic retrieval → metadata filtering
 *     → deterministic ranking/tie-breaking → explicit context candidates
 *     → P8.3 firewall (never a direct prompt injection)
 *
 * Retrieval enforces scope, ownership, and lifecycle policy BEFORE any
 * ranking: a record that fails policy is invisible, not merely low-scored.
 * Results are explicit retrieved-record references carrying full provenance
 * — text never flows straight into a prompt (P9.13).
 *
 * P9.12 determinism: index matches break score ties by chunkId; the
 * memory-level ordering here is (score desc, memoryId asc), so identical
 * inputs and stores produce identical results regardless of insertion order.
 */

/** Explicit retrieval query context + policy. */
export interface SemanticRetrievalQuery {
  readonly text: string;
  /** Query vector — produced by a governed embed of the query text. */
  readonly queryVector: readonly number[];
  /** The scope being retrieved FROM. */
  readonly scope: SemanticMemoryScope;
  /** The acting owner — cross-owner records are never visible. */
  readonly owner: string;
  /** Optional source-kind restriction (knowledge-source policy). */
  readonly allowedSourceKinds?: readonly string[];
  readonly limit?: number;
}

/** A governed retrieval hit — a canonical record reference, provenance preserved. */
export interface SemanticRetrievalHit {
  readonly memory: SemanticMemoryRecord;
  /** Score in [0,1] — relevance, never authority (P9.14). */
  readonly score: number;
  readonly matchedChunkId: string;
}

export interface SemanticRetrievalResult {
  readonly hits: readonly SemanticRetrievalHit[];
  /** Ids of the admitted memory records — the P8.3 `admittedMemory` view input. */
  readonly admittedMemoryIds: readonly string[];
  readonly scope: SemanticMemoryScope;
  readonly owner: string;
}

/**
 * Governed semantic retrieval over the derived index. Policy filtering
 * (scope, owner, lifecycle, source policy) happens inside the index filter
 * so violating records never reach scoring. The canonical records are
 * resolved from the caller-supplied live-record view (single source of
 * truth) and re-checked against lifecycle.
 */
export function retrieveSemanticMemory(
  index: SemanticMemoryIndex,
  recordsById: ReadonlyMap<string, SemanticMemoryRecord>,
  query: SemanticRetrievalQuery,
): QuackResult<SemanticRetrievalResult> {
  if (typeof query.text !== "string" || query.text.trim().length === 0) {
    return { ok: false, error: { code: "memory.retrieval_invalid", message: "retrieval requires non-empty query text", category: "validation", recoverable: true } };
  }
  if (!Array.isArray(query.queryVector) || query.queryVector.length === 0) {
    return { ok: false, error: { code: "memory.retrieval_invalid", message: "retrieval requires a query vector", category: "validation", recoverable: false } };
  }
  const limit = Math.max(1, Math.min(query.limit ?? SEMANTIC_MEMORY_BOUNDS.maxRetrievalResults, SEMANTIC_MEMORY_BOUNDS.maxRetrievalResults));

  const allowedSources = query.allowedSourceKinds ? new Set(query.allowedSourceKinds) : undefined;
  const matches = index.search(
    query.queryVector,
    (entry) =>
      entry.scope === query.scope
      && entry.owner === query.owner
      && (allowedSources ? allowedSources.has(entry.scope) : true),
    limit,
  );

  // Best chunk per memory: matches arrive (score desc, chunkId asc) — the
  // first match for a memory is its best chunk; later duplicates skipped.
  const bestByMemory = new Map<string, { score: number; chunkId: string; scope: string; owner: string }>();
  for (const match of matches) {
    if (bestByMemory.has(match.entry.memoryId)) continue;
    bestByMemory.set(match.entry.memoryId, { score: match.score, chunkId: match.entry.chunkId, scope: match.entry.scope, owner: match.entry.owner });
  }

  // Deterministic memory-level ordering: (score desc, memoryId asc).
  const ordered = [...bestByMemory.entries()].sort((left, right) => {
    const byScore = right[1].score - left[1].score;
    return byScore !== 0 ? byScore : left[0] < right[0] ? -1 : 1;
  });

  const hits: SemanticRetrievalHit[] = [];
  for (const [memoryId, best] of ordered) {
    const record = recordsById.get(memoryId);
    // P9.18: deleted/retired canonical records never surface, even if a
    // stale index entry somehow survived.
    if (!record || record.lifecycle !== "active") continue;
    if (record.scope !== query.scope || record.owner !== query.owner) continue;
    hits.push({ memory: record, score: best.score, matchedChunkId: best.chunkId });
    if (hits.length >= limit) break;
  }

  return ok({
    hits,
    admittedMemoryIds: hits.map((hit) => hit.memory.memoryId),
    scope: query.scope,
    owner: query.owner,
  });
}
