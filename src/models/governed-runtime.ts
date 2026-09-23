import { createId, fail, ok, type JsonObject, type QuackResult } from "../core/types.js";
import type { EventBus } from "../events/event-bus.js";
import { QUACK_CONTRACT_VERSION, type CapabilityRequirement, type ExecutionContextV1, type ProviderModelRequestV1 } from "../contracts/index.js";
import { buildToolCapabilityRequest, type CapabilityBroker } from "../security/capability-broker.js";
import type { Permission } from "../security/permissions.js";
import { GovernedProviderRouter } from "../providers/governed-router.js";
import { ProviderRoutingError, type ProviderRoutingPolicyV1, type ProviderRouteResultV1 } from "../providers/kernel.js";
import type { ModelInfo } from "./types.js";
import type { EmbeddingRequest, EmbeddingResponse, ModelRequest, ModelResponse, ModelRuntime, ModelStreamChunk } from "./runtime.js";
import { SYSTEM_PROMPT_METADATA_KEY } from "./provider-v1-adapter.js";

export interface GovernedModelRuntimeOptions {
  readonly providerRouter?: GovernedProviderRouter;
  readonly events?: Pick<EventBus, "emit">;
}

/**
 * Governed model dispatch (ADR 0036).
 *
 * `ModelRuntime.generate`/`stream` contact provider endpoints (Ollama,
 * OpenAI-compatible) with no authority check. `GovernedModelRuntime` wraps a
 * `ModelRuntime` and resolves `provider.invoke` through the capability broker
 * for every generation/stream call, carrying the full execution identity
 * (mission, task, agent, actor) plus cancellation. `selectModel` remains
 * ungated: it is a registry metadata lookup that performs no network I/O
 * and grants nothing. Denial fails closed with `model.permission_denied`
 * before any provider is contacted.
 */
export class GovernedModelRuntime {
  constructor(
    private readonly inner: ModelRuntime,
    private readonly capabilityBroker: CapabilityBroker,
    private readonly options: GovernedModelRuntimeOptions = {},
  ) {}

  selectModel(options: Parameters<ModelRuntime["selectModel"]>[0] = {}): QuackResult<ModelInfo> {
    return this.inner.selectModel(options);
  }

  getFailures(): ModelRuntime["getFailures"] extends () => infer T ? T : never {
    return this.inner.getFailures();
  }

