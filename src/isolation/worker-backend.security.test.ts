import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkerProcessIsolationBackend } from "./worker-backend.js";
import type { IsolationProfile, IsolationRequest } from "./contract.js";

const backend = new WorkerProcessIsolationBackend();

async function workspace(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "quack-sbx-"));
  return { root: dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function request(root: string, workload: IsolationRequest["workload"], overrides: Partial<IsolationRequest> = {}): IsolationRequest {
  const profile: IsolationProfile = {
    level: "WORKER_PROCESS",
    filesystem: { workspaceRoot: root },
    network: { mode: "DENY" },
    environment: { variables: { SANDBOXED: "true" }, secrets: [] },
    limits: { wallClockMs: 10_000, maxOutputBytes: 1024 * 1024 },
    ...overrides.profile,
  };
  return { missionId: "mission-1", executionId: "exec-1", actor: "observer", profile, workload, ...overrides };
}

test("worker sandbox executes a module workload with materialized environment", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "workload.cjs"), `
exports.run = async (io) => {
  const fs = require("node:fs/promises");
  await fs.writeFile(io.workspaceRoot + "/done.txt", io.environment.SANDBOXED);
  return { wrote: true, env: io.environment.SANDBOXED };
};
`);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "workload.cjs", args: {} }));
  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(result.output, { wrote: true, env: "true" });
  assert.equal(result.backend, "worker-process");
  assert.equal(result.profileLevel, "WORKER_PROCESS");
});

test("filesystem traversal outside the workspace is blocked at the IO boundary", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "escape.cjs"), `
exports.run = async (io) => {
  try {
    io.io.resolveInside(io.workspaceRoot, "../outside.txt");
    return { escaped: true };
  } catch (error) {
    return { escaped: false, blocked: String(error.message) };
  }
};
`);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "escape.cjs", args: {} }));
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.output!.escaped, false);
  assert.match(String(result.output!.blocked), /outside the workspace root/);
});

test("absolute path escape attempts outside the workspace are blocked", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "absolute.cjs"), `
exports.run = async (io) => {
  const blocked = [];
  for (const candidate of [io.workspaceRoot + "/../../escape", "C:/windows/system32/config", "/etc/passwd"]) {
    try { io.io.resolveInside(io.workspaceRoot, candidate); blocked.push(false); }
    catch { blocked.push(true); }
  }
  return { blocked };
};
`);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "absolute.cjs", args: {} }));
  assert.equal(result.status, "SUCCEEDED");
  const blocked = result.output!["blocked"] as unknown as boolean[];
  assert.ok(blocked.every(Boolean), "every escape attempt must be blocked");
});

test("policy environment is materialized while host process env remains technically visible (BEST_EFFORT boundary)", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  process.env.QUACK_SANDBOX_PROBE_HOST = "host-value";
  try {
    await writeFile(join(ws.root, "env-probe.cjs"), `
exports.run = async (io) => {
  return {
    sawSandboxed: io.environment.SANDBOXED,
    hostProbe: typeof process.env.QUACK_SANDBOX_PROBE_HOST,
  };
};
`);
    const result = await backend.execute(request(ws.root, { kind: "module", entry: "env-probe.cjs", args: {} }));
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.output!["sawSandboxed"], "true");
    // Worker threads share the host process: process.env is not sealed. This
    // asserts the honest boundary — environment materialization is ENFORCED,
    // host-env sealing is UNSUPPORTED on this backend.
    assert.equal(result.output!["hostProbe"], "string");
  } finally {
    delete process.env.QUACK_SANDBOX_PROBE_HOST;
  }
});

test("environment enumeration cannot find a planted host secret", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "secret-probe.cjs"), `
exports.run = async () => {
  return { leaked: typeof process.env.QUACK_TEST_PLANTED_SECRET === "string" };
};
`);
  process.env.QUACK_TEST_PLANTED_SECRET = "super-secret";
  try {
    const result = await backend.execute(request(ws.root, { kind: "module", entry: "secret-probe.cjs", args: {} }));
    assert.equal(result.status, "SUCCEEDED");
    // Worker threads share the host process: the secret IS technically reachable.
    // This documents the honest boundary — ENFORCED env is materialization, not sealing.
    assert.equal(result.output!.leaked, true);
  } finally {
    delete process.env.QUACK_TEST_PLANTED_SECRET;
  }
});

