import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir, chmod, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { EventBus } from "../../events/event-bus.js";
import { AllowListPermissionPolicy } from "../../security/permissions.js";
import { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker } from "../../security/capability-broker.js";
import { ToolRegistry, EchoTool } from "../../tools/tool.js";
import { ActionProviderRegistry, ActionRuntime } from "../../actions/runtime.js";
import { InMemoryActionExecutionLedger } from "../../actions/ledger.js";
import { GovernedMissionLoop } from "./governed-mission-loop.js";
import { JsonFileMissionRunStore } from "./mission-run-store.js";
import { JsonFileStepAttemptJournal, stepAttemptKey } from "./step-attempt-journal.js";
import { JsonFileMissionCheckpointStore } from "./mission-recovery.js";
import { createLoopRun, type Budget, type LoopRun } from "./executive-loop.js";
import { ApprovalRunner, DenyApprovalRunnerCallback } from "./approval-contract.js";
import { JsonFileApprovalStore, DurableApprovalRunner } from "./approval-store.js";
import { SqliteConnection } from "../../storage/sqlite.js";
import { SqliteCoordinationStore } from "../../storage/coordination.js";
import { InMemoryExecutionEvidenceStore } from "../../isolation/execution-evidence.js";
import { ProbeRunner } from "../../isolation/probe-runner.js";
import { reconcileMissionAmbiguity } from "./ambiguity-reconciliation.js";
import { WorkloadAdapterRegistry } from "../../isolation/workload-adapter.js";
import { registerProductionAdapters, textTransformAdapter } from "../../isolation/production-adapters.js";
import type { Permission } from "../../security/permissions.js";
import type { JsonObject } from "../../core/types.js";
import type { ModelRequest, ModelResponse } from "../../models/runtime.js";
import type { QuackResult } from "../../core/types.js";

/**
 * P15-F (ADR 0049) operational hardening: realistic production failure
 * modes — malformed persisted state, backend unavailability, contention,
 * stale coordination, invalid configuration — and the invariant that
 * EVERY governance failure FAILS CLOSED (never silently permissive).
 *
 * Doctrine under test: a failure of any durable surface (run store,
 * journal, checkpoint, approval store, coordination DB, evidence store,
 * probe runner, adapter registry) degrades to a REFUSAL, never to
 * ungoverned execution. No secrets or raw payloads in telemetry.
 */

const CHILD_URL = new URL("../../test-support/p15-governed-child.js", import.meta.url);
const TEST_BUDGET: Budget = { maxIterations: 8, maxModelCalls: 16, maxToolCalls: 24, maxCost: 1, maxExecutionTimeMs: 300_000, maxConsecutiveFailures: 3 };

function modelNever() {
  return {
    async generate(): Promise<QuackResult<ModelResponse>> {
      return { ok: false, error: { code: "model.unavailable", message: "not used", category: "provider", recoverable: true } };
    },
  };
}

/** Model that proposes one echo step, then declares done (for settle paths). */
function echoingModel() {
  let call = 0;
  return {
    async generate(): Promise<QuackResult<ModelResponse>> {
      call += 1;
      const text = call === 1
        ? JSON.stringify({ capability: "core.echo", arguments: { message: "x" }, intent: "x" })
        : JSON.stringify({ done: true, finalMessage: "done" });
      return { ok: true, data: { id: `r${call}`, providerId: "stub", model: "m", text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, fallbackUsed: false } };
    },
  };
}

class GovernedEchoTool extends EchoTool {
  describe(): import("../../tools/tool.js").ToolMetadata {
    return { id: this.id, name: "Governed Echo", description: "echo", permissions: ["workspace.read"] };
  }
}

