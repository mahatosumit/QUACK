import { createId, now, type IsoTimestamp, type JsonObject, type QuackResult, fail, ok } from "../core/types.js";
import { buildToolCapabilityRequest, type CapabilityBroker, type CapabilityRequest } from "../security/capability-broker.js";
import type { Permission } from "../security/permissions.js";
import type { PluginHookContribution, PluginHookKind } from "./types.js";

/**
 * Governed plugin hook execution (ADR 0034).
 *
 * Hooks are frozen observers of runtime events, not actors: they receive a
 * frozen event payload and return void. They never receive host APIs,
 * registries, brokers, or authority. A hook executes only when the plugin's
 * declared manifest permissions resolve through the capability broker for
 * the current mission context (admission → policy → capability attenuation
 * → governed execution), and its outcome is recorded as a dispatch record
 * with provenance. Timeouts, cancellation, handler failure, and authority
 * denial produce deterministic FAILED records and never crash the host.
 */
export interface HookDispatchRecord {
  readonly hookId: string;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly kind: PluginHookKind;
  readonly missionId: string | null;
  readonly taskId: string | null;
  readonly actor: string;
  readonly dispatchedAt: IsoTimestamp;
  readonly durationMs: number;
  readonly status: "EXECUTED" | "DENIED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  readonly reason: string;
}

export interface HookDispatchContext {
  readonly missionId?: string;
  readonly taskId?: string;
  readonly agentId?: string;
  readonly skillId?: string;
  readonly actor?: string;
  readonly signal?: AbortSignal;
  readonly deadline?: IsoTimestamp;
}

export interface GovernedHook {
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly kind: PluginHookKind;
  readonly permissions: readonly Permission[];
  readonly handler: (event: Readonly<JsonObject>) => Promise<void> | void;
}

export interface GovernedHookExecutorOptions {
  readonly timeoutMs?: number;
}

const DEFAULT_HOOK_TIMEOUT_MS = 5_000;

export class GovernedHookExecutor {
  private readonly timeoutMs: number;

  constructor(
    private readonly capabilityBroker: CapabilityBroker,
    options: GovernedHookExecutorOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  }

  /**
   * Execute one admitted plugin hook under governed authority. The hook runs
   * only when every manifest-declared permission resolves through the
   * capability broker for the current execution context; denial fails closed
   * before the handler is contacted.
   */
  async dispatch(hook: GovernedHook, event: JsonObject, context: HookDispatchContext = {}): Promise<HookDispatchRecord> {
    const actor = context.actor ?? "runtime";
    const dispatchedAt = now();
    const started = Date.now();
    const base = { hookId: `${hook.pluginId}:${hook.kind}`, pluginId: hook.pluginId, pluginVersion: hook.pluginVersion,
      kind: hook.kind, missionId: context.missionId ?? null, taskId: context.taskId ?? null, actor, dispatchedAt };
    const finish = (status: HookDispatchRecord["status"], reason: string): HookDispatchRecord =>
      ({ ...base, durationMs: Date.now() - started, status, reason });

    if (context.signal?.aborted) return finish("CANCELLED", "Hook dispatch was cancelled before execution.");
    if (context.deadline && (!Number.isFinite(Date.parse(context.deadline)) || Date.now() >= Date.parse(context.deadline))) {
      return finish("CANCELLED", "Hook dispatch deadline expired before execution.");
    }

    for (const permission of hook.permissions) {
      const request: CapabilityRequest = buildToolCapabilityRequest({
        taskId: context.taskId,
        missionId: context.missionId,
        agentId: context.agentId,
        skillId: context.skillId,
        actor,
        toolId: `plugin:${hook.pluginId}:${hook.kind}`,
        permission,
        input: { kind: hook.kind },
        reason: `Plugin ${hook.pluginId} hook ${hook.kind} requires ${permission}.`,
      });
      const decision = await this.capabilityBroker.resolve(request);
      if (!decision.granted) return finish("DENIED", decision.reason);
    }

    const frozen = deepFreeze(event);
    try {
      await withTimeout(Promise.resolve(hook.handler(frozen)), this.timeoutMs, context.signal);
      return finish("EXECUTED", "Plugin hook executed.");
    } catch (error) {
      if (context.signal?.aborted) return finish("CANCELLED", "Plugin hook was cancelled.");
      const message = error instanceof Error ? error.message : String(error);
      if (/timed out|timeout/i.test(message)) return finish("TIMED_OUT", `Plugin hook timed out after ${this.timeoutMs}ms.`);
      return finish("FAILED", message);
    }
  }

  /** Execute all hooks of a kind, deterministically in registration order. */
  async dispatchAll(hooks: readonly GovernedHook[], kind: PluginHookKind, event: JsonObject, context: HookDispatchContext = {}): Promise<readonly HookDispatchRecord[]> {
    const records: HookDispatchRecord[] = [];
    for (const hook of hooks) {
      if (hook.kind !== kind) continue;
      records.push(await this.dispatch(hook, event, context));
    }
    return records;
  }
}

function withTimeout(operation: Promise<void>, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Plugin hook timed out after ${timeoutMs}ms.`)), timeoutMs);
    const abort = () => { clearTimeout(timer); reject(new Error("Plugin hook was cancelled.")); };
    signal?.addEventListener("abort", abort, { once: true });
    operation.then(() => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(); },
      (error) => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); });
  });
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze)) as unknown as T;
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key]);
    return Object.freeze(value);
  }
  return value;
}

/**
 * Validate an admitted hook contribution shape. Admission calls this before
 * storing hooks; malformed hooks fail closed at admission time.
 */
export function validateHookContribution(value: PluginHookContribution, pluginId: string): QuackResult<GovernedHook> {
  const kinds: readonly PluginHookKind[] = ["runtime", "mission", "session", "model", "tool", "capability", "evidence", "memory", "evaluation"];
  if (!value || typeof value !== "object" || !kinds.includes(value.kind)) {
    return fail({ code: "extension.invalid", message: `Plugin ${pluginId} declares an invalid hook kind.`, category: "validation", recoverable: false });
  }
  if (typeof value.handler !== "function") {
    return fail({ code: "extension.invalid", message: `Plugin ${pluginId} hook ${value.kind} must provide a function handler.`, category: "validation", recoverable: false });
  }
  return ok({ pluginId, pluginVersion: "", kind: value.kind, permissions: [], handler: value.handler });
}

export function hookDispatchEventId(): string {
  return createId("hook-event");
}