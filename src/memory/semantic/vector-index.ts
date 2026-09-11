import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  SEMANTIC_MEMORY_BOUNDS,
  type SemanticMemoryScope,
} from "./records.js";

/**
 * P9.10 derived semantic vector index (ADR 0043).
 *
 * The index is DERIVED infrastructure: it holds chunk vectors + scope
 * metadata for fast cosine retrieval, and the canonical memory record
 * remains the single source of truth. Invariants:
 *
 * - an index entry exists ONLY for a live canonical record chunk (orphan
 *   entries are swept on load and on every rebuild)
 * - deletion of a memory removes all its chunks here (P9.18 propagation)
 * - duplicate (chunkId) inserts are idempotent upserts (deterministic
 *   recovery from interrupted writes)
 * - ranking ties break by chunkId — insertion order never decides (P9.12)
 */

export interface IndexedChunk {
  readonly chunkId: string;
  readonly memoryId: string;
  readonly scope: SemanticMemoryScope;
  readonly owner: string;
  readonly contentHash: string;
  readonly position: number;
  readonly vector: readonly number[];
  readonly embeddingVersion: number;
}

/** A scored index match — score is relevance, never authority (P9.14). */
export interface IndexMatch {
  readonly entry: IndexedChunk;
  readonly score: number;
}

/** Cosine similarity — dimension-guarded, deterministic. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

/**
 * In-memory derived index over semantic memory chunks, with an OPTIONAL
 * durable vector-cache file. The cache is pure acceleration: on load every
 * cached entry is re-validated against the caller's live-record view
 * (memoryId present, scope/owner/position/contentHash matching the
 * canonical record's chunks), so an interrupted write, a tampered cache, or
 * a deleted memory can never surface as retrievable (P9.20). A missing or
 * corrupt cache simply means a slower rebuild path, never wrong results.
 */
export class SemanticMemoryIndex {
  private entries = new Map<string, IndexedChunk>();
  private readonly cachePath?: string;
  private cacheLoaded = false;

  constructor(cachePath?: string) {
    this.cachePath = cachePath;
  }

  /** Upsert one chunk entry — idempotent, deterministic recovery safe. */
  upsert(entry: IndexedChunk): void {
    this.entries.set(entry.chunkId, { ...entry, vector: [...entry.vector] });
  }

  /** Remove a chunk entry. Returns true when an entry was removed. */
  removeChunk(chunkId: string): boolean {
    return this.entries.delete(chunkId);
  }

  /** P9.18 deletion propagation: remove every chunk of one memory. */
  removeMemory(memoryId: string): number {
    let removed = 0;
    for (const [chunkId, entry] of this.entries) {
      if (entry.memoryId === memoryId) {
        this.entries.delete(chunkId);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * P9.11 governed search: scope/owner/lifecycle/visibility filtering is
   * the CALLER's policy job (see retrieval.ts) — this method only computes
   * deterministic semantic ranking over the supplied filter, with stable
   * chunkId tie-breakers (P9.12) and a bounded limit.
   */
  search(query: readonly number[], filter: (entry: IndexedChunk) => boolean, limit: number = SEMANTIC_MEMORY_BOUNDS.maxRetrievalResults): readonly IndexMatch[] {
    const bounded = Math.max(1, Math.min(limit, SEMANTIC_MEMORY_BOUNDS.maxRetrievalResults));
    const scored: IndexMatch[] = [];
    for (const entry of this.entries.values()) {
      if (!filter(entry)) continue;
      scored.push({ entry, score: cosineSimilarity(query, entry.vector) });
    }
    scored.sort((left, right) => {
      const byScore = right.score - left.score;
      if (byScore !== 0) return byScore;
      return left.entry.chunkId < right.entry.chunkId ? -1 : 1;
    });
    return scored.slice(0, bounded);
  }

  /** Deterministic rebuild: keep only entries whose memory ids are live. */
  sweepOrphans(liveMemoryIds: ReadonlySet<string>): number {
    let removed = 0;
    for (const [chunkId, entry] of this.entries) {
      if (!liveMemoryIds.has(entry.memoryId)) {
        this.entries.delete(chunkId);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.entries.size;
  }

  /** Deterministic stats (Studio/CLI inspection). */
  stats(): { chunkCount: number; memoryCount: number; scopes: Record<string, number> } {
    const scopes: Record<string, number> = {};
    const memories = new Set<string>();
    for (const entry of this.entries.values()) {
      memories.add(entry.memoryId);
      scopes[entry.scope] = (scopes[entry.scope] ?? 0) + 1;
    }
    return { chunkCount: this.entries.size, memoryCount: memories.size, scopes };
  }

  /**
   * Load the durable vector cache (if configured). Entries are validated
   * against the caller-supplied live-chunk view (identity + content hash +
   * scope + owner + position + embedding version); anything that does not
   * match a live canonical chunk is dropped. Never throws — a corrupt cache
   * is discarded.
   */
  async loadCache(liveChunks: ReadonlyMap<string, { contentHash: string; scope: SemanticMemoryScope; owner: string; position: number; memoryId: string; embeddingVersion: number }>): Promise<number> {
    if (!this.cachePath || this.cacheLoaded) return 0;
    this.cacheLoaded = true;
    try {
      const raw = await readFile(this.cachePath, "utf8");
      const parsed = JSON.parse(raw) as { version?: number; entries?: unknown };
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return 0;
      let restored = 0;
      for (const value of parsed.entries) {
        const entry = value as Partial<IndexedChunk>;
        if (typeof entry.chunkId !== "string" || !Array.isArray(entry.vector)) continue;
        const live = liveChunks.get(entry.chunkId);
        if (!live || live.contentHash !== entry.contentHash
          || live.scope !== entry.scope || live.owner !== entry.owner
          || live.position !== entry.position || live.memoryId !== entry.memoryId
          || live.embeddingVersion !== entry.embeddingVersion) continue;
        if (entry.vector.some((component) => typeof component !== "number" || !Number.isFinite(component))) continue;
        this.entries.set(entry.chunkId, {
          chunkId: entry.chunkId, memoryId: entry.memoryId, scope: entry.scope, owner: entry.owner,
          contentHash: entry.contentHash, position: entry.position, vector: entry.vector as number[],
          embeddingVersion: entry.embeddingVersion,
        });
        restored += 1;
      }
      return restored;
    } catch {
      return 0; // missing/corrupt cache — rebuild path
    }
  }

  /** Persist the current entries to the durable cache (atomic write). */
  async persistCache(): Promise<void> {
    if (!this.cachePath) return;
    try {
      await mkdir(dirname(this.cachePath), { recursive: true });
      const tmpPath = `${this.cachePath}.tmp-${process.pid}-${randomUUID()}`;
      await writeFile(tmpPath, JSON.stringify({ version: 1, entries: [...this.entries.values()] }, null, 2), "utf8");
      await rename(tmpPath, this.cachePath);
    } catch {
      // Cache persistence is best-effort acceleration, never a correctness path.
    }
  }
}

/** Deterministic index-entry identity check (P9.29 — one representation per chunk). */
export function indexEntryHash(entry: IndexedChunk): string {
  return createHash("sha256")
    .update(`${entry.chunkId}:${entry.memoryId}:${entry.scope}:${entry.contentHash}:${String(entry.position)}:${String(entry.embeddingVersion)}`)
    .digest("hex");
}
