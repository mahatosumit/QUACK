import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createId, now, type IsoTimestamp, type QuackResult, ok, fail } from "../../core/types.js";
import { atomicWriteFile, isMissingFile } from "../../core/utils.js";
import { compactRecords, type MemoryCompactOptions, type MemoryCompactResult } from "../memory.js";
import {
  SEMANTIC_MEMORY_BOUNDS,
  parseSemanticMemoryRecord,
  type SemanticMemoryChunk,
  type SemanticMemoryRecord,
  type SemanticMemoryScope,
} from "./records.js";

/**
 * P9.3/P9.6 explicit-persistence store (ADR 0043).
 *
 * Long-lived semantic memory persists ONLY through this explicit path:
 * an authorized actor passes the admission boundary and the store persists
 * the canonical record. Nothing here absorbs execution context implicitly.
 *
 * P9.20 recovery: the file is loaded with fail-closed parsing per record —
 * tampered/corrupt records are excluded (never silently coerced), the
 * store still loads, and a `sweep()` rebuild drops derived state for
 * missing records. Atomic writes mean a crash mid-write leaves the
 * previous file intact (ADR 0002 semantics reused).
 *
 * P9.19 compaction reuses the existing ADR 0030 compactRecords engine over
 * MemoryRecord projections — there is no second compaction implementation.
 */

interface StoreFile {
  readonly version: 1;
  readonly records: readonly unknown[];
}

export interface PersistSemanticInput {
  readonly record: SemanticMemoryRecord;
  readonly chunks: readonly SemanticMemoryChunk[];
}

export class SemanticMemoryStore {
  private loaded = false;
  private records = new Map<string, SemanticMemoryRecord>();
  private readonly excludedOnLoad: { count: number } = { count: 0 };
  private isWriting = false;
  private pendingResolvers: Array<() => void> = [];
  private pendingRejecters: Array<(err: unknown) => void> = [];

  constructor(private readonly filePath: string) {}