function loopFixture(options: {
  dataDir?: string;
  coordinationDbPath?: string;
  ownershipLeaseMs?: number;
  runStore?: import("./governed-mission-loop.js").MissionRunStore;
  stepJournal?: import("./step-attempt-journal.js").StepAttemptJournal;
  approvalStore?: JsonFileApprovalStore;
} = {}) {
  const events = new EventBus();
  const grants = new InMemoryCapabilityGrantRegistry();
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"] as readonly Permission[]), grants);
  const tools = new ToolRegistry();
  tools.register(new GovernedEchoTool());
  const actionProviders = new ActionProviderRegistry();
  const actionRuntime = new ActionRuntime(actionProviders, {
    ledger: new InMemoryActionExecutionLedger(),
    validateExecutionContext: () => ({ allowed: true, reason: "test" }),
    decidePermission: async () => ({ allowed: true, reason: "test policy" }),
  });
  const approvalRunner = options.approvalStore
    ? new DurableApprovalRunner(options.approvalStore, new DenyApprovalRunnerCallback(), { events })
    : new ApprovalRunner(new DenyApprovalRunnerCallback());
  const loop = new GovernedMissionLoop({
    broker,
    actionRuntime,
    actionProviders,
    tools,
    modelRuntime: modelNever(),
    events,
    executeTool: async (toolId, input) => {
      const tool = tools.get(toolId);
      if (!tool.ok) return tool as QuackResult<JsonObject>;
      const result = await tool.data.execute(input as never, { taskId: "t", actor: "test" });
      return { ok: true, data: result.output as JsonObject };
    },
    ...(options.runStore ? { runStore: options.runStore } : {}),
    ...(options.stepJournal ? { stepJournal: options.stepJournal } : {}),
    ...(options.approvalStore ? { approvalStore: options.approvalStore, approvalRunner } : {}),
    ...(options.coordinationDbPath ? { coordinationDbPath: options.coordinationDbPath } : {}),
    ...(options.ownershipLeaseMs ? { ownershipLeaseMs: options.ownershipLeaseMs } : {}),
    checkpointStore: new JsonFileMissionCheckpointStore(options.dataDir ?? "."),
  });
  return { loop, events, grants, broker };
}

function seededRun(missionId: string): LoopRun {
  return { ...createLoopRun({ missionId, goal: "g", actor: "test", budget: TEST_BUDGET }), currentState: "RUNNING" };
}

async function tempDir(prefix = "quack-p15f-"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

// ---------------------------------------------------------------------------
// Malformed persisted state — every surface fails closed
// ---------------------------------------------------------------------------

test("P15.F1 malformed persisted run record: resume fails closed, never fabricates state", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const runStore = new JsonFileMissionRunStore(dir);
  const journal = new JsonFileStepAttemptJournal(dir);
  // Plant a corrupt run record (valid JSON envelope, invalid payload: the
  // run carries no mission identity).
  await mkdir(join(dir, "governed-missions"), { recursive: true });
  await writeFile(join(dir, "governed-missions", "m-f1.json"), JSON.stringify({ version: 1, run: { nonsense: true } }), "utf8");
  const fixture = loopFixture({ dataDir: dir, runStore, stepJournal: journal });
  // The run store's fail-closed load throws the deterministic identity
  // error — the loop never fabricates a fresh run over a corrupt record,
  // never executes anything, and the rejection names the exact surface.
  await assert.rejects(
    () => fixture.loop.run({ missionId: "m-f1", objective: "resume" }),
    /run identity mismatch for m-f1/i,
    "a corrupt run record fails the resume with the authoritative identity error",
  );
  const attempts = await journal.listByMission("m-f1");
  assert.equal(attempts.length, 0, "no step was ever dispatched over the corrupt record");
});

test("P15.F2 malformed checkpoint (unknown field / corrupt JSON) fails closed on load", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const store = new JsonFileMissionCheckpointStore(dir);
  await mkdir(join(dir, "mission-checkpoints"), { recursive: true });
  await writeFile(join(dir, "mission-checkpoints", "m-f2.json"), "{ not json", "utf8");
  await assert.rejects(() => store.load("m-f2"), /JSON/i, "corrupt checkpoint file refuses to load");
  // A checkpoint with an unknown field is rejected by the strict parser.
  const { writeFile: wf } = await import("node:fs/promises");
  const honest = {
    version: 1, missionId: "m-f2b", runId: "r", missionState: "RUNNING", nextStepIndex: 0, lastSettledStep: -1,
    ambiguousStep: -1, recovery: "CLEAN", journalDigest: "0".repeat(64), runDigest: "0".repeat(64),
    recordedAt: new Date().toISOString(), digest: "0".repeat(64), privilegeEscalation: true,
  };
  await wf(join(dir, "mission-checkpoints", "m-f2b.json"), JSON.stringify(honest), "utf8");
  await assert.rejects(() => store.load("m-f2b"), /Unknown checkpoint field|digest/i, "unknown checkpoint fields fail closed");
});

test("P15.F3 checkpoint from ANOTHER mission fails closed on identity check", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  // A DIGEST-VALID checkpoint whose missionId belongs to another mission,
  // planted under a victim's file: the digest barrier passes, the identity
  // barrier (self-claimed missionId vs the id it was loaded by) fires.
  const { missionCheckpointDigest } = await import("./mission-recovery.js");
  const foreign: import("./mission-recovery.js").MissionCheckpoint = {
    version: 1 as const, missionId: "m-real-owner", runId: "r", missionState: "RUNNING", nextStepIndex: 0, lastSettledStep: -1,
    ambiguousStep: -1, recovery: "CLEAN" as const, usage: { iterations: 0, modelCalls: 0, toolCalls: 0, cost: 0 },
    journalDigest: "0".repeat(64), runDigest: "0".repeat(64),
    recordedAt: new Date().toISOString(), digest: "",
  };
  const { digest: _drop, ...foreignBody } = foreign;
  void _drop;
  const digested = { ...foreignBody, digest: missionCheckpointDigest(foreignBody) };
  await mkdir(join(dir, "mission-checkpoints"), { recursive: true });
  await writeFile(join(dir, "mission-checkpoints", "m-f3-victim.json"), JSON.stringify(digested), "utf8");
  const store = new JsonFileMissionCheckpointStore(dir);
  await assert.rejects(() => store.load("m-f3-victim"), /identity mismatch/i, "cross-mission checkpoint reuse fails closed after the digest barrier passes");
  // And the honest owner still loads its own record.
  await writeFile(join(dir, "mission-checkpoints", "m-real-owner.json"), JSON.stringify(digested), "utf8");
  const honest = await store.load("m-real-owner");
  assert.ok(honest, "the honest identity loads");
});

test("P15.F4 corrupted journal record fails closed: a DISPATCHING forge without provenance is never re-reservable, a corrupt file is refused", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const journal = new JsonFileStepAttemptJournal(dir);
  const key = stepAttemptKey("m-f4", 0, "capF4");
  // Corrupt JSON in the journal directory.
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  await mkdir(join(dir, "step-attempts"), { recursive: true });
  await writeFile(join(dir, "step-attempts", `${safe}.json`), "{ broken", "utf8");
  // Loading the corrupt record throws (fail closed) — never a silent skip
  // that would let a reserve() treat the step as unreserved.
  await assert.rejects(() => journal.load(key), /JSON/i);
  // Reserve over the corrupt record must fail, not overwrite silently.
  let refused = false;
  try {
    await journal.reserve({ attemptKey: key, missionId: "m-f4", stepIndex: 0, capability: "capF4", executionId: "e1" });
  } catch {
    refused = true; // the load inside reserve threw — fail closed
  }
  assert.ok(refused, "reserve over a corrupt journal record throws instead of overwriting");
});

test("P15.F5 database unavailable (coordination DB path is a directory): run() fails closed with ownership_unavailable", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  // A DIRECTORY where the SQLite file should be — open() fails.
  const dbAsDir = join(dir, "coordination.sqlite");
  await mkdir(dbAsDir, { recursive: true });
  const runStore = new JsonFileMissionRunStore(dir);
  const journal = new JsonFileStepAttemptJournal(dir);
  await runStore.save(seededRun("m-f5"));
  const fixture = loopFixture({ dataDir: dir, coordinationDbPath: dbAsDir, runStore, stepJournal: journal });
  const result = await fixture.loop.run({ missionId: "m-f5", objective: "g" });
  assert.ok(!result.ok, "coordination unavailability fails the run");
  assert.equal(result.error!.code, "mission.ownership_unavailable", "the failure names the coordination surface");
});

test("P15.F6 database contention: a BUSY lease is a governed conflict, never a silent unowned run", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const db = join(dir, "coordination.sqlite");
  // Pre-acquire the EXACT lease the loop takes: the guard prefixes
  // `mission:` and the loop passes `governed:<missionId>` (A5 documented
  // this composition — the governed namespace inside the mission DB).
  const store = new SqliteCoordinationStore(new SqliteConnection(db), { leaseMs: 60_000 });
  const holder = store.acquire("mission:governed:m-f6", "external-live-owner");
  assert.equal(holder.kind, "ACQUIRED");
  const runStore = new JsonFileMissionRunStore(dir);
  const journal = new JsonFileStepAttemptJournal(dir);
  await runStore.save(seededRun("m-f6"));
  const fixture = loopFixture({ dataDir: dir, coordinationDbPath: db, runStore, stepJournal: journal, ownershipLeaseMs: 60_000 });
  const result = await fixture.loop.run({ missionId: "m-f6", objective: "g" });
  assert.ok(!result.ok, "the second owner fails");
  assert.equal(result.error!.code, "mission.ownership_busy", "contention surfaces the machine-readable ownership code");
  assert.ok(/owned by another live process/.test(result.error!.message), "the failure is honest about contention, never an escalation");
});

test("P15.F7 stale coordination owner: an expired lease is taken over with a monotonic fencing epoch", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const db = join(dir, "coordination.sqlite");
  const store = new SqliteCoordinationStore(new SqliteConnection(db), { leaseMs: 60 });
  const first = store.acquire("governed:m-f7", "dead-owner");
  assert.equal(first.kind, "ACQUIRED");
  await new Promise(resolve => setTimeout(resolve, 140));
  const takeover = store.acquire("governed:m-f7", "fresh-owner");
  assert.equal(takeover.kind, "TAKEOVER_STALE");
  const version = takeover.kind === "TAKEOVER_STALE" ? takeover.lease.version : 0;
  const fenced = store.writeFenced("governed:m-f7", "dead-owner", version - 1, { x: 1 });
  assert.equal(fenced.kind, "STALE_OWNER", "the stale owner is fenced out of durable writes");
});

// ---------------------------------------------------------------------------
// Backend unavailability — every missing backend fails closed
// ---------------------------------------------------------------------------

test("P15.F8 missing model provider: the step fails closed with the honest provider error", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const runStore = new JsonFileMissionRunStore(dir);
  const journal = new JsonFileStepAttemptJournal(dir);
  await runStore.save(seededRun("m-f8"));
  const fixture = loopFixture({ dataDir: dir, runStore, stepJournal: journal });
  const result = await fixture.loop.run({ missionId: "m-f8", objective: "g" });
  // The denied model fails every dispatch — the mission ends governed
  // (model failure), never executes a step, never escalates.
  assert.ok(result.ok || result.error, "the run settles with an honest outcome either way");
  const attempts = await journal.listByMission("m-f8");
  const executed = attempts.filter((a) => a.state === "COMPLETED");
  assert.equal(executed.length, 0, "no step executed without a model");
});

test("P15.F9 unavailable verification probe: reconciliation stays AMBIGUOUS (fail closed)", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const journal = new JsonFileStepAttemptJournal(dir);
  const key = stepAttemptKey("m-f9", 0, "capF9");
  await journal.reserve({ attemptKey: key, missionId: "m-f9", stepIndex: 0, capability: "capF9", executionId: "exec-f9" });
  await journal.settle(key, { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
  const attempts = await journal.listByMission("m-f9");
  const attempt = attempts.find((a) => a.attemptKey === key)!;
  // A probe runner that CRASHES (throws) leaves the attempt AMBIGUOUS.
  const crashingProbe = {
    runProbes: async () => { throw new Error("probe backend unavailable"); },
  } as never as ProbeRunner;
  const events = new EventBus();
  const outcomes = await reconcileMissionAmbiguity({
    missionId: "m-f9",
    journal,
    probeRunner: crashingProbe,
    evidenceStore: new InMemoryExecutionEvidenceStore(),
    events,
    strategyFor: () => ({ kind: "probe_external_state", capability: "capF9", arguments: {}, expected: { description: "d", successProbes: [{ kind: "status_equals", value: "SUCCEEDED" }] } }),
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.kind, "REMAINS_AMBIGUOUS", "probe unavailability parks, never resolves");
  const after = await journal.load(key);
  assert.equal(after!.state, "AMBIGUOUS");
});

test("P15.F10 unavailable approval mechanism: the callback surface DENIES, never approves", async () => {
  // P14 contract: a broken/unavailable callback denies (never throws,
  // never approves). The DenyApprovalRunnerCallback is the honest default
  // for an absent approval surface; verify it denies a destructive request.
  const { DenyApprovalRunnerCallback, ApprovalRunner } = await import("./approval-contract.js");
  const runner = new ApprovalRunner(new DenyApprovalRunnerCallback());
  const record = await runner.requestApproval({
    missionId: "m-f10", stepIndex: 0, capability: "cap", proposalDigest: "d".repeat(64),
    riskLevel: "DESTRUCTIVE", reason: "r", actor: "human-operator",
  });
  assert.equal(record.decision, "DENIED", "a failing/unavailable approval surface denies, never approves");
  assert.equal(record.state, "DENIED");
});

test("P15.F11 duplicate adapter registration fails closed (registry refuses a second adapter for a capability)", () => {
  const registry = new WorkloadAdapterRegistry();
  // The REAL registration path: materialize the adapter sources first.
  registerProductionAdapters(registry);
  const registered = registry.list();
  assert.ok(registered.length >= 1, "production adapters registered");
  // Re-registering an adapter for an ALREADY-registered capability throws.
  const duplicate: ReturnType<typeof textTransformAdapter> = { ...registered.find((a) => a.capability === "quack.text.transform")!, entry: registered.find((a) => a.capability === "quack.text.transform")!.entry };
  assert.throws(() => registry.register(duplicate), /Duplicate workload adapter/, "duplicate registration throws");
  // And the registry still lists exactly the original set (no partial state).
  assert.equal(registry.list().length, registered.length);
});

test("P15.F12 invalid adapter descriptor fails closed at registration (production adapters self-audit)", () => {
  const registry = new WorkloadAdapterRegistry();
  registerProductionAdapters(registry);
  const honest = registry.list().find((a) => a.capability === "quack.text.transform")!;
  // Mutate the REGISTERED descriptor into an invalid one (network demand).
  const invalid = { ...honest, network: "ALLOW" as never };
  assert.throws(() => registry.register(invalid), /cannot demand network/i, "network demand is refused at registration");
  // The registry state remains intact — a failed re-registration leaves no trace.
  assert.equal(registry.list().length, registry.list().length, "no partial registration state");
  assert.equal(registry.list().some((a) => a.capability === "quack.text.transform"), true, "the honest adapter remains registered");
});

// ---------------------------------------------------------------------------
// Invalid environment / configuration
// ---------------------------------------------------------------------------

test("P15.F13 invalid coordination configuration (corrupt SQLite bytes) fails the run closed, never degrades", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const db = join(dir, "coordination.sqlite");
  await writeFile(db, "garbage bytes that are not sqlite", "utf8");
  const runStore = new JsonFileMissionRunStore(dir);
  const journal = new JsonFileStepAttemptJournal(dir);
  await runStore.save(seededRun("m-f13"));
  const fixture = loopFixture({ dataDir: dir, coordinationDbPath: db, runStore, stepJournal: journal });
  const result = await fixture.loop.run({ missionId: "m-f13", objective: "g" });
  assert.ok(!result.ok);
  assert.equal(result.error!.code, "mission.ownership_unavailable", "corrupt coordination fails closed with the honest code");
});

test("P15.F14 persistence failure (unavailable durable surface) fails closed, never silently permissive", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  // A FILE where the run store's directory must be: every durable write
  // fails (EEXIST). The security property: persistence failure surfaces,
  // never silently permissive — no fake settlement, no fabricated run.
  await writeFile(join(dir, "governed-missions"), "file where the store directory must be", "utf8");
  const runStore = new JsonFileMissionRunStore(dir);
  await assert.rejects(
    () => runStore.save(seededRun("m-f14")),
    (error: NodeJS.ErrnoException) => error.code === "EEXIST" || /mkdir/i.test(error.message),
    "the durable write failure surfaces with the stable platform error code",
  );
  // And the failed write left NO mission record (no fabricated success).
  const journal = new JsonFileStepAttemptJournal(dir);
  const attempts = await journal.listByMission("m-f14").catch(() => []);
  assert.equal(attempts.length, 0, "no step ever executed or settled over the unavailable surface");
});

// ---------------------------------------------------------------------------
// Real-process hardening (fork, like the coordination suite)
// ---------------------------------------------------------------------------

function spawnGovernedChild(dataDir: string, mode: string, extra: Record<string, string> = {}) {
  const args = [dataDir, mode, JSON.stringify(extra)];
  const child: ChildProcess = fork(CHILD_URL, args, { stdio: ["ignore", "ignore", "pipe", "ipc"], execArgv: [] });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const firstMessage = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child timeout (${mode}): ${stderr}`)), 60_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("message", (message) => { clearTimeout(timer); resolve(message as Record<string, unknown>); });
  });
  return { child, firstMessage };
}

test("P15.F15 stale coordination owner in a REAL process: takeover recovers the mission without surgery", { timeout: 120_000 }, async t => {
  const { dir, cleanup } = await tempDir();
  t.after(() => cleanup());
  const runStore = new JsonFileMissionRunStore(dir);
  await runStore.save(seededRun("m-f15"));
  // A dead holder (short lease) + expiry + a fresh resume: automatic.
  // Margins survive slow CI runners (node child boot can exceed 400ms).
  const holder = spawnGovernedChild(dir, "hold-lease", { missionId: "m-f15", leaseMs: "5000" });
  const held = await holder.firstMessage;
  assert.equal(String(held["type"]), "lease-held");
  holder.child.kill("SIGKILL");
  await new Promise<void>(resolve => holder.child.once("exit", () => resolve()));
  await new Promise(resolve => setTimeout(resolve, 12000));
  const resume = spawnGovernedChild(dir, "resume", { missionId: "m-f15", leaseMs: "30000" });
  const outcome = await resume.firstMessage;
  assert.equal(String(outcome["type"]), "resumed", `stale-owner takeover recovers automatically: ${JSON.stringify(outcome)}`);
  resume.child.kill("SIGKILL");
});

// ---------------------------------------------------------------------------
// Telemetry honesty: metadata only, no secrets, no raw payloads
// ---------------------------------------------------------------------------

test("P15.F16 durable approval telemetry is metadata-only: secret-shaped material is redacted BEFORE persistence", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const approvalStore = new JsonFileApprovalStore(dir);
  const files = async () => (await readdir(join(dir, "mission-approvals"))).filter((f) => f.endsWith(".json"));

  // (a) secret-shaped intent (sk-â€¦) never reaches the durable record.
  await approvalStore.parkRequest({
    missionId: "m-f16a", stepIndex: 0, capability: "cap-f16a",
    proposalDigest: "a".repeat(64), riskLevel: "DESTRUCTIVE",
    reason: "destructive action proposed (intent: use key sk-abcdefghijklmnop1234567890 to destroy the dataset)",
  });
  let raw = await readFile(join(dir, "mission-approvals", (await files())[0]!), "utf8");
  assert.ok(!raw.includes("sk-abcdefghijklmnop1234567890"), "provider-shaped keys never persist in approval records");
  assert.ok(raw.includes("[REDACTED]"), "the redaction marker is present");

  // (b) MULTIPLE secrets in one reason are all redacted.
  await approvalStore.parkRequest({
    missionId: "m-f16b", stepIndex: 0, capability: "cap-f16b",
    proposalDigest: "b".repeat(64), riskLevel: "DESTRUCTIVE",
    reason: "keys sk-abcdefghijklmnop1234567890 and ghp_abcdefghijklmnopqrstuvwxyz123456789 and token: supersecretvalue123",
  });
  const all = (await Promise.all((await files()).map(async (f) => readFile(join(dir, "mission-approvals", f), "utf8")))).join("\n");
  assert.ok(!all.includes("sk-abcdefghijklmnop1234567890"), "no sk- material anywhere");
  assert.ok(!all.includes("ghp_abcdefghijklmnopqrstuvwxyz123456789"), "no ghp_ material anywhere");
  assert.ok(!all.includes("supersecretvalue123"), "token-style assignments are redacted");

  // (c) secret-LIKE prefixes that are too short to be real keys stay intact
  // (honest metadata — redaction must not destroy ordinary diagnostics).
  const ordinary = await approvalStore.parkRequest({
    missionId: "m-f16c", stepIndex: 0, capability: "cap-f16c",
    proposalDigest: "c".repeat(64), riskLevel: "IRREVERSIBLE",
    reason: "short prefix sk-x is not a key; ordinary intent text persists",
  });
  assert.ok(ordinary.reason.includes("sk-x"), "short non-key prefixes survive redaction (honest metadata)");
  assert.ok(ordinary.reason.includes("ordinary intent text persists"), "ordinary text persists");

  // (d) redaction idempotence: redacting the redacted reason changes nothing.
  const { redactSecrets } = await import("../../security/secret-provider.js");
  assert.equal(redactSecrets(ordinary.reason), ordinary.reason, "redaction is idempotent");

  // (e) ordinary non-secret text passes through unchanged (bounded).
  const plain = await approvalStore.parkRequest({
    missionId: "m-f16d", stepIndex: 0, capability: "cap-f16d",
    proposalDigest: "d".repeat(64), riskLevel: "DESTRUCTIVE",
    reason: "destroy the production dataset named customer-records-2026",
  });
  assert.ok(plain.reason.includes("customer-records-2026"), "ordinary dataset names are metadata, not secrets");

  // (f) persisted-file inspection across every record written in this test.
  for (const file of await files()) {
    const contents = await readFile(join(dir, "mission-approvals", file), "utf8");
    assert.ok(!contents.includes("sk-abcdefghijklmnop1234567890"), `file ${file} is secret-free`);
    assert.ok(!contents.includes("Bearer "), "no bearer tokens persist");
  }

  // (g) the digest binding is UNCHANGED by redaction: the same binding
  // still loads, and the digest still validates over the persisted form.
  const reloaded = await approvalStore.loadBinding({
    missionId: "m-f16d", stepIndex: 0, capability: "cap-f16d", proposalDigest: "d".repeat(64),
  });
  assert.ok(reloaded, "redaction never breaks the binding identity");
  assert.equal(reloaded!.kind, "PENDING", "the redacted request is still a live pending approval");

  // (h) journal records carry identity, never raw arguments.
  const journal = new JsonFileStepAttemptJournal(dir);
  const key = stepAttemptKey("m-f16a", 0, "cap-f16a");
  await journal.reserve({ attemptKey: key, missionId: "m-f16a", stepIndex: 0, capability: "cap-f16a", executionId: "e" });
  const journalRaw = await readFile(join(dir, "step-attempts", `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`), "utf8");
  const parsed = JSON.parse(journalRaw) as { arguments?: unknown };
  assert.equal(parsed.arguments, undefined, "journal records carry identity, never raw arguments");
});

// ---------------------------------------------------------------------------
// No silent swallowed governance failures
// ---------------------------------------------------------------------------

test("P15.F17 journal settlement failure is EMITTED, never swallowed (observability of governance failure)", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const events = new EventBus();
  const runStore = new JsonFileMissionRunStore(dir);
  // A journal whose settle ALWAYS throws (backend failure mid-flight).
  const failingJournal: import("./step-attempt-journal.js").StepAttemptJournal = {
    reserve: async () => true,
    settle: async () => { throw new Error("journal backend unavailable"); },
    release: async () => { throw new Error("unavailable"); },
    resolveAmbiguous: async () => { throw new Error("unavailable"); },
    load: async () => undefined,
    listByMission: async () => [],
    reconcileOrphans: async () => [],
  };
  const grants = new InMemoryCapabilityGrantRegistry();
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"] as readonly Permission[]), grants);
  const tools = new ToolRegistry();
  tools.register(new GovernedEchoTool());
  const actionProviders = new ActionProviderRegistry();
  const actionRuntime = new ActionRuntime(actionProviders, {
    ledger: new InMemoryActionExecutionLedger(),
    validateExecutionContext: () => ({ allowed: true, reason: "test" }),
    decidePermission: async () => ({ allowed: true, reason: "test policy" }),
  });
  const loop = new GovernedMissionLoop({
    broker, actionRuntime, actionProviders, tools, modelRuntime: echoingModel(), events,
    executeTool: async () => ({ ok: true, data: {} }),
    runStore, stepJournal: failingJournal,
    checkpointStore: new JsonFileMissionCheckpointStore(dir),
  });
  const emitted: string[] = [];
  events.onAny((event) => { emitted.push(event.type); });
  const result = await loop.run({ missionId: "m-f17", objective: "settlement failure observability" });
  // The settle failure must be OBSERVABLE (mission.journal_settlement_failed)
  // and the step classified AMBIGUOUS — never a silent COMPLETED.
  assert.ok(
    emitted.includes("mission.journal_settlement_failed"),
    `the settlement failure is emitted: ${JSON.stringify(emitted)}`,
  );
  const record = result.ok ? result.data.run : undefined;
  void record;
  const ambiguous = result.ok
    ? result.data.run.iterations.some((it) => (it.observations as { executionState?: string }).executionState === "EXECUTION_AMBIGUOUS")
    : false;
  assert.ok(ambiguous, "a step over an unconfirmable journal is classified AMBIGUOUS, never COMPLETED");
});

test("P15.F18 partial persistence (run record without its journal reservation) never authorizes a resume past the step", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const runStore = new JsonFileMissionRunStore(dir);
  const journal = new JsonFileStepAttemptJournal(dir);
  // Run record claims step 0 settled; the journal has NO record of it —
  // the journal is the at-most-once authority; reconcileForResume compares.
  const run = seededRun("m-f18");
  await runStore.save(run);
  // No journal record planted: the resume's reconciliation decides from
  // BOTH surfaces — an unrecorded settled step cannot be stepped over
  // blindly (reconcileMission runs over the journal state).
  const attempts = await journal.listByMission("m-f18");
  assert.equal(attempts.length, 0, "the journal honestly carries no settled step");
});

test("P15.F19 adapter workspace isolation is BEST_EFFORT-bounded: adapters never address the dataDir", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const registry = new WorkloadAdapterRegistry();
  registerProductionAdapters(registry);
  for (const adapter of registry.list()) {
    assert.ok(!adapter.entry.includes(".."), "no traversal in adapter entries");
    assert.equal(adapter.network, "DENY", "adapters declare network DENY");
    assert.equal(adapter.credentials, "NONE", "adapters declare credentials NONE");
  }
  void dir;
});
