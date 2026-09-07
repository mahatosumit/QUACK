import { type JsonObject } from "../core/types.js";
import { type ProviderAdapter, type ProviderCapabilities, type GenerateRequest, type GenerateResult } from "./provider.js";

/**
 * Configuration for an OpenAI-compatible provider.
 * Compatible with OpenAI, Anthropic (when proxied), Ollama, Groq, Together AI,
 * DeepSeek, and any other provider that exposes an OpenAI-compatible chat
 * completions endpoint.
 */
export interface OpenAiProviderConfig {
  /** Omit for local endpoints such as Ollama or llama.cpp. */
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly defaultModel?: string;
  readonly timeoutMs?: number;
  readonly id?: string;
  /** Endpoint-specific claims. Omitted capabilities default to unsupported. */
  readonly capabilities?: {
    readonly streaming?: boolean;
    readonly structuredOutput?: boolean;
    readonly toolCalling?: boolean;
    readonly embeddings?: boolean;
    readonly multimodal?: boolean;
  };
}

/**
 * Adapter for OpenAI-compatible chat completion APIs.
 * Uses the native fetch API — no external SDK dependency.
 */
export class OpenAiCompatibleProvider implements ProviderAdapter {
  readonly id: string;

  constructor(private readonly config: OpenAiProviderConfig) {
    this.id = config.id ?? "provider.openai-compatible";
  }

  async discover(): Promise<ProviderCapabilities> {
    const response = await fetch(`${this.config.baseUrl}/models`, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
    });
    if (!response.ok) throw new Error(`OpenAI-compatible model discovery failed with status ${response.status}.`);
    const parsed = await response.json() as { readonly data?: readonly { readonly id?: string }[] };
    const discovered = (parsed.data ?? []).flatMap((model) => model.id ? [model.id] : []);
    const models = discovered.length > 0 ? discovered : this.config.defaultModel ? [this.config.defaultModel] : [];
    return {
      providerId: this.id,
      models,
      supportsStreaming: this.config.capabilities?.streaming ?? false,
      supportsStructuredOutput: this.config.capabilities?.structuredOutput ?? false,
      supportsToolCalling: this.config.capabilities?.toolCalling ?? false,
      supportsEmbeddings: this.config.capabilities?.embeddings ?? false,
      supportsMultimodal: this.config.capabilities?.multimodal ?? false,
    };
  }

  async healthCheck(): Promise<{ readonly healthy: boolean; readonly message: string }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
      if (!response.ok) {
        return { healthy: false, message: `API returned status ${response.status}` };
      }
      return { healthy: true, message: `Connected to ${this.config.baseUrl}` };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : "Unknown error during health check",
      };
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const startTime = Date.now();
    const model = request.model || this.config.defaultModel;
    if (!model) throw new Error("A model must be selected from provider discovery or configuration.");
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: request.prompt }],
      temperature: 0.1,
      max_tokens: 4096,
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible request failed with status ${response.status}.`);
    }

    const data = (await response.json()) as {
      readonly choices: readonly { readonly message: { readonly content: string | null } }[];
      readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
      readonly model: string;
    };

    const text = data.choices?.[0]?.message?.content ?? "";
    const durationMs = Date.now() - startTime;

    return {
      text,
      model: data.model ?? model,
      metrics: {
        durationMs,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        provider: this.id,
      },
    };
  }

  private authHeaders(): Record<string, string> {
    return this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {};
  }
}

export function createOllamaProvider(options: { readonly baseUrl?: string; readonly model?: string; readonly timeoutMs?: number } = {}): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    id: "provider.ollama",
    baseUrl: options.baseUrl ?? "http://127.0.0.1:11434/v1",
    defaultModel: options.model,
    timeoutMs: options.timeoutMs,
  });
}

export function createVllmProvider(options: { readonly baseUrl: string; readonly model: string; readonly apiKey?: string; readonly timeoutMs?: number }): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    id: "provider.vllm",
    baseUrl: options.baseUrl,
    defaultModel: options.model,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
  });
}