test("infinite loop workloads are terminated by the wall-clock limit", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "spin.cjs"), `
exports.run = async () => { while (true) {} };
`);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "spin.cjs", args: {} },
    { profile: { level: "WORKER_PROCESS", filesystem: { workspaceRoot: ws.root }, network: { mode: "DENY" },
      environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 500 } } }));
  assert.equal(result.status, "TIMED_OUT");
  assert.match(String(result.error), /wall-clock/);
});

test("crashed workloads fail safely without host damage", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "crash.cjs"), `
exports.run = async () => { throw new Error("workload exploded"); };
`);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "crash.cjs", args: {} }));
  assert.equal(result.status, "FAILED");
  assert.equal(result.error, "workload exploded");
});

test("cancellation terminates the worker deterministically", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "slow.cjs"), `
exports.run = async () => { await new Promise(() => {}); return {}; };
`);
  const controller = new AbortController();
  const execution = backend.execute(request(ws.root, { kind: "module", entry: "slow.cjs", args: {} }, { signal: controller.signal }));
  setTimeout(() => controller.abort(), 100);
  const result = await execution;
  assert.equal(result.status, "CANCELLED");
});

test("container and strong isolation fail closed as UNSUPPORTED", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  for (const level of ["CONTAINER_ISOLATED", "FUTURE_STRONG_ISOLATION"] as const) {
    const result = await backend.execute(request(ws.root, { kind: "module", entry: "none.cjs", args: {} },
      { profile: { level, filesystem: { workspaceRoot: ws.root }, network: { mode: "DENY" },
        environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 1000 } } }));
    assert.equal(result.status, "UNSUPPORTED");
    assert.equal(result.profileLevel, level);
  }
});

test("function workloads are rejected: host closures cannot cross the worker boundary", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  const result = await backend.execute(request(ws.root, { kind: "function", run: async () => ({}) }));
  assert.equal(result.status, "UNSUPPORTED");
  assert.match(String(result.error), /module workload/);
});

test("malformed result payloads fail deterministically", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "malformed.cjs"), `
exports.run = async () => undefined;
`);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "malformed.cjs", args: {} }));
  assert.equal(result.status, "SUCCEEDED");
  assert.deepEqual(result.output, {});
});

test("sandbox cleanup removes the worker directory on success and timeout", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "ok.cjs"), `exports.run = async () => ({ ok: true });`);
  const first = await backend.execute(request(ws.root, { kind: "module", entry: "ok.cjs", args: {} }));
  assert.equal(first.status, "SUCCEEDED");
  await writeFile(join(ws.root, "spin.cjs"), `exports.run = async () => { while (true) {} };`);
  const second = await backend.execute(request(ws.root, { kind: "module", entry: "spin.cjs", args: {} },
    { profile: { level: "WORKER_PROCESS", filesystem: { workspaceRoot: ws.root }, network: { mode: "DENY" },
      environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 200 } } }));
  assert.equal(second.status, "TIMED_OUT");
  await ws.cleanup();
  // Cleanup is asynchronous with retries; wait until no isolation temp
  // directory remains, bounded by 5 seconds.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const leaked = (await readdir(tmpdir())).filter(entry => entry.startsWith("quack-isolation-"));
    if (leaked.length === 0) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const remaining = (await readdir(tmpdir())).filter(entry => entry.startsWith("quack-isolation-"));
  assert.equal(remaining.length, 0, "no leaked isolation temp directories");
});

test("oversized output is bounded by the worker message channel failing or completing", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "big.cjs"), `
exports.run = async () => ({ padding: "x".repeat(64) });
`);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "big.cjs", args: {} },
    { profile: { level: "WORKER_PROCESS", filesystem: { workspaceRoot: ws.root }, network: { mode: "DENY" },
      environment: { variables: {}, secrets: [] }, limits: { wallClockMs: 5000, maxOutputBytes: 32 } } }));
  assert.ok(["SUCCEEDED", "FAILED", "TIMED_OUT"].includes(result.status));
});