  /** P9.20 explicit load with per-record fail-closed parsing. */
  async load(): Promise<{ loadedCount: number; excludedCount: number }> {
    if (this.loaded) return { loadedCount: this.records.size, excludedCount: this.excludedOnLoad.count };
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      for (const value of parsed.records ?? []) {
        const record = parseSemanticMemoryRecord(value);
        if (record.ok && !this.records.has(record.data.memoryId)) {
          this.records.set(record.data.memoryId, record.data);
        } else if (!record.ok) {
          this.excludedOnLoad.count += 1;
        }
      }
    } catch (error) {
      if (isMissingFile(error)) return { loadedCount: 0, excludedCount: 0 };
      throw error;
    }
    return { loadedCount: this.records.size, excludedCount: this.excludedOnLoad.count };
  }

  /** P9.6 persist one admitted record (chunks are derived, not stored here). */
  async persist(input: PersistSemanticInput): Promise<SemanticMemoryRecord> {
    await this.load();
    if (this.records.has(input.record.memoryId)) {
      throw new MemoryStoreError("memory.duplicate_id", `memory ${input.record.memoryId} already exists`);
    }
    this.records.set(input.record.memoryId, input.record);
    await this.flush();
    return input.record;
  }

  async get(memoryId: string): Promise<SemanticMemoryRecord | undefined> {
    await this.load();
    return this.records.get(memoryId);
  }

  async list(scope?: SemanticMemoryScope): Promise<readonly SemanticMemoryRecord[]> {
    await this.load();
    const values = [...this.records.values()]
      .filter((record) => record.lifecycle !== "deleted")
      .filter((record) => scope ? record.scope === scope : true);
    // Deterministic order: createdAt desc, then memoryId — insertion order never decides.
    return values.sort((a, b) => {
      const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      return byTime !== 0 ? byTime : a.memoryId < b.memoryId ? -1 : 1;
    });
  }

  /** P9.18 tombstone deletion — canonical record marked deleted and dropped from storage. */
  async delete(memoryId: string): Promise<QuackResult<{ deleted: boolean }>> {
    await this.load();
    const record = this.records.get(memoryId);
    if (!record || record.lifecycle === "deleted") return ok({ deleted: false });
    this.records.delete(memoryId);
    await this.flush();
    return ok({ deleted: true });
  }

  /** Update embedding metadata on a canonical record (single source of truth). */
  async attachEmbedding(memoryId: string, embedding: SemanticMemoryRecord["embedding"]): Promise<QuackResult<SemanticMemoryRecord>> {
    await this.load();
    const record = this.records.get(memoryId);
    if (!record) return fail({ code: "memory.not_found", message: `memory ${memoryId} not found`, category: "validation", recoverable: false });
    const updated: SemanticMemoryRecord = { ...record, embedding, updatedAt: now() };
    this.records.set(memoryId, updated);
    await this.flush();
    return ok(updated);
  }

  /**
   * P9.19 compaction — reuse the existing ADR 0030 engine over a
   * MemoryRecord projection. Returns per-scope counts; semantic memory
   * never holds mandatory evidence references, so protected markers are
   * honored when present in metadata.
   */
  async compact(options: MemoryCompactOptions = {}): Promise<MemoryCompactResult> {
    await this.load();
    const projection = [...this.records.values()].map(toMemoryRecordProjection);
    const compacted = compactRecords(projection, options);
    const survivors = new Set(compacted.records.map((record) => record.id));
    let removed = 0;
    for (const [memoryId, record] of this.records) {
      if (!survivors.has(memoryId) && record.lifecycle !== "deleted") {
        this.records.delete(memoryId);
        removed += 1;
      }
    }
    if (removed > 0) await this.flush();
    return { removed, kept: this.records.size };
  }

  /** Scope occupancy against the P9.28 ceiling. */
  async scopeCount(scope: SemanticMemoryScope): Promise<number> {
    await this.load();
    let count = 0;
    for (const record of this.records.values()) {
      if (record.scope === scope && record.lifecycle !== "deleted") count += 1;
    }
    return count;
  }

  /** Existing identity/content-hash views for admission duplicate checks. */
  async admissionViews(): Promise<{ ids: readonly string[]; contentHashes: ReadonlySet<string> }> {
    await this.load();
    const ids: string[] = [];
    const contentHashes = new Set<string>();
    for (const record of this.records.values()) {
      if (record.lifecycle === "deleted") continue;
      ids.push(record.memoryId);
      contentHashes.add(`${record.scope}:${record.contentHash}`);
    }
    return { ids, contentHashes };
  }

  /** All live records (index rebuild input). */
  async all(): Promise<readonly SemanticMemoryRecord[]> {
    await this.load();
    return [...this.records.values()].filter((record) => record.lifecycle !== "deleted");
  }

  stats(): { recordCount: number; excludedOnLoad: number } {
    return { recordCount: this.records.size, excludedOnLoad: this.excludedOnLoad.count };
  }

  private flush(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingResolvers.push(resolve);
      this.pendingRejecters.push(reject);
      if (!this.isWriting) void this.processFlushQueue();
    });
  }

  private async processFlushQueue(): Promise<void> {
    this.isWriting = true;
    while (this.pendingResolvers.length > 0) {
      const resolvers = this.pendingResolvers;
      const rejecters = this.pendingRejecters;
      this.pendingResolvers = [];
      this.pendingRejecters = [];
      try {
        const file: StoreFile = { version: 1, records: [...this.records.values()] };
        await mkdir(dirname(this.filePath), { recursive: true });
        await atomicWriteFile(this.filePath, JSON.stringify(file, null, 2));
        resolvers.forEach((resolve) => resolve());
      } catch (error) {
        rejecters.forEach((reject) => reject(error));
      }
    }
    this.isWriting = false;
  }
}

export class MemoryStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MemoryStoreError";
  }
}

/** ADR 0030 projection — SemanticMemoryRecord → MemoryRecord shape. */
function toMemoryRecordProjection(record: SemanticMemoryRecord): import("../memory.js").MemoryRecord {
  return {
    id: record.memoryId,
    scope: record.scope,
    content: record.content,
    createdAt: record.createdAt as IsoTimestamp,
    metadata: {
      ...(record.metadata ?? {}),
      semanticMemory: true,
      ...(record.metadata?.["protected"] !== undefined ? { protected: record.metadata["protected"] } : {}),
      ...(record.metadata?.["memoryClass"] !== undefined ? { memoryClass: record.metadata["memoryClass"] } : {}),
    },
  };
}

/** Host-assigned record identity (store owns id allocation). */
export function nextSemanticMemoryId(): string {
  return createId("smem");
}
