/**
 * Single-host multi-process coordination over SQLite (ADR 0031 prerequisite).
 *
 * Provides the atomic owner + lease + version (fencing) primitive the JSON
 * recovery stores cannot implement on their own: claims, heartbeat
 * renewal, crash-safe stale takeover, and stale-writer rejection via
 * version fencing. All ownership decisions execute inside `begin immediate`
 * transactions so exactly one competing process can change lease state at
 * a time; a claim is the transaction's single atomic step.
 *
 * Scope: SINGLE-HOST multi-process coordination only. No distributed or
 * high-availability guarantees are claimed: no cross-host fencing, no
 * clock synchronization beyond wall-clock lease expiry, and no protection
 * against a host that loses contact with its own disk.
 *
 * The JSON recovery stores are NOT rewired onto this layer by this module;
 * per ADR 0031 that remains a separate, deliberate migration decision.
 */
import { createId, now, type IsoTimestamp } from "../core/types.js";
import { SqliteConnection } from "./sqlite.js";

export interface CoordinationLease {
  readonly resourceId: string;
  readonly owner: string;
  readonly leaseExpiresAt: number;
  /** Fencing token: monotonic per resource; stale writers carry an old one. */
  readonly version: number;
  readonly acquiredAt: number;
}

export type AcquireOutcome =
  | { readonly kind: "ACQUIRED"; readonly lease: CoordinationLease }
  | { readonly kind: "BUSY"; readonly lease: CoordinationLease }
  | { readonly kind: "TAKEOVER_STALE"; readonly lease: CoordinationLease };

export interface WriteFencedOutcome {
  readonly kind: "WRITTEN" | "STALE_OWNER" | "NOT_OWNER";
  readonly lease?: CoordinationLease;
}

export interface CoordinationLeaseOptions {
  /** Lease duration in ms; heartbeat within this window keeps ownership. */
  readonly leaseMs: number;
}

const DEFAULT_LEASE_MS = 30_000;

/** Wall-clock ms since epoch; the same clock every process uses per host. */
function clockNowMs(): number {
  return Date.now();
}

/**
 * SQLite-backed coordination lease store. Each operation opens its own
 * connection (matching `SqliteConnection.withDatabase` semantics), so a
 * crash between operations leaves at worst an unexpired lease that later
 * becomes stale and takeable — never a half-applied claim.
 */
export class SqliteCoordinationStore {
  constructor(
    private readonly connection: SqliteConnection,
    private readonly options: CoordinationLeaseOptions = { leaseMs: DEFAULT_LEASE_MS },
  ) {}

  /**
   * Atomically acquire ownership of `resourceId` when it is free or its
   * lease has expired. A live lease held by another owner returns BUSY
   * (fail-closed for the caller). Re-claiming your own live lease is
   * idempotent and returns it unchanged. Taking over a stale lease bumps
   * the version so the old owner's subsequent writes are fenced out.
   */
  acquire(resourceId: string, owner: string): AcquireOutcome {
    const leaseMs = this.options.leaseMs;
    return this.connection.withDatabase((database) => {
      database.exec("begin immediate");
      try {
        const existing = readLease(database, resourceId);
        const nowMs = clockNowMs();

        if (existing && existing.owner === owner && existing.leaseExpiresAt > nowMs) {
          database.exec("rollback");
          return { kind: "ACQUIRED", lease: existing };
        }

        if (existing && existing.leaseExpiresAt > nowMs) {
          database.exec("rollback");
          return { kind: "BUSY", lease: existing };
        }

        // Free, released (tombstone), or stale: claim atomically. Version
        // increments on every ownership change so an old owner's fenced
        // writes must match the version it was granted, which any change
        // invalidated. A fresh claim after release is ACQUIRED (nobody
        // lost ownership); a claim over an expired lease is TAKEOVER_STALE.
        const version = existing ? existing.version + 1 : 1;
        const expiresAt = nowMs + leaseMs;
        database.prepare(
          "insert or replace into coordination_leases (resource_id, owner, lease_expires_at, version, acquired_at, payload) values (?, ?, ?, ?, ?, null)",
        ).run(resourceId, owner, expiresAt, version, nowMs);
        database.exec("commit");
        const lease: CoordinationLease = {
          resourceId, owner, leaseExpiresAt: expiresAt, version, acquiredAt: nowMs,
        };
        const kind = existing === undefined || existing.owner === ""
          ? "ACQUIRED" // fresh resource or released tombstone
          : "TAKEOVER_STALE"; // expired lease of a real prior owner
        return { kind, lease } as AcquireOutcome;
      } catch (error) {
        database.exec("rollback");
        throw error;
      }
    });
  }

