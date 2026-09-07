import { fail, ok, type JsonObject, type QuackResult } from "../core/types.js";

/** Describes a provider's advertised capabilities. */
export interface ProviderCapabilities {
  /** Unique provider identifier. */
  readonly providerId: string;
  /** Models this provider supports. */
  readonly models: readonly string[];
  readonly supportsStreaming: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsToolCalling: boolean;
  readonly supportsEmbeddings: boolean;
  readonly supportsMultimodal: boolean;
}

/** Input parameters for a generation request. */
export interface GenerateRequest {
  /** Target model name. */
  readonly model: string;
  /** Input prompt text. */
  readonly prompt: string;
  /** Optional metadata forwarded to the provider. */
  readonly metadata?: JsonObject;
}

/** The result returned from a provider's generation call. */
export interface GenerateResult {
  /** Generated output text. */
  readonly text: string;
  /** Model that produced the output. */
  readonly model: string;
  /** Optional performance or usage metrics. */
  readonly metrics?: JsonObject;
}

/** Pluggable adapter interface for AI provider backends. */
export interface ProviderAdapter {
  /** Unique provider identifier. */
  readonly id: string;
  /** Returns the provider's capabilities. */
  discover(): Promise<ProviderCapabilities>;
  /** Checks whether the provider is reachable and responsive. */
  healthCheck(): Promise<{ readonly healthy: boolean; readonly message: string }>;
  /** Sends a generation request and returns the result. */
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

/** Registry that manages provider lifecycle and lookup by ID. */
export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderAdapter>();

  register(provider: ProviderAdapter): QuackResult<ProviderCapabilities["providerId"]> {
    if (this.providers.has(provider.id)) {
      return fail({
        code: "provider.duplicate",
        message: `Provider ${provider.id} is already registered.`,
        category: "provider",
        recoverable: true,
      });
    }

    this.providers.set(provider.id, provider);
    return ok(provider.id);
  }

  get(id: string): QuackResult<ProviderAdapter> {
    const provider = this.providers.get(id);
    if (!provider) {
      return fail({
        code: "provider.not_found",
        message: `Provider ${id} is not registered.`,
        category: "provider",
        recoverable: true,
      });
    }

    return ok(provider);
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}

export class EchoProvider implements ProviderAdapter {
  readonly id = "core.echo-provider";

  async discover(): Promise<ProviderCapabilities> {
    return {
      providerId: this.id,
      models: ["echo-1"],
      supportsStreaming: false,
      supportsStructuredOutput: false,
      supportsToolCalling: false,
      supportsEmbeddings: false,
      supportsMultimodal: false,
    };
  }

  async healthCheck(): Promise<{ readonly healthy: boolean; readonly message: string }> {
    return { healthy: true, message: "Echo provider is available offline." };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    return {
      text: `EchoProvider(${request.model}): ${request.prompt}`,
      model: request.model,
      metrics: {
        inputCharacters: request.prompt.length,
        outputCharacters: request.prompt.length + request.model.length + 16,
      },
    };
  }
}

