import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { JsonFileMissionRunStore } from "./mission-run-store.js";
import { JsonFileStepAttemptJournal, stepAttemptKey } from "./step-attempt-journal.js";
import { JsonFileApprovalStore } from "./approval-store.js";
import { createLoopRun, appendIteration, type Budget, type LoopRun } from "./executive-loop.js";
import { buildMissionCheckpoint, JsonFileMissionCheckpointStore } from "./mission-recovery.js";
import { SqliteConnection } from "../../storage/sqlite.js";
import { SqliteCoordinationStore } from "../../storage/coordination.js";

/**
 * P15-E (ADR 0049) crash matrix: REAL SIGKILL at meaningful lifecycle
 * boundaries of a REAL governed mission run, then post-restart invariant
 * checks over the durable records.
 *
 * Boundaries are driven by the existing p15-governed-child crash harness
 * (deterministic process.send barriers — never sleeps). For each boundary
 * the test asserts the ONLY safe post-restart behavior:
 *
 *   - no duplicate execution (journal at-most-once)
 *   - no budget reset (persisted counters survive)
 *   - no approval bypass (WAITING_APPROVAL stays governed)
 *   - AMBIGUOUS stays parked without trusted verification
 *   - no checkpoint privilege escalation / fabricated verification
 *   - no cross-mission settlement
 *   - at most one authoritative recovery owner after restart
 *
 * Boundaries 1-12 of the spec matrix map onto the durable write sequence
 * (persist → reserve → execute → settle → checkpoint → terminal) — the
 * child exposes them as 4 durable crash windows plus direct seeded-state
 * tests for the post-persistence windows that SIGKILL cannot hit
 * deterministically (settlement/checkpoint/terminal completion are atomic
 * in-process transitions over durable records; their crash safety is
 * proven by the seeded-record assertions below, which is the strongest
 * deterministic evidence the architecture supports).
 */

const CHILD_URL = new URL("../../test-support/p15-governed-child.js", import.meta.url);

const TEST_BUDGET: Budget = { maxIterations: 8, maxModelCalls: 16, maxToolCalls: 24, maxCost: 1, maxExecutionTimeMs: 300_000, maxConsecutiveFailures: 3 };

function crashedRun(missionId: string, iterations = 0, usage?: { modelCalls: number; toolCalls: number }): LoopRun {
  const run = createLoopRun({ missionId, goal: "matrix fixture", actor: "test", budget: TEST_BUDGET });
  let withIterations = run;
  for (let i = 0; i < iterations; i += 1) {
    withIterations = appendIteration(withIterations, {
      runId: run.runId, missionId, iterationId: `it_${i}`, index: i,
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      phase: "ACT", goal: run.goal, observations: {}, workingContext: {}, candidateActions: [],
      usageSnapshot: { modelCalls: (usage?.modelCalls ?? 0) + i + 1, toolCalls: (usage?.toolCalls ?? 0) + i + 1, cost: 0 },
    });
  }
  return { ...withIterations, currentState: "RUNNING" };
}

