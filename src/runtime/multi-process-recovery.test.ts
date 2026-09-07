/**
 * Phase 5 multi-process crash/restart recovery (ADR 0031 lift).
 *
 * Every scenario uses REAL forked Node processes sharing one dataDir and
 * one coordination DB. The fixture child runs a durable mission that
 * pauses at a chosen boundary so the parent can SIGKILL it mid-execution;
 * a second child (fresh process) then resumes the mission through
 * QuackRuntime.resumeMission and must land on exactly-once durable
 * effects with a single verified owner at all times.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrashPoint } from "../test-support/multi-process-recovery-types.js";

const WORKER_URL = new URL("../test-support/ownership-child.js", import.meta.url);
/** Child lease is 600ms; takeover requires expiry. */
const LEASE_WAIT_MS = 900;

export type SpawnedMessage = { readonly type: string; readonly [key: string]: unknown };

interface Message {
  readonly type: string;
  readonly taskId?: string;
  readonly stage?: string;
  readonly error?: string;
  readonly [key: string]: unknown;
}

interface SpawnedChild {
  readonly child: ChildProcess;
  readonly firstMessage: Promise<Message>;
}

function spawnChild(dataDir: string, mode: string, crashPoint?: string, extra?: Record<string, string>): SpawnedChild {
  const args = [dataDir, mode, ...(crashPoint ? [crashPoint] : []), ...(extra ? [JSON.stringify(extra)] : [])];
  const child = fork(WORKER_URL, args, { stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [] });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const firstMessage = new Promise<Message>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ownership child timeout (${mode}): ${stderr}`)), 45_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("message", (message) => {
      clearTimeout(timer);
      if (typeof message === "object" && message !== null && "type" in message) resolve(message as Message);
      else reject(new Error(`unexpected child message: ${JSON.stringify(message)} ${stderr}`));
    });
  });
  return { child, firstMessage };
}

async function tempDataDir(): Promise<{ dataDir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "quack-mp-"));
  return { dataDir: dir, cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => rm(dir, { recursive: true, force: true })) };
}

async function lines(dir: string, filename: string): Promise<string[]> {
  try { return (await readFile(join(dir, filename), "utf8")).trim().split("\n").filter(Boolean); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function crashAt(t: TestContext, dataDir: string, crashPoint: CrashPoint): Promise<string> {
  const { child, firstMessage } = spawnChild(dataDir, "run-mission", crashPoint);
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const message = await firstMessage;
  assert.equal(message.type, "boundary", `child did not reach boundary: ${JSON.stringify(message)}`);
  assert.ok(message.taskId);
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => { child.once("exit", () => resolve()); });
  return message.taskId;
}

async function resumeInSecondProcess(dataDir: string, taskId: string, waitFirst = false): Promise<{ ok: boolean; type: string; status?: string; code?: string; receiptVerified?: boolean }> {
  if (waitFirst) await new Promise(resolve => setTimeout(resolve, LEASE_WAIT_MS));
  const { child, firstMessage } = spawnChild(dataDir, "resume-mission", undefined, { taskId });
  const result = await firstMessage;
  void child;
  return { ok: result.type === "resumed", type: result.type, status: result["status"] as string | undefined, code: result["code"] as string | undefined, receiptVerified: result["receiptVerified"] as boolean | undefined };
}

// ---------------------------------------------------------------------
// 5B.5 crash scenarios (real processes)
// ---------------------------------------------------------------------

for (const [boundary, expectedCalls] of [
  ["before-ownership", 0], ["after-ownership", 0], ["during-heartbeat", 0],
  ["tool-entered", 1], ["after-tool-before-persist", 1], ["after-receipt-before-complete", 1],
] as const) {
  test(`crash at ${boundary}: second process takes over after lease expiry and resumes to completion`, { timeout: 120_000 }, async t => {
    const { dataDir, cleanup } = await tempDataDir();
    t.after(cleanup);
    const taskId = await crashAt(t, dataDir, boundary);
    // after-ownership/during-heartbeat hold a LIVE lease: the second
    // process must wait for expiry (stale takeover) — that IS the
    // multi-process guarantee under test.
    const result = await resumeInSecondProcess(dataDir, taskId, true);
    assert.equal(result.type, "resumed", JSON.stringify(result));
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.receiptVerified, true, "resumed mission must carry a verified completion receipt");
    const calls = (await lines(dataDir, "calls.log")).map(line => JSON.parse(line) as { taskId: string; attemptId?: string; idempotencyKey?: string });
    const missionCalls = calls.filter(call => call.taskId === taskId);
    // Retry-safe (READ_ONLY) tool: at most one crash attempt + one resume
    // attempt; acknowledged work is never repeated.
    assert.ok(missionCalls.length >= expectedCalls && missionCalls.length <= expectedCalls + 1,
      `expected ${expectedCalls}-${expectedCalls + 1} durable calls, got ${missionCalls.length}`);
    assert.ok(missionCalls.every(call => call.taskId === taskId));
  });
}

test("simultaneous recovery attempts: never more than one executing owner", { timeout: 120_000 }, async t => {
  const { dataDir, cleanup } = await tempDataDir();
  t.after(cleanup);
  const taskId = await crashAt(t, dataDir, "after-ownership");

  // Race two resumers. If the crashed owner's lease is still live, BOTH
  // are rejected (fail closed) — that is the guarantee. If it expired,
  // exactly one takes over and the other must see the taker's fresh lease.
  const first = spawnChild(dataDir, "resume-mission", undefined, { taskId });
  const second = spawnChild(dataDir, "resume-mission", undefined, { taskId });
  t.after(() => { first.child.kill("SIGKILL"); second.child.kill("SIGKILL"); });
  const [a, b] = await Promise.all([first.firstMessage, second.firstMessage]);
  const types = [a.type, b.type];
  const resumed = types.filter(type => type === "resumed").length;
  assert.ok(resumed <= 1, `two processes must never both resume: ${JSON.stringify(types)}`);
  assert.ok(types.every(type => ["resumed", "ownership-conflict", "resume-rejected"].includes(type)),
    `both outcomes must be governed: ${JSON.stringify(types)}`);
  if (resumed === 1) {
    assert.equal(types.filter(type => type === "ownership-conflict" || type === "resume-rejected").length, 1,
      `the loser must be governed-rejected: ${JSON.stringify(types)}`);
  }
});

test("stale process cannot re-execute after takeover: completed mission returns stored result", { timeout: 120_000 }, async t => {
  const { dataDir, cleanup } = await tempDataDir();
  t.after(cleanup);
  const taskId = await crashAt(t, dataDir, "tool-entered");
  const resumed = await resumeInSecondProcess(dataDir, taskId, true);
  assert.equal(resumed.type, "resumed", JSON.stringify(resumed));
  assert.equal(resumed.status, "completed");
  // A stale process resuming the completed mission must NOT re-execute.
  const stale = await resumeInSecondProcess(dataDir, taskId);
  assert.ok(stale.type === "resumed" && stale.status === "completed", `stale resume must return the stored terminal result: ${JSON.stringify(stale)}`);
  const calls = (await lines(dataDir, "calls.log")).map(line => JSON.parse(line) as { taskId: string });
  assert.equal(calls.filter(c => c.taskId === taskId).length, 2,
    "exactly two durable tool calls (crashed attempt + resumed completion) — no re-execution");
});

test("repeated crash/restart cycles: mission eventually completes with a verified receipt", { timeout: 240_000 }, async t => {
  const { dataDir, cleanup } = await tempDataDir();
  t.after(cleanup);
  // Cycle 1: crash during the initial run at the tool.
  const taskId = await crashAt(t, dataDir, "tool-entered");
  // Cycle 2: crash during resume, mid-verification. Wait for the cycle-1
  // lease to expire first so the resume child can actually take over.
  await new Promise(resolve => setTimeout(resolve, LEASE_WAIT_MS));
  const mid = spawnChild(dataDir, "resume-mission", "during-heartbeat", { taskId });
  t.after(() => { if (mid.child.exitCode === null) mid.child.kill("SIGKILL"); });
  const midMessage = await mid.firstMessage;
  assert.equal(midMessage.type, "boundary", `mid-resume crash point: ${JSON.stringify(midMessage)}`);
  mid.child.kill("SIGKILL");
  await new Promise<void>(resolve => { mid.child.once("exit", () => resolve()); });
  // Cycle 3: final resume after lease expiry completes the mission.
  const final = await resumeInSecondProcess(dataDir, taskId, true);
  assert.equal(final.type, "resumed", JSON.stringify(final));
  assert.equal(final.status, "completed");
  assert.equal(final.receiptVerified, true, "completion receipt must survive the whole crash chain");
});

test("crash before ownership: no lease is left behind; immediate recovery works", { timeout: 120_000 }, async t => {
  const { dataDir, cleanup } = await tempDataDir();
  t.after(cleanup);
  const taskId = await crashAt(t, dataDir, "before-ownership");
  // No wait: the crashed process never took a lease, so recovery must be
  // immediate (distinguishes real lease tracking from blind sleeps).
  const result = await resumeInSecondProcess(dataDir, taskId);
  assert.equal(result.type, "resumed", JSON.stringify(result));
  assert.equal(result.status, "completed");
});

// ---------------------------------------------------------------------
// 5K end-to-end dogfood: compiled SKILL.md → governed graph → durable run
// → SIGKILL → second process resume → verified receipt
// ---------------------------------------------------------------------

test("dogfood: SKILL.md execution survives a process crash and resumes with a verified receipt", { timeout: 180_000 }, async t => {
  const { dataDir, cleanup } = await tempDataDir();
  t.after(cleanup);
  const child = fork(WORKER_URL, [dataDir, "dogfood-skill", "tool-entered"], { stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [] });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });

  // Collect messages until the tool-entered crash boundary.
  const boundary = await new Promise<Message>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dogfood child timeout: ${stderr}`)), 60_000);
    const onMessage = (message: unknown) => {
      if (typeof message === "object" && message !== null && (message as Message).type === "boundary") {
        clearTimeout(timer);
        child.off("message", onMessage);
        resolve(message as Message);
      } else if ((message as Message)?.type === "error" || (message as Message)?.type === "unexpected-completion") {
        clearTimeout(timer);
        child.off("message", onMessage);
        reject(new Error(`dogfood child failed early: ${JSON.stringify(message)} ${stderr}`));
      }
    };
    child.on("message", onMessage);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  assert.ok(boundary.taskId);
  child.kill("SIGKILL");
  await new Promise<void>(resolve => { child.once("exit", () => resolve()); });

  const resumed = await resumeInSecondProcess(dataDir, boundary.taskId!, true);
  assert.equal(resumed.type, "resumed", JSON.stringify(resumed));
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.receiptVerified, true, "dogfood mission must complete with a verified receipt across the crash");
  const calls = (await lines(dataDir, "calls.log")).map(line => JSON.parse(line) as { taskId: string });
  assert.equal(calls.filter(c => c.taskId === boundary.taskId).length, 2,
    "crashed attempt + resumed attempt — exactly once per process, never duplicated");
});



test("ownership attack: forged owner id and version guessing cannot write mission state", { timeout: 120_000 }, async t => {
  const { dataDir, cleanup } = await tempDataDir();
  t.after(cleanup);
  const taskId = await crashAt(t, dataDir, "after-ownership");
  // Attack during the unexpired window: forged process races takeover.
  const { child, firstMessage } = spawnChild(dataDir, "attack-forged", undefined, { taskId });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const result = await firstMessage;
  assert.equal(result.type, "attack-rejected", `forged ownership must be rejected: ${JSON.stringify(result)}`);
  // And after expiry, takeover+resume still works — the attack left no residue.
  const resume = await resumeInSecondProcess(dataDir, taskId, true);
  assert.equal(resume.type, "resumed", JSON.stringify(resume));
});

