import test from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createId } from "../core/types.js";
import { SqliteConnection } from "./sqlite.js";
import { SqliteCoordinationStore, type AcquireOutcome } from "./coordination.js";

const WORKER_URL = new URL("../test-support/coordination-worker.js", import.meta.url);

interface WorkerResult {
  readonly type: "result";
  readonly [key: string]: unknown;
}

function spawnWorker(dbPath: string, scenario: string, resourceId: string, owner: string, leaseMs?: number): ChildProcess {
  const args = [dbPath, scenario, resourceId, owner];
  if (leaseMs !== undefined) args.push(String(leaseMs));
  return fork(WORKER_URL, args, { stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [] });
}

function workerResult(child: ChildProcess, timeoutMs = 20_000): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => reject(new Error(`worker timeout: ${stderr}`)), timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("message", (message) => {
      clearTimeout(timer);
      if (typeof message === "object" && message !== null && (message as WorkerResult).type === "result") {
        resolve(message as WorkerResult);
      } else {
        reject(new Error(`unexpected worker message: ${JSON.stringify(message)} ${stderr}`));
      }
    });
  });
}

async function tempDb(): Promise<{ dbPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "quack-coord-"));
  return { dbPath: join(dir, "coordination.sqlite"), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("acquire is free-first, and a valid lease rejects a second owner across processes", async () => {
  const { dbPath, cleanup } = await tempDb();
  const resourceId = createId("res");
  try {
    const a = spawnWorker(dbPath, "acquire", resourceId, "owner-a");
    const first = await workerResult(a);
    const firstOutcome = first["outcome"] as AcquireOutcome;
    assert.equal(firstOutcome.kind, "ACQUIRED");
    assert.equal(firstOutcome.lease.version, 1);

    const b = spawnWorker(dbPath, "acquire", resourceId, "owner-b");
    const second = await workerResult(b);
    const secondOutcome = second["outcome"] as AcquireOutcome;
    assert.equal(secondOutcome.kind, "BUSY");
    assert.equal(secondOutcome.lease.owner, "owner-a");
  } finally {
    await cleanup();
  }
});

test("two processes race to acquire; exactly one wins", async () => {
  const { dbPath, cleanup } = await tempDb();
  const resourceId = createId("res");
  try {
    const racers = ["r1", "r2", "r3", "r4"].map((owner) => spawnWorker(dbPath, "race", resourceId, owner));
    const results = await Promise.all(racers.map((child) => workerResult(child, 30_000)));
    const kinds = results.map((r) => (r["outcome"] as AcquireOutcome).kind);
    const winners = kinds.filter((k) => k === "ACQUIRED" || k === "TAKEOVER_STALE");
    assert.equal(winners.length, 1);
    assert.ok(kinds.filter((k) => k === "BUSY").length >= 3);
  } finally {
    await cleanup();
  }
});

test("valid owner heartbeats and extends its lease across processes", async () => {
  const { dbPath, cleanup } = await tempDb();
  const resourceId = createId("res");
  try {
    const a = spawnWorker(dbPath, "heartbeat", resourceId, "owner-a");
    const result = await workerResult(a);
    assert.equal(result["acquired"], true);
    assert.equal(result["renewed"], true);
  } finally {
    await cleanup();
  }
});

test("second process rejected during valid lease, accepted after lease expiry (stale takeover)", async () => {
  const { dbPath, cleanup } = await tempDb();
  const resourceId = createId("res");
  try {
    // Lease long enough that the BUSY probe (a forked worker, ~0.5-1s to
    // start on slow CI runners) still lands inside the lease window.
    const holder = spawnWorker(dbPath, "acquire", resourceId, "owner-a", 2_000);
    const first = await workerResult(holder);
    assert.equal((first["outcome"] as AcquireOutcome).kind, "ACQUIRED");

    const rejected = spawnWorker(dbPath, "acquire", resourceId, "owner-b");
    const busy = await workerResult(rejected);
    assert.equal((busy["outcome"] as AcquireOutcome).kind, "BUSY");

    // Wait past the 2s lease so the takeover is a genuine stale takeover.
    await new Promise((resolve) => setTimeout(resolve, 2_400));

    const takeover = spawnWorker(dbPath, "acquire", resourceId, "owner-b");
    const taken = await workerResult(takeover);
    const outcome = taken["outcome"] as AcquireOutcome;
    assert.equal(outcome.kind, "TAKEOVER_STALE");
    assert.equal(outcome.lease.owner, "owner-b");
    assert.equal(outcome.lease.version, 2);
  } finally {
    await cleanup();
  }
});

test("old owner cannot write after takeover: version fencing rejects stale writers", async () => {
  const { dbPath, cleanup } = await tempDb();
  const resourceId = createId("res");
  // Lease long enough that the immediate post-acquire write cannot be
  // starved past expiry on a loaded CI runner (full parallel suite can
  // deschedule this process for hundreds of ms; 3s holds), short enough
  // that a bounded sleep crosses it for the takeover phase.
  const shortLease = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs: 3_000 });
  try {
    const original = shortLease.acquire(resourceId, "owner-a");
    assert.equal(original.kind, "ACQUIRED");
    const versionA = original.lease.version;

    // owner-a writes with its granted version: OK.
    const writeA = shortLease.writeFenced(resourceId, "owner-a", versionA, { value: "a" });
    assert.equal(writeA.kind, "WRITTEN");

    // Lease expires; owner-b takes over, bumping the fencing version.
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    const takeover = shortLease.acquire(resourceId, "owner-b");
    assert.equal(takeover.kind, "TAKEOVER_STALE");
    assert.equal(takeover.lease.version, versionA + 1);

    // owner-a attempts its next write with its now-old version: REJECTED.
    const staleWrite = shortLease.writeFenced(resourceId, "owner-a", versionA, { value: "a2" });
    assert.equal(staleWrite.kind, "STALE_OWNER");

    // owner-b writes with the new version: OK.
    const writeB = shortLease.writeFenced(resourceId, "owner-b", takeover.lease.version, { value: "b" });
    assert.equal(writeB.kind, "WRITTEN");
    assert.deepEqual(shortLease.readPayload(resourceId), { value: "b" });
  } finally {
    await cleanup();
  }
});

