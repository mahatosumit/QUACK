import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContainerIsolationBackend } from "./container-backend.js";
import { IsolationBackendRegistry } from "./backend-resolver.js";
import type { IsolationProfile, IsolationRequest } from "./contract.js";

/**
 * P13 (ADR 0047) container-backend tests. Availability is
 * environment-dependent BY DESIGN: the docker daemon is probed honestly.
 * Enforcement tests run only when the daemon is actually available (opt-in
 * via QUACK_P13_CONTAINER=1 AND a reachable daemon); every other host
 * exercises the fail-closed path — which is itself a security property.
 */

const backend = new ContainerIsolationBackend();

async function containerAvailable(): Promise<boolean> {
  const availability = await backend.availability();
  if (!availability.available) return false;
  return process.env.QUACK_P13_CONTAINER === "1";
}

function profile(root: string, overrides: Partial<IsolationProfile> = {}): IsolationProfile {
  return {
    level: "CONTAINER_ISOLATED",
    filesystem: { workspaceRoot: root },
    network: { mode: "DENY" },
    environment: { variables: { SANDBOXED: "true" }, secrets: [] },
    limits: { wallClockMs: 30_000, memoryBytes: 256 * 1024 * 1024 },
    ...overrides,
  };
}

test("P13.CT-1 availability probe is honest and never throws", async () => {
  const availability = await backend.availability();
  assert.equal(typeof availability.available, "boolean");
  assert.equal(typeof availability.reason, "string");
});

test("P13.CT-2 availability is cached within its window (probe stability)", async () => {
  const first = await backend.availability();
  const second = await backend.availability();
  assert.equal(first.available, second.available);
});

test("P13.CT-3 unavailable daemon fails closed: CONTAINER_ISOLATED execution denies, never downgrades", async t => {
  const ws = { root: await mkdtemp(join(tmpdir(), "quack-ct-")), cleanup: () => rm(ws.root, { recursive: true, force: true }) };
  t.after(() => ws.cleanup());
  const availability = await backend.availability();
  if (availability.available) {
    // Daemon reachable on this host (enforcement path covered by CT-9/CT-10
    // under QUACK_P13_CONTAINER=1): the fail-closed branch cannot be
    // exercised here without lying about availability.
    t.skip("docker daemon available: fail-closed path is exercised on hosts without docker (CI windows/macos).");
    return;
  }
  // Daemon unavailable on this host: the exact CI/production case.
  const result = await backend.execute({
    missionId: "m", executionId: "e", actor: "a", profile: profile(ws.root),
    workload: { kind: "module", entry: "workload.cjs", args: {} },
  });
  assert.equal(result.status, "UNSUPPORTED", "unavailable backend reports UNSUPPORTED");
  assert.match(String(result.error), /unavailable/i);
});

test("P13.CT-4 ALLOWLIST network policy fails closed (network none is the only enforceable mode)", async t => {
  const ws = { root: await mkdtemp(join(tmpdir(), "quack-ct2-")), cleanup: () => rm(ws.root, { recursive: true, force: true }) };
  t.after(() => ws.cleanup());
  const result = await backend.execute({
    missionId: "m", executionId: "e", actor: "a",
    profile: { ...profile(ws.root), network: { mode: "ALLOWLIST", hosts: ["example.com"], schemes: ["https:"] } },
    workload: { kind: "module", entry: "workload.cjs", args: {} },
  });
  assert.equal(result.status, "UNSUPPORTED");
  assert.match(String(result.error), /ALLOWLIST networking cannot be enforced/);
});

test("P13.CT-5 secrets fail closed across the container boundary", async t => {
  const ws = { root: await mkdtemp(join(tmpdir(), "quack-ct3-")), cleanup: () => rm(ws.root, { recursive: true, force: true }) };
  t.after(() => ws.cleanup());
  const result = await backend.execute({
    missionId: "m", executionId: "e", actor: "a",
    profile: { ...profile(ws.root), environment: { variables: {}, secrets: ["API_KEY"] } },
    workload: { kind: "module", entry: "workload.cjs", args: {} },
  });
  assert.equal(result.status, "UNSUPPORTED");
});

