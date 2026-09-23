import { now, type JsonObject } from "../core/types.js";
import {
  QUACK_CONTRACT_VERSION,
  type ExecutionBoundary,
  type ExecutionContextV1,
  type ModelDescriptorV1,
  type ProviderCapabilitySupport,
  type ProviderHealthV1,
  type ProviderMetadataV1,
  type ProviderModelEventV1,
  type ProviderModelRequestV1,
  type ProviderModelResponseV1,
  type QuackProviderV1,
} from "../contracts/index.js";
import type { ModelCapability, ModelInfo } from "./types.js";
import type { ModelProvider, ModelRuntimeProviderConfig } from "./runtime.js";

/** Compatibility bridge into the canonical provider contract. Grants nothing. */
export class ModelProviderV1Bridge implements QuackProviderV1 {
  constructor(
    private readonly provider: ModelProvider,
    private readonly config: ModelRuntimeProviderConfig,
  ) {}

  metadata(): ProviderMetadataV1 {
    return {
      contractVersion: QUACK_CONTRACT_VERSION,
      providerId: this.provider.id,
      displayName: this.config.displayName ?? this.provider.id,
      runtime: this.provider.kind,
      boundary: this.config.boundary ?? inferBoundary(this.config.baseUrl, this.provider.kind),
      endpoint: this.config.baseUrl,
      credentialEnvironmentVariables: this.config.credentialEnvironmentVariables ?? [],
    };
  }

  async health(): Promise<ProviderHealthV1> {
    const started = Date.now();
    const models = await this.provider.listModels();
    return models.ok
      ? { status: "HEALTHY", checkedAt: now(), latencyMs: Date.now() - started, message: `${models.data.length} model(s) available.` }
      : { status: inferHealthStatus(models.error.message), checkedAt: now(), latencyMs: Date.now() - started, message: models.error.message };
  }

  async discoverModels(): Promise<readonly ModelDescriptorV1[]> {
    const models = await this.provider.listModels();
    if (!models.ok) throw new Error(models.error.message);
    return models.data.map(model => this.descriptor(model));
  }

  async capabilities(model: string): Promise<readonly ProviderCapabilitySupport[]> {
    const models = await this.provider.listModels();
    if (!models.ok) throw new Error(models.error.message);
    const match = models.data.find(candidate => candidate.name === model || candidate.id === model);
    return match ? capabilitiesFor(match) : [];
  }

  async generate(request: ProviderModelRequestV1, context: ExecutionContextV1): Promise<ProviderModelResponseV1> {
    if (context.signal?.aborted) throw context.signal.reason ?? new Error("Cancelled.");
    const system = typeof request.metadata?.[SYSTEM_PROMPT_METADATA_KEY] === "string"
      ? String(request.metadata[SYSTEM_PROMPT_METADATA_KEY])
      : undefined;
    const result = await this.provider.generate({
      prompt: request.prompt,
      model: request.model,
      maxTokens: request.maxOutputTokens,
      temperature: request.temperature,
      system,
      metadata: removeSystemPrompt(request.metadata),
    });
    if (!result.ok) throw new Error(result.error.message);
    return {
      executionId: context.executionId,
      providerId: result.data.providerId,
      model: result.data.model,
      text: result.data.text,
      usage: { ...result.data.usage, source: "provider" },
      latencyMs: result.data.latencyMs,
      finishReason: result.data.finishReason,
    };
  }

  async *stream(request: ProviderModelRequestV1, context: ExecutionContextV1): AsyncIterable<ProviderModelEventV1> {
    if (context.signal?.aborted) throw context.signal.reason ?? new Error("Cancelled.");
    const system = typeof request.metadata?.[SYSTEM_PROMPT_METADATA_KEY] === "string"
      ? String(request.metadata[SYSTEM_PROMPT_METADATA_KEY])
      : undefined;
    let completed = false;
    for await (const chunk of this.provider.stream({
      prompt: request.prompt,
      model: request.model,
      maxTokens: request.maxOutputTokens,
      temperature: request.temperature,
      system,
      metadata: removeSystemPrompt(request.metadata),
    })) {
      if (chunk.text) {
        yield { executionId: context.executionId, providerId: chunk.providerId, model: chunk.model, type: "TEXT_DELTA", text: chunk.text };
      }
      if (chunk.usage) {
        yield { executionId: context.executionId, providerId: chunk.providerId, model: chunk.model, type: "USAGE", usage: { ...chunk.usage, source: "provider" } };
      }
      if (chunk.done) {
        completed = true;
        yield { executionId: context.executionId, providerId: chunk.providerId, model: chunk.model, type: "COMPLETED" };
      }
    }
    if (!completed) {
      yield { executionId: context.executionId, providerId: this.provider.id, model: request.model, type: "COMPLETED" };
    }
  }

  private descriptor(model: ModelInfo): ModelDescriptorV1 {
    return {
      id: model.name,
      providerId: this.provider.id,
      runtime: this.provider.kind,
      capabilities: capabilitiesFor(model),
      metadata: {
        latencyMs: model.latencyMs,
        costPer1kTokens: model.costPer1kInput + model.costPer1kOutput,
        status: model.status,
      },
    };
  }
}

export const SYSTEM_PROMPT_METADATA_KEY = "quack.runtime.systemPrompt";

function capabilitiesFor(model: ModelInfo): readonly ProviderCapabilitySupport[] {
  const has = (capability: ModelCapability): boolean => model.capabilities.includes(capability);
  return [
    { capability: "text", level: "NATIVE" },
    { capability: "streaming", level: "NATIVE" },
    { capability: "cancellation", level: "UNSUPPORTED", reason: "The legacy model-provider interface has no in-flight cancellation operation." },
    { capability: "context-window", level: "NATIVE", value: model.contextWindow },
    { capability: "token-accounting", level: "DEGRADED", reason: "Usage may be estimated by a protocol adapter." },
    { capability: "tool-calling", level: model.supportsTools ? "NATIVE" : "UNSUPPORTED" },
    { capability: "reasoning", level: has("reasoning") || has("coding") || has("careful") ? "NATIVE" : "DEGRADED" },
    { capability: "embedding", level: "UNSUPPORTED", reason: "Provider Contract v1 does not define an embedding operation." },
  ];
}

function inferBoundary(baseUrl: string | undefined, kind: ModelProvider["kind"]): ExecutionBoundary {
  if (kind === "ollama") return "local";
  if (!baseUrl) return "cloud";
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return "local";
  } catch {
    return "cloud";
  }
  return "cloud";
}

function inferHealthStatus(message: string): ProviderHealthV1["status"] {
  const normalized = message.toLowerCase();
  if (/\b(401|403|auth|api key)\b/.test(normalized)) return "AUTHENTICATION_ERROR";
  if (/\b(429|rate limit)\b/.test(normalized)) return "RATE_LIMITED";
  return "OFFLINE";
}

function removeSystemPrompt(metadata: JsonObject | undefined): JsonObject | undefined {
  if (!metadata || !(SYSTEM_PROMPT_METADATA_KEY in metadata)) return metadata;
  const cleaned = { ...metadata };
  delete cleaned[SYSTEM_PROMPT_METADATA_KEY];
  return cleaned;
}
