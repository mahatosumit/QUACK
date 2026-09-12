import { createId, type IsoTimestamp, type JsonObject, now } from "../core/types.js";

/** Discriminated union of all event types emitted across QUACK's lifecycle. */
export type QuackEventType =
  | "task.created"
  | "skill.selected"
  | "skill.loaded"
  | "skill.validated"
  | "skill.started"
  | "skill.completed"
  | "skill.failed"
  | "skill.package.imported"
  | "skill.package.validated"
  | "skill.package.enabled"
  | "skill.package.disabled"
  | "skill.package.rejected"
  | "task.planned"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "loop.started"
  | "loop.iteration"
  | "loop.action_selected"
  | "loop.completed"
  | "loop.failed"
  | "loop.wake.TOOL_COMPLETION"
  | "loop.wake.BACKGROUND_JOB_COMPLETION"
  | "loop.wake.PROVIDER_RECOVERED"
  | "loop.wake.APPROVAL_DECISION"
  | "loop.wake.CHILD_REPORT"
  | "loop.wake.FILE_CHANGE"
  | "loop.wake.GIT_STATUS_CHANGE"
  | "loop.wake.TEST_COMPLETION"
  | "loop.wake.EXTERNAL_WATCHED_CONDITION"
  | "loop.wake.TIMER_DEADLINE"
  | "loop.wake.HARNESS_HEALTH_CHANGE"
  | "loop.wake.BUDGET_WARNING"
  | "loop.wake.PARENT_FOLLOWUP"
  | "evaluation.started"
  | "evaluation.completed"
  | "trace.created"
  | "capability.requested"
  | "capability.checked"
  | "capability.allowed"
  | "capability.denied"
  | "capability.decided"
  | "permission.requested"
  | "permission.decided"
  | "tool.requested"
  | "tool.completed"
  | "provider.requested"
  | "provider.completed"
  | "memory.written"
  | "skill.compile.started"
  | "skill.compile.parsed"
  | "skill.compile.tool-resolved"
  | "skill.compile.validation-failed"
  | "skill.compile.completed"
  | "skill.compile.requires-clarification"
  | "skill.compile.rejected"
  | "skill.compile.promoted"
  | "improvement.cycle.started"
  | "improvement.cycle.completed"
  | "experiment.queued"
  | "experiment.completed"
  | "workflow.created"
  | "workflow.started"
  | "workflow.completed"
  | "workflow.failed"
  | "workflow.paused"
  | "workflow.resumed"
  | "workflow.cancelled"
  | "node.created"
  | "node.ready"
  | "node.started"
  | "node.completed"
  | "node.failed"
  | "node.skipped"
  | "node.retrying"
  | "node.paused"
  | "reflect.started"
  | "reflect.completed"
  | "recovery.started"
  | "recovery.completed"
  | "checkpoint.created"
  | "checkpoint.restored"
  | "journal.written"
  | "session.created"
  | "session.ended"
  | "session.paused"
  | "session.resumed"
  | "session.snapshot"
  | "session.undo"
  | "session.redo"
  | "code.change.proposed"
  | "code.worktree.created"
  | "code.worktree.cleanup_failed"
  | "code.patch.generated"
  | "code.verification.started"
  | "code.verification.completed"
  | "code.change.eligible"
  | "code.change.rejected"
  | "code.change.awaiting_human"
  | "code.change.approved"
  | "code.change.promoting"
  | "code.change.promoted"
  | "code.change.revalidation_required"
  | "code.change.rejected"
  | "code.change.rolled_back"
  | "code.change.rollback_failed"
  | "improvement.eligibility_checked"
  | "improvement.skipped"
  | "improvement.started"
  | "improvement.completed"
  | "improvement.failed"
  | "proposal.created"
  | "proposal.awaiting_approval"
  | "harness.execution.completed"
    | "harness.authorization"
    | "harness.registered"
    | "harness.unregistered"
  /** Phase 5 multi-process ownership lifecycle (ADR 0031 lift). */
  | "ownership.acquired"
  | "ownership.rejected"
  | "ownership.heartbeat"
  | "ownership.lost"
  | "ownership.released"
  /** Phase 5 mission-level operational events. */
  | "mission.started"
  | "mission.resumed"
  | "mission.completed"
  | "mission.failed"
  | "mission.cancelled"
  | "mission.recovery_started"
  | "mission.recovery_completed"
  /** P1 human-approval queue events (Approval Center contract). */
  | "approval.requested"
  | "approval.decided"
  /** P4 governed model streaming chunks (broker-gated per call, redacted at the wire). */
  | "model.stream.chunk"
  /** P8.7 instruction observability (metadata-only; ADR 0042). */
  | "instruction.dispatched"
  | "instruction.rejected"
  /** P9 semantic-memory observability (metadata-only; ADR 0043). */
  | "memory.admitted"
  | "memory.rejected"
  | "memory.persisted"
  | "memory.embedding.requested"
  | "memory.embedding.completed"
  | "memory.embedding.failed"
  | "memory.indexed"
  | "memory.retrieved"
  | "memory.deleted"
  | "memory.compacted"
  /** P10 ecosystem observability (metadata-only; ADR 0044). */
  | "extension.discovered"
  | "extension.validated"
  | "extension.admitted"
  | "extension.installed"
  | "extension.enabled"
  | "extension.disabled"
  | "extension.quarantined"
  | "extension.removed"
  | "extension.rejected"
  /** P11 governed mission loop observability (metadata-only; ADR 0045). */
  | "mission.step.started"
  | "mission.step.completed"
  | "mission.step.failed"
  | "mission.action.proposed"
  | "mission.action.denied"
  | "mission.action.completed"
  | "mission.action.failed";
