import { createId, now, type JsonObject } from "../core/types.js";
import {
  QUACK_CONTRACT_VERSION,
  capabilitySupport,
  satisfiesCapability,
  type CapabilityRequirement,
  type ProviderCapabilitySupport,
  type ExecutionBoundary,
  type ExecutionContextV1,
  type ModelDescriptorV1,
  type NormalizedProviderErrorV1,
  type ProviderFailureCategory,
  type ProviderModelRequestV1,
  type ProviderModelResponseV1,
  type QuackProviderV1,
} from "../contracts/index.js";

export interface ProviderRoutingPolicyV1 {
  readonly privacy: "local-only" | "private-only" | "allow-cloud";
  readonly allowCloudFallback: boolean;
  readonly allowedProviderIds?: readonly string[];
  readonly deniedProviderIds?: readonly string[];
  readonly preferredBoundaries?: readonly ExecutionBoundary[];
  readonly preferredProviderIds?: readonly string[];
}

export interface ProviderRouteRequestV1 {
  readonly request: ProviderModelRequestV1;
  readonly requirements: readonly CapabilityRequirement[];
  readonly context: ExecutionContextV1;
  readonly policy: ProviderRoutingPolicyV1;
  readonly retry?: Partial<ProviderRetryPolicy>;
}

export interface ProviderRetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
  readonly timeoutMs: number;
}

export interface ProviderCandidateDecisionV1 {
  readonly providerId: string;
  readonly model: string;
  readonly boundary: ExecutionBoundary;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly score: number;
}

export interface ProviderFallbackEventV1 {
  readonly originalProviderId: string;
  readonly originalModel: string;
  readonly failureCategory: ProviderFailureCategory;
  readonly retryCount: number;
  readonly candidateProviderIds: readonly string[];
  readonly selectedFallbackProviderId?: string;
  readonly policy: ProviderRoutingPolicyV1;
  readonly latencyMs: number;
  readonly result: "RETRY" | "FALLBACK" | "FAILED";
}

export interface ProviderRouteResultV1 {
  readonly response: ProviderModelResponseV1;
  readonly selected: ProviderCandidateDecisionV1;
  readonly candidates: readonly ProviderCandidateDecisionV1[];
  readonly fallbackEvents: readonly ProviderFallbackEventV1[];
}

export class ProviderRoutingError extends Error {
  constructor(
    readonly normalized: NormalizedProviderErrorV1,
    readonly candidates: readonly ProviderCandidateDecisionV1[] = [],
    readonly fallbackEvents: readonly ProviderFallbackEventV1[] = [],
  ) {
    super(normalized.message);
  }
}

export class CanonicalProviderRegistry {
  private readonly providers = new Map<string, QuackProviderV1>();

  register(provider: QuackProviderV1): void {
    const metadata = provider.metadata();
    if (metadata.contractVersion !== QUACK_CONTRACT_VERSION) {
      throw new Error(`Provider ${metadata.providerId} uses unsupported contract ${metadata.contractVersion}.`);
    }
    if (this.providers.has(metadata.providerId)) throw new Error(`Provider ${metadata.providerId} is already registered.`);
    this.providers.set(metadata.providerId, provider);
  }

  get(providerId: string): QuackProviderV1 | undefined {
    return this.providers.get(providerId);
  }

  list(): readonly QuackProviderV1[] {
    return [...this.providers.values()];
  }
}

const DEFAULT_RETRY_POLICY: ProviderRetryPolicy = {
  maxRetries: 1,
  baseDelayMs: 100,
  maxDelayMs: 2_000,
  jitterRatio: 0.2,
  timeoutMs: 60_000,
};

interface CircuitState {
  failures: number;
  openUntil: number;
}

/** Capability- and policy-first router for the QUACK Provider Contract v1. */
export class CapabilityProviderRouter {
  private readonly circuits = new Map<string, CircuitState>();

  constructor(
    private readonly registry: CanonicalProviderRegistry,
    private readonly circuitFailureThreshold = 3,
    private readonly circuitRecoveryMs = 30_000,
  ) {}

