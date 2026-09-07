/**
 * Forked worker for multi-process coordination tests. argv:
 *   <dbPath> <scenario> <resourceId> <owner> [leaseMs]
 * Scenarios (message reply is the JSON result):
 *   acquire          → AcquireOutcome JSON
 *   acquire-hold     → acquire, wait for "release" message, release
 *   heartbeat        → acquire then heartbeat
 *   crash-hold      → acquire then never exit on its own (parent kills)
 *   write            → acquire then writeFenced payload {value}
 *   race             → retry-acquire loop with small jitter, first to
 *                     ACQUIRED wins; reports attempts
 */
import { fork } from "node:child_process";

if (process.send === undefined) {
  // Standalone probe guard: this module exists to be forked with IPC.
  console.error("coordination-worker: requires fork with IPC channel");
  process.exit(2);
}

const [dbPath, scenario, resourceId, owner, leaseMsArg] = process.argv.slice(2);
if (!dbPath || !scenario || !resourceId || !owner) {
  process.send!({ type: "error", error: "missing argv" });
  process.exit(2);
}
const { SqliteConnection } = await import("../storage/sqlite.js");
const { SqliteCoordinationStore } = await import("../storage/coordination.js");

const leaseMs = leaseMsArg ? Number(leaseMsArg) : 30_000;
const store = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs });
const send = (payload: object) => process.send!({ type: "result", ...payload });

switch (scenario) {
  case "acquire": {
    send({ outcome: store.acquire(resourceId, owner) });
    process.exit(0);
  }
  case "acquire-hold": {
    const outcome = store.acquire(resourceId, owner);
    send({ outcome });
    if (outcome.kind !== "ACQUIRED" && outcome.kind !== "TAKEOVER_STALE") process.exit(1);
    process.on("message", (message: { type: string }) => {
      if (message.type === "release") {
        store.release(resourceId, owner);
        process.exit(0);
      }
    });
    break;
  }
  case "heartbeat": {
    const outcome = store.acquire(resourceId, owner);
    if (outcome.kind === "ACQUIRED" || outcome.kind === "TAKEOVER_STALE") {
      send({ acquired: true, version: outcome.lease.version, renewed: store.heartbeat(resourceId, owner) });
    } else {
      send({ acquired: false, outcome });
    }
    process.exit(0);
  }
  case "crash-hold": {
    const outcome = store.acquire(resourceId, owner);
    if (outcome.kind === "ACQUIRED" || outcome.kind === "TAKEOVER_STALE") {
      send({ acquired: true, version: outcome.lease.version });
      // Hold the lease; parent SIGKILLs this process to simulate a crash.
      setInterval(() => { /* hold */ }, 1000);
    } else {
      send({ acquired: false });
      process.exit(1);
    }
    break;
  }
  case "write": {
    const outcome = store.acquire(resourceId, owner);
    if (outcome.kind !== "ACQUIRED" && outcome.kind !== "TAKEOVER_STALE") {
      send({ outcome });
      process.exit(0);
    }
    const written = store.writeFenced(resourceId, owner, outcome.lease.version, { value: owner });
    send({ outcome, written });
    process.exit(0);
  }
  case "race": {
    let attempts = 0;
    for (;;) {
      attempts++;
      const outcome = store.acquire(resourceId, owner);
      if (outcome.kind === "ACQUIRED" || outcome.kind === "TAKEOVER_STALE") {
        send({ attempts, outcome });
        process.exit(0);
      }
      // BUSY: jitter then retry until this process wins or the parent
      // stops the race via message.
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 20)));
      if (attempts > 200) {
        send({ attempts, outcome });
        process.exit(1);
      }
    }
  }
  default:
    send({ error: `unknown scenario ${scenario}` });
    process.exit(2);
}

export {};
void fork;
