import { type JsonObject } from "../core/types.js";
import { type ProviderAdapter, type ProviderCapabilities, type GenerateRequest, type GenerateResult } from "./provider.js";
import { readProviderCredentialForBoot } from "../security/secret-provider.js";

/** Configuration for NVIDIA NIM (Inference Microservices) API Provider. */
export interface NvidiaProviderConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly defaultModel?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

/**
 * Adapter for NVIDIA NIM AI models API.
 * Maps NVIDIA NIM endpoints to standard QUACK ProviderAdapter interface.
 */
export class NvidiaNimProvider implements ProviderAdapter {
  readonly id = "provider.nvidia-nim";

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(config: NvidiaProviderConfig = {}) {
    // Credential fallback stays inside the security layer's sanctioned
    // boot-time boundary (allowlist + consumer binding enforced there).
    this.apiKey = config.apiKey ?? readProviderCredentialForBoot("NVIDIA_API_KEY", "provider.nvidia-nim");
    this.baseUrl = config.baseUrl ?? process.env.QUACK_NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
    this.defaultModel = config.defaultModel ?? process.env.QUACK_NVIDIA_MODEL ?? "";
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.fetcher = config.fetch ?? fetch;
  }

  async discover(): Promise<ProviderCapabilities> {
    if (!this.apiKey) {
      return this.capabilities(this.defaultModel ? [this.defaultModel] : []);
    }
    const response = await this.fetcher(`${this.baseUrl}/models`, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`NVIDIA model discovery failed with status ${response.status}.`);
    const parsed = await response.json() as { readonly data?: readonly { readonly id?: string }[] };
    const models = (parsed.data ?? []).flatMap((model) => model.id ? [model.id] : []);
    return this.capabilities(models);
  }

  private capabilities(models: readonly string[]): ProviderCapabilities {
    return {
      providerId: this.id,
      models,
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsToolCalling: false,
      supportsEmbeddings: false,
      supportsMultimodal: false,
    };
  }

  async healthCheck(): Promise<{ readonly healthy: boolean; readonly message: string }> {
    if (!this.apiKey) {
      return {
        healthy: false,
        message: "NVIDIA authentication is not configured. Set NVIDIA_API_KEY to activate the live endpoint.",
      };
    }
    try {
      const response = await this.fetcher(`${this.baseUrl}/models`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        return { healthy: false, message: `NVIDIA API returned status ${response.status}` };
      }
      return { healthy: true, message: `Connected to NVIDIA NIM at ${this.baseUrl}` };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : "NVIDIA API health check failed",
      };
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const startTime = Date.now();
    const targetModel = request.model || this.defaultModel;
    if (!this.apiKey) throw new Error("NVIDIA authentication is not configured.");
    if (!targetModel) throw new Error("NVIDIA model must be selected from discovery or configuration.");

    const body = {
      model: targetModel,
      messages: [{ role: "user", content: request.prompt }],
      temperature: 0.2,
      max_tokens: 4096,
    };

    const response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`NVIDIA NIM API request failed with status ${response.status}.`);
    }

    const data = (await response.json()) as {
      readonly choices?: readonly { readonly message?: { readonly content?: string } }[];
      readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
      readonly model?: string;
    };

    const text = data.choices?.[0]?.message?.content ?? "";

    return {
      text,
      model: data.model ?? targetModel,
      metrics: {
        durationMs: Date.now() - startTime,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        provider: this.id,
      },
    };
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }
}
