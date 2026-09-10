import { fail, ok, type JsonObject, type QuackResult } from "../core/types.js";
import type { ModelRequest, ModelResponse, ModelStreamChunk } from "../models/runtime.js";
import type { ModelCapability } from "../models/types.js";
import { renderComposedText } from "./composer.js";
import { enforceInstructionDefense, flagsToMetadata } from "./injection-defense.js";
import { type InstructionDispatchObserver } from "./records.js";
import { INSTRUCTION_PLAN_VERSION, type ComposedInstruction, type InstructionOutputKind } from "./types.js";

/**
 * P8.4 governed model adaptation (ADR 0042).
 *
 * Translates a P8.1 `ComposedInstruction` into the existing provider-neutral
 * `ModelRequest` contract and dispatches it through the EXISTING
 * `GovernedModelRuntime` (ADR 0036). Ownership:
 *
 * - QIE owns WHAT the model is instructed to receive (the composed
 *   instruction — selected, validated, budgeted upstream).
 * - GovernedModelRuntime owns WHETHER/HOW that governed instruction is
 *   allowed to reach a model (capability broker, fail-closed).
 * - Providers own HOW to talk to a particular backend (protocol only).
 *
 * The adapter is a pure, deterministic translator. It performs no retrieval,
 * no provider I/O, no prompt mutation, and no role mapping: the existing
 * provider behavior (flat prompt / single user message) is preserved, and
 * QIE precedence is carried INSIDE the rendered instruction text
 * (`[TRUSTED]/[USER]/[DATA]` labels + fixed layer order), never by provider
 * role assignment. Instruction identity is preserved verbatim: the P8.1
 * digest is passed through request metadata untouched — never regenerated,
 * never replaced by timestamps, random ids, or provider hashes.
 *
 * Output contracts are CARRIED (rendered section + metadata), not enforced:
 * the current provider adapters have no response-schema capability, so no
 * schema enforcement is claimed. Token estimation is deliberately NOT
 * derived from the char budget (chars ≠ tokens); `maxTokens` stays an
 * explicit caller option.
 */

/** Runtime kinds accepted by {@link invokeGovernedInstruction}. */
export type InstructionOutputKindGuard = InstructionOutputKind;

