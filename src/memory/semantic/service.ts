import { join } from "node:path";
import { createId, now, type JsonObject, type QuackResult, ok, fail } from "../../core/types.js";
import { type EventBus } from "../../events/event-bus.js";
import type { MemoryCompactOptions, MemoryCompactResult } from "../memory.js";
import { admitSemanticMemory, type SemanticMemoryAdmissionRequest } from "./admission.js";
import { embedSemanticContent, type EmbedGatewayOptions, type EmbeddingRuntimeSurface } from "./embedding.js";
import { SemanticMemoryIndex, type IndexedChunk } from "./vector-index.js";
import { resolveKnowledgeSource, type KnowledgeSourceRequest } from "./knowledge.js";
import {
  retrieveSemanticMemory,
  type SemanticRetrievalResult,
} from "./retrieval.js";
import {
  SEMANTIC_MEMORY_BOUNDS,
  chunkSemanticMemory,
  semanticContentHash,
  type SemanticMemoryRecord,
  type SemanticMemoryScope,
} from "./records.js";
import { SemanticMemoryStore } from "./store.js";

/**
 * P9 semantic memory service (ADR 0043) — the single governed composition
 * facade over admission → persistence → governed embedding → index →
 * retrieval. It adds NO policy of its own (P9.29): scope/owner checks come
 * from the admission boundary, embedding authority from the governed
 * runtime, budget from P8.1 via QIE. Events ride the EXISTING EventBus with
 * metadata-only, bounded payloads (P9.22).
 *
 * AUTHORIZATION: the service never grants authority (memory is data, not
 * authority). Compositions that have a capability broker pass an
 * `authorize` hook (e.g. resolving `memory.write`/`memory.read`); the
 * library default (no hook) trusts the caller — the same contract as the
 * existing MemoryManager/MemoryStore boundaries.
 */

export interface SemanticMemoryServiceOptions {
  readonly dataDir: string;
  readonly workspaceRoot: string;
  readonly events?: EventBus;
  /** Governed embedding runtime — REQUIRED when embeddings are enabled. */
  readonly embeddingRuntime?: EmbeddingRuntimeSurface;
  readonly embeddingModel?: string;
  readonly embeddingVersion?: number;
  /** Embedding disabled by default: memory works without a provider. */
  readonly embeddingsEnabled?: boolean;
  /** Composition-supplied authority hook (capability-broker backed in production). */
  readonly authorize?: (input: {
    readonly actor: string;
    readonly operation: "read" | "write" | "delete";
    readonly scope: SemanticMemoryScope;
    readonly owner: string;
  }) => Promise<QuackResult<void>> | QuackResult<void>;
}

export interface RememberRequest {
  readonly content: string;
  readonly scope: SemanticMemoryScope;
  readonly owner: string;
  readonly actor: string;
  readonly policyNotes?: string;
  readonly metadata?: SemanticMemoryRecord["metadata"];
  /** Knowledge-source request instead of inline content (P9.26). */
  readonly source?: KnowledgeSourceRequest;
  readonly context: { readonly missionId?: string; readonly taskId?: string; readonly actor: string; readonly signal?: AbortSignal };
}

export interface RememberResult {
  readonly record: SemanticMemoryRecord;
  readonly embedded: boolean;
}

export interface RecallRequest {
  readonly text: string;
  readonly scope: SemanticMemoryScope;
  readonly owner: string;
  readonly limit?: number;
  readonly context: { readonly missionId?: string; readonly taskId?: string; readonly actor: string; readonly signal?: AbortSignal };
}

/** Chunk view used for index-cache validation. */
interface LiveChunkView {
  readonly memoryId: string;
  readonly contentHash: string;
  readonly scope: SemanticMemoryScope;
  readonly owner: string;
  readonly position: number;
  readonly embeddingVersion: number;
}

export class SemanticMemoryService {
  readonly store: SemanticMemoryStore;
  readonly index: SemanticMemoryIndex;
  private readonly embeddingOptions: EmbedGatewayOptions | undefined;
  private readonly embeddingsEnabled: boolean;