  async generate(
    request: ModelRequest,
    context: {
      readonly missionId?: string;
      readonly taskId?: string;
      readonly agentId?: string;
      readonly skillId?: string;
      readonly actor: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<QuackResult<ModelResponse>> {
    if (this.options.providerRouter) return this.generateCanonical(request, context);
    const decision = await this.resolveAuthority(request, context);
    if (!decision.ok) return decision as QuackResult<ModelResponse>;
    if (context.signal?.aborted) {
      return fail(this.cancelled());
    }
    return this.inner.generate({ ...request, metadata: withGovernedProvenance(request.metadata) });
  }

  private async generateCanonical(
    request: ModelRequest,
    context: {
      readonly missionId?: string;
      readonly taskId?: string;
      readonly agentId?: string;
      readonly skillId?: string;
      readonly actor: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<QuackResult<ModelResponse>> {
    if (context.signal?.aborted) return fail(this.cancelled());
    const executionId = createId("model-dispatch");
    const executionContext: ExecutionContextV1 = {
      contractVersion: QUACK_CONTRACT_VERSION,
      missionId: context.missionId ?? "unscoped",
      taskId: context.taskId ?? executionId,
      executionId,
      actor: context.actor,
      signal: context.signal,
      metadata: {
        ...(context.agentId ? { agentId: context.agentId } : {}),
        ...(context.skillId ? { skillId: context.skillId } : {}),
      },
    };
    try {
      const routed = await this.options.providerRouter!.route({
        request: {
          model: request.model ?? "",
          prompt: request.prompt,
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature,
          metadata: {
            ...withGovernedProvenance(request.metadata),
            ...(request.system ? { [SYSTEM_PROMPT_METADATA_KEY]: request.system } : {}),
          },
        },
        requirements: requirementsFor(request),
        context: executionContext,
        policy: routingPolicyFor(request),
      });
      const response = canonicalResponse(routed);
      await this.options.events?.emit("model.routed", {
        executionId: response.id,
        providerId: response.providerId,
        model: response.model,
        latencyMs: response.latencyMs,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        candidateCount: routed.candidates.length,
        fallbackCount: routed.fallbackEvents.length,
      }, { taskId: context.taskId, actor: "model-router" }).catch(() => undefined);
      return ok(response);
    } catch (error) {
      if (error instanceof ProviderRoutingError) {
        await this.options.events?.emit("model.routing_failed", {
          executionId,
          providerId: error.normalized.providerId,
          model: error.normalized.model ?? null,
          category: error.normalized.category,
          retriable: error.normalized.retriable,
          candidateCount: error.candidates.length,
          fallbackCount: error.fallbackEvents.length,
        }, { taskId: context.taskId, actor: "model-router" }).catch(() => undefined);
        return fail({
          code: error.normalized.category === "POLICY_DENIED" ? "model.permission_denied" : "model.routing_failed",
          message: error.normalized.message,
          category: error.normalized.category === "POLICY_DENIED" ? "permission" : "provider",
          recoverable: error.normalized.retriable,
          context: {
            providerId: error.normalized.providerId,
            model: error.normalized.model ?? null,
            failureCategory: error.normalized.category,
            candidateCount: error.candidates.length,
            fallbackCount: error.fallbackEvents.length,
          },
        });
      }
      return fail({
        code: "model.routing_failed",
        message: error instanceof Error ? error.message : String(error),
        category: "provider",
        recoverable: false,
      });
    }
  }

  async *stream(
    request: ModelRequest,
    context: {
      readonly missionId?: string;
      readonly taskId?: string;
      readonly agentId?: string;
      readonly skillId?: string;
      readonly actor: string;
      readonly signal?: AbortSignal;
    },
  ): AsyncIterable<ModelStreamChunk> {
    if (this.options.providerRouter) {
      yield* this.streamCanonical(request, context);
      return;
    }
    const decision = await this.resolveAuthority(request, context);
    if (!decision.ok) throw new Error(decision.error.message);
    if (context.signal?.aborted) throw new Error("Model generation was cancelled before dispatch.");
    yield* this.inner.stream({ ...request, metadata: withGovernedProvenance(request.metadata) });
  }

  private async *streamCanonical(
    request: ModelRequest,
    context: {
      readonly missionId?: string;
      readonly taskId?: string;
      readonly agentId?: string;
      readonly skillId?: string;
      readonly actor: string;
      readonly signal?: AbortSignal;
    },
  ): AsyncIterable<ModelStreamChunk> {
    if (context.signal?.aborted) throw new Error("Model generation was cancelled before dispatch.");
    const executionId = createId("model-stream");
    const started = Date.now();
    let routed = false;
    try {
      for await (const event of this.options.providerRouter!.stream({
        request: canonicalRequest(request),
        requirements: [...requirementsFor(request), { capability: "streaming", minimumLevel: "NATIVE" }],
        context: executionContextFor(context, executionId),
        policy: routingPolicyFor(request),
      })) {
        if (!routed) {
          routed = true;
          await this.options.events?.emit("model.routed", {
            executionId,
            providerId: event.providerId,
            model: event.model,
            latencyMs: Date.now() - started,
            streaming: true,
          }, { taskId: context.taskId, actor: "model-router" }).catch(() => undefined);
        }
        yield {
          providerId: event.providerId,
          model: event.model,
          text: event.type === "TEXT_DELTA" ? event.text ?? "" : "",
          done: event.type === "COMPLETED",
          ...(event.usage ? { usage: {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            totalTokens: event.usage.totalTokens,
          } } : {}),
        };
      }
    } catch (error) {
      if (error instanceof ProviderRoutingError) {
        await this.options.events?.emit("model.routing_failed", {
          executionId,
          providerId: error.normalized.providerId,
          model: error.normalized.model ?? null,
          category: error.normalized.category,
          retriable: error.normalized.retriable,
          candidateCount: error.candidates.length,
          fallbackCount: error.fallbackEvents.length,
          streaming: true,
        }, { taskId: context.taskId, actor: "model-router" }).catch(() => undefined);
        throw new Error(error.normalized.message);
      }
      throw error;
    }
  }

  /**
   * P9 governed embedding dispatch (ADR 0043): resolves `provider.invoke`
   * through the capability broker BEFORE any provider contact, exactly like
   * generation. Denial fails closed with `model.permission_denied`; the
   * wrapped runtime must expose `embed` (embedding-capable providers only).
   */
  async embed(
    request: EmbeddingRequest,
    context: {
      readonly missionId?: string;
      readonly taskId?: string;
      readonly agentId?: string;
      readonly skillId?: string;
      readonly actor: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<QuackResult<EmbeddingResponse>> {
    if (typeof (this.inner as { embed?: unknown }).embed !== "function") {
      return fail({
        code: "model.embed_unsupported",
        message: "The governed runtime does not expose an embedding path.",
        category: "provider",
        recoverable: false,
      });
    }
    const authorityRequest = { ...request, capability: "embedding" as const };
    const decision = await this.resolveAuthority(authorityRequest as ModelRequest, context);
    if (!decision.ok) return decision as QuackResult<EmbeddingResponse>;
    if (context.signal?.aborted) {
      return fail(this.cancelled());
    }
    return (this.inner as unknown as { embed(request: EmbeddingRequest): Promise<QuackResult<EmbeddingResponse>> })
      .embed({ ...request, metadata: withGovernedProvenance(request.metadata) });
  }

  private async resolveAuthority(
    request: ModelRequest,
    context: { readonly missionId?: string; readonly taskId?: string; readonly agentId?: string; readonly skillId?: string; readonly actor: string },
  ): Promise<QuackResult<true>> {
    const permission: Permission = "provider.invoke";
    const capabilityRequest = buildToolCapabilityRequest({
      taskId: context.taskId,
      missionId: context.missionId,
      agentId: context.agentId,
      skillId: context.skillId,
      actor: context.actor,
      toolId: `model:${request.model ?? request.capability ?? "auto"}`,
      permission,
      input: { ...(request.model ? { model: request.model } : {}), ...(request.capability ? { capability: request.capability } : {}) } as JsonObject,
      reason: `Model generation (${request.model ?? "auto-selected"}) requires provider invocation authority.`,
    });
    const decision = await this.capabilityBroker.resolve(capabilityRequest);
    if (!decision.granted) {
      return fail({
        code: "model.permission_denied",
        message: `CapabilityDeniedError: ${decision.reason}`,
        category: "permission",
        recoverable: true,
        context: { errorType: "CapabilityDeniedError", capabilityId: capabilityRequest.capabilityId, requestId: capabilityRequest.id },
      });
    }
    const revalidated = this.capabilityBroker.revalidateAuthority?.(capabilityRequest);
    if (revalidated && !revalidated.granted) {
      return fail({
        code: "model.permission_denied",
        message: `CapabilityDeniedError: ${revalidated.reason}`,
        category: "permission",
        recoverable: true,
        context: { errorType: "CapabilityDeniedError", capabilityId: capabilityRequest.capabilityId, requestId: capabilityRequest.id },
      });
    }
    return { ok: true, data: true };
  }

  private cancelled() {
    return {
      code: "model.cancelled",
      message: "Model generation was cancelled before dispatch.",
      category: "runtime" as const,
      recoverable: false,
    };
  }
}

function withGovernedProvenance(metadata: JsonObject | undefined): JsonObject {
  return { ...(metadata ?? {}), governedDispatch: true, dispatchId: createId("model-dispatch") };
}

function canonicalRequest(request: ModelRequest): ProviderModelRequestV1 {
  return {
    model: request.model ?? "",
    prompt: request.prompt,
    maxOutputTokens: request.maxTokens,
    temperature: request.temperature,
    metadata: {
      ...withGovernedProvenance(request.metadata),
      ...(request.system ? { [SYSTEM_PROMPT_METADATA_KEY]: request.system } : {}),
    },
  };
}

function executionContextFor(
  context: {
    readonly missionId?: string;
    readonly taskId?: string;
    readonly agentId?: string;
    readonly skillId?: string;
    readonly actor: string;
    readonly signal?: AbortSignal;
  },
  executionId: string,
): ExecutionContextV1 {
  return {
    contractVersion: QUACK_CONTRACT_VERSION,
    missionId: context.missionId ?? "unscoped",
    taskId: context.taskId ?? executionId,
    executionId,
    actor: context.actor,
    signal: context.signal,
    metadata: {
      ...(context.agentId ? { agentId: context.agentId } : {}),
      ...(context.skillId ? { skillId: context.skillId } : {}),
    },
  };
}

function requirementsFor(request: ModelRequest): readonly CapabilityRequirement[] {
  if (request.capability === "embedding") return [{ capability: "embedding", minimumLevel: "NATIVE" }];
  if (request.capability === "reasoning" || request.capability === "coding" || request.capability === "careful") {
    return [
      { capability: "text", minimumLevel: "NATIVE" },
      { capability: "reasoning", minimumLevel: "DEGRADED" },
    ];
  }
  return [{ capability: "text", minimumLevel: "NATIVE" }];
}

function routingPolicyFor(request: ModelRequest): ProviderRoutingPolicyV1 {
  const providerId = typeof request.metadata?.["providerId"] === "string" ? String(request.metadata["providerId"]) : undefined;
  const localOnly = request.metadata?.["localOnly"] === true || request.metadata?.["privacy"] === "local-only";
  const privateOnly = request.metadata?.["privacy"] === "private-only";
  return {
    privacy: localOnly ? "local-only" : privateOnly ? "private-only" : "allow-cloud",
    allowCloudFallback: !localOnly,
    ...(providerId ? { allowedProviderIds: [providerId], preferredProviderIds: [providerId] } : {}),
    ...(localOnly ? { preferredBoundaries: ["local"] } : {}),
  };
}

function canonicalResponse(routed: ProviderRouteResultV1): ModelResponse {
  return {
    id: routed.response.executionId,
    providerId: routed.response.providerId,
    model: routed.response.model,
    text: routed.response.text,
    usage: {
      inputTokens: routed.response.usage.inputTokens,
      outputTokens: routed.response.usage.outputTokens,
      totalTokens: routed.response.usage.totalTokens,
    },
    latencyMs: routed.response.latencyMs,
    fallbackUsed: routed.fallbackEvents.some(event => event.result === "FALLBACK"),
    finishReason: routed.response.finishReason,
    routing: {
      selectedProviderId: routed.selected.providerId,
      selectedModel: routed.selected.model,
      candidates: routed.candidates.map(candidate => ({
        providerId: candidate.providerId,
        model: candidate.model,
        boundary: candidate.boundary,
        eligible: candidate.eligible,
        reasons: [...candidate.reasons],
        score: Number.isFinite(candidate.score) ? candidate.score : null,
      })),
      fallbackCount: routed.fallbackEvents.length,
    },
  };
}

/**
 * Gate a live `ModelRuntime` instance in place: `generate` and `stream` on
 * the returned proxy resolve `provider.invoke` through the capability broker
 * (with the caller's execution context) before delegating to the wrapped
 * runtime. All metadata-only members (selectModel, getFailures, registry,
 * router, config) delegate unchanged. The wrapped instance's own generate/
 * stream are shadowed by non-configurable gated versions on the proxy, so the
 * ungoverned path is not reachable through the proxy.
 */
export type GovernedModelRuntimeSurface = ModelRuntime & {
  generate(request: ModelRequest, context?: {
    readonly missionId?: string;
    readonly taskId?: string;
    readonly agentId?: string;
    readonly skillId?: string;
    readonly actor: string;
    readonly signal?: AbortSignal;
  }): Promise<QuackResult<ModelResponse>>;
  stream(request: ModelRequest, context?: {
    readonly missionId?: string;
    readonly taskId?: string;
    readonly agentId?: string;
    readonly skillId?: string;
    readonly actor: string;
    readonly signal?: AbortSignal;
  }): AsyncIterable<ModelStreamChunk>;
};

export function governModelRuntime(
  inner: ModelRuntime,
  capabilityBroker: CapabilityBroker,
  options: GovernedModelRuntimeOptions = {},
): GovernedModelRuntimeSurface {
  const gated = Object.create(inner) as ModelRuntime;
  const gatedGenerate = gated.generate.bind(gated);
  const gatedStream = gated.stream.bind(gated);
  const governed = new GovernedModelRuntime({ generate: gatedGenerate, stream: gatedStream,
    selectModel: gated.selectModel.bind(gated), getFailures: gated.getFailures.bind(gated) } as unknown as ModelRuntime, capabilityBroker, options);
  Object.defineProperty(gated, "generate", {
    value: (request: ModelRequest, context: Parameters<GovernedModelRuntime["generate"]>[1]) =>
      context ? governed.generate(request, context) : Promise.resolve(fail({
        code: "model.execution_context_required",
        message: "Governed model generation requires an execution context (mission/task/actor) for capability resolution.",
        category: "permission",
        recoverable: false,
      })),
    configurable: false, enumerable: true, writable: false,
  });
  Object.defineProperty(gated, "stream", {
    value: (request: ModelRequest, context: Parameters<GovernedModelRuntime["stream"]>[1]) => {
      if (!context) {
        return (async function* () {
          throw new Error("Governed model streaming requires an execution context for capability resolution.");
        })();
      }
      return governed.stream(request, context);
    },
    configurable: false, enumerable: true, writable: false,
  });
  if (typeof gated.embed === "function") {
    Object.defineProperty(gated, "embed", {
      value: (request: import("./runtime.js").EmbeddingRequest, context: Parameters<GovernedModelRuntime["embed"]>[1]) =>
        context ? governed.embed(request, context) : Promise.resolve(fail({
          code: "model.execution_context_required",
          message: "Governed embedding requires an execution context (mission/task/actor) for capability resolution.",
          category: "permission",
          recoverable: false,
        })),
      configurable: false, enumerable: true, writable: false,
    });
  }
  return gated;
}