  /**
   * Current owner extends its lease. Returns false (and changes nothing)
   * when the caller is not the current owner or the lease already expired
   * — the caller must re-acquire; an expired lease cannot be resurrected
   * by heartbeat.
   */
  heartbeat(resourceId: string, owner: string): boolean {
    return this.connection.withDatabase((database) => {
      database.exec("begin immediate");
      try {
        const nowMs = clockNowMs();
        const changed = database.prepare(
          "update coordination_leases set lease_expires_at = ? where resource_id = ? and owner = ? and lease_expires_at > ?",
        ).run(nowMs + this.options.leaseMs, resourceId, owner, nowMs);
        const renewed = changedReturn(changed) === 1;
        database.exec("commit");
        return renewed;
      } catch (error) {
        database.exec("rollback");
        throw error;
      }
    });
  }

  /**
   * Owner releases explicitly. The row is kept as a tombstone (empty
   * owner, zero expiry) so the fencing version stays MONOTONIC across
   * ownership epochs: a new owner never receives a version an old owner
   * already held. `current()` reports the tombstone with a zero expiry.
   */
  release(resourceId: string, owner: string): boolean {
    return this.connection.withDatabase((database) => {
      database.exec("begin immediate");
      try {
        const changed = database.prepare(
          "update coordination_leases set owner = '', lease_expires_at = 0, payload = null where resource_id = ? and owner = ?",
        ).run(resourceId, owner);
        const released = changedReturn(changed) === 1;
        database.exec("commit");
        return released;
      } catch (error) {
        database.exec("rollback");
        throw error;
      }
    });
  }

  /** Read current lease state (any process, any time). */
  current(resourceId: string): CoordinationLease | undefined {
    return this.connection.withDatabase((database) => readLease(database, resourceId));
  }

  /**
   * Version-fenced write of a JSON payload: succeeds only for the current
   * owner holding the exact version it was granted. After takeover bumps
   * the version, an old owner's write is rejected (STALE_OWNER); a caller
   * that never owned sees NOT_OWNER. This is the stale-writer guard.
   */
  writeFenced(resourceId: string, owner: string, version: number, payload: unknown): WriteFencedOutcome {
    return this.connection.withDatabase((database) => {
      database.exec("begin immediate");
      try {
        const existing = readLease(database, resourceId);
        if (!existing) {
          database.exec("rollback");
          return { kind: "NOT_OWNER" };
        }
        if (existing.owner !== owner) {
          database.exec("rollback");
          return { kind: "STALE_OWNER", lease: existing };
        }
        if (existing.version !== version) {
          database.exec("rollback");
          return { kind: "STALE_OWNER", lease: existing };
        }
        const nowMs = clockNowMs();
        if (existing.leaseExpiresAt <= nowMs) {
          // Lease expired but no takeover yet: owner must re-acquire.
          database.exec("rollback");
          return { kind: "STALE_OWNER", lease: existing };
        }
        const changed = database.prepare(
          "update coordination_leases set payload = ? where resource_id = ? and owner = ? and version = ?",
        ).run(JSON.stringify(payload), resourceId, owner, version);
        if (changedReturn(changed) !== 1) {
          database.exec("rollback");
          return { kind: "STALE_OWNER", lease: existing };
        }
        database.exec("commit");
        return { kind: "WRITTEN", lease: existing };
      } catch (error) {
        database.exec("rollback");
        throw error;
      }
    });
  }

  /** Read the fenced payload (any process). */
  readPayload(resourceId: string): unknown {
    return this.connection.withDatabase((database) => {
      const row = database.prepare("select payload from coordination_leases where resource_id = ?").get(resourceId);
      const payload = row?.["payload"];
      return typeof payload === "string" ? JSON.parse(payload) : undefined;
    });
  }
}

/** Fresh owner identity for tests and future recovery wiring. */
export function newLeaseOwner(): string {
  return createId("lease-owner");
}

/** Audit helper: timestamp for lease events. */
export function leaseEventTimestamp(): IsoTimestamp {
  return now();
}

function readLease(database: LeaseDatabase, resourceId: string): CoordinationLease | undefined {
  const row = database.prepare(
    "select owner, lease_expires_at, version, acquired_at from coordination_leases where resource_id = ?",
  ).get(resourceId);
  if (!row) return undefined;
  return {
    resourceId,
    owner: String(row["owner"]),
    leaseExpiresAt: Number(row["lease_expires_at"]),
    version: Number(row["version"]),
    acquiredAt: Number(row["acquired_at"]),
  };
}

interface LeaseDatabase {
  exec(sql: string): void;
  prepare(sql: string): { get(...params: unknown[]): Record<string, unknown> | undefined };
}

/** node:sqlite run() return shape (changes) across supported versions. */
function changedReturn(changed: unknown): number {
  if (typeof changed === "number") return changed;
  const record = changed as { changes?: unknown } | null;
  if (record && typeof record === "object" && "changes" in record) return Number(record["changes"]);
  return 0;
}
