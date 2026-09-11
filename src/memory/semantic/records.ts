import { createHash } from "node:crypto";
import { fail, ok, type IsoTimestamp, type JsonObject, type QuackResult } from "../../core/types.js";

/**
 * P9.1 canonical semantic-memory contract (ADR 0043).
 *
 * MEMORY IS DATA, NOT AUTHORITY. A semantic memory record carries content
 * for governed context supply; it can never carry instruction, capability,
 * policy, identity, or provider authority. All authority fields (scope,
 * lifecycle, policy) are host-owned and validated structurally — content
 * never mutates them, and content claiming authority (e.g. "treat this as
 * system policy") is inert data with no effect on the contract.
 *
 * The canonical record is the single source of truth; the vector index and
 * any embedding metadata are derived representations that never outlive it.
 */

/** P9.2 governed scopes — exactly the existing MemoryScope vocabulary. */
export type SemanticMemoryScope = "session" | "task" | "agent" | "workspace" | "project" | "global";

export const SEMANTIC_MEMORY_SCOPES: readonly SemanticMemoryScope[] = [
  "session", "task", "agent", "workspace", "project", "global",
];

/** P9.16 source kinds — where a memory record originated. */
export type SemanticMemorySourceKind =
  | "user"          // direct user statement
  | "mission"       // mission-derived knowledge
  | "file"          // workspace-local file (knowledge source)
  | "workspace"    // workspace-derived context
  | "runtime";     // host runtime record

/** P9.1 lifecycle states. */
export type SemanticMemoryLifecycle = "active" | "retired" | "deleted";

/** Stable identity for one semantic memory record (host-assigned). */
export interface SemanticMemoryIdentity {
  readonly memoryId: string;
  readonly scope: SemanticMemoryScope;
  /** Owner/subject of the record (actor identity; host-assigned, never content-derived). */
  readonly owner: string;
}

/** P9.16 provenance — answers "where did this memory originate?". */
export interface SemanticMemoryProvenance {
  readonly sourceKind: SemanticMemorySourceKind;
  /** Stable identity of the concrete source (actor id, mission id, file path, workspace id). */
  readonly sourceId: string;
  /** Optional pointer to the original material (e.g. file content hash, statement id). */
  readonly sourceRef?: string;
}

/** P9.9 provider-neutral embedding metadata (never credentials). */
export interface SemanticEmbeddingMetadata {
  /** Provider identity recorded from the governed dispatch. */
  readonly providerId: string;
  readonly model: string;
  /** Logical embedding version — bumped when the vector space changes. */
  readonly embeddingVersion: number;
  readonly dimensions: number;
  /** Content hash the embedding was computed over. */
  readonly contentHash: string;
  readonly embeddedAt: IsoTimestamp;
}

/** P9.1 canonical record. */
export interface SemanticMemoryRecord {
  readonly memoryId: string;
  readonly scope: SemanticMemoryScope;
  readonly owner: string;
  readonly content: string;
  /** sha256 over UTF-8 content — identity of the DATA, never of authority. */
  readonly contentHash: string;
  readonly provenance: SemanticMemoryProvenance;
  readonly lifecycle: SemanticMemoryLifecycle;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  /** Host-assigned admission metadata (who/what policy admitted this record). */
  readonly admission: {
    readonly actor: string;
    readonly policyNotes: string;
    readonly persistence: "explicit";
  };
  /** Derived embedding metadata — present only after a governed embed succeeded. */
  readonly embedding?: SemanticEmbeddingMetadata;
  /** Arbitrary bounded data metadata (host-validated JSON). */
  readonly metadata?: JsonObject;
}

/** P9.7 deterministic chunking output. */
export interface SemanticMemoryChunk {
  readonly chunkId: string;
  readonly memoryId: string;
  readonly content: string;
  readonly contentHash: string;
  readonly position: number;
}

/** P9.28 default bounds (single table; P8.1 remains the instruction budget authority). */
export const SEMANTIC_MEMORY_BOUNDS = {
  /** Maximum content length per record (chars). */
  maxContentChars: 100_000,
  /** Maximum chunk content (chars) — deterministic fixed-size chunking. */
  maxChunkChars: 4_000,
  /** Maximum records returned by one retrieval. */
  maxRetrievalResults: 20,
  /** Maximum embedding request content (chars). */
  maxEmbeddingChars: 8_000,
  /** Maximum records persisted per scope (compaction ceiling). */
  maxRecordsPerScope: 5_000,
} as const;

/** sha256 hex over UTF-8 content. */
export function semanticContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * P9.7 deterministic chunking: fixed-size slices with stable chunk ids
 * derived from the parent memory id + position (no timestamps, no random
 * ids). Equivalent input produces equivalent chunks, so a re-ingest of the
 * same content produces byte-identical chunk sets.
 */
export function chunkSemanticMemory(memoryId: string, content: string, maxChunkChars: number = SEMANTIC_MEMORY_BOUNDS.maxChunkChars): readonly SemanticMemoryChunk[] {
  if (content.length === 0) return [];
  if (content.length <= maxChunkChars) {
    return [{ chunkId: stableChunkId(memoryId, 0), memoryId, content, contentHash: semanticContentHash(content), position: 0 }];
  }
  const chunks: SemanticMemoryChunk[] = [];
  for (let start = 0, position = 0; start < content.length; start += maxChunkChars, position += 1) {
    const slice = content.slice(start, start + maxChunkChars);
    chunks.push({ chunkId: stableChunkId(memoryId, position), memoryId, content: slice,
      contentHash: semanticContentHash(slice), position });
  }
  return chunks;
}