test("fenced write from an actual other process: NOT_OWNER for non-owner, WRITTEN for owner", async () => {
  const { dbPath, cleanup } = await tempDb();
  const resourceId = createId("res");
  const store = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs: 60_000 });
  try {
    const acquired = store.acquire(resourceId, "owner-a");
    assert.equal(acquired.kind, "ACQUIRED");
    const foreign = store.writeFenced(resourceId, "owner-b", acquired.lease.version, { value: "evil" });
    assert.equal(foreign.kind, "STALE_OWNER");

    const writer = spawnWorker(dbPath, "write", resourceId, "owner-a");
    const result = await workerResult(writer);
    const written = result["written"] as { kind: string };
    assert.equal(written.kind, "WRITTEN");
    assert.deepEqual(store.readPayload(resourceId), { value: "owner-a" });
  } finally {
    await cleanup();
  }
});

test("process crash mid-hold: lease goes stale and another process recovers ownership", async () => {
  const { dbPath, cleanup } = await tempDb();
  const resourceId = createId("res");
  try {
    const crashed = spawnWorker(dbPath, "crash-hold", resourceId, "owner-a", 200);
    const held = await workerResult(crashed);
    assert.equal(held["acquired"], true);

    // Kill the holder abruptly: a real process death, no release call.
    crashed.kill("SIGKILL");
    await new Promise((resolve) => { crashed.once("exit", resolve); });

    // Within the lease window the resource is still "owned" by the dead
    // process — fail closed.
    const store = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs: 60_000 });
    const busy = store.acquire(resourceId, "owner-b");
    assert.equal(busy.kind, "BUSY");

    // After lease expiry the new process takes over and recovers.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const takeover = store.acquire(resourceId, "owner-b");
    assert.equal(takeover.kind, "TAKEOVER_STALE");
    assert.equal(takeover.lease.owner, "owner-b");
  } finally {
    await cleanup();
  }
});

test("in-process concurrency guard: acquire/heartbeat/release lifecycle", async () => {
  const { dbPath, cleanup } = await tempDb();
  const resourceId = createId("res");
  const store = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs: 5_000 });
  try {
    const acquired = store.acquire(resourceId, "owner-a");
    assert.equal(acquired.kind, "ACQUIRED");

    // Double acquire by same owner is idempotent (no version bump).
    const again = store.acquire(resourceId, "owner-a");
    assert.equal(again.kind, "ACQUIRED");
    assert.equal(again.lease.version, acquired.lease.version);

    assert.equal(store.heartbeat(resourceId, "owner-a"), true);
    assert.equal(store.heartbeat(resourceId, "owner-b"), false);

    // Version mismatch write rejected.
    assert.equal(store.writeFenced(resourceId, "owner-a", acquired.lease.version + 99, {}).kind, "STALE_OWNER");

    assert.equal(store.release(resourceId, "owner-b"), false);
    assert.equal(store.release(resourceId, "owner-a"), true);

    const reacquired = store.acquire(resourceId, "owner-b");
    assert.equal(reacquired.kind, "ACQUIRED");
    assert.equal(reacquired.lease.version, 2);
  } finally {
    await cleanup();
  }
});

test("expired lease cannot be resurrected by heartbeat from the old owner", async () => {
  const { dbPath, cleanup } = await tempDb();
  const resourceId = createId("res");
  const store = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs: 50 });
  try {
    const acquired = store.acquire(resourceId, "owner-a");
    assert.equal(acquired.kind, "ACQUIRED");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(store.heartbeat(resourceId, "owner-a"), false);

    // Another process takes over; the old owner's write is fenced out.
    const takeover = store.acquire(resourceId, "owner-b");
    assert.equal(takeover.kind, "TAKEOVER_STALE");
    const stale = store.writeFenced(resourceId, "owner-a", acquired.lease.version, {});
    assert.equal(stale.kind, "STALE_OWNER");
  } finally {
    await cleanup();
  }
});