  constructor(private readonly options: SemanticMemoryServiceOptions) {
    this.store = new SemanticMemoryStore(join(options.dataDir, "semantic-memory.json"));
    this.index = new SemanticMemoryIndex(join(options.dataDir, "semantic-memory-index.json"));
    this.embeddingsEnabled = options.embeddingsEnabled ?? false;
    this.embeddingOptions = options.embeddingRuntime
      ? { runtime: options.embeddingRuntime, ...(options.embeddingModel ? { model: options.embeddingModel } : {}),
        embeddingVersion: options.embeddingVersion ?? 1 }
      : undefined;
    if (this.embeddingsEnabled && !this.embeddingOptions) {
      throw new Error("Semantic memory cannot enable embeddings without a governed embedding runtime.");
    }
  }

  /**
   * P9.20 restart recovery: load the canonical store with fail-closed
   * parsing, then restore the derived index ONLY from cache entries that
   * match live canonical record chunks (identity + content hash + scope +
   * owner + position + embedding version). Interrupted writes, tampered
   * caches, and deleted memories can never surface as retrievable; records
   * whose embedding was interrupted load as valid-but-unembedded (honest,
   * inspectable, re-rememberable) — never ghost records.
   */
  async recover(): Promise<{ loadedCount: number; excludedCount: number; restoredChunks: number; indexedChunks: number }> {
    const loaded = await this.store.load();
    const live = await this.store.all();
    const liveChunks = new Map<string, LiveChunkView>();
    for (const record of live) {
      if (!record.embedding) continue;
      for (const chunk of chunkSemanticMemory(record.memoryId, record.content)) {
        liveChunks.set(chunk.chunkId, {
          memoryId: record.memoryId, contentHash: chunk.contentHash, scope: record.scope,
          owner: record.owner, position: chunk.position, embeddingVersion: record.embedding.embeddingVersion,
        });
      }
    }
    const restoredChunks = await this.index.loadCache(liveChunks);
    this.index.sweepOrphans(new Set(live.map((record) => record.memoryId)));
    return {
      loadedCount: loaded.loadedCount,
      excludedCount: loaded.excludedCount,
      restoredChunks,
      indexedChunks: this.index.size(),
    };
  }