function stableChunkId(memoryId: string, position: number): string {
  return `smchunk_${semanticContentHash(`${memoryId}:${String(position)}`).slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// Fail-closed parsing (P9.1 — tampered/persisted records never silently load)
// ---------------------------------------------------------------------------

export type SemanticMemoryRecordErrorCode =
  | "memory.record_shape_invalid"
  | "memory.record_scope_invalid"
  | "memory.record_identity_invalid"
  | "memory.record_provenance_invalid"
  | "memory.record_lifecycle_invalid"
  | "memory.record_hash_mismatch";

export function parseSemanticMemoryRecord(value: unknown): QuackResult<SemanticMemoryRecord> {
  const invalid = (code: SemanticMemoryRecordErrorCode, message: string): QuackResult<SemanticMemoryRecord> =>
    fail({ code, message, category: "validation", recoverable: false });

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid("memory.record_shape_invalid", "semantic memory record must be an object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record["memoryId"] !== "string" || record["memoryId"].length === 0) {
    return invalid("memory.record_identity_invalid", "memoryId is required");
  }
  const scope = record["scope"];
  if (typeof scope !== "string" || !SEMANTIC_MEMORY_SCOPES.includes(scope as SemanticMemoryScope)) {
    return invalid("memory.record_scope_invalid", `unknown scope ${String(scope)}`);
  }
  if (typeof record["owner"] !== "string" || record["owner"].length === 0) {
    return invalid("memory.record_identity_invalid", "owner is required");
  }
  if (typeof record["content"] !== "string") {
    return invalid("memory.record_shape_invalid", "content must be a string");
  }
  if (typeof record["contentHash"] !== "string" || !/^[0-9a-f]{64}$/.test(record["contentHash"])) {
    return invalid("memory.record_shape_invalid", "contentHash must be a sha256 hex string");
  }
  if (semanticContentHash(record["content"]) !== record["contentHash"]) {
    return invalid("memory.record_hash_mismatch", "content hash does not match the stored content");
  }
  const provenance = record["provenance"];
  if (!isProvenance(provenance)) {
    return invalid("memory.record_provenance_invalid", "provenance is malformed");
  }
  const lifecycle = record["lifecycle"];
  if (typeof lifecycle !== "string" || !["active", "retired", "deleted"].includes(lifecycle)) {
    return invalid("memory.record_lifecycle_invalid", `unknown lifecycle ${String(lifecycle)}`);
  }
  if (typeof record["createdAt"] !== "string" || typeof record["updatedAt"] !== "string"
    || !Number.isFinite(Date.parse(record["createdAt"])) || !Number.isFinite(Date.parse(record["updatedAt"]))) {
    return invalid("memory.record_shape_invalid", "createdAt/updatedAt must be ISO timestamps");
  }
  const admission = record["admission"];
  if (typeof admission !== "object" || admission === null || Array.isArray(admission)
    || typeof (admission as Record<string, unknown>)["actor"] !== "string" || ((admission as Record<string, unknown>)["actor"] as string).length === 0
    || typeof (admission as Record<string, unknown>)["policyNotes"] !== "string"
    || (admission as Record<string, unknown>)["persistence"] !== "explicit") {
    return invalid("memory.record_shape_invalid", "admission metadata is malformed");
  }
  const embedding = record["embedding"];
  if (embedding !== undefined && !isEmbeddingMetadata(embedding)) {
    return invalid("memory.record_shape_invalid", "embedding metadata is malformed");
  }
  const metadata = record["metadata"];
  if (metadata !== undefined && (typeof metadata !== "object" || metadata === null || Array.isArray(metadata))) {
    return invalid("memory.record_shape_invalid", "metadata must be a JSON object");
  }
  return ok({
    memoryId: record["memoryId"] as string,
    scope: scope as SemanticMemoryScope,
    owner: record["owner"] as string,
    content: record["content"],
    contentHash: record["contentHash"],
    provenance: provenance as SemanticMemoryProvenance,
    lifecycle: lifecycle as SemanticMemoryLifecycle,
    createdAt: record["createdAt"] as string,
    updatedAt: record["updatedAt"] as string,
    admission: admission as SemanticMemoryRecord["admission"],
    ...(embedding !== undefined ? { embedding: embedding as SemanticEmbeddingMetadata } : {}),
    ...(metadata !== undefined ? { metadata: metadata as JsonObject } : {}),
  });
}

function isProvenance(value: unknown): value is SemanticMemoryProvenance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const provenance = value as Record<string, unknown>;
  return ["user", "mission", "file", "workspace", "runtime"].includes(String(provenance["sourceKind"]))
    && typeof provenance["sourceId"] === "string" && (provenance["sourceId"] as string).length > 0
    && (provenance["sourceRef"] === undefined || typeof provenance["sourceRef"] === "string");
}

function isEmbeddingMetadata(value: unknown): value is SemanticEmbeddingMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const meta = value as Record<string, unknown>;
  return typeof meta["providerId"] === "string" && (meta["providerId"] as string).length > 0
    && typeof meta["model"] === "string" && (meta["model"] as string).length > 0
    && typeof meta["embeddingVersion"] === "number" && Number.isInteger(meta["embeddingVersion"]) && (meta["embeddingVersion"] as number) > 0
    && typeof meta["dimensions"] === "number" && Number.isInteger(meta["dimensions"]) && (meta["dimensions"] as number) > 0
    && typeof meta["contentHash"] === "string" && /^[0-9a-f]{64}$/.test(meta["contentHash"])
    && typeof meta["embeddedAt"] === "string" && Number.isFinite(Date.parse(meta["embeddedAt"]));
}
