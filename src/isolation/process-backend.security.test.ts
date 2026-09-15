import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readdir, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessIsolationBackend } from "./process-backend.js";
import { IsolationBackendRegistry } from "./backend-resolver.js";
import type { IsolationProfile, IsolationRequest } from "./contract.js";

/**
 * P13 (ADR 0047) process-backend behavior tests. These exercise REAL OS
 * process isolation: the child is a separate process with a sealed
 * environment block, and every guarantee asserted here is enforced by the
 * boundary, not by a label.
 */

const backend = new ProcessIsolationBackend();

async function workspace(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "quack-proc-sbx-"));
  return { root: dir, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

function profile(root: string, overrides: Partial<IsolationProfile> = {}): IsolationProfile {
  return {
    level: "WORKER_PROCESS",
    filesystem: { workspaceRoot: root },
    network: { mode: "DENY" },
    environment: { variables: { SANDBOXED: "true" }, secrets: [] },
    limits: { wallClockMs: 15_000 },
    ...overrides,
  };
}

function request(root: string, workload: IsolationRequest["workload"], overrides: Partial<IsolationRequest> = {}): IsolationRequest {
  return { missionId: "mission-1", executionId: "exec-1", actor: "observer", profile: profile(root), workload, ...overrides };
}

test("P13.PROC-1 child process executes a module workload with materialized environment", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "workload.cjs"), `
    exports.run = async (io) => ({ saw: io.environment.SANDBOXED, cwd: process.cwd() });
  `);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "workload.cjs", args: {} }));
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.output!["saw"], "true");
  // cwd is the isolated workspace root: the child cannot even NAME other dirs by accident.
  // macOS reports the realpath (/var/folders → /private/var/folders); both
  // spellings denote the same isolated directory.
  const cwd = String(result.output!["cwd"]);
  assert.ok(cwd === ws.root || cwd === realpathSync(ws.root), `cwd must be the isolated workspace root (got ${cwd})`);
});

test("P13.PROC-2 host secrets are SEALED: planted values are not inherited (OS env boundary)", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "probe.cjs"), `
    exports.run = async (io) => ({
      leakedPlanted: typeof process.env.QUACK_P13_PLANTED_SECRET,
      leakedCustom: typeof process.env.QUACK_P13_CUSTOM_VALUE,
      sawPolicy: io.environment.SANDBOXED,
      envKeys: Object.keys(process.env).join(","),
    });
  `);
  process.env.QUACK_P13_PLANTED_SECRET = "super-secret-value";
  process.env.QUACK_P13_CUSTOM_VALUE = "custom-host-value";
  try {
    const result = await backend.execute(request(ws.root, { kind: "module", entry: "probe.cjs", args: {} }));
    assert.equal(result.status, "SUCCEEDED");
    // REAL process boundary: the child's env block contains the policy
    // variables and OS-required identity variables only — planted host
    // secrets and custom host values are ABSENT.
    assert.equal(result.output!["leakedPlanted"], "undefined", "planted host secret must not cross the process env boundary");
    assert.equal(result.output!["leakedCustom"], "undefined", "custom host value must not cross the process env boundary");
    assert.equal(result.output!["sawPolicy"], "true");
    // Windows injects OS-identity variables (SYSTEMROOT, default system
    // PATH, TEMP...) into every child process regardless of the passed
    // environment; those are platform-required, not host secrets. macOS
    // likewise injects CoreFoundation encoding identity. Node injects
    // NODE_V8_COVERAGE into every child when the TEST RUNNER itself runs
    // under coverage (runner instrumentation, not a host variable).
    // Assert the child env is bounded to these OS/runner identity classes:
    // no user variables beyond QUACK runner internals appear.
    const keys = String(result.output!["envKeys"]).split(",");
    const allowed = new Set(["QUACK_ISOLATION_SPEC", "NODE_OPTIONS", "NODE_ENV", "NODE_V8_COVERAGE", "__CF_USER_TEXT_ENCODING", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "PATH", "TEMP", "TMP", "HOMEDRIVE", "HOMEPATH", "HOMEDIR", "HOME", "USERDOMAIN", "USERNAME", "USERPROFILE", "LOGONSERVER", "COMSPEC", "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA"]);
    const unexpected = keys.filter(key => !allowed.has(key));
    assert.deepEqual(unexpected, [], `unexpected env keys crossed the boundary: ${unexpected.join(",")}`);
  } finally {
    delete process.env.QUACK_P13_PLANTED_SECRET;
    delete process.env.QUACK_P13_CUSTOM_VALUE;
  }
});

test("P13.PROC-3 secret-demanding profiles fail closed (no secret mediation across the boundary)", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "x.cjs", args: {} }, {
    profile: { ...profile(ws.root), environment: { variables: {}, secrets: ["API_KEY"] } },
  }));
  assert.equal(result.status, "UNSUPPORTED");
  assert.match(String(result.error), /failing closed/);
});

test("P13.PROC-4 network policy beyond DENY fails closed (honest UNSUPPORTED, no pretend allowlist)", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "x.cjs", args: {} }, {
    profile: { ...profile(ws.root), network: { mode: "ALLOWLIST", hosts: ["example.com"], schemes: ["https:"] } },
  }));
  assert.equal(result.status, "UNSUPPORTED");
  assert.match(String(result.error), /failing closed/);
});

test("P13.PROC-5 wall-clock timeout terminates the child process tree deterministically", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "spin.cjs"), `exports.run = async () => { while (true) {} };`);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "spin.cjs", args: {} }, {
    profile: { ...profile(ws.root), limits: { wallClockMs: 800 } },
  }));
  assert.equal(result.status, "TIMED_OUT");
  assert.match(String(result.error), /wall-clock/);
});

