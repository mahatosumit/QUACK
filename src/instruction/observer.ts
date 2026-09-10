import { createId, now, type IsoTimestamp, type JsonObject } from "../core/types.js";
import { type EventBus } from "../events/event-bus.js";
import { type GovernedInstructionRecord, type InstructionDispatchOutcome, type InstructionRecordErrorCode, buildInstructionRecord } from "./records.js";
import { type ComposedInstruction } from "./types.js";
import { type InjectionFlag } from "./injection-defense.js";

/**
 * P8.7 instruction observability (ADR 0042).
 *
 * `InstructionObserver` is the seam between QIE dispatches and QUACK's
 * existing observability machinery — it introduces NO second event system:
 *
 * - it emits `instruction.dispatched` / `instruction.rejected` on the
 *   EXISTING EventBus (so every existing surface — SSE `/events` clients,
 *   audit feeds, dashboards — sees instruction telemetry exactly like any
 *   other runtime event),
 * - it builds the P8.6 metadata-only `GovernedInstructionRecord` for the
 *   durable trace (attached by callers to `MissionTrace.instruction`),
 * - and it reports record counts on demand for dashboard state aggregation.
 *
 * Event payloads are METADATA-ONLY (identity, census counts, outcome,
 * flag counts) — never item data, never prompt text, never matched
 * injection content. The record itself is the same metadata-only object
 * P8.6 defined; the observer never widens it.
 */

/** Event sink QIE requires — the existing EventBus satisfies this structurally. */
export interface InstructionEventSink {
  emit(type: "instruction.dispatched" | "instruction.rejected", payload: JsonObject, options?: { readonly taskId?: string; readonly actor?: string }): Promise<unknown>;
}

/** Result of one observed dispatch. */
export interface ObservedDispatch {
  readonly record: GovernedInstructionRecord;
  /** Event emission errors are captured, never thrown — observability never breaks dispatch. */
  readonly eventEmitted: boolean;
}

export class InstructionObserver {
  private readonly recent: GovernedInstructionRecord[] = [];

  constructor(private readonly options: {
    readonly events?: InstructionEventSink | EventBus;
    /** Cap on retained recent records (default 200) — bounded memory, deterministic eviction. */
    readonly recentLimit?: number;
  } = {}) {}

  /**
   * Observe one dispatch outcome and emit the corresponding event. Pure
   * with respect to the dispatch decision — the record is BUILT from the
   * composed instruction + defense flags; nothing about the dispatch is
   * changed by observation. Event emission failure is swallowed (logged
   * via `eventEmitted: false`) so observability can never fail a governed
   * dispatch.
   */
  async observeDispatch(input: {
    readonly composed: ComposedInstruction;
    readonly flags: readonly InjectionFlag[];
    readonly outcome: InstructionDispatchOutcome;
    readonly errorCode?: InstructionRecordErrorCode;
    readonly dispatchedAt?: IsoTimestamp;
    readonly actor?: string;
  }): Promise<ObservedDispatch> {
    const dispatchedAt = input.dispatchedAt ?? now();
    const record = buildInstructionRecord({
      composed: input.composed,
      flags: input.flags,
      outcome: input.outcome,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      recordId: createId("instruction-dispatch"),
      dispatchedAt,
    });

    this.recent.push(record);
    const limit = this.options.recentLimit ?? 200;
    if (this.recent.length > limit) this.recent.splice(0, this.recent.length - limit);

    const eventType = input.outcome === "dispatched" ? "instruction.dispatched" : "instruction.rejected";
    const payload: JsonObject = {
      recordId: record.recordId,
      missionId: record.missionId,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      digest: record.digest,
      outcome: record.outcome,
      ...(record.errorCode ? { errorCode: record.errorCode } : {}),
      totalItems: record.totalItems,
      omittedItemCount: record.omittedItemCount,
      injectionFlagCount: record.injectionFlagCount,
    };

    let eventEmitted = false;
    try {
      await this.options.events?.emit(eventType, payload, {
        ...(record.taskId ? { taskId: record.taskId } : {}),
        actor: input.actor ?? "instruction",
      });
      eventEmitted = true;
    } catch {
      eventEmitted = false;
    }

    return { record, eventEmitted };
  }

  /** Records retained in this observer (most recent last). Metadata-only. */
  getRecentRecords(): readonly GovernedInstructionRecord[] {
    return [...this.recent];
  }

  /** Aggregate counts for dashboard state — metadata only. */
  summary(): InstructionObservationSummary {
    const dispatched = this.recent.filter((record) => record.outcome === "dispatched").length;
    const rejected = this.recent.filter((record) => record.outcome === "rejected").length;
    const injectionFlags = this.recent.reduce((total, record) => total + record.injectionFlagCount, 0);
    return {
      observedDispatches: this.recent.length,
      dispatched,
      rejected,
      injectionFlagCount: injectionFlags,
    };
  }
}

/** Metadata-only aggregate for dashboard state. */
export interface InstructionObservationSummary {
  readonly observedDispatches: number;
  readonly dispatched: number;
  readonly rejected: number;
  readonly injectionFlagCount: number;
}

/** Serializable summary view (JsonObject-compatible). */
export function summaryToJsonObject(summary: InstructionObservationSummary): JsonObject {
  return { ...summary };
}
