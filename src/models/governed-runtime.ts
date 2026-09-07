import { createId, fail, type JsonObject, type QuackResult } from "../core/types.js";
import { buildToolCapabilityRequest, type CapabilityBroker } from "../security/capability-broker.js";
import type { Permission } from "../security/permissions.js";
import type { ModelInfo } from "./types.js";
import type { ModelRequest, ModelResponse, ModelRuntime, ModelStreamChunk } from "./runtime.js";

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
    const decision = await this.resolveAuthority(request, context);
    if (!decision.ok) return decision as QuackResult<ModelResponse>;
    if (context.signal?.aborted) {
      return fail(this.cancelled());
    }
    return this.inner.generate({ ...request, metadata: withGovernedProvenance(request.metadata) });
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
    const decision = await this.resolveAuthority(request, context);
    if (!decision.ok) throw new Error(decision.error.message);
    if (context.signal?.aborted) throw new Error("Model generation was cancelled before dispatch.");
    yield* this.inner.stream({ ...request, metadata: withGovernedProvenance(request.metadata) });
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

export function governModelRuntime(inner: ModelRuntime, capabilityBroker: CapabilityBroker): GovernedModelRuntimeSurface {
  const gated = Object.create(inner) as ModelRuntime;
  const gatedGenerate = gated.generate.bind(gated);
  const gatedStream = gated.stream.bind(gated);
  const governed = new GovernedModelRuntime({ generate: gatedGenerate, stream: gatedStream,
    selectModel: gated.selectModel.bind(gated), getFailures: gated.getFailures.bind(gated) } as unknown as ModelRuntime, capabilityBroker);
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
  return gated;
}