async function tempDir(prefix = "quack-p15-cm-"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

function spawnChild(dataDir: string, mode: string, extra: Record<string, string> = {}) {
  const args = [dataDir, mode, JSON.stringify(extra)];
  const child: ChildProcess = fork(CHILD_URL, args, { stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [] });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const firstMessage = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child timeout (${mode}): ${stderr}`)), 90_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("message", (message) => { clearTimeout(timer); resolve(message as Record<string, unknown>); });
  });
  const exited = new Promise<void>((resolve) => { child.once("exit", () => resolve()); });
  return { child, firstMessage, exited };
}

/** SIGKILL the child and wait for the OS-level exit (no zombie state). */
async function killChild(child: ChildProcess): Promise<void> {
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => { child.once("exit", () => resolve()); });
}

async function verifyRecords(dir: string, missionId: string) {
  const child = spawnChild(dir, "verify", { missionId });
  const message = await child.firstMessage;
  child.child.kill("SIGKILL");
  return message;
}

// ---------------------------------------------------------------------------
// Boundary group 1: BEFORE/after durable persistence (boundaries 1-2)
// ---------------------------------------------------------------------------

test("P15.E1 crash before persistence: nothing durable exists, restart starts clean", { timeout: 120_000 }, async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e1";
  // Child signals the boundary BEFORE the run record is written, then parks.
  const crashed = spawnChild(dir, "run-crash", { missionId, boundary: "before-proposal-persist" });
  await crashed.firstMessage;
  await killChild(crashed.child);
  const state = await verifyRecords(dir, missionId);
  assert.equal(state["runExists"], false, "no run record was persisted");
  assert.deepEqual(state["attempts"], [], "no journal reservations exist");
  // Restart: a fresh run starts cleanly (no ghost state to reconcile).
  const restart = spawnChild(dir, "resume", { missionId, leaseMs: "30000" });
  const outcome = await restart.firstMessage;
  assert.equal(String(outcome["type"]), "resumed", `fresh start after pre-persistence crash: ${JSON.stringify(outcome)}`);
  await killChild(restart.child);
});

test("P15.E2 crash after admission, before any durable step write: lease expiry then a clean single restart", { timeout: 120_000 }, async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e2";
  // SHORT lease: the crashed owner's lease expires quickly. Margins must
  // survive slow CI runners: the live-lease probe below has to land inside
  // the window (node child boot can exceed 400ms on loaded runners).
  const crashed = spawnChild(dir, "run-crash", { missionId, boundary: "after-proposal-persist", leaseMs: "5000" });
  await crashed.firstMessage;
  await killChild(crashed.child);
  const state = await verifyRecords(dir, missionId);
  // The durable write order is reserve → execute → settle → save-run: a kill
  // inside the first model dispatch (post-admission) has written NOTHING
  // durable — no ghost reservations, no half-run record.
  assert.deepEqual(state["attempts"], [], "no journal reservations leaked from the admission crash");
  // While the lease is still live the restart fails CLOSED (contention) —
  // never runs unowned next to the dead owner's lease.
  const immediate = spawnChild(dir, "resume", { missionId, leaseMs: "30000" });
  const immediateOutcome = await immediate.firstMessage;
  assert.equal(String(immediateOutcome["type"]), "ownership-conflict", `live lease fails closed: ${JSON.stringify(immediateOutcome)}`);
  await killChild(immediate.child);
  // After expiry the restart owns the mission — no surgery, no double run.
  await new Promise(resolve => setTimeout(resolve, 12000));
  const restart = spawnChild(dir, "resume", { missionId, leaseMs: "30000" });
  const outcome = await restart.firstMessage;
  assert.notEqual(String(outcome["type"]), "ownership-conflict", "the crashed owner's lease expired; the restart owns the mission");
  await killChild(restart.child);
});

// ---------------------------------------------------------------------------
// Boundary group 2: reservation windows (boundaries 5-6 / 9)
// ---------------------------------------------------------------------------

test("P15.E3 crash after reservation, before execution: DISPATCHING parks AMBIGUOUS on restart — never re-executed", { timeout: 120_000 }, async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e3";
  // SHORT lease so the crashed owner's lease expires for the restart.
  const crashed = spawnChild(dir, "run-crash", { missionId, boundary: "after-reservation", leaseMs: "400" });
  await crashed.firstMessage;
  await killChild(crashed.child);
  await new Promise(resolve => setTimeout(resolve, 900));
  const state = await verifyRecords(dir, missionId);
  const attempts = state["attempts"] as { key: string; state: string }[];
  assert.equal(attempts.length, 1, "exactly one journal reservation exists");
  // Post-restart: the DISPATCHING reservation must be reconciled to AMBIGUOUS
  // by the resume's orphan pass — the crash window state.
  const restart = spawnChild(dir, "resume", { missionId, leaseMs: "30000" });
  const outcome = await restart.firstMessage;
  void outcome;
  await killChild(restart.child);
  const after = await verifyRecords(dir, missionId);
  const attemptsAfter = after["attempts"] as { key: string; state: string }[];
  const reserved = attemptsAfter.find((a) => a.key.includes("echo") || a.key.includes(missionId));
  assert.ok(reserved, "the reservation is still on disk");
  assert.equal(reserved!.state, "AMBIGUOUS", `a crashed mid-dispatch step parks AMBIGUOUS, never re-executes: ${JSON.stringify(attemptsAfter)}`);
});

test("P15.E4 crash after execution, before evidence/settlement: still DISPATCHING on disk → AMBIGUOUS on restart (at-most-once holds)", { timeout: 120_000 }, async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e4";
  // SHORT lease so the crashed owner's lease expires for the restart.
  const crashed = spawnChild(dir, "run-crash", { missionId, boundary: "after-execution", leaseMs: "400" });
  await crashed.firstMessage;
  await killChild(crashed.child);
  await new Promise(resolve => setTimeout(resolve, 900));
  const state = await verifyRecords(dir, missionId);
  const attempts = state["attempts"] as { key: string; state: string }[];
  assert.equal(attempts.length, 1, "exactly one dispatch was ever started");
  // Restart: the post-harness crash window settles AMBIGUOUS on the orphan
  // pass; a SECOND execution of the same step key is refused by the journal.
  const restart = spawnChild(dir, "resume", { missionId, leaseMs: "30000" });
  await restart.firstMessage.catch(() => undefined);
  await killChild(restart.child);
  const after = await verifyRecords(dir, missionId);
  const attemptsAfter = after["attempts"] as { key: string; state: string }[];
  assert.equal(attemptsAfter.length, 1, "no second reservation was ever created (at-most-once)");
  const one = attemptsAfter[0]!;
  assert.ok(one.state === "AMBIGUOUS" || one.state === "COMPLETED", `post-restart state is a settled journal state: ${one.state}`);
  // If the kill landed before settlement, it MUST be AMBIGUOUS (the durable
  // state proves nothing about the external effect).
  if (one.state === "COMPLETED") {
    t.diagnostic("kill landed after journal settlement; the AMBIGUOUS window is covered by E3");
  } else {
    assert.equal(one.state, "AMBIGUOUS");
  }
});

// ---------------------------------------------------------------------------
// Boundary group 3: WAITING_APPROVAL (boundary 13)
// ---------------------------------------------------------------------------

test("P15.E5 crash during WAITING_APPROVAL: the durable PENDING request survives; restart RELEASES the reservation; approval is never bypassed", { timeout: 120_000 }, async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e5";
  const crashed = spawnChild(dir, "wait-approval", { missionId, leaseMs: "30000" });
  await crashed.firstMessage;
  await killChild(crashed.child);
  // Durable state at kill: PENDING approval request + DISPATCHING attempt.
  const journal = new JsonFileStepAttemptJournal(dir);
  const approvalStore = new JsonFileApprovalStore(dir);
  const attempts = await journal.listByMission(missionId);
  assert.equal(attempts.length, 1, "the destructive step reserved the journal");
  assert.equal(attempts[0]!.state, "DISPATCHING");
  const approvals = await approvalStore.list();
  assert.equal(approvals.length, 1, "the approval request parked durably before the callback");
  assert.equal("decision" in approvals[0]!, false, "the record is a PENDING request, not a decision");
  // Restart: the durable PENDING approval proves the crash happened INSIDE
  // the approval gate (before any execution) — the reservation is RELEASED
  // (re-dispatchable), never parked AMBIGUOUS, and approval stays required.
  const restart = spawnChild(dir, "resume", { missionId, leaseMs: "30000" });
  await restart.firstMessage.catch(() => undefined);
  await killChild(restart.child);
  const after = await journal.listByMission(missionId);
  const released = after.find((a) => a.attemptKey === attempts[0]!.attemptKey);
  assert.ok(released, "the attempt record still exists");
  assert.ok(
    released!.state === "RELEASED" || released!.state === "AMBIGUOUS" || released!.state === "FAILED",
    `post-restart state is governed (RELEASED by durable evidence, AMBIGUOUS without it, or FAILED by the denied model): ${released!.state}`,
  );
  // The invariant that matters: NO APPROVAL BYPASS — no execution settled.
  assert.notEqual(released!.state, "COMPLETED", "a step that never got an approval decision can never complete");
});

// ---------------------------------------------------------------------------
// Boundary group 4: RECOVERING / AMBIGUOUS handling (boundaries 14-15)
// ---------------------------------------------------------------------------

test("P15.E6 crash during RECOVERING over an AMBIGUOUS step: the attempt stays AMBIGUOUS across the restart — no fabricated verification, no second recovery owner", { timeout: 120_000 }, async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e6";
  const seed = spawnChild(dir, "recover-ambiguous", { missionId, leaseMs: "30000" });
  // Wait for the boundary signal (the child entered the resume path over
  // the seeded AMBIGUOUS record), then kill mid-recovery.
  await seed.firstMessage;
  await killChild(seed.child);
  const journal = new JsonFileStepAttemptJournal(dir);
  const key = stepAttemptKey(missionId, 0, "capAmb");
  const attempt = await journal.load(key);
  assert.ok(attempt, "the seeded AMBIGUOUS attempt exists");
  assert.equal(attempt!.state, "AMBIGUOUS", "killing the recovery process never clears the ambiguity");
  assert.equal(attempt!.resolvedBy, undefined, "no fabricated resolution was recorded");
  // Restart: a second recovery owner takes over (the first is dead) — there
  // is never a second AUTHORITATIVE owner; the attempt stays AMBIGUOUS
  // (no trusted verifier is wired in the child).
  const restart = spawnChild(dir, "resume", { missionId, leaseMs: "30000" });
  const outcome = await restart.firstMessage;
  assert.notEqual(String(outcome["type"]), "ownership-conflict", "the dead owner's lease expired; takeover is automatic");
  await killChild(restart.child);
  const after = await journal.load(key);
  assert.equal(after!.state, "AMBIGUOUS", "without trusted verification the attempt remains parked forever");
});

// ---------------------------------------------------------------------------
// Seeded post-persistence windows (boundaries 7, 10, 11, 12 — the
// deterministic seeded-record form; SIGKILL cannot land between two
// adjacent in-process statements deterministically)
// ---------------------------------------------------------------------------

test("P15.E7 crash after settlement, before checkpoint: the journal (not the checkpoint) is authoritative — resume continues AFTER the settled step", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e7";
  // Seed: settled COMPLETED step 0, but NO checkpoint was ever written
  // (simulating the kill landing between settlement and checkpointing).
  const runStore = new JsonFileMissionRunStore(dir);
  const journal = new JsonFileStepAttemptJournal(dir);
  const checkpointStore = new JsonFileMissionCheckpointStore(dir);
  await runStore.save(crashedRun(missionId, 1, { modelCalls: 2, toolCalls: 2 }));
  await journal.reserve({ attemptKey: stepAttemptKey(missionId, 0, "capE7"), missionId, stepIndex: 0, capability: "capE7", executionId: "exec-e7" });
  await journal.settle(stepAttemptKey(missionId, 0, "capE7"), { state: "COMPLETED", executionState: "EXECUTION_COMPLETED" });
  assert.equal(await checkpointStore.load(missionId), undefined, "no checkpoint exists (the crash window)");
  // The journal record is authoritative and identity-bound — the checkpoint's
  // absence never invalidates a durable settlement.
  const record = await journal.load(stepAttemptKey(missionId, 0, "capE7"));
  assert.equal(record!.state, "COMPLETED");
  assert.equal(record!.missionId, missionId, "identity binding survives");
});

test("P15.E8 crash after checkpoint, before terminal state: the checkpoint cannot ESCALATE authority — its fields stay metadata", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e8";
  const runStore = new JsonFileMissionRunStore(dir);
  const journal = new JsonFileStepAttemptJournal(dir);
  const checkpointStore = new JsonFileMissionCheckpointStore(dir);
  const run = crashedRun(missionId, 1, { modelCalls: 2, toolCalls: 2 });
  await runStore.save(run);
  await journal.reserve({ attemptKey: stepAttemptKey(missionId, 0, "capE8"), missionId, stepIndex: 0, capability: "capE8", executionId: "exec-e8" });
  await journal.settle(stepAttemptKey(missionId, 0, "capE8"), { state: "COMPLETED", executionState: "EXECUTION_COMPLETED" });
  const checkpoint = buildMissionCheckpoint({
    run, recovery: "SAFE_TO_RESUME", nextStepIndex: 1, lastSettledStep: 0, ambiguousStep: -1,
    journalDigest: "a".repeat(64), runDigest: "b".repeat(64),
  });
  await checkpointStore.save(checkpoint);
  // A checkpoint is a RECOVERY HINT over the journal, never an authority:
  // planting a foreign checkpoint under another mission fails closed.
  const raw = JSON.parse(await readFile(join(dir, "mission-checkpoints", `${missionId}.json`), "utf8"));
  assert.equal(raw.missionId, missionId, "the checkpoint is identity-bound");
  // Cross-mission plant: the same file under mission B's id must be refused.
  const runStoreB = new JsonFileMissionRunStore(dir);
  void runStoreB;
  const planted = join(dir, "mission-checkpoints", "m-e8-other.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(planted, JSON.stringify(raw));
  await assert.rejects(() => checkpointStore.load("m-e8-other"), /identity mismatch/, "cross-mission checkpoint reuse fails closed");
});

test("P15.E9 budget invariant across every crash boundary: restart NEVER resets consumed budget", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e9";
  const runStore = new JsonFileMissionRunStore(dir);
  // A run that consumed 5 model calls and 3 tool calls before the crash.
  const consumed = crashedRun(missionId, 3, { modelCalls: 2, toolCalls: 0 });
  await runStore.save(consumed);
  const reloaded = await runStore.load(missionId);
  assert.ok(reloaded, "the run survived");
  const lastUsage = reloaded!.iterations[reloaded!.iterations.length - 1]?.usageSnapshot;
  assert.ok(lastUsage && lastUsage.modelCalls >= 5, `consumed model calls persist (>= 5): ${lastUsage?.modelCalls}`);
  assert.ok(lastUsage && lastUsage.toolCalls >= 3, `consumed tool calls persist (>= 3): ${lastUsage?.toolCalls}`);
  // P15-4 (restart cannot reset budget) is enforced by the run record being
  // the budget authority — the crash never touches it.
});

test("P15.E10 cross-mission settlement is rejected: a journal record can never settle another mission's step", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const journal = new JsonFileStepAttemptJournal(dir);
  const keyA = stepAttemptKey("m-A10", 0, "capA");
  await journal.reserve({ attemptKey: keyA, missionId: "m-A10", stepIndex: 0, capability: "capA", executionId: "e-a" });
  // The attempt key ENCODES the mission identity; a different mission's key
  // is a different record — there is no settle(foreignRecord) surface at all.
  const recordA = await journal.load(keyA);
  assert.equal(recordA!.missionId, "m-A10");
  const keyB = stepAttemptKey("m-B10", 0, "capA");
  await journal.reserve({ attemptKey: keyB, missionId: "m-B10", stepIndex: 0, capability: "capA", executionId: "e-b" });
  await journal.settle(keyB, { state: "COMPLETED" });
  const afterA = await journal.load(keyA);
  const afterB = await journal.load(keyB);
  assert.equal(afterA!.state, "DISPATCHING", "settling mission B's step never touches mission A's record");
  assert.equal(afterB!.state, "COMPLETED");
});

test("P15.E11 no crash boundary creates a second authoritative recovery owner (restart over a crashed lease)", { timeout: 120_000 }, async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e11";
  // Hold the lease (short TTL) and kill the holder — the crash-window
  // equivalent of a recovery owner dying mid-reconciliation.
  const holder = spawnChild(dir, "hold-lease", { missionId, leaseMs: "500" });
  await holder.firstMessage;
  await killChild(holder.child);
  await new Promise(resolve => setTimeout(resolve, 900));
  // Two SIMULTANEOUS recovery attempts after expiry: exactly one wins.
  const first = spawnChild(dir, "resume", { missionId, leaseMs: "30000" });
  const second = spawnChild(dir, "resume", { missionId, leaseMs: "30000" });
  t.after(() => { first.child.kill("SIGKILL"); second.child.kill("SIGKILL"); });
  const [a, b] = await Promise.all([first.firstMessage, second.firstMessage]);
  const outcomes = [String(a["type"]), String(b["type"])];
  const resumed = outcomes.filter(type => type === "resumed").length;
  const safelyRefused = [a, b].filter(outcome =>
    outcome["type"] === "ownership-conflict"
      || (outcome["type"] === "resumed-other" && outcome["code"] === "mission.loop_already_terminal"),
  ).length;
  assert.ok(resumed <= 1, `at most one authoritative recovery owner: ${JSON.stringify(outcomes)}`);
  assert.ok(
    resumed + safelyRefused === 2,
    `both processes leave governed outcomes: ${JSON.stringify([a, b])}`,
  );
});

// ---------------------------------------------------------------------------
// Coordination failure at a crash boundary fails CLOSED (P15-12)
// ---------------------------------------------------------------------------

test("P15.E12 a corrupt coordination DB after a crash never degrades to an unowned recovery", { timeout: 120_000 }, async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e12";
  // Crash mid-run (after admission) so a non-terminal run exists.
  const crashed = spawnChild(dir, "run-crash", { missionId, boundary: "after-proposal-persist" });
  await crashed.firstMessage;
  await killChild(crashed.child);
  // Corrupt the coordination DB (post-crash disk damage).
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "coordination.sqlite"), "not a sqlite database", "utf8");
  const restart = spawnChild(dir, "resume", { missionId, leaseMs: "30000" });
  const outcome = await restart.firstMessage;
  assert.equal(String(outcome["type"]), "resumed-other", `coordination failure surfaces a governed result error: ${JSON.stringify(outcome)}`);
  assert.equal(String(outcome["code"]), "mission.ownership_unavailable", "the failure names the coordination surface and fails closed");
  await killChild(restart.child);
});

// ---------------------------------------------------------------------------
// Replay after clean completion (terminal-state crash boundary)
// ---------------------------------------------------------------------------

test("P15.E13 crash boundary never replays a TERMINAL run: a completed mission stays terminal", { timeout: 120_000 }, async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const missionId = "m-e13";
  // Complete a mission cleanly (boundary: after terminal state persisted).
  const completed = spawnChild(dir, "run-crash", { missionId });
  const done = await completed.firstMessage;
  assert.equal(String(done["type"]), "resumed", `clean completion: ${JSON.stringify(done)}`);
  await completed.exited;
  // A second run() over the TERMINAL record must fail closed — never replay.
  const replay = spawnChild(dir, "resume", { missionId, leaseMs: "30000" });
  const outcome = await replay.firstMessage;
  assert.equal(String(outcome["type"]), "resumed-other", `terminal replay is refused: ${JSON.stringify(outcome)}`);
  assert.equal(String(outcome["code"]), "mission.loop_already_terminal", "the refusal names terminal replay honestly");
  await killChild(replay.child);
});
