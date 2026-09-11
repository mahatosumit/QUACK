import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createId, fail, ok, type JsonObject, type QuackResult } from "../core/types.js";
import { type ModelCapability, type ModelInfo, type RoutingPolicy } from "./types.js";
import { ModelRegistry } from "./registry.js";
import { ModelRouter } from "./routing.js";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface ModelRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly capability?: ModelCapability;
  readonly metadata?: JsonObject;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface ModelResponse {
  readonly id: string;
  readonly providerId: string;
  readonly model: string;
  readonly text: string;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  readonly fallbackUsed: boolean;
  readonly finishReason?: string;
}

export interface ModelStreamChunk {
  readonly providerId: string;
  readonly model: string;
  readonly text: string;
  readonly done: boolean;
  readonly usage?: TokenUsage;
}

/**
 * P9 provider-neutral embedding request (ADR 0043). Embeddings are model
 * operations: they dispatch through the governed model path exactly like
 * generation. `content` is a single text item — batching is the caller's
 * concern and each item is one governed dispatch.
 */
export interface EmbeddingRequest {
  /** Text to embed. Never carries authority metadata. */
  readonly prompt: string;
  readonly model?: string;
  readonly metadata?: JsonObject;
}

/** Provider-neutral embedding result. No credentials, no provider objects. */
export interface EmbeddingResponse {
  readonly id: string;
  readonly providerId: string;
  readonly model: string;
  /** Embedding vector — provider-agnostic float components. */
  readonly embedding: readonly number[];
  readonly dimensions: number;
  readonly latencyMs: number;
}

/** P9: an embedding-capable provider surface. Optional on providers. */
export interface EmbeddingProvider {
  embed(request: EmbeddingRequest & { readonly model: string }): Promise<QuackResult<EmbeddingResponse>>;
}

export interface ModelProvider {
  readonly id: string;
  readonly kind: "ollama" | "openai-compatible";
  listModels(): Promise<QuackResult<readonly ModelInfo[]>>;
  generate(request: ModelRequest & { readonly model: string }): Promise<QuackResult<ModelResponse>>;
  stream(request: ModelRequest & { readonly model: string }): AsyncIterable<ModelStreamChunk>;
  /** P9 optional embedding operation (ADR 0043). Presence discovered, never assumed. */
  embed?(request: EmbeddingRequest & { readonly model: string }): Promise<QuackResult<EmbeddingResponse>>;
}

export interface ModelRuntimeProviderConfig {
  readonly provider: "ollama" | "openai-compatible";
  readonly id?: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly fallback?: boolean;
  readonly capabilities?: readonly ModelCapability[];
  readonly timeoutMs?: number;
  /** Injectable fetcher (e.g. NetworkPolicyEngine.fetch) for governed egress. */
  readonly fetch?: typeof fetch;
}

export interface ModelRuntimeConfig {
  readonly provider: "ollama" | "openai-compatible";
  readonly model: string;
  readonly providers: readonly ModelRuntimeProviderConfig[];
  readonly fallbackProviderId?: string;
}