/** A structured event emitted by {@link EventBus} with typed metadata and payload. */
export interface QuackEvent<TPayload extends JsonObject = JsonObject> {
  readonly id: string;
  readonly type: QuackEventType;
  readonly timestamp: IsoTimestamp;
  readonly taskId?: string;
  readonly actor: string;
  readonly payload: TPayload;
}

/** A function that handles a {@link QuackEvent}, synchronously or asynchronously. */
export type EventHandler<TPayload extends JsonObject = JsonObject> = (
  event: QuackEvent<TPayload>,
) => void | Promise<void>;

/** Lightweight pub/sub event bus. Supports typed per-type handlers and catch-all listeners. */
export class EventBus {
  private readonly handlers = new Map<QuackEventType, Set<EventHandler>>();
  private readonly allHandlers = new Set<EventHandler>();
  private readonly pendingEmits = new Set<Promise<void>>();

  on(type: QuackEventType, handler: EventHandler): () => void {
    const handlers = this.handlers.get(type) ?? new Set<EventHandler>();
    handlers.add(handler);
    this.handlers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  onAny(handler: EventHandler): () => void {
    this.allHandlers.add(handler);
    return () => this.allHandlers.delete(handler);
  }

  async emit<TPayload extends JsonObject>(
    type: QuackEventType,
    payload: TPayload,
    options: { readonly taskId?: string; readonly actor?: string } = {},
  ): Promise<QuackEvent<TPayload>> {
    const event: QuackEvent<TPayload> = {
      id: createId("event"),
      type,
      timestamp: now(),
      taskId: options.taskId,
      actor: options.actor ?? "runtime",
      payload,
    };

    const handlers = [...(this.handlers.get(type) ?? []), ...this.allHandlers];
    const dispatch = Promise.all(handlers.map((handler) => handler(event))).then(() => undefined);
    this.pendingEmits.add(dispatch);
    try {
      await dispatch;
    } finally {
      this.pendingEmits.delete(dispatch);
    }
    return event;
  }

  /** Wait for already-dispatched asynchronous listeners, primarily for controlled shutdown and test teardown. */
  async drain(): Promise<void> {
    while (this.pendingEmits.size > 0) {
      await Promise.all([...this.pendingEmits]);
    }
  }
}