  /**
   * P9.3/P9.4/P9.6 explicit persistence: authorize → admission → persist →
   * optional governed per-chunk embed → index. Partial failure is
   * recoverable: the record is durable before embedding; an embedding
   * failure leaves a valid, inspectable record (embedded: false) and the
   * event records the failure. Embedding is all-or-nothing per record: all
   * chunks embed and index, or none do.
   */
  async remember(request: RememberRequest): Promise<QuackResult<RememberResult>> {
    const authorized = await this.authorizeOrDeny(request.actor, "write", request.scope, request.owner);
    if (!authorized.ok) return authorized as QuackResult<RememberResult>;

    let content = request.content;
    let provenance: SemanticMemoryAdmissionRequest["provenance"];
    let policyNotes = request.policyNotes;
    if (request.source) {
      const resolved = await resolveKnowledgeSource(request.source, this.options.workspaceRoot);
      if (!resolved.ok) return resolved as QuackResult<RememberResult>;
      content = resolved.data.content;
      provenance = resolved.data.provenance;
      policyNotes = request.policyNotes ?? `knowledge source: ${resolved.data.sourceLabel}`;
    } else {
      if (typeof request.content !== "string" || request.content.trim().length === 0) {
        return fail({ code: "memory.admission_shape_invalid", message: "remember requires content or a knowledge source", category: "validation", recoverable: true });
      }
      provenance = { sourceKind: "user", sourceId: request.actor };
    }

    await this.store.load();
    const views = await this.store.admissionViews();
    const memoryId = createId("smem");
    const admission = admitSemanticMemory({
      content, scope: request.scope, owner: request.owner, provenance,
      actor: request.actor, policyNotes, metadata: request.metadata,
      persistence: "explicit",
      existingIds: views.ids, existingContentHashes: views.contentHashes,
    }, now(), memoryId);
    if (!admission.ok) return admission as QuackResult<RememberResult>;
    if (admission.data.rejection) {
      await this.emit("memory.rejected", { memoryId, scope: request.scope, code: admission.data.rejection.code });
      return fail({
        code: admission.data.rejection.code,
        message: admission.data.rejection.message,
        category: "validation",
        recoverable: admission.data.rejection.code !== "memory.admission_duplicate_content",
      });
    }
    const { record, chunks } = admission.data;

    // P9.28 scope ceiling.
    if ((await this.store.scopeCount(record.scope)) >= SEMANTIC_MEMORY_BOUNDS.maxRecordsPerScope) {
      await this.emit("memory.rejected", { memoryId, scope: record.scope, code: "memory.admission_scope_full" });
      return fail({ code: "memory.admission_scope_full", message: `scope ${record.scope} reached its record ceiling`, category: "validation", recoverable: false });
    }

    await this.store.persist({ record, chunks });
    await this.emit("memory.admitted", { memoryId, scope: record.scope, owner: record.owner, sourceKind: record.provenance.sourceKind });
    await this.emit("memory.persisted", { memoryId, scope: record.scope, contentHash: record.contentHash });

    // P9.8 governed per-chunk embedding (optional, explicit, all-or-nothing).
    if (this.embeddingsEnabled && this.embeddingOptions) {
      await this.emit("memory.embedding.requested", { memoryId, contentHash: record.contentHash, chunkCount: chunks.length });
      const entries: IndexedChunk[] = [];
      let firstMetadata: import("./records.js").SemanticEmbeddingMetadata | undefined;
      let failureCode: string | undefined;
      for (const chunk of chunks) {
        const embedded = await embedSemanticContent(this.embeddingOptions, {
          content: chunk.content, contentHash: chunk.contentHash, context: request.context,
        });
        if (!embedded.ok) {
          failureCode = embedded.error.code;
          break;
        }
        firstMetadata ??= embedded.data.metadata;
        entries.push({
          chunkId: chunk.chunkId, memoryId, scope: record.scope, owner: record.owner,
          contentHash: chunk.contentHash, position: chunk.position,
          vector: embedded.data.vector, embeddingVersion: embedded.data.metadata.embeddingVersion,
        });
      }
      if (failureCode || !firstMetadata || entries.length !== chunks.length) {
        await this.emit("memory.embedding.failed", { memoryId, code: failureCode ?? "memory.embedding_incomplete" });
        return ok({ record, embedded: false });
      }
      const dimensions = firstMetadata.dimensions;
      const updated = await this.store.attachEmbedding(memoryId, {
        providerId: firstMetadata.providerId,
        model: firstMetadata.model,
        embeddingVersion: firstMetadata.embeddingVersion,
        dimensions,
        contentHash: record.contentHash,
        embeddedAt: firstMetadata.embeddedAt,
      });
      if (!updated.ok) return updated as QuackResult<RememberResult>;
      for (const entry of entries) this.index.upsert(entry);
      await this.index.persistCache();
      await this.emit("memory.embedding.completed", { memoryId, dimensions, chunkCount: entries.length });
      await this.emit("memory.indexed", { memoryId, chunkCount: entries.length });
      return ok({ record: updated.data, embedded: true });
    }
    return ok({ record, embedded: false });
  }

