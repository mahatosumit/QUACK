import { type GenerateRequest, type GenerateResult, type ProviderAdapter, type ProviderRegistry } from "./provider.js";

/** Sequential, explicit fallback router. It never retries a provider outside the caller's declared order. */
export class ProviderFallbackRouter {
  constructor(private readonly providers: ProviderRegistry) {}

  async generate(request: GenerateRequest, providerIds: readonly string[]): Promise<{ readonly result: GenerateResult; readonly providerId: string; readonly attempted: readonly string[] }> {
    const attempted: string[] = [];
    let lastError: unknown;
    for (const providerId of providerIds) {
      attempted.push(providerId);
      const provider = this.providers.get(providerId);
      if (!provider.ok) {
        lastError = new Error(provider.error.message);
        continue;
      }
      try {
        return { result: await provider.data.generate(request), providerId, attempted };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No configured provider could generate a response.");
  }
}

/** Deterministic provider for offline harnesses. */
export class DeterministicMockProvider implements ProviderAdapter {
  readonly id = "test.deterministic-mock";

  async discover() {
    return { providerId: this.id, models: ["deterministic-1"], supportsStreaming: false, supportsStructuredOutput: true, supportsToolCalling: false, supportsEmbeddings: false, supportsMultimodal: false };
  }

  async healthCheck() {
    return { healthy: true, message: "Deterministic mock provider is available." };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    return { text: `mock:${request.model}:${request.prompt}`, model: request.model, metrics: { deterministic: true } };
  }
}