export class OllamaModelProvider implements ModelProvider {
  readonly id: string;
  readonly kind = "ollama" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: ModelRuntimeProviderConfig) {
    this.id = config.id ?? "ollama";
    this.baseUrl = config.baseUrl ?? "http://localhost:11434";
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.fetcher = config.fetch ?? fetch;
  }

  async listModels(): Promise<QuackResult<readonly ModelInfo[]>> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) return fail(providerError("model.list_failed", `Ollama model list failed with ${response.status}.`));
      const parsed = await response.json() as { readonly models?: readonly { readonly name?: string }[] };
      return ok((parsed.models ?? []).flatMap((model) => model.name ? [this.modelInfo(model.name)] : []));
    } catch (error) {
      return fail(providerError("model.provider_unreachable", errorMessage(error)));
    }
  }

  async generate(request: ModelRequest & { readonly model: string }): Promise<QuackResult<ModelResponse>> {
    const started = Date.now();
    try {
      const response = await this.fetcher(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          stream: false,
          options: {
            temperature: request.temperature ?? 0.1,
            num_predict: request.maxTokens,
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return fail(providerError("model.generate_failed", `Ollama generation failed with ${response.status}.`));
      const parsed = await response.json() as {
        readonly response?: string;
        readonly model?: string;
        readonly prompt_eval_count?: number;
        readonly eval_count?: number;
        readonly done_reason?: string;
      };
      return ok(responseFrom({
        providerId: this.id,
        model: parsed.model ?? request.model,
        text: parsed.response ?? "",
        inputTokens: parsed.prompt_eval_count ?? estimateTokens(request.prompt),
        outputTokens: parsed.eval_count ?? estimateTokens(parsed.response ?? ""),
        latencyMs: Date.now() - started,
        fallbackUsed: false,
        finishReason: parsed.done_reason,
      }));
    } catch (error) {
      return fail(providerError("model.generate_failed", errorMessage(error)));
    }
  }

  async *stream(request: ModelRequest & { readonly model: string }): AsyncIterable<ModelStreamChunk> {
    const response = await this.fetcher(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        stream: true,
        options: {
          temperature: request.temperature ?? 0.1,
          num_predict: request.maxTokens,
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Ollama stream failed with ${response.status}.`);

    for await (const event of readJsonLines(response)) {
      const parsed = event as {
        readonly model?: string;
        readonly response?: string;
        readonly done?: boolean;
        readonly prompt_eval_count?: number;
        readonly eval_count?: number;
      };
      yield {
        providerId: this.id,
        model: parsed.model ?? request.model,
        text: parsed.response ?? "",
        done: parsed.done ?? false,
        usage: parsed.done
          ? usageFrom({
            inputTokens: parsed.prompt_eval_count ?? estimateTokens(request.prompt),
            outputTokens: parsed.eval_count ?? estimateTokens(parsed.response ?? ""),
          })
          : undefined,
      };
    }
  }

  private modelInfo(model: string): ModelInfo {
    return {
      id: `${this.id}:${model}`,
      name: model,
      provider: this.id,
      capabilities: this.config.capabilities ?? ["balanced", "reasoning"],
      contextWindow: 8192,
      supportsTools: false,
      latencyMs: 1000,
      costPer1kInput: 0,
      costPer1kOutput: 0,
      status: "available",
    };
  }

  /** P9: Ollama POST /api/embeddings (single input, provider-neutral shape). */
  async embed(request: EmbeddingRequest & { readonly model: string }): Promise<QuackResult<EmbeddingResponse>> {
    const started = Date.now();
    try {
      const response = await this.fetcher(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: request.model, prompt: request.prompt }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return fail(providerError("model.embed_failed", `Ollama embedding failed with ${response.status}.`));
      const parsed = await response.json() as { readonly embedding?: readonly number[] };
      if (!Array.isArray(parsed.embedding) || parsed.embedding.length === 0
        || parsed.embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
        return fail(providerError("model.embed_failed", "Ollama embedding response is malformed."));
      }
      return ok({
        id: createId("embedding"),
        providerId: this.id,
        model: request.model,
        embedding: parsed.embedding,
        dimensions: parsed.embedding.length,
        latencyMs: Date.now() - started,
      });
    } catch (error) {
      return fail(providerError("model.embed_failed", errorMessage(error)));
    }
  }
}

export class OpenAICompatibleModelProvider implements ModelProvider {
  readonly id: string;
  readonly kind = "openai-compatible" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: ModelRuntimeProviderConfig) {
    this.id = config.id ?? "openai-compatible";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.fetcher = config.fetch ?? fetch;
  }

  async listModels(): Promise<QuackResult<readonly ModelInfo[]>> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return fail(providerError("model.list_failed", `OpenAI-compatible model list failed with ${response.status}.`));
      const parsed = await response.json() as { readonly data?: readonly { readonly id?: string }[] };
      return ok((parsed.data ?? []).flatMap((model) => model.id ? [this.modelInfo(model.id)] : []));
    } catch (error) {
      return fail(providerError("model.provider_unreachable", errorMessage(error)));
    }
  }

  async generate(request: ModelRequest & { readonly model: string }): Promise<QuackResult<ModelResponse>> {
    const started = Date.now();
    try {
      const response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          messages: [{ role: "user", content: request.prompt }],
          stream: false,
          temperature: request.temperature ?? 0.1,
          max_tokens: request.maxTokens,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return fail(providerError("model.generate_failed", `OpenAI-compatible generation failed with ${response.status}.`));
      const parsed = await response.json() as {
        readonly model?: string;
        readonly choices?: readonly { readonly message?: { readonly content?: string | null }; readonly finish_reason?: string | null }[];
        readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number; readonly total_tokens?: number };
      };
      const text = parsed.choices?.[0]?.message?.content ?? "";
      return ok(responseFrom({
        providerId: this.id,
        model: parsed.model ?? request.model,
        text,
        inputTokens: parsed.usage?.prompt_tokens ?? estimateTokens(request.prompt),
        outputTokens: parsed.usage?.completion_tokens ?? estimateTokens(text),
        totalTokens: parsed.usage?.total_tokens,
        latencyMs: Date.now() - started,
        fallbackUsed: false,
        finishReason: parsed.choices?.[0]?.finish_reason ?? undefined,
      }));
    } catch (error) {
      return fail(providerError("model.generate_failed", errorMessage(error)));
    }
  }

  async *stream(request: ModelRequest & { readonly model: string }): AsyncIterable<ModelStreamChunk> {
    const response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: [{ role: "user", content: request.prompt }],
        stream: true,
        stream_options: { include_usage: true },
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`OpenAI-compatible stream failed with ${response.status}.`);

    let doneEmitted = false;
    for await (const event of readServerSentEvents(response)) {
      if (event === "[DONE]") {
        if (!doneEmitted) {
          doneEmitted = true;
          yield { providerId: this.id, model: request.model, text: "", done: true };
        }
        continue;
      }
      const parsed = JSON.parse(event) as {
        readonly model?: string;
        readonly choices?: readonly {
          readonly delta?: { readonly content?: string | null };
          readonly finish_reason?: string | null;
        }[];
        readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number; readonly total_tokens?: number };
      };
      const usage = parsed.usage
        ? usageFrom({
          inputTokens: parsed.usage.prompt_tokens ?? estimateTokens(request.prompt),
          outputTokens: parsed.usage.completion_tokens ?? 0,
          totalTokens: parsed.usage.total_tokens,
        })
        : undefined;
      const done = Boolean(parsed.choices?.some((choice) => choice.finish_reason) || usage);
      doneEmitted = doneEmitted || done;
      yield {
        providerId: this.id,
        model: parsed.model ?? request.model,
        text: parsed.choices?.[0]?.delta?.content ?? "",
        done,
        usage,
      };
    }
  }

  private headers(): Record<string, string> {
    return this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {};
  }

  /** P9: OpenAI-compatible POST /embeddings (provider-neutral shape only). */
  async embed(request: EmbeddingRequest & { readonly model: string }): Promise<QuackResult<EmbeddingResponse>> {
    const started = Date.now();
    try {
      const response = await this.fetcher(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ model: request.model, input: request.prompt }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return fail(providerError("model.embed_failed", `OpenAI-compatible embedding failed with ${response.status}.`));
      const parsed = await response.json() as {
        readonly model?: string;
        readonly data?: readonly { readonly embedding?: readonly number[] }[];
      };
      const vector = parsed.data?.[0]?.embedding;
      if (!Array.isArray(vector) || vector.length === 0
        || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
        return fail(providerError("model.embed_failed", "OpenAI-compatible embedding response is malformed."));
      }
      return ok({
        id: createId("embedding"),
        providerId: this.id,
        model: parsed.model ?? request.model,
        embedding: vector,
        dimensions: vector.length,
        latencyMs: Date.now() - started,
      });
    } catch (error) {
      return fail(providerError("model.embed_failed", errorMessage(error)));
    }
  }

  private modelInfo(model: string): ModelInfo {
    return {
      id: `${this.id}:${model}`,
      name: model,
      provider: this.id,
      capabilities: this.config.capabilities ?? ["balanced", "reasoning", "coding"],
      contextWindow: 8192,
      supportsTools: true,
      latencyMs: 800,
      costPer1kInput: 0.01,
      costPer1kOutput: 0.03,
      status: "available",
    };
  }
}

export class ModelRuntimeRouter {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly router = new ModelRouter(),
  ) {}

  selectModel(options: {
    readonly capability?: ModelCapability;
    readonly goal?: string;
    readonly policy?: RoutingPolicy;
    readonly providerId?: string;
    readonly model?: string;
  } = {}): QuackResult<ModelInfo> {
    if (options.providerId && options.model) {
      const id = `${options.providerId}:${options.model}`;
      const exact = this.registry.get(id);
      if (exact.ok) return exact;
    }
    const candidates = options.providerId
      ? this.registry.findByProvider(options.providerId)
      : options.capability
        ? this.registry.findByCapability(options.capability)
        : this.registry.getAll();
    const selected = this.router.select(candidates, options.goal ?? "", options.policy);
    return selected ? ok(selected) : fail(providerError("model.no_available_model", "No available model matched the request."));
  }
}

export class ModelRuntime {
  private readonly providers = new Map<string, ModelProvider>();
  readonly router: ModelRuntimeRouter;
  private readonly failures: { readonly providerId: string; readonly message: string; readonly at: string }[] = [];

  constructor(
    readonly registry: ModelRegistry,
    private readonly config: ModelRuntimeConfig,
    providers: readonly ModelProvider[],
  ) {
    for (const provider of providers) this.providers.set(provider.id, provider);
    this.router = new ModelRuntimeRouter(registry);
  }

  selectModel(options: Parameters<ModelRuntimeRouter["selectModel"]>[0] = {}): QuackResult<ModelInfo> {
    return this.router.selectModel(options);
  }

  async generate(request: ModelRequest): Promise<QuackResult<ModelResponse>> {
    const selected = this.selectModel({
      capability: request.capability,
      goal: request.prompt,
      providerId: request.metadata?.["providerId"] as string | undefined,
      model: request.model,
    });
    if (!selected.ok) return fail(selected.error);
    const primary = await this.generateWithModel(selected.data, request, false);
    if (primary.ok) return primary;

    this.failures.push({ providerId: selected.data.provider, message: primary.error.message, at: new Date().toISOString() });
    const fallback = this.fallbackModel(selected.data.provider);
    if (!fallback.ok) return primary;
    const fallbackResult = await this.generateWithModel(fallback.data, request, true);
    return fallbackResult.ok ? fallbackResult : primary;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const selected = this.selectModel({ capability: request.capability, goal: request.prompt, model: request.model });
    if (!selected.ok) throw new Error(selected.error.message);
    const provider = this.providers.get(selected.data.provider);
    if (!provider) throw new Error(`Provider ${selected.data.provider} is not registered.`);
    yield* provider.stream({ ...request, model: selected.data.name });
  }

  /**
   * P9 embedding dispatch (ADR 0043): select an embedding-capable model by
   * exact id or embedding capability, then call the provider's optional
   * `embed`. No fallback for embeddings — a failed embedding is a structured
   * error, never a silently different vector space.
   */
  async embed(request: EmbeddingRequest): Promise<QuackResult<EmbeddingResponse>> {
    const selected = this.selectModel({
      capability: request.model ? undefined : "embedding",
      providerId: request.metadata?.["providerId"] as string | undefined,
      model: request.model,
    });
    if (!selected.ok) return fail(selected.error);
    const provider = this.providers.get(selected.data.provider);
    if (!provider) return fail(providerError("model.provider_not_found", `Provider ${selected.data.provider} is not registered.`));
    if (typeof provider.embed !== "function") {
      return fail(providerError("model.embed_unsupported", `Provider ${selected.data.provider} does not support embeddings.`));
    }
    return provider.embed({ ...request, model: selected.data.name });
  }

  getFailures(): readonly { readonly providerId: string; readonly message: string; readonly at: string }[] {
    return [...this.failures];
  }

  private async generateWithModel(model: ModelInfo, request: ModelRequest, fallbackUsed: boolean): Promise<QuackResult<ModelResponse>> {
    const provider = this.providers.get(model.provider);
    if (!provider) return fail(providerError("model.provider_not_found", `Provider ${model.provider} is not registered.`));
    const result = await provider.generate({ ...request, model: model.name });
    return result.ok ? ok({ ...result.data, fallbackUsed }) : result;
  }

  private fallbackModel(primaryProviderId: string): QuackResult<ModelInfo> {
    const fallbackProviderId = this.config.fallbackProviderId ?? this.config.providers.find((provider) => provider.fallback)?.id;
    const candidates = this.registry.getAll().filter((model) => model.provider !== primaryProviderId && (!fallbackProviderId || model.provider === fallbackProviderId));
    const selected = new ModelRouter().select(candidates, "", { id: "fallback", name: "Fallback", strategy: "balanced" });
    return selected ? ok(selected) : fail(providerError("model.no_fallback", "No fallback provider is available."));
  }
}

export function loadModelRuntimeConfig(path = join(process.cwd(), "config", "models.json")): ModelRuntimeConfig {
  const defaultConfig: ModelRuntimeConfig = {
    provider: "ollama",
    model: "qwen3.6:27b",
    providers: [{ provider: "ollama", id: "ollama", model: "qwen3.6:27b", fallback: true }],
    fallbackProviderId: "ollama",
  };
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) return defaultConfig;
  const parsed = JSON.parse(readFileSync(resolvedPath, "utf8")) as Partial<ModelRuntimeConfig> & Partial<ModelRuntimeProviderConfig>;
  const provider = parsed.provider ?? defaultConfig.provider;
  const model = parsed.model ?? defaultConfig.model;
  const providers = parsed.providers ?? [{ provider, id: provider, model, baseUrl: parsed.baseUrl, apiKey: parsed.apiKey, fallback: true }];
  return {
    provider,
    model,
    providers,
    fallbackProviderId: parsed.fallbackProviderId ?? providers.find((entry) => entry.fallback)?.id,
  };
}

/**
 * Creates the model runtime. `fetcher` (e.g. NetworkPolicyEngine.fetch)
 * governs every provider network call; omitting it falls back to global fetch
 * for tests and standalone library use. Production wiring always passes a
 * policy-gated fetcher.
 */
export function createModelRuntime(config = loadModelRuntimeConfig(), fetcher?: typeof fetch): ModelRuntime {
  const registry = new ModelRegistry();
  const providers = config.providers.map((providerConfig) => createProvider(fetcher ? { ...providerConfig, fetch: fetcher } : providerConfig));
  for (const providerConfig of config.providers) {
    registry.register({
      id: `${providerConfig.id ?? providerConfig.provider}:${providerConfig.model}`,
      name: providerConfig.model,
      provider: providerConfig.id ?? providerConfig.provider,
      capabilities: providerConfig.capabilities ?? ["balanced", "reasoning"],
      contextWindow: 8192,
      supportsTools: providerConfig.provider === "openai-compatible",
      latencyMs: providerConfig.provider === "ollama" ? 1000 : 800,
      costPer1kInput: providerConfig.provider === "ollama" ? 0 : 0.01,
      costPer1kOutput: providerConfig.provider === "ollama" ? 0 : 0.03,
      status: "available",
    });
  }
  return new ModelRuntime(registry, config, providers);
}

function createProvider(config: ModelRuntimeProviderConfig): ModelProvider {
  return config.provider === "ollama"
    ? new OllamaModelProvider(config)
    : new OpenAICompatibleModelProvider(config);
}

function responseFrom(input: {
  readonly providerId: string;
  readonly model: string;
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
  readonly latencyMs: number;
  readonly fallbackUsed: boolean;
  readonly finishReason?: string;
}): ModelResponse {
  const totalTokens = input.totalTokens ?? input.inputTokens + input.outputTokens;
  return {
    id: createId("model_response"),
    providerId: input.providerId,
    model: input.model,
    text: input.text,
    usage: {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens,
    },
    latencyMs: input.latencyMs,
    fallbackUsed: input.fallbackUsed,
    finishReason: input.finishReason,
  };
}

function usageFrom(input: { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens?: number }): TokenUsage {
  return {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.totalTokens ?? input.inputTokens + input.outputTokens,
  };
}

async function* readJsonLines(response: Response): AsyncIterable<unknown> {
  for await (const line of readResponseLines(response)) {
    const trimmed = line.trim();
    if (trimmed) yield JSON.parse(trimmed);
  }
}

async function* readServerSentEvents(response: Response): AsyncIterable<string> {
  for await (const line of readResponseLines(response)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) continue;
    yield trimmed.slice("data:".length).trim();
  }
}

async function* readResponseLines(response: Response): AsyncIterable<string> {
  if (!response.body) throw new Error("Model provider did not return a readable stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) yield line;
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield buffer;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function providerError(code: string, message: string) {
  return {
    code,
    message,
    category: "provider" as const,
    recoverable: true,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
