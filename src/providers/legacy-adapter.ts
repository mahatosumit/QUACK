import { createId, now } from "../core/types.js";
import {
  QUACK_CONTRACT_VERSION,
  type ProviderCapabilitySupport,
  type ExecutionBoundary,
  type ExecutionContextV1,
  type ModelDescriptorV1,
  type ProviderHealthV1,
  type ProviderMetadataV1,
  type ProviderModelRequestV1,
  type ProviderModelResponseV1,
  type QuackProviderV1,
} from "../contracts/index.js";
import type { ProviderAdapter } from "./provider.js";

export interface LegacyProviderBridgeConfig {
  readonly displayName: string;
  readonly runtime: string;
  readonly boundary: ExecutionBoundary;
  readonly endpoint?: string;
  readonly credentialEnvironmentVariables?: readonly string[];
  readonly capabilityOverrides?: Readonly<Record<string, readonly ProviderCapabilitySupport[]>>;
}
/**
 * Compatibility bridge for pre-v1 providers. Boolean legacy claims are marked
 * DEGRADED until a native v1 adapter or conformance evidence proves them.
 */
export class LegacyProviderV1Bridge implements QuackProviderV1 {
  constructor(
    private readonly provider: ProviderAdapter,
    private readonly config: LegacyProviderBridgeConfig,
  ) {}

  metadata(): ProviderMetadataV1 {
    return {
      contractVersion: QUACK_CONTRACT_VERSION,
      providerId: this.provider.id,
      displayName: this.config.displayName,
      runtime: this.config.runtime,
      boundary: this.config.boundary,
      endpoint: this.config.endpoint,
      credentialEnvironmentVariables: this.config.credentialEnvironmentVariables ?? [],
    };
  }

  async health(): Promise<ProviderHealthV1> {
    const started = Date.now();
    const health = await this.provider.healthCheck();
    return {
      status: health.healthy ? "HEALTHY" : inferUnhealthyStatus(health.message),
      checkedAt: now(),
      latencyMs: Date.now() - started,
      message: health.message,
    };
  }

  async discoverModels(): Promise<readonly ModelDescriptorV1[]> {
    const discovered = await this.provider.discover();
    return discovered.models.map((model) => ({
      id: model,
      providerId: this.provider.id,
      runtime: this.config.runtime,
      capabilities: this.config.capabilityOverrides?.[model] ?? legacyCapabilities(discovered),
    }));
  }

  async capabilities(model: string): Promise<readonly ProviderCapabilitySupport[]> {
    const match = (await this.discoverModels()).find((candidate) => candidate.id === model);
    return match?.capabilities ?? [];
  }

  async generate(request: ProviderModelRequestV1, context: ExecutionContextV1): Promise<ProviderModelResponseV1> {
    if (context.signal?.aborted) throw context.signal.reason ?? new Error("Cancelled.");
    const started = Date.now();
    const response = await this.provider.generate({ model: request.model, prompt: request.prompt, metadata: request.metadata });
    const inputTokens = numericMetric(response.metrics, "promptTokens");
    const outputTokens = numericMetric(response.metrics, "completionTokens");
    const hasProviderUsage = inputTokens !== undefined && outputTokens !== undefined;
    const normalizedInput = inputTokens ?? estimateTokens(request.prompt);
    const normalizedOutput = outputTokens ?? estimateTokens(response.text);
    return {
      executionId: context.executionId || createId("execution"),
      providerId: this.provider.id,
      model: response.model,
      text: response.text,
      usage: {
        inputTokens: normalizedInput,
        outputTokens: normalizedOutput,
        totalTokens: normalizedInput + normalizedOutput,
        source: hasProviderUsage ? "provider" : "estimated",
      },
      latencyMs: numericMetric(response.metrics, "durationMs") ?? Date.now() - started,
      rawMetadata: response.metrics,
    };
  }
}

function legacyCapabilities(capabilities: Awaited<ReturnType<ProviderAdapter["discover"]>>): readonly ProviderCapabilitySupport[] {
  const uncertain = (supported: boolean, capability: ProviderCapabilitySupport["capability"]): ProviderCapabilitySupport => supported
    ? { capability, level: "DEGRADED", reason: "Legacy boolean advertisement; native support is not conformance-verified." }
    : { capability, level: "UNSUPPORTED" };
  return [
    { capability: "text", level: "NATIVE" },
    uncertain(capabilities.supportsStreaming, "streaming"),
    uncertain(capabilities.supportsStructuredOutput, "structured-output"),
    uncertain(capabilities.supportsStructuredOutput, "json-schema"),
    uncertain(capabilities.supportsToolCalling, "tool-calling"),
    uncertain(capabilities.supportsEmbeddings, "embedding"),
    uncertain(capabilities.supportsMultimodal, "vision"),
    { capability: "token-accounting", level: "DEGRADED", reason: "Usage may be estimated by the compatibility bridge." },
  ];
}

function inferUnhealthyStatus(message: string): ProviderHealthV1["status"] {
  const normalized = message.toLowerCase();
  if (normalized.includes("auth") || normalized.includes("api key") || normalized.includes("401") || normalized.includes("403")) return "AUTHENTICATION_ERROR";
  if (normalized.includes("rate") || normalized.includes("429")) return "RATE_LIMITED";
  return "OFFLINE";
}

function numericMetric(metrics: ProviderModelResponseV1["rawMetadata"] | undefined, key: string): number | undefined {
  const value = metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
