import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoveryFixture, type CrashBoundary } from "../test-support/recovery-child.js";
import type { RetrySafety } from "../engine/execution-recovery.js";
import type { Checkpoint } from "../engine/types.js";
import type { MissionState } from "./mission-lifecycle/mission-state-machine.js";

async function crash(t: TestContext, boundary: CrashBoundary, safety: RetrySafety = "READ_ONLY") {
  const dir = await mkdtemp(join(tmpdir(), "quack-crash-"));
  const child = fork(new URL("../test-support/recovery-child.js", import.meta.url), [dir, boundary, safety], {
    stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [],
  });
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr += String(chunk); });
  const exited = new Promise<void>(resolve => { child.once("exit", () => resolve()); });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await exited; await rm(dir, { recursive: true, force: true }); });
  const taskId = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Crash fixture timed out at ${boundary}: ${stderr}`)), 15000);
    const cleanup = () => clearTimeout(timer);
    child.once("error", error => { cleanup(); reject(error); });
    child.once("exit", () => { cleanup(); reject(new Error(`Crash fixture exited before ${boundary}: ${stderr}`)); });
    child.once("message", message => {
      cleanup();
      if (typeof message === "object" && message !== null && "type" in message && message.type === "boundary" && "taskId" in message && typeof message.taskId === "string") resolve(message.taskId);
      else reject(new Error(`Unexpected child response: ${JSON.stringify(message)} ${stderr}`));
    });
  });
  assert.ok(taskId);
  child.kill("SIGKILL");
  await exited;
  return { dir, taskId };
}

async function lines(dir: string, filename: string): Promise<string[]> {
  try { return (await readFile(join(dir, filename), "utf8")).trim().split("\n").filter(Boolean); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function mutateCheckpoint(dir: string, taskId: string, mutate: (checkpoint: Checkpoint) => void): Promise<void> {
  const tasks = JSON.parse(await readFile(join(dir, "tasks.json"), "utf8")) as {
    tasks: Array<{ id: string; execution?: { sessionId: string; workflowId: string } }>;
  };
  const execution = tasks.tasks.find(task => task.id === taskId)?.execution;
  assert.ok(execution);
  const path = join(dir, "sessions", execution.sessionId, "checkpoints.json");
  const envelope = JSON.parse(await readFile(path, "utf8")) as { version: number; checkpoints: Checkpoint[] };
  const checkpoint = envelope.checkpoints.find(value => value.workflowId === execution.workflowId);
  assert.ok(checkpoint);
  mutate(checkpoint);
  await writeFile(path, JSON.stringify(envelope));
}

for (const [boundary, expectedCalls, expectedVerifications] of [
  ["planning", 1, 1], ["planned", 1, 1], ["node-started", 1, 1], ["tool-entered", 2, 1],
  ["acknowledged", 1, 1], ["verifying", 1, 2], ["finalizing", 1, 1],
] as const) {
  test(`fresh runtime resumes after process death at ${boundary}`, { timeout: 25000 }, async t => {
    const { dir, taskId } = await crash(t, boundary);
    const fixture = recoveryFixture(dir);
    t.after(() => fixture.runtime.shutdown());
    const result = await fixture.runtime.resumeMission(taskId);
    assert.ok(result.ok, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.data.id, taskId);
    assert.equal(result.data.status, "completed");
    const calls = (await lines(dir, "calls.log")).map(line => JSON.parse(line) as { taskId: string; attemptId?: string; idempotencyKey?: string });
    assert.equal(calls.length, expectedCalls);
    assert.ok(calls.every(call => call.taskId === taskId));
    if (boundary === "tool-entered") {
      assert.ok(calls[0].idempotencyKey);
      assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
      assert.ok(calls[0].attemptId);
      assert.notEqual(calls[0].attemptId, calls[1].attemptId);
    }
    assert.equal((await lines(dir, "verification.log")).length, expectedVerifications);
    const reopened = recoveryFixture(dir);
    t.after(() => reopened.runtime.shutdown());
    const again = await reopened.runtime.resumeMission(taskId);
    assert.ok(again.ok, JSON.stringify(again));
    if (again.ok) assert.equal(again.data.status, "completed");
    assert.equal((await lines(dir, "calls.log")).length, expectedCalls);
    assert.equal((await lines(dir, "verification.log")).length, expectedVerifications);
  });
}

for (const safety of ["NON_IDEMPOTENT_WRITE", "DESTRUCTIVE", "UNKNOWN"] as const) {
  test(`ambiguous ${safety} call requires reconciliation without repeating effect`, { timeout: 25000 }, async t => {
    const { dir, taskId } = await crash(t, "tool-entered", safety);
    const fixture = recoveryFixture(dir, { safety });
    t.after(() => fixture.runtime.shutdown());
    const result = await fixture.runtime.resumeMission(taskId);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "recovery.reconciliation_required");
    assert.equal((await lines(dir, "calls.log")).length, 1);
    assert.equal((await lines(dir, "verification.log")).length, 0);
  });
}

test("retry-safe acknowledged failures use a fresh attempt under the node retry policy", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-retry-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = recoveryFixture(dir, { safety: "READ_ONLY", failAttempts: 1, maxRetries: 1 });
  t.after(() => fixture.runtime.shutdown());
  const result = await fixture.runtime.submitGoal(fixture.graph.description, "observer");
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) assert.equal(result.data.status, "completed");
  const calls = (await lines(dir, "calls.log")).map(line => JSON.parse(line) as { attemptId: string; idempotencyKey: string });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.notEqual(calls[0].attemptId, calls[1].attemptId);
});

test("retry safety is revalidated against current tool metadata", { timeout: 25000 }, async t => {
  const { dir, taskId } = await crash(t, "tool-entered", "READ_ONLY");
  const fixture = recoveryFixture(dir, { safety: "UNKNOWN" });
  t.after(() => fixture.runtime.shutdown());
  const result = await fixture.runtime.resumeMission(taskId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "recovery.reconciliation_required");
  assert.equal((await lines(dir, "calls.log")).length, 1);
});

test("recovery rechecks current capability authority before retrying", { timeout: 25000 }, async t => {
  const { dir, taskId } = await crash(t, "tool-entered", "READ_ONLY");
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());
  assert.ok(fixture.grant);
  assert.equal(fixture.grants.revokeGrant(fixture.grant!.id, { revokedBy: "test", reason: "Recovery authority revoked" }), true);
  const result = await fixture.runtime.resumeMission(taskId);
  assert.ok(result.ok, JSON.stringify(result));
  if (result.ok) assert.equal(result.data.status, "failed");
  assert.equal((await lines(dir, "calls.log")).length, 1);
  assert.equal((await lines(dir, "verification.log")).length, 0);
});

test("a durable injected session cannot resume without the runtime data directory contract", { timeout: 25000 }, async t => {
  const { dir, taskId } = await crash(t, "planned");
  const fixture = recoveryFixture(dir, { omitRuntimeDataDir: true });
  t.after(() => fixture.runtime.shutdown());
  const result = await fixture.runtime.resumeMission(taskId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "recovery.invalid_checkpoint");
  assert.equal((await lines(dir, "calls.log")).length, 0);
});

test("foreign durable evidence fails closed without replay", { timeout: 25000 }, async t => {
  const { dir, taskId } = await crash(t, "verifying");
  await mutateCheckpoint(dir, taskId, checkpoint => { Object.assign(checkpoint.recovery!.evidence!, { missionId: "foreign-mission" }); });
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());
  const result = await fixture.runtime.resumeMission(taskId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "recovery.invalid_checkpoint");
  assert.equal((await lines(dir, "calls.log")).length, 1);
  assert.equal((await lines(dir, "verification.log")).length, 1);
});

test("foreign stored verification fails closed without replay", { timeout: 25000 }, async t => {
  const { dir, taskId } = await crash(t, "finalizing");
  await mutateCheckpoint(dir, taskId, checkpoint => { Object.assign(checkpoint.recovery!.verification!.record!, { executionId: "foreign-execution" }); });
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());
  const result = await fixture.runtime.resumeMission(taskId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "recovery.invalid_checkpoint");
  assert.equal((await lines(dir, "calls.log")).length, 1);
  assert.equal((await lines(dir, "verification.log")).length, 1);
});

for (const status of ["FAILED", "CANCELLED", "TIMED_OUT"] as const satisfies readonly MissionState[]) {
  test(`terminal ${status} recovery remains terminal across restarts`, { timeout: 25000 }, async t => {
    const { dir, taskId } = await crash(t, "planned");
    await mutateCheckpoint(dir, taskId, checkpoint => { Object.assign(checkpoint.recovery!, { status }); });
    const fixture = recoveryFixture(dir);
    t.after(() => fixture.runtime.shutdown());
    const first = await fixture.runtime.resumeMission(taskId);
    assert.ok(first.ok, JSON.stringify(first));
    if (first.ok) assert.equal(first.data.status, "failed");
    const reopened = recoveryFixture(dir);
    t.after(() => reopened.runtime.shutdown());
    const second = await reopened.runtime.resumeMission(taskId);
    assert.ok(second.ok, JSON.stringify(second));
    if (second.ok) assert.equal(second.data.status, "failed");
    assert.equal((await lines(dir, "calls.log")).length, 0);
  });
}

test("checkpoint with a missing persisted budget limit fails closed", { timeout: 25000 }, async t => {
  const { dir, taskId } = await crash(t, "planned");
  await mutateCheckpoint(dir, taskId, checkpoint => { delete (checkpoint.recovery!.budget as { maxToolCalls?: number }).maxToolCalls; });
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());
  const result = await fixture.runtime.resumeMission(taskId);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "recovery.invalid_checkpoint");
  assert.equal((await lines(dir, "calls.log")).length, 0);
});

test("unsupported checkpoint version rejects repeatedly and preserves bytes", { timeout: 25000 }, async t => {
  const { dir, taskId } = await crash(t, "planned");
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());
  const task = (await fixture.runtime.listTasks()).find(task => task.id === taskId)!;
  assert.ok(task.execution);
  const path = join(dir, "sessions", task.execution!.sessionId, "checkpoints.json");
  const envelope = JSON.parse(await readFile(path, "utf8"));
  envelope.version = 999;
  const raw = JSON.stringify(envelope);
  await writeFile(path, raw);
  assert.equal((await fixture.runtime.resumeMission(taskId)).ok, false);
  assert.equal((await fixture.runtime.resumeMission(taskId)).ok, false);
  assert.equal(await readFile(path, "utf8"), raw);
  assert.equal((await lines(dir, "calls.log")).length, 0);
});

test("concurrent resume callers have one execution owner", { timeout: 25000 }, async t => {
  const { dir, taskId } = await crash(t, "planned");
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const fixture = recoveryFixture(dir, { boundary: "tool-entered", pause: async () => { entered(); await blocked; } });
  t.after(() => { release(); return fixture.runtime.shutdown(); });
  const first = fixture.runtime.resumeMission(taskId);
  await Promise.race([started, first.then(result => { throw new Error(`First resume never entered tool: ${JSON.stringify(result)}`); })]);
  const second = await fixture.runtime.resumeMission(taskId);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.error.code, "recovery.busy");
  release();
  const result = await first;
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal((await lines(dir, "calls.log")).length, 1);
});
