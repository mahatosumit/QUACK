import { now, ok, fail, type IsoTimestamp, type QuackResult } from "../../core/types.js";
import type { GovernedModelRuntime } from "../../models/governed-runtime.js";
import type { EmbeddingResponse } from "../../models/runtime.js";
import {
  SEMANTIC_MEMORY_BOUNDS,
  semanticContentHash,
  type SemanticEmbeddingMetadata,
} from "./records.js";

/**
 * P9.8 embedding governance (ADR 0043).
 *
 * EMBEDDINGS ARE PROVIDER OPERATIONS. Every embedding dispatch flows through
 * the EXISTING GovernedModelRuntime — there is no direct provider path, no
 * hidden embedding SDK, and no ungoverned fallback:
 *
 *   memory content → embedding request → GovernedModelRuntime.embed
 *     → capability broker (provider.invoke) → provider
 *
 * Provider denial happens BEFORE provider contact (the governed runtime
 * fails closed with model.permission_denied). Provider failures surface with
 * the existing QuackResult semantics — no retry, no fallback to a different
 * vector space (a mixed vector index is silently wrong retrieval).
 *
 * P9.9: the gateway consumes and returns only the provider-neutral
 * EmbeddingRequest/EmbeddingResponse contracts. No vendor objects, no
 * credentials, no provider clients are exposed to memory callers.
 */

/** Structural contract the gateway needs from a governed runtime. */
export interface EmbeddingRuntimeSurface {
  embed(request: import("../../models/runtime.js").EmbeddingRequest, context: {
    readonly missionId?: string;
    readonly taskId?: string;
    readonly agentId?: string;
    readonly skillId?: string;
    readonly actor: string;
    readonly signal?: AbortSignal;
  }): Promise<QuackResult<EmbeddingResponse>>;
}

export interface EmbedGatewayOptions {
  readonly runtime: EmbeddingRuntimeSurface;
  /** Explicit embedding model id (existing selection mechanism; no routing added). */
  readonly model?: string;
  /** Logical embedding version — bump when the vector space changes. */
  readonly embeddingVersion: number;
}

/** Result of a governed embed. */
export interface GovernedEmbedResult {
  readonly vector: readonly number[];
  readonly metadata: SemanticEmbeddingMetadata;
}

/**
 * Embed one admitted memory record's content through the governed runtime.
 * The record is NOT modified here — callers persist embedding metadata onto
 * the canonical record (single source of truth) after a successful embed.
 */
export async function embedSemanticContent(
  options: EmbedGatewayOptions,
  input: {
    readonly content: string;
    readonly contentHash: string;
    readonly context: { readonly missionId?: string; readonly taskId?: string; readonly actor: string; readonly signal?: AbortSignal };
  },
): Promise<QuackResult<GovernedEmbedResult>> {
  if (input.content.length === 0) {
    return fail({ code: "memory.embedding_input_invalid", message: "embedding content must be non-empty", category: "validation", recoverable: false });
  }
  if (input.content.length > SEMANTIC_MEMORY_BOUNDS.maxEmbeddingChars) {
    return fail({
      code: "memory.embedding_input_oversize",
      message: `embedding content exceeds the maximum of ${String(SEMANTIC_MEMORY_BOUNDS.maxEmbeddingChars)} characters`,
      category: "validation",
      recoverable: false,
    });
  }
  const result = await options.runtime.embed(
    { prompt: input.content, ...(options.model ? { model: options.model } : {}),
      metadata: { memoryEmbedding: true, contentHash: input.contentHash } },
    input.context,
  );
  if (!result.ok) return result as QuackResult<GovernedEmbedResult>;
  const response = result.data;
  if (!Array.isArray(response.embedding) || response.embedding.length === 0
    || response.embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    return fail({ code: "memory.embedding_malformed", message: "governed runtime returned a malformed embedding vector", category: "provider", recoverable: false });
  }
  const expectedHash = input.contentHash ?? semanticContentHash(input.content);
  return ok({
    vector: response.embedding,
    metadata: {
      providerId: response.providerId,
      model: response.model,
      embeddingVersion: options.embeddingVersion,
      dimensions: response.dimensions,
      contentHash: expectedHash,
      embeddedAt: now() as IsoTimestamp,
    },
  });
}