  async route(input: ProviderRouteRequestV1): Promise<ProviderRouteResultV1> {
    const candidates = await this.resolveCandidates(input);
    const eligible = candidates.filter((candidate) => candidate.eligible).sort(compareCandidates);
    if (eligible.length === 0) {
      const deniedOnlyByPolicy = candidates.length > 0 && candidates.every((candidate) =>
        candidate.reasons.every((reason) => reason.startsWith("privacy-") || reason.startsWith("provider-") || reason === "cloud-fallback-disabled"),
      );
      throw new ProviderRoutingError(normalizedError({
        category: deniedOnlyByPolicy ? "POLICY_DENIED" : "CAPABILITY_MISMATCH",
        providerId: "router",
        model: input.request.model,
        message: "No provider/model satisfies the required capabilities and policy.",
        retriable: false,
      }), candidates);
    }

    const retry = { ...DEFAULT_RETRY_POLICY, ...input.retry };
    const fallbackEvents: ProviderFallbackEventV1[] = [];
    const original = eligible[0];
    let lastError: NormalizedProviderErrorV1 | undefined;

    for (let candidateIndex = 0; candidateIndex < eligible.length; candidateIndex += 1) {
      const candidate = eligible[candidateIndex];
      const provider = this.registry.get(candidate.providerId)!;
      for (let attempt = 0; attempt <= retry.maxRetries; attempt += 1) {
        const started = Date.now();
        try {
          const response = await withTimeout(
            provider.generate({ ...input.request, model: candidate.model }, input.context),
            retry.timeoutMs,
            input.context.signal,
          );
          this.recordSuccess(candidate.providerId);
          if (candidateIndex > 0) {
            fallbackEvents.push({
              originalProviderId: original.providerId,
              originalModel: original.model,
              failureCategory: lastError?.category ?? "PROVIDER_INTERNAL",
              retryCount: attempt,
              candidateProviderIds: eligible.map((item) => item.providerId),
              selectedFallbackProviderId: candidate.providerId,
              policy: input.policy,
              latencyMs: Date.now() - started,
              result: "FALLBACK",
            });
          }
          return { response, selected: candidate, candidates, fallbackEvents };
        } catch (error) {
          lastError = normalizeProviderFailure(error, candidate.providerId, candidate.model);
          this.recordFailure(candidate.providerId);
          const canRetry = lastError.retriable && attempt < retry.maxRetries;
          fallbackEvents.push({
            originalProviderId: original.providerId,
            originalModel: original.model,
            failureCategory: lastError.category,
            retryCount: attempt,
            candidateProviderIds: eligible.map((item) => item.providerId),
            selectedFallbackProviderId: canRetry ? candidate.providerId : eligible[candidateIndex + 1]?.providerId,
            policy: input.policy,
            latencyMs: Date.now() - started,
            result: canRetry ? "RETRY" : eligible[candidateIndex + 1] ? "FALLBACK" : "FAILED",
          });
          if (!canRetry) break;
          await delay(backoffDelay(retry, attempt), input.context.signal);
        }
      }
    }

    throw new ProviderRoutingError(lastError ?? normalizedError({
      category: "PROVIDER_INTERNAL",
      providerId: original.providerId,
      model: original.model,
      message: "All eligible providers failed.",
      retriable: false,
    }), candidates, fallbackEvents);
  }