test("P13.CT-6 resolver never selects an unavailable container backend", async t => {
  const ws = { root: await mkdtemp(join(tmpdir(), "quack-ct4-")), cleanup: () => rm(ws.root, { recursive: true, force: true }) };
  t.after(() => ws.cleanup());
  const registry = new IsolationBackendRegistry();
  registry.register(new ContainerIsolationBackend());
  const resolution = await registry.resolve("CONTAINER_ISOLATED", profile(ws.root));
  const daemonAvailable = (await backend.availability()).available;
  if (daemonAvailable) {
    assert.equal(resolution.kind, "RESOLVED");
  } else {
    // The architectural guarantee: unavailable backend → UNRESOLVED → DENY.
    assert.equal(resolution.kind, "UNRESOLVED", "unavailable container backend never resolves");
  }
});

test("P13.CT-7 guarantees are honest: container reports ENFORCED fs/network/env/process", () => {
  assert.equal(backend.guarantees.filesystem, "ENFORCED");
  assert.equal(backend.guarantees.network, "ENFORCED");
  assert.equal(backend.guarantees.environment, "ENFORCED");
  assert.equal(backend.guarantees.process, "ENFORCED");
  assert.equal(backend.guarantees.resources, "BEST_EFFORT");
  assert.equal(backend.guarantees.secrets, "UNSUPPORTED");
});

test("P13.CT-8 supported levels list only CONTAINER_ISOLATED (no weaker-level execution)", () => {
  assert.deepEqual([...backend.supportedLevels], ["CONTAINER_ISOLATED"]);
});

// ---------------------------------------------------------------------------
// Enforcement tests — run only with a live daemon AND explicit opt-in.
// CI: ubuntu runners have docker; the opt-in gate keeps developer machines
// (daemon down) on the fail-closed path instead of skipping silently.
// ---------------------------------------------------------------------------

test("P13.CT-9 container executes a module workload with sealed network and env (enforcement)", async t => {
  if (!(await containerAvailable())) { t.skip("docker daemon unavailable or not opted in (QUACK_P13_CONTAINER=1); fail-closed path covered above"); return; }
  const ws = { root: await mkdtemp(join(tmpdir(), "quack-ct5-")), cleanup: () => rm(ws.root, { recursive: true, force: true }) };
  t.after(() => ws.cleanup());
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(ws.root, "net-probe.cjs"), `
    exports.run = async (io) => {
      const probe = await fetch("http://example.com").then(() => "reachable", (error) => String(error.cause?.code ?? error.message));
      return { network: probe, env: io.environment.SANDBOXED };
    };
  `);
  const result = await backend.execute({
    missionId: "m", executionId: "e", actor: "a", profile: profile(ws.root),
    workload: { kind: "module", entry: "net-probe.cjs", args: {} },
  });
  assert.equal(result.status, "SUCCEEDED");
  // --network none: fetch must NOT reach example.com.
  assert.notEqual(result.output!["network"], "reachable", "network namespace must seal outbound traffic");
  assert.equal(result.output!["env"], "true");
});

test("P13.CT-10 container memory limit is kernel-enforced (OOM kills excess allocation)", async t => {
  if (!(await containerAvailable())) { t.skip("docker daemon unavailable or not opted in"); return; }
  const ws = { root: await mkdtemp(join(tmpdir(), "quack-ct6-")), cleanup: () => rm(ws.root, { recursive: true, force: true }) };
  t.after(() => ws.cleanup());
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(ws.root, "oom.cjs"), `
    exports.run = async () => {
      const blocks = [];
      while (true) blocks.push(Buffer.alloc(64 * 1024 * 1024));
    };
  `);
  const result = await backend.execute({
    missionId: "m", executionId: "e", actor: "a",
    profile: { ...profile(ws.root), limits: { wallClockMs: 60_000, memoryBytes: 128 * 1024 * 1024 } },
    workload: { kind: "module", entry: "oom.cjs", args: {} },
  });
  // Kernel OOM kill: the workload cannot exceed its memory limit.
  assert.ok(["FAILED", "TIMED_OUT"].includes(result.status), `memory-exceeding workload terminated, got ${result.status}`);
});
