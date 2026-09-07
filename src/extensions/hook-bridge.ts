import type { EventBus, QuackEvent, QuackEventType } from "../events/event-bus.js";
import type { CapabilityBroker } from "../security/capability-broker.js";
import type { JsonObject } from "../core/types.js";
import { GovernedHookExecutor, type GovernedHook, type HookDispatchContext, type HookDispatchRecord } from "./hooks.js";
import type { PluginHookKind } from "./types.js";

/**
 * Runtime hook bridge (ADR 0037): wires canonical runtime events to admitted
 * plugin hooks through the governed executor. Hooks remain observers — the
 * bridge converts an event into a frozen payload and dispatches matching
 * hooks; hook results never mutate runtime state. Every dispatch is governed
 * by the capability broker and recorded as a dispatch record.
 */
export interface HookWiring {
  readonly event: QuackEventType;
  readonly hookKind: PluginHookKind;
}

/** Canonical runtime events that map onto plugin hook kinds. */
export const CANONICAL_HOOK_WIRINGS: readonly HookWiring[] = [
  { event: "task.created", hookKind: "mission" },
  { event: "task.started", hookKind: "mission" },
  { event: "task.completed", hookKind: "mission" },
  { event: "task.failed", hookKind: "mission" },
  { event: "tool.requested", hookKind: "tool" },
  { event: "tool.completed", hookKind: "tool" },
  { event: "capability.decided", hookKind: "capability" },
  { event: "memory.written", hookKind: "memory" },
];

export interface RuntimeHookBridgeOptions {
  readonly eventBus: EventBus;
  readonly capabilityBroker: CapabilityBroker;
  /** Admitted hooks to dispatch; registration order is preserved. */
  readonly hooks: readonly GovernedHook[];
  readonly wirings?: readonly HookWiring[];
  readonly actor?: string;
  readonly onDispatchRecord?: (record: HookDispatchRecord) => void;
  readonly timeoutMs?: number;
}

export class RuntimeHookBridge {
  private readonly executor: GovernedHookExecutor;
  private readonly unsubscribe: () => void;
  private readonly records: HookDispatchRecord[] = [];

  constructor(private readonly options: RuntimeHookBridgeOptions) {
    this.executor = new GovernedHookExecutor(options.capabilityBroker, { timeoutMs: options.timeoutMs });
    const offs = (options.wirings ?? CANONICAL_HOOK_WIRINGS).map(wiring =>
      options.eventBus.on(wiring.event, event => this.dispatchEvent(wiring, event)));
    this.unsubscribe = () => { for (const off of offs) off(); };
  }

  private async dispatchEvent(wiring: HookWiring, event: QuackEvent): Promise<void> {
    const context: HookDispatchContext = {
      missionId: str(event.payload["missionId"]),
      taskId: event.taskId ?? str(event.payload["taskId"]),
      actor: this.options.actor ?? event.actor ?? "runtime",
    };
    for (const hook of this.options.hooks) {
      if (hook.kind !== wiring.hookKind) continue;
      const record = await this.executor.dispatch(hook, event.payload as JsonObject, context);
      this.records.push(record);
      this.options.onDispatchRecord?.(record);
    }
  }

  /** Dispatch records captured so far (audit surface). */
  listRecords(): readonly HookDispatchRecord[] {
    return [...this.records];
  }

  stop(): void {
    this.unsubscribe();
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}