  private async resolveCandidates(input: ProviderRouteRequestV1): Promise<ProviderCandidateDecisionV1[]> {
    const decisions: ProviderCandidateDecisionV1[] = [];
    for (const provider of this.registry.list()) {
      const metadata = provider.metadata();
      const policyReasons = policyRejectionReasons(metadata.providerId, metadata.boundary, input.policy);
      // Privacy decisions happen before any health check or model discovery so a
      // forbidden cloud endpoint is never contacted by a local-only mission.
      if (policyReasons.length > 0) {
        decisions.push({
          providerId: metadata.providerId,
          model: input.request.model,
          boundary: metadata.boundary,
          eligible: false,
          reasons: policyReasons,
          score: Number.NEGATIVE_INFINITY,
        });
        continue;
      }
      if (this.isCircuitOpen(metadata.providerId)) {
        decisions.push({
          providerId: metadata.providerId,
          model: input.request.model,
          boundary: metadata.boundary,
          eligible: false,
          reasons: ["circuit-open"],
          score: Number.NEGATIVE_INFINITY,
        });
        continue;
      }

      let models: readonly ModelDescriptorV1[];
      try {
        const health = await provider.health(input.context);
        if (health.status !== "HEALTHY" && health.status !== "DEGRADED") {
          decisions.push({ providerId: metadata.providerId, model: input.request.model, boundary: metadata.boundary, eligible: false, reasons: [`health:${health.status}`], score: Number.NEGATIVE_INFINITY });
          continue;
        }
        models = await provider.discoverModels(input.context);
      } catch (error) {
        decisions.push({ providerId: metadata.providerId, model: input.request.model, boundary: metadata.boundary, eligible: false, reasons: [`discovery:${errorMessage(error)}`], score: Number.NEGATIVE_INFINITY });
        continue;
      }

      const matchingModels = input.request.model
        ? models.filter((model) => model.id === input.request.model)
        : models;
      for (const model of matchingModels) {
        const reasons = capabilityRejectionReasons(model.capabilities, input.requirements);
        decisions.push({
          providerId: metadata.providerId,
          model: model.id,
          boundary: metadata.boundary,
          eligible: reasons.length === 0,
          reasons,
          score: scoreCandidate(metadata.providerId, metadata.boundary, model, input.policy),
        });
      }
      if (matchingModels.length === 0) {
        decisions.push({ providerId: metadata.providerId, model: input.request.model, boundary: metadata.boundary, eligible: false, reasons: ["model-not-found"], score: Number.NEGATIVE_INFINITY });
      }
    }
    return decisions;
  }

  private isCircuitOpen(providerId: string): boolean {
    const circuit = this.circuits.get(providerId);
    if (!circuit) return false;
    if (circuit.openUntil <= Date.now()) {
      this.circuits.delete(providerId);
      return false;
    }
    return true;
  }

  private recordFailure(providerId: string): void {
    const previous = this.circuits.get(providerId) ?? { failures: 0, openUntil: 0 };
    const failures = previous.failures + 1;
    this.circuits.set(providerId, {
      failures,
      openUntil: failures >= this.circuitFailureThreshold ? Date.now() + this.circuitRecoveryMs : 0,
    });
  }

  private recordSuccess(providerId: string): void {
    this.circuits.delete(providerId);
  }
}

function policyRejectionReasons(providerId: string, boundary: ExecutionBoundary, policy: ProviderRoutingPolicyV1): string[] {
  const reasons: string[] = [];
  if (policy.allowedProviderIds && !policy.allowedProviderIds.includes(providerId)) reasons.push("provider-not-allowed");
  if (policy.deniedProviderIds?.includes(providerId)) reasons.push("provider-denied");
  if (policy.privacy === "local-only" && boundary !== "local") reasons.push("privacy-local-only");
  if (policy.privacy === "private-only" && boundary === "cloud") reasons.push("privacy-private-only");
  if (!policy.allowCloudFallback && boundary === "cloud" && policy.preferredBoundaries?.includes("local")) reasons.push("cloud-fallback-disabled");
  return reasons;
}

function capabilityRejectionReasons(capabilities: readonly ProviderCapabilitySupport[], requirements: readonly CapabilityRequirement[]): string[] {
  return requirements
    .filter((requirement) => requirement.required !== false)
    .flatMap((requirement) => satisfiesCapability(capabilitySupport(capabilities, requirement.capability), requirement)
      ? []
      : [`capability:${requirement.capability}`]);
}

