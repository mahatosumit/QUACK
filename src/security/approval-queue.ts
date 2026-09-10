import { createId, type IsoTimestamp, type JsonObject } from "../core/types.js";
import type { EventBus } from "../events/event-bus.js";
import type { ApprovalCallback } from "./approval-controller.js";

/**
 * A human-approval request parked in the queue (P1 Approval Center contract).
 *
 * Requests enter via the canonical ApprovalCallback seam
 * (RiskAwareApprovalPolicy / action approval) and stay PENDING until a human
 * decides through the Mission API (CLI, Studio, or SDK) — the surfaces can
 * only *submit decisions*; they can never grant capabilities themselves.
 */
export interface PendingApproval {
  readonly id: string;
  readonly prompt: string;
  readonly context: JsonObject;
  readonly requestedAt: IsoTimestamp;
  /** Monotonic expiry deadline; expired requests resolve as DENIED. */
  readonly expiresAt: IsoTimestamp;
  state: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";
}

export interface ApprovalDecision {
  readonly id: string;
  readonly approved: boolean;
  readonly decidedBy: string;
  readonly decidedAt: IsoTimestamp;
  readonly reason: string;
}

const DEFAULT_TTL_MS = 15 * 60_000; // 15 minutes

/**
 * Queue-backed ApprovalCallback: parks medium/high-risk decisions until a
 * human resolves them through the Mission API, instead of blocking on stdin.
 *
 * Semantics:
 * - requestApproval() enqueues a PENDING record, emits `approval.requested`
 *   on the runtime EventBus, and returns a promise that stays pending until
 *   decide() (or expiry, checked at decision time) resolves it.
 * - decide() resolves the parked promise, emits `approval.decided`, and
 *   emits `loop.wake.APPROVAL_DECISION` so any loop yielded on approval can
 *   resume — the existing wake path, not a new one.
 * - Deny-on-expiry is evaluated lazily on decide() and eagerly on snapshot
 *   reads; an expired request never approves.
 * - The queue is per-system instance, in-process. It is a *callback
 *   implementation*, not a second permission system: all risk assessment and
 *   allow-list authority stay in RiskAwareApprovalPolicy; the queue only
 *   holds the human's answer.
 */
export class QueuedApprovalCallback implements ApprovalCallback {
  private events?: EventBus;
  private readonly ttlMs: number;
  private readonly pending = new Map<string, PendingApproval>();
  private readonly resolvers = new Map<string, (approved: boolean) => void>();

  constructor(options: { events?: EventBus; ttlMs?: number } = {}) {
    this.events = options.events;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Bind the composition root's bus; the queue is usually built before it exists. */
  attach(events: EventBus): void {
    this.events = events;
  }

  async requestApproval(prompt: string, context: JsonObject): Promise<boolean> {
    const id = createId("approval");
    const now = new Date();
    const request: PendingApproval = {
      id,
      prompt,
      context,
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
      state: "PENDING",
    };
    this.pending.set(id, request);
    // ponytail: unbounded queue is a memory ceiling only a hostile local
    // actor can push; keep a hard cap and drop (deny) beyond it.
    if (this.pending.size > 1000) {
      this.pending.delete(id);
      return false;
    }
    // Park synchronously BEFORE the first await: a decide() arriving in the
    // same tick must find the resolver registered.
    return new Promise<boolean>((resolve) => {
      this.resolvers.set(id, resolve);
      void this.events?.emit("approval.requested", { ...request } as unknown as JsonObject, { actor: "runtime" })
        .then(() => undefined, () => undefined);
    });
  }

  /** Human decision via the Mission API. Fails closed on unknown/expired/tampered ids. */
  async decide(id: string, decision: { approved: boolean; decidedBy: string; reason?: string }): Promise<QuackResultLike<ApprovalDecision>> {
    const request = this.pending.get(id);
    if (!request || request.state !== "PENDING") {
      return { ok: false as const, error: { code: "approval.not_pending", message: "No pending approval with that id." } };
    }
    const nowIso = new Date().toISOString();
    if (request.expiresAt <= nowIso) {
      request.state = "EXPIRED";
      this.resolvers.get(id)?.(false);
      this.resolvers.delete(id);
      await this.events?.emit("approval.decided", { id, approved: false, decidedBy: "system", decidedAt: nowIso, reason: "expired" } as unknown as JsonObject);
      return { ok: false as const, error: { code: "approval.expired", message: "Approval request expired; the action was denied." } };
    }
    request.state = decision.approved ? "APPROVED" : "DENIED";
    const outcome: ApprovalDecision = {
      id,
      approved: decision.approved,
      decidedBy: decision.decidedBy,
      decidedAt: nowIso,
      reason: decision.reason ?? (decision.approved ? "Approved by human operator." : "Denied by human operator."),
    };
    this.resolvers.get(id)?.(decision.approved);
    this.resolvers.delete(id);
    await this.events?.emit("approval.decided", { ...outcome } as unknown as JsonObject, { actor: decision.decidedBy });
    // Wake any loop that yielded for this decision — the existing wake path.
    await this.events?.emit("loop.wake.APPROVAL_DECISION", { source: "approval-queue", missionId: String(request.context["missionId"] ?? ""), runId: id, timestamp: nowIso, payload: { approvalId: id, approved: decision.approved } } as unknown as JsonObject, { actor: decision.decidedBy });
    return { ok: true as const, data: outcome };
  }

  /** Snapshot for the Approval Center view; lazily expires stale entries. */
  list(): readonly PendingApproval[] {
    const nowIso = new Date().toISOString();
    for (const request of this.pending.values()) {
      if (request.state === "PENDING" && request.expiresAt <= nowIso) request.state = "EXPIRED";
    }
    return [...this.pending.values()].filter((request) => request.state === "PENDING" || request.state === "EXPIRED");
  }
}

type QuackResultLike<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };
