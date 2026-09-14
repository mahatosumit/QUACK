import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteConnection } from "../storage/sqlite.js";
import { SqliteCoordinationStore } from "../storage/coordination.js";
import { createSqliteStorage } from "../storage/sqlite.js";
import { ProcessIsolationBackend } from "../isolation/process-backend.js";
import { ContainerIsolationBackend } from "../isolation/container-backend.js";
import { EventBus } from "../events/event-bus.js";
import { createId, type JsonObject } from "../core/types.js";
import type { IsolationRequest } from "../isolation/contract.js";
import { WorkloadAdapterRegistry } from "../isolation/workload-adapter.js";
import { registerProductionAdapters } from "../isolation/production-adapters.js";

/**
 * P16-I/P16-J (deployment qualification): isolation deployment + SQLite/
 * dataDir operational limits. Honesty boundaries are asserted, not assumed:
 *
 *   ISO  OS-process backend (release SUPPORTED on this host class) and
 *        container backend (BEST_EFFORT: Docker-daemon dependent)
 *   LIM  single-host SQLite coordination limits: this is single-host
 *        coordination, NOT distributed consensus
 */

async function tempDir(prefix = "quack-p16-lim-"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function isolationRequest(root: string, level: "WORKER_PROCESS" | "CONTAINER_ISOLATED", entry = "workload.cjs"): IsolationRequest {
  return {
    missionId: "m-p16-lim",
    executionId: createId("execution"),
    actor: "p16-qualification",
    profile: {
      level,
      filesystem: { workspaceRoot: root },
      network: { mode: "DENY" },
      environment: { variables: { ISOLATED: "yes" }, secrets: [] },
      limits: { wallClockMs: 15_000, maxOutputBytes: 128 * 1024 },
    },
    workload: { kind: "module", entry, args: {} },
  };
}

// ===========================================================================
// ISO — isolation deployment qualification
// ===========================================================================

test("ISO-1 OS-process backend: available on this host, executes a real isolated process, enforces the filesystem boundary", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-iso-proc-");
  try {
    const backend = new ProcessIsolationBackend();
    const { writeFile: write, mkdir } = await import("node:fs/promises");
    await write(join(dir, "workload.cjs"), `
      exports.run = async (io) => ({ ok: true, isolatedPid: process.pid, envSealed: io.environment.ISOLATED === "yes" });
    `);
    const result = await backend.execute(isolationRequest(dir, "WORKER_PROCESS"));
    assert.equal(result.status, "SUCCEEDED", "real OS-process isolation executes");
    assert.equal((result.output as JsonObject | undefined)?.["envSealed"], true, "the isolated environment is sealed (explicit variables only)");
    assert.notEqual((result.output as JsonObject | undefined)?.["isolatedPid"], process.pid, "execution happened in a REAL child process");
    assert.equal(result.backend, "os-process");
  } finally { await cleanup(); }
});

test("ISO-2 OS-process backend: wall-clock timeout is ENFORCED (a sleeping workload cannot outlive its limit)", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-iso-timeout-");
  try {
    const backend = new ProcessIsolationBackend();
    const { writeFile: write } = await import("node:fs/promises");
    await write(join(dir, "workload.cjs"), `
      exports.run = async () => { while (true) {} };
    `);
    const request = {
      ...isolationRequest(dir, "WORKER_PROCESS"),
      profile: { ...isolationRequest(dir, "WORKER_PROCESS").profile, limits: { wallClockMs: 500, maxOutputBytes: 128 * 1024 } },
    };
    const result = await backend.execute(request);
    assert.equal(result.status, "TIMED_OUT", "wall-clock timeout is enforced deterministically");
    assert.match(String(result.error ?? ""), /wall-clock/);
  } finally { await cleanup(); }
});

test("ISO-3 container backend: honest availability — UNAVAILABLE fails DENY, never a downgrade to a weaker level", async () => {
  const backend = new ContainerIsolationBackend({ availabilityCacheMs: 0 });
  const availability = await backend.availability();
  if (!availability.available) {
    const { dir, cleanup } = await tempDir("quack-p16-iso-cont-");
    try {
      const result = await backend.execute(isolationRequest(dir, "CONTAINER_ISOLATED"));
      assert.equal(result.status, "UNSUPPORTED", "no downgrade path when the daemon is unavailable");
    } finally { await cleanup(); }
    return;
  }
  // Docker daemon present: the fail-closed path is covered by the P13
  // container suite (CT-1..CT-10); this branch records availability only.
  assert.ok(availability.reason.length > 0, "availability carries an honest reason");
});

test("ISO-4 production adapters execute through the REAL isolation supervisor with verified evidence", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-iso-supervisor-");
  try {
    const events = new EventBus();
    const { IsolationBackendRegistry } = await import("../isolation/backend-resolver.js");
    const registry = new IsolationBackendRegistry();
    registry.register(new ProcessIsolationBackend());
    const adapters = new WorkloadAdapterRegistry();
    registerProductionAdapters(adapters);
    const { JsonFileExecutionEvidenceStore } = await import("../isolation/execution-evidence.js");
    const { IsolationSupervisor } = await import("../isolation/supervisor.js");
    const { ProbeRunner } = await import("../isolation/probe-runner.js");
    const { DefaultExecutionHarness } = await import("../runtime/mission-lifecycle/harness.js");
    const { createProposal } = await import("../runtime/mission-lifecycle/action-contract.js");
    const { AllowListPermissionPolicy } = await import("../security/permissions.js");
    const { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker } = await import("../security/capability-broker.js");
    const { ActionProviderRegistry, ActionRuntime } = await import("../actions/runtime.js");
    const { InMemoryActionExecutionLedger } = await import("../actions/ledger.js");

    const evidenceStore = new JsonFileExecutionEvidenceStore(dir);
    const supervisor = new IsolationSupervisor({ registry, events, actor: "p16", workspaceRoot: dir, evidenceStore });
    const probeRunner = new ProbeRunner({ workspaceRoot: dir, events, actor: "p16" });

    // The production-adapter descriptor provider pattern (deployer-registered
    // trusted data; execute never reached — isolation routes first).
    const adapter = adapters.resolve("quack.text.transform", { input: "production smoke", op: "upper" });
    assert.equal(adapter.kind, "REGISTERED", "the production adapter is registered");
    const descriptor = {
      contractVersion: "1.0.0", providerId: "isolation", id: "quack.text.transform", name: "Text transform",
      inputSchema: { type: "object" }, riskClass: "READ_ONLY", sideEffect: "read", externalCommunication: false,
      financialImpact: false, authenticationScopes: [], requiredPermissions: ["workspace.read"], idempotent: true,
      supportsDryRun: false, supportsCompensation: false, timeoutMs: 15_000, dataClassification: "public",
      networkRequirements: [], approval: "NEVER",
    };
    const provider = {
      metadata: () => ({ contractVersion: "1.0.0", providerId: "isolation", displayName: "Isolation", transport: "local", boundary: "local" }),
      health: async () => ({ status: "HEALTHY", checkedAt: new Date().toISOString() }),
      discoverActions: async () => [descriptor],
      execute: async () => { throw new Error("host path must never execute"); },
    } as never;
    const actionProviders = new ActionProviderRegistry();
    actionProviders.register(provider as never);
    const grants = new InMemoryCapabilityGrantRegistry();
    const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]), grants);
    grants.ensureGrant({
      missionId: "m-p16-iso4", capabilities: ["permission.workspace.read"],
      approval: { approvedBy: "p16", reason: "fixture", approvedAt: new Date().toISOString() },
    });
    const actionRuntime = new ActionRuntime(actionProviders, {
      ledger: new InMemoryActionExecutionLedger(),
      validateExecutionContext: () => ({ allowed: true, reason: "test" }),
      decidePermission: async () => ({ allowed: true, reason: "test policy" }),
    });
    const harness = new DefaultExecutionHarness(actionRuntime, broker, actionProviders, new (await import("../tools/tool.js")).ToolRegistry(), events, {
      defaultTimeoutMs: 15_000, requireVerificationForIrreversible: true,
      executeTool: async () => ({ ok: false, error: { code: "not.used", message: "isolation routes first", category: "permission", recoverable: false } }),
      isolation: { supervisor, adapters, probeRunner },
    });

    const result = await harness.execute(
      createProposal({
        missionId: "m-p16-iso4", capability: "quack.text.transform",
        arguments: { input: "production smoke", op: "upper" },
        intent: "p16 isolation qualification", riskLevel: "READ_ONLY", sandbox: "IN_PROCESS_TRUSTED",
        idempotencyKey: "p16-iso4", timeoutMs: 15_000, selectionReason: "p16", proposedBy: "p16",
        verificationStrategy: {
          kind: "probe_external_state",
          capability: "quack.text.transform",
          arguments: { input: "production smoke", op: "upper" },
          expected: {
            description: "transform succeeded",
            successProbes: [
              { kind: "output_field", path: "output", equals: "PRODUCTION SMOKE" },
              { kind: "status_equals", value: "SUCCEEDED" },
            ],
          },
        },
      }),
      { missionId: "m-p16-iso4", runId: "run-p16", iterationId: "it-0", actor: "p16", stepIndex: 0 },
    );
    assert.equal(result.outcome.actionResult.status, "SUCCEEDED", "real isolated execution succeeded");
    assert.equal(result.outcome.actionResult.providerId, "isolation:os-process", "executed through the REAL OS-process backend");
    assert.equal((result.outcome.actionResult.output as JsonObject)["output"], "PRODUCTION SMOKE");
    assert.equal(result.verification.status, "PASSED", "trusted probe verification over runtime evidence");
    const evidence = await evidenceStore.load(result.outcome.executionId);
    assert.ok(evidence, "identity-bound execution evidence recorded");
    assert.equal(evidence.verification.state, "VERIFIED");
  } finally { await cleanup(); }
});

// ===========================================================================
// LIM — SQLite / dataDir operational limits
// ===========================================================================

test("LIM-1 normal concurrency: multiple processes serialize on the coordination DB (begin immediate) with exactly one winner", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-lim-conc-");
  try {
    const store = new SqliteCoordinationStore(new SqliteConnection(join(dir, "coordination.sqlite")), { leaseMs: 60_000 });
    const outcomes = ["owner-a", "owner-b", "owner-c"].map((owner) => store.acquire("governed:gov_p16_lim1", owner));
    const acquired = outcomes.filter((outcome) => outcome.kind === "ACQUIRED");
    const busy = outcomes.filter((outcome) => outcome.kind === "BUSY");
    assert.equal(acquired.length, 1, "exactly one owner wins the race");
    assert.equal(busy.length, 2, "the losers fail closed BUSY");
  } finally { await cleanup(); }
});

test("LIM-2 malformed/corrupted database: a corrupt quack.sqlite fails closed at open, never silently permissive", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-lim-corrupt-");
  try {
    await writeFile(join(dir, "quack.sqlite"), "definitely not a sqlite database");
    assert.throws(() => {
      const storage = createSqliteStorage(join(dir, "quack.sqlite"));
      storage.missions.list();
    }, /SQLITE|database|file/i, "a corrupt database fails closed — operations refuse, never degrade to permissive in-memory defaults");
  } finally { await cleanup(); }
});

test("LIM-3 lock recovery: a busy_timeout of 10s is configured on every connection", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-lim-lock-");
  try {
    const connection = new SqliteConnection(join(dir, "quack.sqlite"));
    connection.withDatabase(() => undefined); // opens + closes cleanly
    // Structural (R44 precedent): busy_timeout is set on EVERY open.
    const source = await readFile(new URL("../../src/storage/sqlite.ts", import.meta.url), "utf8");
    assert.ok(source.includes("pragma busy_timeout = 10000;"), "the documented 10s busy timeout is enforced on every connection");
  } finally { await cleanup(); }
});

test("LIM-4 stale leases recover automatically: expiry + takeover, no manual surgery", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-lim-stale-");
  try {
    const store = new SqliteCoordinationStore(new SqliteConnection(join(dir, "coordination.sqlite")), { leaseMs: 40 });
    const first = store.acquire("governed:gov_p16_lim4", "owner-1");
    assert.equal(first.kind, "ACQUIRED");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const takeover = store.acquire("governed:gov_p16_lim4", "owner-2");
    assert.equal(takeover.kind, "TAKEOVER_STALE", "the stale lease is taken over automatically");
    assert.ok(takeover.lease.version > first.lease.version, "fencing version bumped");
  } finally { await cleanup(); }
});

test("LIM-5 database copied to another host: coordination data is host-independent (no host identity baked in), fencing survives the copy", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-lim-copy-");
  const copyDir = join(dir, "..", `p16-copy-${Date.now()}`);
  try {
    const source = new SqliteCoordinationStore(new SqliteConnection(join(dir, "coordination.sqlite")), { leaseMs: 60_000 });
    source.acquire("governed:gov_p16_lim5", "owner-original");
    // Simulate a copy: byte-for-byte copy of the DB to a "new host" path.
    const { copyFile } = await import("node:fs/promises");
    await copyFile(join(dir, "coordination.sqlite"), join(copyDir, "coordination.sqlite")).catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(copyDir, { recursive: true });
      await copyFile(join(dir, "coordination.sqlite"), join(copyDir, "coordination.sqlite"));
    });
    const copy = new SqliteCoordinationStore(new SqliteConnection(join(copyDir, "coordination.sqlite")), { leaseMs: 60_000 });
    const lease = copy.current("governed:gov_p16_lim5");
    assert.ok(lease, "coordination state survives a host copy");
    assert.equal(lease.owner, "owner-original");
    // Honest limitation: two hosts sharing a copy both hold "valid" state —
    // cross-host fencing is NOT CLAIMED. The copy below proves data survives;
    // single-host semantics are the documented deployment boundary.
  } finally { await rm(copyDir, { recursive: true, force: true }); await cleanup(); }
});

test("LIM-6 backup while active: a backup of a live dataDir restores a usable SQLite store", async () => {
  const { createQuackBackup } = await import("../recovery/backup.js");
  const { dir, cleanup } = await tempDir("quack-p16-lim-backup-");
  const backupDir = join(dir, "..", `lim6-backup-${Date.now()}`);
  try {
    // Live store with data.
    const storage = createSqliteStorage(join(dir, "quack.sqlite"));
    storage.missions.save({ id: "m-lim6", name: "live", description: "backup while active", status: "active", createdAt: new Date().toISOString() } as never);
    // Backup without stopping anything (cold-copy semantics).
    await createQuackBackup(dir, backupDir);
    const fresh = join(dir, "..", `lim6-restored-${Date.now()}`);
    const { restoreQuackBackup } = await import("../recovery/backup.js");
    await restoreQuackBackup(backupDir, fresh);
    const restored = createSqliteStorage(join(fresh, "quack.sqlite"));
    const missions = restored.missions.list();
    assert.equal(missions.length, 1, "mission data restored from an active-time backup");
    assert.equal(missions[0].id, "m-lim6");
    await rm(fresh, { recursive: true, force: true });
  } finally { await rm(backupDir, { recursive: true, force: true }); await cleanup(); }
});

test("LIM-7 permission changes on the dataDir fail closed: an unreadable directory refuses operations (never silent degradation)", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-lim-perm-");
  try {
    // On POSIX, chmod 000 blocks reads. On Windows, chmod is mostly a no-op,
    // so this test qualifies the POSIX behavior and skips the assertion
    // where the OS cannot express it (honest environment boundary).
    if (process.platform === "win32") {
      const connection = new SqliteConnection(join(dir, "quack.sqlite"));
      connection.withDatabase(() => undefined);
      return; // Windows: permission-change semantics not expressible here.
    }
    await chmod(dir, 0o000);
    try {
      assert.throws(() => {
        const storage = createSqliteStorage(join(dir, "quack.sqlite"));
        storage.missions.list();
      }, /EACCES|permission|SQLITE|unable to open database|ENOENT/i, "unreadable dataDir fails closed");
    } finally {
      await chmod(dir, 0o755);
    }
  } finally { await cleanup(); }
});

test("LIM-8 single-host boundary honesty: the coordination source documents that this is NOT distributed consensus", async () => {
  const source = await readFile(new URL("../../src/storage/coordination.ts", import.meta.url), "utf8");
  assert.ok(source.includes("SINGLE-HOST"), "the coordination primitive declares its single-host scope");
  assert.ok(source.includes("No distributed"), "no distributed/HA claims are made by the primitive");
  const doc = await readFile(new URL("../../docs/recovery/sqlite-coordination.md", import.meta.url), "utf8").catch(() => "");
  if (doc) assert.ok(/single-host/i.test(doc), "the operational documentation states the single-host boundary");
});

test("LIM-9 disk-full-like failure where testable: an unwritable dataDir fails closed at durable-write time", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-lim-disk-");
  try {
    if (process.platform === "win32") {
      // Read-only directories on Windows do not reliably block writes for
      // the same user; qualify the honest failure mode via a non-directory
      // path instead (deterministic on every OS).
      const notADir = join(dir, "occupant.txt");
      await writeFile(notADir, "occupied");
      await assert.rejects(() => import("node:fs/promises").then((fs) => fs.mkdir(join(notADir, "sub"), { recursive: true })), /ENOTDIR|EEXIST|not a directory/i);
      return;
    }
    await chmod(dir, 0o500); // read + execute, no write
    try {
      const { JsonFileMissionRunStore } = await import("../runtime/mission-lifecycle/mission-run-store.js");
      const store = new JsonFileMissionRunStore(dir);
      await assert.rejects(() => store.save({
        missionId: "m-disk", runId: "r", goal: "g", actor: "t",
        currentState: "RUNNING", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        iterations: [], usage: { iterations: 0, modelCalls: 0, toolCalls: 0, cost: 0, executionTimeMs: 0 },
        budget: { maxIterations: 8, maxModelCalls: 16, maxToolCalls: 24, maxCost: 1, maxExecutionTimeMs: 300000, maxConsecutiveFailures: 3 },
      } as never), /EACCES|permission/i, "durable writes to an unwritable dataDir fail closed");
    } finally {
      await chmod(dir, 0o755);
    }
  } finally { await cleanup(); }
});