function scoreCandidate(providerId: string, boundary: ExecutionBoundary, model: ModelDescriptorV1, policy: ProviderRoutingPolicyV1): number {
  let score = model.capabilities.reduce((total, capability) => total + ({ NATIVE: 4, EMULATED: 2, DEGRADED: 1, UNSUPPORTED: 0 }[capability.level]), 0);
  const preferredProviderIndex = policy.preferredProviderIds?.indexOf(providerId) ?? -1;
  if (preferredProviderIndex >= 0) score += 1_000 - preferredProviderIndex;
  const preferredBoundaryIndex = policy.preferredBoundaries?.indexOf(boundary) ?? -1;
  if (preferredBoundaryIndex >= 0) score += 100 - preferredBoundaryIndex;
  const reliability = model.metadata?.["historicalSuccessRate"];
  if (typeof reliability === "number") score += reliability * 10;
  const latency = model.metadata?.["latencyMs"];
  if (typeof latency === "number") score -= latency / 1_000;
  const cost = model.metadata?.["costPer1kTokens"];
  if (typeof cost === "number") score -= cost;
  return score;
}

function compareCandidates(left: ProviderCandidateDecisionV1, right: ProviderCandidateDecisionV1): number {
  return right.score - left.score || left.providerId.localeCompare(right.providerId) || left.model.localeCompare(right.model);
}

function normalizeProviderFailure(error: unknown, providerId: string, model: string): NormalizedProviderErrorV1 {
  if (error instanceof ProviderRoutingError) return error.normalized;
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  let category: ProviderFailureCategory = "PROVIDER_INTERNAL";
  let retriable = false;
  if (lower.includes("abort") || lower.includes("cancel")) category = "CANCELLED";
  else if (lower.includes("timeout") || lower.includes("timed out")) { category = "TIMEOUT"; retriable = true; }
  else if (lower.includes("429") || lower.includes("rate limit")) { category = "RATE_LIMIT"; retriable = true; }
  else if (lower.includes("401") || lower.includes("403") || lower.includes("auth")) category = "AUTHENTICATION";
  else if (lower.includes("not found") || lower.includes("404")) category = "MODEL_NOT_FOUND";
  else if (lower.includes("context") && lower.includes("limit")) category = "CONTEXT_OVERFLOW";
  else if (lower.includes("connect") || lower.includes("network") || lower.includes("fetch")) { category = "CONNECTION"; retriable = true; }
  else if (lower.includes("invalid") || lower.includes("400")) category = "INVALID_REQUEST";
  else if (lower.includes("json") || lower.includes("malformed")) category = "MALFORMED_RESPONSE";
  else if (lower.includes("500") || lower.includes("502") || lower.includes("503") || lower.includes("504")) retriable = true;
  return normalizedError({ category, providerId, model, message, retriable });
}

function normalizedError(input: Omit<NormalizedProviderErrorV1, "contractVersion">): NormalizedProviderErrorV1 {
  return { contractVersion: QUACK_CONTRACT_VERSION, ...input };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function backoffDelay(policy: ProviderRetryPolicy, attempt: number): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** attempt));
  const jitter = exponential * policy.jitterRatio * ((Math.random() * 2) - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("Cancelled."));
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Cancelled."));
    }, { once: true });
  });
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw signal.reason ?? new Error("Cancelled.");
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Provider request timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  const aborted = signal
    ? new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason ?? new Error("Cancelled.")), { once: true }))
    : new Promise<never>(() => undefined);
  try {
    return await Promise.race([operation, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createExecutionContext(input: Omit<ExecutionContextV1, "contractVersion" | "executionId"> & { readonly executionId?: string }): ExecutionContextV1 {
  return {
    contractVersion: QUACK_CONTRACT_VERSION,
    executionId: input.executionId ?? createId("execution"),
    missionId: input.missionId,
    taskId: input.taskId,
    actor: input.actor,
    signal: input.signal,
    deadline: input.deadline,
    metadata: input.metadata,
  };
}

export function providerDiagnosticSnapshot(routerError: ProviderRoutingError): JsonObject {
  return {
    capturedAt: now(),
    error: {
      category: routerError.normalized.category,
      providerId: routerError.normalized.providerId,
      model: routerError.normalized.model ?? null,
      retriable: routerError.normalized.retriable,
    },
    candidates: routerError.candidates.map((candidate) => ({
      providerId: candidate.providerId,
      model: candidate.model,
      boundary: candidate.boundary,
      eligible: candidate.eligible,
      reasons: candidate.reasons,
      score: Number.isFinite(candidate.score) ? candidate.score : null,
    })),
  };
}