test("P13.PROC-6 cancellation terminates the child and settles CANCELLED", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  // A pending-timer workload keeps the child's event loop alive, so only
  // the supervisor's cancel decision can end it.
  await writeFile(join(ws.root, "slow.cjs"), `exports.run = async () => { await new Promise((resolve) => setTimeout(resolve, 60_000)); };`);
  const controller = new AbortController();
  const execution = backend.execute(request(ws.root, { kind: "module", entry: "slow.cjs", args: {} }, { signal: controller.signal }));
  setTimeout(() => controller.abort(new Error("operator cancel")), 200);
  const result = await execution;
  assert.equal(result.status, "CANCELLED");
});

test("P13.PROC-7 crashed workloads fail safely in their own process", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "crash.cjs"), `exports.run = async () => { throw new Error("workload exploded"); };`);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "crash.cjs", args: {} }));
  assert.equal(result.status, "FAILED");
  assert.equal(result.error, "workload exploded");
});

test("P13.PROC-8 traversal in the entry path is rejected before spawn", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await assert.rejects(
    () => backend.execute(request(ws.root, { kind: "module", entry: "../outside.cjs", args: {} })),
    /outside the workspace root|does not exist/,
  );
});

test("P13.PROC-9 function workloads are rejected: host closures cannot cross the process boundary", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  const result = await backend.execute(request(ws.root, { kind: "function", run: async () => ({}) }));
  assert.equal(result.status, "UNSUPPORTED");
  assert.match(String(result.error), /module workload/);
});

test("P13.PROC-10 IO-boundary validation blocks path traversal inside the workload", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "escape.cjs"), `
    exports.run = async (io) => {
      try { io.io.resolveInside(io.workspaceRoot, "../outside.txt"); return { escaped: true }; }
      catch (error) { return { escaped: false, blocked: String(error.message) }; }
    };
  `);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "escape.cjs", args: {} }));
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.output!["escaped"], false);
});

test("P13.PROC-11 oversized output is dropped at the containment boundary (never previewed)", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "big.cjs"), `exports.run = async () => ({ blob: "x".repeat(4096) });`);
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "big.cjs", args: {} }, {
    profile: { ...profile(ws.root), limits: { wallClockMs: 15_000, maxOutputBytes: 64 } },
  }));
  // Output larger than the cap: stdout truncation flips → FAILED with the
  // containment message; the blob content never reaches the runtime.
  assert.ok(["FAILED", "SUCCEEDED"].includes(result.status));
  if (result.status === "SUCCEEDED") {
    assert.equal(JSON.stringify(result.output).includes("xxxx"), false, "oversized content never previewed");
  } else {
    assert.match(String(result.error), /containment|no result|JSON/);
  }
});

test("P13.PROC-12 runner temp directories are cleaned on every terminal path", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  await writeFile(join(ws.root, "ok.cjs"), `exports.run = async () => ({ ok: true });`);
  // The invariant: THIS backend instance cleans the runner directory it
  // creates for each execution. (A whole-tmpdir sweep is not assertable in
  // parallel runs — other suites legitimately run their own process-backed
  // workloads concurrently, and their in-flight dirs are not leaks.)
  const before = new Set((await readdir(tmpdir())).filter(entry => entry.startsWith("quack-isolation-proc-")));
  const result = await backend.execute(request(ws.root, { kind: "module", entry: "ok.cjs", args: {} }));
  assert.equal(result.status, "SUCCEEDED");
  // Give the async rm in the finally-path a bounded settle window.
  let leaked: string[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 25));
    leaked = (await readdir(tmpdir())).filter(entry => entry.startsWith("quack-isolation-proc-") && !before.has(entry));
    if (leaked.length === 0) break;
  }
  assert.equal(leaked.length, 0, "no leaked process-backend temp directories created by this execution");
});

// ---------------------------------------------------------------------------
// Resolver negotiation (P13.3): capability match + fail-closed behavior.
// ---------------------------------------------------------------------------

test("P13.RES-1 resolver selects the available backend that supports the level", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const resolution = await registry.resolve("WORKER_PROCESS", profile(ws.root));
  assert.equal(resolution.kind, "RESOLVED");
  if (resolution.kind === "RESOLVED") assert.equal(resolution.backend.id, "os-process");
});

test("P13.RES-2 required level with no supporting backend fails closed UNRESOLVED", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const resolution = await registry.resolve("CONTAINER_ISOLATED", { ...profile(ws.root), level: "CONTAINER_ISOLATED" });
  assert.equal(resolution.kind, "UNRESOLVED", "no silent downgrade to process level");
});

test("P13.RES-3 empty registry is UNRESOLVED for any isolation requirement", async t => {
  const ws = await workspace();
  t.after(ws.cleanup);
  const registry = new IsolationBackendRegistry();
  const resolution = await registry.resolve("WORKER_PROCESS", profile(ws.root));
  assert.equal(resolution.kind, "UNRESOLVED");
});

test("P13.RES-4 executeIsolated refuses an UNRESOLVED resolution (never execute on denial)", async () => {
  const registry = new IsolationBackendRegistry();
  const resolution = await registry.resolve("WORKER_PROCESS", profile("C:/nonexistent-root-xyz"));
  assert.equal(resolution.kind, "UNRESOLVED");
  await assert.rejects(
    () => import("./backend-resolver.js").then(m => m.executeIsolated(resolution, {} as never)),
    /RESOLVED/,
  );
});

test("P13.RES-5 backend availability is honest: probe reports and never throws", async () => {
  const availability = await backend.availability();
  assert.equal(availability.available, true);
  assert.equal(typeof availability.reason, "string");
});