/** Known P8.1 output-contract kinds (runtime mirror of the union). */
const OUTPUT_KINDS: ReadonlySet<string> = new Set<string>([
  "plainResponse",
  "structuredResponse",
  "toolIntent",
  "clarification",
  "plan",
  "verificationResult",
  "failureResult",
  "completionResult",
]);

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/** Optional request pass-throughs — the adapter invents no model routing. */
export interface GovernedInvocationOptions {
  /** Explicit model id (existing selection mechanism; no routing added). */
  readonly model?: string;
  /** Capability hint for the existing runtime router. */
  readonly capability?: ModelCapability;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

/** Execution identity for the governed dispatch (ADR 0036 context). */
export interface GovernedInvocationContext {
  readonly missionId?: string;
  readonly taskId?: string;
  readonly agentId?: string;
  readonly skillId?: string;
  readonly actor: string;
  readonly signal?: AbortSignal;
}

/**
 * Structural contract for a governed runtime: `generate` MUST accept the
 * execution context so `provider.invoke` authority is resolved before any
 * provider contact. Callers must pass a `GovernedModelRuntime` (or a
 * `governModelRuntime()` surface) — dispatching through a raw
 * `ModelRuntime` bypasses capability authority and is a caller violation
 * of the ADR 0036 boundary, not something this adapter can detect at the
 * type level (TS allows fewer-parameter assignability).
 */
export interface GovernedDispatchRuntime {
  generate(request: ModelRequest, context: GovernedInvocationContext): Promise<QuackResult<ModelResponse>>;
  stream?(request: ModelRequest, context: GovernedInvocationContext): AsyncIterable<ModelStreamChunk>;
}

/**
 * Adapt a composed instruction into the provider-neutral `ModelRequest`.
 *
 * Deterministic: identical composed instruction + options → byte-identical
 * prompt (the P8.1 rendered representation) and identical metadata. Fails
 * closed on: missing/invalid digest, missing mission/task identity, wrong
 * plan version, unknown output-contract kind, or an empty rendering.
 */
export function adaptComposedInstruction(
  composed: ComposedInstruction,
  options: GovernedInvocationOptions = {},
): QuackResult<ModelRequest> {
  const invalid = (message: string): QuackResult<ModelRequest> =>
    fail({ code: "instruction.adaptation_invalid", message, category: "validation", recoverable: true });

  if (!composed || typeof composed.missionId !== "string" || composed.missionId.length === 0) {
    return invalid("composed instruction requires a non-empty missionId");
  }
  if (typeof composed.digest !== "string" || !DIGEST_PATTERN.test(composed.digest)) {
    return invalid("composed instruction requires a valid sha256 instruction digest");
  }
  if (composed.planVersion !== INSTRUCTION_PLAN_VERSION) {
    return invalid(`unsupported instruction plan version ${String(composed.planVersion)}`);
  }
  if (!Array.isArray(composed.layers)) {
    return invalid("composed instruction requires a layers array");
  }
  const kind = composed.outputContract?.kind;
  if (typeof kind !== "string" || !OUTPUT_KINDS.has(kind)) {
    return invalid(`composed instruction requires a known output-contract kind (got ${String(kind)})`);
  }

  const prompt = renderComposedText(composed);
  if (typeof prompt !== "string" || prompt.length === 0) {
    return invalid("composed instruction rendered to an empty prompt");
  }

  // Identity metadata — the digest is PRESERVED, never regenerated here.
  const metadata: JsonObject = {
    governedInstruction: true,
    instructionDigest: composed.digest,
    instructionPlanVersion: composed.planVersion,
    missionId: composed.missionId,
    outputContractKind: kind,
    ...(composed.taskId ? { taskId: composed.taskId } : {}),
  };

  return ok({
    prompt,
    ...(options.model ? { model: options.model } : {}),
    ...(options.capability ? { capability: options.capability } : {}),
    metadata,
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
  });
}

/**
 * Dispatch a composed instruction through an existing governed runtime.
 * The instruction is first enforced by the P8.5 injection-defense boundary
 * (structural validation + digest correspondence; violations fail closed
 * and never reach the runtime), then validated, adapted, and sent with the
 * full execution context so `provider.invoke` authority (and
 * cancellation) is resolved by the governed layer before any provider
 * contact. The P8.1 digest travels in request metadata — instruction
 * identity is never mutated. Heuristic detection flags (defense-in-depth,
 * metadata-only) ride in request metadata under `injectionFlags`. No
 * fallback, no retry, no retrieval: a denial or provider error fails
 * closed with the existing `QuackResult` error semantics.
 *
 * P8.7: when `observer` is supplied, the dispatch outcome is observed
 * (event + P8.6 record) — `instruction.dispatched` on success,
 * `instruction.rejected` on defense/adaptation failure. Observation is
 * strictly after the dispatch decision and never changes it; the observed
 * record and event carry metadata only.
 */
export async function invokeGovernedInstruction(
  runtime: GovernedDispatchRuntime,
  composed: ComposedInstruction,
  context: GovernedInvocationContext,
  options: GovernedInvocationOptions = {},
  observer?: InstructionDispatchObserver,
): Promise<QuackResult<ModelResponse>> {
  if (!runtime || typeof runtime.generate !== "function") {
    return fail({
      code: "instruction.adaptation_invalid",
      message: "governed invocation requires a governed model runtime",
      category: "validation",
      recoverable: false,
    });
  }
  // P8.5: structural enforcement before adaptation/dispatch.
  const defense = enforceInstructionDefense(composed);
  if (!defense.ok) {
    await observer?.observeDispatch({
      composed,
      flags: [],
      outcome: "rejected",
      errorCode: defense.error?.code as import("./records.js").InstructionRecordErrorCode | undefined,
      actor: context.actor,
    }).catch(() => undefined);
    return fail(defense.error ?? {
      code: "instruction.defense_shape_invalid",
      message: "composed instruction failed injection-defense enforcement",
      category: "validation",
      recoverable: false,
    });
  }
  const adapted = adaptComposedInstruction(composed, options);
  if (!adapted.ok) {
    await observer?.observeDispatch({
      composed,
      flags: defense.flags,
      outcome: "rejected",
      errorCode: adapted.error?.code as import("./records.js").InstructionRecordErrorCode | undefined,
      actor: context.actor,
    }).catch(() => undefined);
    return adapted;
  }
  const flagsMetadata = flagsToMetadata(defense.flags);
  const request = flagsMetadata
    ? { ...adapted.data, metadata: { ...adapted.data.metadata, ...flagsMetadata } as JsonObject }
    : adapted.data;
  const result = await runtime.generate(request, context);
  // P8.7: observe the terminal outcome. `denied` = capability authority
  // refused before provider contact; `provider_error` = dispatched but the
  // governed runtime returned an error. Both remain observable failures
  // without changing the pass-through QuackResult semantics.
  if (observer) {
    const outcome = result.ok ? "dispatched"
      : result.error?.code === "model.permission_denied" ? "denied"
      : "provider_error";
    await observer.observeDispatch({
      composed,
      flags: defense.flags,
      outcome,
      ...(result.ok ? {} : { errorCode: "instruction.adaptation_invalid" as const }),
      actor: context.actor,
    }).catch(() => undefined);
  }
  return result;
}
