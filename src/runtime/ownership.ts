/**
 * Mission ownership over the SQLite coordination primitive (ADR 0031 lift).
 *
 * A durable mission execution is owned by exactly one process at a time:
 * `QuackRuntime.resumeMission` (and fresh durable runs) must acquire the
 * mission's coordination lease before touching durable state, must
 * heartbeat while executing, and must persist final state BEFORE releasing
 * — a stale process (crashed, lease expired, ownership taken over) is
 * fenced out of every durable write by an ownership epoch stamp.
 *
 * Scope: single-host multi-process ownership only (the coordination
 * primitive's scope). No distributed consensus, no HA claims.
 */
import { createId } from "../core/types.js";
import { SqliteConnection } from "../storage/sqlite.js";
import { SqliteCoordinationStore, type CoordinationLease } from "../storage/coordination.js";

export type OwnershipLifecycleState =
  | "UNOWNED"
  | "ACQUIRING"
  | "OWNED"
  | "HEARTBEATING"
  | "COMPLETING"
  | "RELEASED"
  | "OWNERSHIP_CONFLICT"
  | "LEASE_LOST"
  | "STALE_OWNER";

export type OwnershipFailureKind =
  | "OWNERSHIP_CONFLICT" // another live owner holds the lease
  | "LEASE_LOST"         // heartbeat found us no longer the owner
  | "STALE_OWNER";       // we know our epoch is outdated

export interface OwnershipSnapshot {
  readonly lifecycle: OwnershipLifecycleState;
  readonly missionId?: string;
  readonly owner?: string;
  /** Fencing epoch: equals the coordination lease version. */
  readonly epoch?: number;
  readonly leaseExpiresAt?: number;
  readonly failure?: OwnershipFailureKind;
}

export interface OwnershipEventPayload {
  readonly missionId: string;
  readonly owner?: string;
  /** Fencing epoch: equals the coordination lease version. */
  readonly epoch?: number;
  readonly lifecycle: OwnershipLifecycleState;
  readonly reason?: string;
}

/** Coordination resource id for a mission's ownership lease. */
export function missionLeaseId(missionId: string): string {
  return `mission:${missionId}`;
}

export interface MissionOwnershipOptions {
  /** Lease duration; heartbeat interval is leaseMs/3. Default 30s. */
  readonly leaseMs?: number;
  /** Process-unique owner identity (default: fresh id per guard). */
  readonly ownerId?: string;
  /** Emission sink for ownership.* observability events. */
  readonly emit?: (type: string, payload: OwnershipEventPayload) => void;
}

const DEFAULT_LEASE_MS = 30_000;

/**
 * Owns at most ONE mission at a time. The guard deliberately has no
 * re-acquire/reentrant logic: a released guard is spent, and a failed
 * acquisition leaves nothing behind (fail closed, no partial state).
 */
export class MissionOwnershipGuard {
  private readonly store: SqliteCoordinationStore;
  private readonly leaseMs: number;
  private readonly owner: string;
  private readonly emitEvent: MissionOwnershipOptions["emit"];
  private state: OwnershipLifecycleState = "UNOWNED";
  private missionId: string | undefined;
  private epoch: number | undefined;
  private leaseExpiresAt: number | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(
    connection: SqliteConnection,
    options: MissionOwnershipOptions = {},
  ) {
    this.store = new SqliteCoordinationStore(connection, { leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS });
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.owner = options.ownerId ?? createId("owner");
    this.emitEvent = options.emit;
  }

  get lifecycle(): OwnershipLifecycleState { return this.state; }
  get currentEpoch(): number | undefined { return this.epoch; }
  get currentMissionId(): string | undefined { return this.missionId; }
  get ownerId(): string { return this.owner; }

  snapshot(): OwnershipSnapshot {
    return {
      lifecycle: this.state,
      ...(this.missionId ? { missionId: this.missionId } : {}),
      ...(this.state === "OWNED" || this.state === "HEARTBEATING" || this.state === "COMPLETING"
        ? { owner: this.owner, epoch: this.epoch, leaseExpiresAt: this.leaseExpiresAt } : {}),
    };
  }

  /**
   * Atomically acquire the mission lease. Returns a discriminated result —
   * never throws for ownership outcomes; caller decides governance.
   */
  acquire(missionId: string): { readonly kind: "ACQUIRED" } | { readonly kind: "FAILED"; readonly failure: OwnershipFailureKind; readonly lease?: CoordinationLease } {
    if (this.closed) throw new Error("Ownership guard is closed.");
    if (this.state !== "UNOWNED") throw new Error(`Guard is not unowned (state: ${this.state}).`);
    this.state = "ACQUIRING";
    this.missionId = missionId;
    const outcome = this.store.acquire(missionLeaseId(missionId), this.owner);
    if (outcome.kind === "BUSY") {
      this.state = "OWNERSHIP_CONFLICT";
      this.emit("ownership.rejected", { missionId, owner: this.owner, lifecycle: this.state, reason: "live lease held by another owner" });
      return { kind: "FAILED", failure: "OWNERSHIP_CONFLICT", lease: outcome.lease };
    }
    // ACQUIRED (fresh/tombstone) or TAKEOVER_STALE (expired prior owner) —
    // both make this process the sole current owner.
    this.epoch = outcome.lease.version;
    this.leaseExpiresAt = outcome.lease.leaseExpiresAt;
    this.state = "OWNED";
    this.emit("ownership.acquired", {
      missionId, owner: this.owner, epoch: this.epoch, lifecycle: this.state,
      ...(outcome.kind === "TAKEOVER_STALE" ? { reason: "stale lease takeover" } : {}),
    });
    return { kind: "ACQUIRED" };
  }

