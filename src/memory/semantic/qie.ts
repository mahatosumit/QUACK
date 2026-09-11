import { ok, type QuackResult } from "../../core/types.js";
import { admitContext, type FirewallAuthorities } from "../../instruction/firewall.js";
import { DEFAULT_CATEGORY_LAYER, selectContext, type ContextCandidate, type SelectionInput, type SelectionResult } from "../../instruction/selector.js";
import type { InstructionLayerName } from "../../instruction/types.js";
import type { SemanticRetrievalResult } from "./retrieval.js";

/**
 * P9.13 QIE integration (ADR 0043).
 *
 * Retrieved semantic memory enters the EXISTING P8 instruction pipeline —
 * there is no memory prompt composer, no manual concatenation, no selector
 * bypass, no firewall bypass, no second digest:
 *
 *   memory retrieval → explicit ContextCandidate (trust = MEMORY,
 *     category = memory) → P8.3 PrivacyFirewall (admittedMemory backing)
 *     → P8.2 Selector → P8.1 Composer (single budget authority)
 *     → P8.5 Defense → P8.4 Adapter → GovernedModelRuntime
 *
 * P9.14: memory candidates carry the MEMORY trust class — the lowest
 * authoritative data lane per P8.1 precedence. Retrieval relevance (the
 * score) is metadata; it is NOT authority and never reorders trust.
 */

/** Build explicit QIE context candidates from governed retrieval hits. */
export function memoryCandidatesFromRetrieval(result: SemanticRetrievalResult): readonly ContextCandidate[] {
  return result.hits.map((hit) => memoryCandidate(hit.memory.memoryId, hit.memory.content, hit.score, hit.matchedChunkId));
}

/**
 * One memory context candidate. Deterministic ids: `memory:<memoryId>`.
 * The item carries provenance (source = "semantic-memory", category =
 * "memory", trust = "MEMORY") and DATA ONLY — content and bounded
 * relevance metadata. Authority fields live exclusively in the P8.3
 * admission views, never in candidate content.
 */
export function memoryCandidate(memoryId: string, content: string, score: number, matchedChunkId?: string): ContextCandidate {
  return {
    item: {
      id: `memory:${memoryId}`,
      provenance: { source: "semantic-memory", category: "memory", trust: "MEMORY" },
      data: {
        memoryId,
        content,
        relevanceScore: Math.max(0, Math.min(1, score)),
        ...(matchedChunkId ? { matchedChunkId } : {}),
      },
    },
    layer: "memory" satisfies InstructionLayerName,
  };
}

/** The P8.3 authority snapshot fragment semantic memory supplies. */
export function semanticMemoryAuthorities(result: SemanticRetrievalResult): FirewallAuthorities {
  return { admittedMemory: result.admittedMemoryIds };
}

export interface MemoryQiePipelineInput extends Omit<SelectionInput, "candidates"> {
  /** Governed retrieval result (hits → candidates, ids → firewall backing). */
  readonly retrieval: SemanticRetrievalResult;
  /** Additional candidates from other sources (optional). */
  readonly extraCandidates?: readonly ContextCandidate[];
  /** Additional P8.3 authority lanes from the caller (runtime/skills/evidence/capabilities). */
  readonly extraAuthorities?: AuthorityExtras;
}

export interface MemoryQiePipelineResult {
  /** The candidates ready for the P8.3 firewall (memory + extras, unchanged). */
  readonly candidates: readonly ContextCandidate[];
  /** P8.3 admission result — only admitted candidates flow to P8.2. */
  readonly admission: ReturnType<typeof admitContext>;
  /** P8.2 selection result when admission succeeded (the assembled plan). */
  readonly selection?: SelectionResult;
}

/** Authority lanes other than memory — caller-supplied snapshots. */
export type AuthorityExtras = Partial<Omit<FirewallAuthorities, "admittedMemory">>;

/**
 * Full memory → QIE path: candidates from retrieval, P8.3 admission with
 * memory-id backing, P8.2 selection when admitted. Deterministic; fails
 * closed through the existing QIE components (this function adds no
 * policy of its own — P9.29).
 */
export function pipelineMemoryToQie(input: MemoryQiePipelineInput): MemoryQiePipelineResult {
  const candidates = [...memoryCandidatesFromRetrieval(input.retrieval), ...(input.extraCandidates ?? [])];
  const admission = admitContext({
    candidates,
    authorities: { ...input.extraAuthorities, ...semanticMemoryAuthorities(input.retrieval) },
  });
  if (!admission.ok) return { candidates, admission };
  const { retrieval: _retrieval, extraCandidates: _extra, extraAuthorities: _authorities, ...selectionInput } = input;
  const selection = selectContext({ ...selectionInput, candidates: [...admission.admitted] } as SelectionInput);
  return { candidates, admission, selection };
}

/** Convenience: default layer for memory candidates is always "memory". */
export function memoryLayerName(): InstructionLayerName {
  return DEFAULT_CATEGORY_LAYER.memory;
}

/** Validate that a selection result kept memory items in the MEMORY lane (defense in depth for tests). */
export function memoryLanePreserved(selection: SelectionResult | undefined, expectedMemoryIds: readonly string[]): boolean {
  if (!selection?.plan) return expectedMemoryIds.length === 0;
  const layer = selection.plan.layers.find((candidate) => candidate.name === "memory");
  const seen = layer?.items.map((item) => item.id) ?? [];
  return expectedMemoryIds.every((id) => seen.includes(`memory:${id}`));
}