  /** P9.11 governed retrieval (requires a governed query-vector embed). */
  async recall(query: RecallRequest): Promise<QuackResult<SemanticRetrievalResult>> {
    const authorized = await this.authorizeOrDeny(query.context.actor, "read", query.scope, query.owner);
    if (!authorized.ok) return authorized as QuackResult<SemanticRetrievalResult>;
    if (!this.embeddingsEnabled || !this.embeddingOptions) {
      return fail({ code: "memory.embeddings_disabled", message: "semantic retrieval requires embeddings, which are disabled in this composition", category: "validation", recoverable: false });
    }
    const embedded = await embedSemanticContent(this.embeddingOptions, {
      content: query.text, contentHash: semanticContentHash(query.text), context: query.context,
    });
    if (!embedded.ok) return embedded as QuackResult<SemanticRetrievalResult>;
    const records = await this.store.all();
    const recordsById = new Map(records.map((record) => [record.memoryId, record]));
    const result = retrieveSemanticMemory(this.index, recordsById, {
      text: query.text, queryVector: embedded.data.vector, scope: query.scope, owner: query.owner,
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });
    if (result.ok) {
      await this.emit("memory.retrieved", {
        scope: query.scope, owner: query.owner, hitCount: result.data.hits.length,
        memoryIds: result.data.admittedMemoryIds.slice(0, SEMANTIC_MEMORY_BOUNDS.maxRetrievalResults),
      });
    }
    return result;
  }

  /**
   * P9.18 deletion with full derived-state propagation: canonical record
   * first (single source of truth), then index entries, then the durable
   * cache. A crash between steps is safe — recovery re-validates the cache
   * against live records and drops orphans.
   */
  async forget(memoryId: string, context: { readonly actor: string }): Promise<QuackResult<{ deleted: boolean; sweptChunks: number }>> {
    const record = await this.store.get(memoryId);
    const scope = record?.scope;
    const owner = record?.owner;
    const authorized = await this.authorizeOrDeny(context.actor, "delete", scope ?? "global", owner ?? "unknown-owner");
    if (!authorized.ok) return authorized as QuackResult<{ deleted: boolean; sweptChunks: number }>;
    const result = await this.store.delete(memoryId);
    if (!result.ok) return result as QuackResult<{ deleted: boolean; sweptChunks: number }>;
    if (!result.data.deleted) return ok({ deleted: false, sweptChunks: 0 });
    const sweptChunks = this.index.removeMemory(memoryId);
    await this.index.persistCache();
    await this.emit("memory.deleted", { memoryId, sweptChunks });
    return ok({ deleted: true, sweptChunks });
  }

  /** P9.19 compaction over the canonical records (ADR 0030 engine reuse). */
  async compact(options?: MemoryCompactOptions): Promise<MemoryCompactResult> {
    const result = await this.store.compact(options);
    const live = await this.store.all();
    this.index.sweepOrphans(new Set(live.map((record) => record.memoryId)));
    await this.index.persistCache();
    await this.emit("memory.compacted", { removed: result.removed, kept: result.kept });
    return result;
  }

  /** Inspection surface (Studio/CLI/SDK) — metadata + content by explicit id. */
  async inspect(memoryId: string): Promise<QuackResult<SemanticMemoryRecord>> {
    const record = await this.store.get(memoryId);
    if (!record) return fail({ code: "memory.not_found", message: `memory ${memoryId} not found`, category: "validation", recoverable: false });
    return ok(record);
  }

  async list(scope?: SemanticMemoryScope): Promise<readonly SemanticMemoryRecord[]> {
    return this.store.list(scope);
  }

  stats(): JsonObject {
    const storeStats = this.store.stats();
    const indexStats = this.index.stats();
    return {
      recordCount: storeStats.recordCount,
      excludedOnLoad: storeStats.excludedOnLoad,
      embeddingsEnabled: this.embeddingsEnabled,
      index: indexStats,
    };
  }

  private async authorizeOrDeny(actor: string, operation: "read" | "write" | "delete", scope: SemanticMemoryScope, owner: string): Promise<QuackResult<void>> {
    if (!this.options.authorize) return ok(undefined);
    try {
      return await this.options.authorize({ actor, operation, scope, owner });
    } catch (error) {
      return fail({
        code: "memory.authorization_failed",
        message: `memory ${operation} authorization check failed: ${error instanceof Error ? error.message : String(error)}`,
        category: "permission",
        recoverable: false,
      });
    }
  }

  private async emit(type: string, payload: JsonObject): Promise<void> {
    // Metadata-only, bounded payloads — never memory content (P9.22).
    try {
      await this.options.events?.emit(type as never, payload, { actor: "semantic-memory" });
    } catch {
      // Observability never breaks memory operations.
    }
  }
}