  /** Start heartbeat renewal (leaseMs/3 interval, fail-closed on loss). */
  startHeartbeat(onLost?: (reason: string) => void): void {
    if (this.state !== "OWNED" && this.state !== "HEARTBEATING") throw new Error(`Cannot heartbeat from state ${this.state}.`);
    if (this.heartbeatTimer) return;
    this.state = "HEARTBEATING";
    const interval = Math.max(250, Math.floor(this.leaseMs / 3));
    this.heartbeatTimer = setInterval(() => {
      // Synchronous store op: SQLite busy_timeout covers contention, and a
      // synchronous check guarantees the flag flips before any later write.
      const renewed = this.checkOwnershipAlive();
      if (!renewed) {
        this.state = "LEASE_LOST";
        this.emit("ownership.lost", { missionId: this.missionId!, owner: this.owner, epoch: this.epoch, lifecycle: this.state, reason: "heartbeat renewal failed" });
        this.stopHeartbeatTimer();
        onLost?.("Mission lease was lost; durable writes are now fenced out.");
      }
    }, interval);
    // Heartbeat timer must never hold the process open on crash paths.
    this.heartbeatTimer.unref?.();
  }

  /** One explicit heartbeat/renewal (also used by tests). */
  heartbeat(): boolean {
    if (this.state !== "OWNED" && this.state !== "HEARTBEATING" && this.state !== "COMPLETING") return false;
    const renewed = this.checkOwnershipAlive();
    if (renewed) this.emit("ownership.heartbeat", { missionId: this.missionId!, owner: this.owner, epoch: this.epoch, lifecycle: "HEARTBEATING" });
    else {
      this.state = "LEASE_LOST";
      this.emit("ownership.lost", { missionId: this.missionId!, owner: this.owner, epoch: this.epoch, lifecycle: this.state, reason: "heartbeat rejected" });
    }
    return renewed;
  }

  private checkOwnershipAlive(): boolean {
    if (this.closed || this.state === "LEASE_LOST" || this.state === "STALE_OWNER") return false;
    const current = this.store.current(missionLeaseId(this.missionId!));
    if (!current || current.owner !== this.owner) return false;
    const renewed = this.store.heartbeat(missionLeaseId(this.missionId!), this.owner);
    if (renewed) this.leaseExpiresAt = current.leaseExpiresAt > this.leaseExpiresAt! ? current.leaseExpiresAt : this.leaseExpiresAt;
    return renewed;
  }

  /**
   * Guard a durable write: throws (fail closed) unless this guard is the
   * live owner of the exact epoch. Called by the runtime before every
   * ownership-sensitive durable state transition.
   */
  assertOwnedForWrite(operation: string): void {
    if (this.state === "STALE_OWNER" || this.state === "LEASE_LOST" || this.state === "OWNERSHIP_CONFLICT") {
      throw new Error(`Mission ownership lost — refusing durable ${operation} (state: ${this.state}).`);
    }
    if (this.state !== "OWNED" && this.state !== "HEARTBEATING" && this.state !== "COMPLETING") {
      throw new Error(`Mission not owned — refusing durable ${operation} (state: ${this.state}).`);
    }
    const current = this.store.current(missionLeaseId(this.missionId!));
    if (!current || current.owner !== this.owner || current.version !== this.epoch) {
      this.state = "STALE_OWNER";
      this.stopHeartbeatTimer();
      this.emit("ownership.lost", { missionId: this.missionId!, owner: this.owner, epoch: this.epoch, lifecycle: this.state, reason: "write fencing check failed" });
      throw new Error(`Mission ownership epoch is stale — refusing durable ${operation} (expected epoch ${this.epoch}, found ${current?.version}).`);
    }
  }

  /** Transition to COMPLETING: final persist phase; heartbeat continues. */
  beginCompleting(): void {
    if (this.state !== "OWNED" && this.state !== "HEARTBEATING") throw new Error(`Cannot complete from state ${this.state}.`);
    this.state = "COMPLETING";
  }

  /**
   * Release ownership AFTER the final durable persist. Tombstones the lease
   * (the coordination store keeps the fencing epoch monotonic) and marks
   * the guard spent. Safe to call from finally blocks; idempotent.
   */
  release(): void {
    if (this.heartbeatTimer) this.stopHeartbeatTimer();
    if (this.state === "RELEASED" || this.state === "UNOWNED") return;
    if (this.state === "OWNED" || this.state === "HEARTBEATING" || this.state === "COMPLETING") {
      // Best-effort release: a crashed process leaves a stale lease that
      // expiry + takeover handles; release() failures must not mask the
      // mission outcome.
      try { this.store.release(missionLeaseId(this.missionId!), this.owner); } catch { /* stale takeover will clean up */ }
      this.emit("ownership.released", { missionId: this.missionId!, owner: this.owner, epoch: this.epoch, lifecycle: "RELEASED" });
    }
    this.state = "RELEASED";
  }

  /** Terminal close: stop timers; a spent guard can never own again. */
  close(): void {
    this.release();
    this.closed = true;
  }

  private stopHeartbeatTimer(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined; }
  }

  private emit(type: string, payload: OwnershipEventPayload): void {
    try { this.emitEvent?.(type, payload); } catch { /* observability must not affect execution */ }
  }
}
