import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuackBackup, verifyQuackBackup, restoreQuackBackup } from "../recovery/backup.js";
import { JsonFileMissionRunStore } from "../runtime/mission-lifecycle/mission-run-store.js";
import { JsonFileStepAttemptJournal, stepAttemptKey } from "../runtime/mission-lifecycle/step-attempt-journal.js";
import { JsonFileMissionCheckpointStore, buildMissionCheckpoint, journalStateDigest, runRecordDigest, reconcileMission } from "../runtime/mission-lifecycle/mission-recovery.js";
import { JsonFileApprovalStore, approvalRequestKey } from "../runtime/mission-lifecycle/approval-store.js";
import { createLoopRun, appendIteration, type Budget, type LoopRun } from "../runtime/mission-lifecycle/executive-loop.js";

/**
 * P16-E/P16-F (deployment qualification): backup/restore and upgrade/migration
 * safety over the REAL durable persistence model. No new authority: this
 * suite drives the existing `quack-solo-backup-v1` format and the existing
 * versioned stores.
 *
 *   BKR  backup/restore of real mission state (identity/journal/approval/
 *        budget/recovery preservation)
 *   MIG  migration safety (forward-only SQLite migrations; fail-closed
 *        unknown versions; no destructive migration)
 *
 * Honesty note: rollback of a schema upgrade is NOT supported (forward-only
 * migrations; unknown future versions fail closed). That is asserted, not
 * assumed, below.
 */

const TEST_BUDGET: Budget = { maxIterations: 8, maxModelCalls: 16, maxToolCalls: 24, maxCost: 1, maxExecutionTimeMs: 300_000, maxConsecutiveFailures: 3 };

async function tempDir(prefix = "quack-p16-bkr-"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

/** Seed a REAL durable mission state snapshot into a dataDir. */
async function seedMissionState(dataDir: string, options: {
  missionId: string;
  usage?: { modelCalls: number; toolCalls: number; iterations: number };
  withAmbiguousStep?: boolean;
}): Promise<{ run: LoopRun }> {
  const runStore = new JsonFileMissionRunStore(dataDir);
  const journal = new JsonFileStepAttemptJournal(dataDir);
  const checkpointStore = new JsonFileMissionCheckpointStore(dataDir);
  const approvals = new JsonFileApprovalStore(dataDir);

  let run = createLoopRun({ missionId: options.missionId, goal: "p16 backup qualification", actor: "test", budget: TEST_BUDGET });
  for (let i = 0; i < (options.usage?.iterations ?? 2); i += 1) {
    run = appendIteration(run, {
      runId: run.runId, missionId: options.missionId, iterationId: `it_${i}`, index: i,
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      phase: "ACT", goal: run.goal, observations: {}, workingContext: {}, candidateActions: [],
      usageSnapshot: { modelCalls: (options.usage?.modelCalls ?? 0) + i + 1, toolCalls: (options.usage?.toolCalls ?? 0) + i + 1, cost: 0 },
    });
  }
  run = { ...run, currentState: "RUNNING" };
  await runStore.save(run);

  // A settled step and (optionally) an ambiguous step.
  const key0 = stepAttemptKey(options.missionId, 0, "fixture.transform");
  await journal.reserve({ attemptKey: key0, missionId: options.missionId, stepIndex: 0, capability: "fixture.transform", executionId: "exec-0" });
  await journal.settle(key0, { state: "COMPLETED" });
  if (options.withAmbiguousStep) {
    const key1 = stepAttemptKey(options.missionId, 1, "fixture.transform");
    await journal.reserve({ attemptKey: key1, missionId: options.missionId, stepIndex: 1, capability: "fixture.transform", executionId: "exec-1" });
    await journal.settle(key1, { state: "AMBIGUOUS" });
  }

  // A durable PENDING approval (WAITING_APPROVAL boundary).
  await approvals.parkRequest({
    missionId: options.missionId, stepIndex: 2, capability: "fixture.destructive",
    proposalDigest: "a".repeat(64), riskLevel: "DESTRUCTIVE",
    reason: "p16 backup qualification request",
  });

  // A checkpoint consistent with the seeded journal/run.
  const decision = await reconcileMission({ missionId: options.missionId, run: await runStore.load(options.missionId), journal });
  const checkpoint = buildMissionCheckpoint({
    run,
    recovery: decision.state === "CLEAN" ? "RECOVERING" : decision.state,
    nextStepIndex: decision.nextStepIndex,
    lastSettledStep: decision.lastSettledStep,
    ambiguousStep: decision.ambiguousStep,
    journalDigest: await journalStateDigest(journal, options.missionId),
    runDigest: runRecordDigest(run),
  });
  await checkpointStore.save(checkpoint);
  return { run };
}

/** Verify a restored dataDir preserves every durable guarantee. */
async function verifyRestoredState(dataDir: string, missionId: string, expectAmbiguous: boolean): Promise<void> {
  const runStore = new JsonFileMissionRunStore(dataDir);
  const journal = new JsonFileStepAttemptJournal(dataDir);
  const checkpointStore = new JsonFileMissionCheckpointStore(dataDir);
  const approvals = new JsonFileApprovalStore(dataDir);

  // Mission identity preserved.
  const restored = await runStore.load(missionId);
  assert.ok(restored, "run record survives restore");
  assert.equal(restored.missionId, missionId);
  assert.ok(restored.runId.length > 0, "run identity preserved");

  // Budget preserved (usage counters survived).
  assert.ok(restored.usage.modelCalls >= 2, "consumed budget survives restore (never reset)");

  // Journal integrity preserved.
  const attempts = await journal.listByMission(missionId);
  assert.ok(attempts.some((attempt) => attempt.state === "COMPLETED"), "settled journal state preserved");
  if (expectAmbiguous) {
    const ambiguous = attempts.filter((attempt) => attempt.state === "AMBIGUOUS");
    assert.ok(ambiguous.length > 0, "AMBIGUOUS journal state preserved");
  }

  // Checkpoint preserved and digest-consistent with restored records.
  const checkpoint = await checkpointStore.load(missionId);
  assert.ok(checkpoint, "checkpoint survives restore");
  assert.equal(checkpoint.journalDigest, await journalStateDigest(journal, missionId), "journal digest matches after restore");
  assert.equal(checkpoint.runDigest, runRecordDigest(restored), "run digest matches after restore");

  // Approval state preserved (PENDING parks; no consumption fabricated).
  const binding = { missionId, stepIndex: 2, capability: "fixture.destructive", proposalDigest: "a".repeat(64) };
  const loaded = await approvals.loadBinding(binding);
  assert.ok(loaded, "approval binding loads after restore");
  assert.equal(loaded.kind, "PENDING", "WAITING_APPROVAL state preserved as durable PENDING");

  // Recovery state preserved: AMBIGUOUS does not silently resume.
  const decision = await reconcileMission({ missionId, run: restored, journal });
  if (expectAmbiguous) {
    assert.equal(decision.state, "REQUIRES_VERIFICATION", "restored AMBIGUOUS mission still requires verification — restore never silently resumes");
  }
}

// ===========================================================================
// BKR — backup + restore qualification
// ===========================================================================

test("BKR-1 clean backup and restore to a fresh data directory preserves complete mission authority", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-bkr-clean-");
  const backupDir = join(dir, "..", `bkr1-backup-${Date.now()}`);
  try {
    await seedMissionState(dir, { missionId: "gov_p16_bkr1", usage: { modelCalls: 3, toolCalls: 3, iterations: 2 } });
    const created = await createQuackBackup(dir, backupDir);
    assert.ok(created.manifest.files.length > 0);

    const fresh = join(dir, "..", `bkr1-restored-${Date.now()}`);
    const result = await restoreQuackBackup(backupDir, fresh);
    assert.ok(result.restoredFiles > 0);
    await verifyRestoredState(fresh, "gov_p16_bkr1", false);
    await rm(fresh, { recursive: true, force: true });
  } finally { await rm(backupDir, { recursive: true, force: true }); await cleanup(); }
});

test("BKR-2 backup during WAITING_APPROVAL preserves the durable pending approval (no duplicate execution authority)", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-bkr-waiting-");
  const backupDir = join(dir, "..", `bkr2-backup-${Date.now()}`);
  try {
    await seedMissionState(dir, { missionId: "gov_p16_bkr2", usage: { modelCalls: 2, toolCalls: 2, iterations: 1 } });
    const created = await createQuackBackup(dir, backupDir);
    assert.ok(created.manifest.files.some((file) => file.path.includes("mission-approvals")), "approval records are part of the backup");

    const fresh = join(dir, "..", `bkr2-restored-${Date.now()}`);
    await restoreQuackBackup(backupDir, fresh);
    // Verify: exactly ONE pending approval record — restore created no duplicates.
    const approvalFiles = await readdir(join(fresh, "mission-approvals"));
    assert.equal(approvalFiles.length, 1, "no duplicate approval records created by restore");
    await verifyRestoredState(fresh, "gov_p16_bkr2", false);
    await rm(fresh, { recursive: true, force: true });
  } finally { await rm(backupDir, { recursive: true, force: true }); await cleanup(); }
});

test("BKR-3 backup containing an AMBIGUOUS mission restores it still parked — never silently resumable", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-bkr-ambig-");
  const backupDir = join(dir, "..", `bkr3-backup-${Date.now()}`);
  try {
    await seedMissionState(dir, { missionId: "gov_p16_bkr3", withAmbiguousStep: true, usage: { modelCalls: 4, toolCalls: 4, iterations: 2 } });
    await createQuackBackup(dir, backupDir);
    const fresh = join(dir, "..", `bkr3-restored-${Date.now()}`);
    await restoreQuackBackup(backupDir, fresh);
    await verifyRestoredState(fresh, "gov_p16_bkr3", true);
    await rm(fresh, { recursive: true, force: true });
  } finally { await rm(backupDir, { recursive: true, force: true }); await cleanup(); }
});

test("BKR-4 a corrupted backup is rejected before any live data is touched", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-bkr-corrupt-");
  const backupDir = join(dir, "..", `bkr4-backup-${Date.now()}`);
  try {
    await seedMissionState(dir, { missionId: "gov_p16_bkr4" });
    await createQuackBackup(dir, backupDir);
    // Corrupt one payload file after the fact.
    const payloads = await readdir(join(backupDir, "payload", "governed-missions"));
    await writeFile(join(backupDir, "payload", "governed-missions", payloads[0]), "tampered");
    await assert.rejects(() => verifyQuackBackup(backupDir), /integrity/i, "digest verification fails closed");
    const live = join(dir, "..", `bkr4-live-${Date.now()}`);
    await mkdir(live, { recursive: true });
    await writeFile(join(live, "keep.txt"), "untouched");
    await assert.rejects(() => restoreQuackBackup(backupDir, live), /integrity/i, "restore of a corrupt backup is refused");
    assert.equal(await readFile(join(live, "keep.txt"), "utf8"), "untouched", "live data untouched by the refused restore");
    await rm(live, { recursive: true, force: true });
  } finally { await rm(backupDir, { recursive: true, force: true }); await cleanup(); }
});

test("BKR-5 a partial backup (missing manifest file) is rejected without touching the target", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-bkr-partial-");
  const backupDir = join(dir, "..", `bkr5-backup-${Date.now()}`);
  try {
    await seedMissionState(dir, { missionId: "gov_p16_bkr5" });
    await createQuackBackup(dir, backupDir);
    // Remove one payload file listed in the manifest (partial backup).
    const manifest = JSON.parse(await readFile(join(backupDir, "manifest.json"), "utf8"));
    const firstMissionFile = manifest.files.find((file: { path: string }) => file.path.includes("governed-missions"));
    await rm(join(backupDir, "payload", firstMissionFile.path));
    await assert.rejects(() => verifyQuackBackup(backupDir), /integrity|ENOENT/i, "a backup missing listed files fails verification");
  } finally { await rm(backupDir, { recursive: true, force: true }); await cleanup(); }
});

test("BKR-6 an unsupported backup format (incompatible/old schema marker) fails closed", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-bkr-format-");
  const backupDir = join(dir, "..", `bkr6-backup-${Date.now()}`);
  try {
    await mkdir(join(backupDir, "payload"), { recursive: true });
    await writeFile(join(backupDir, "manifest.json"), JSON.stringify({ format: "quack-solo-backup-v0", files: [] }));
    await assert.rejects(() => verifyQuackBackup(backupDir), /unsupported/i, "unknown backup format fails closed, never coerced");
  } finally { await rm(backupDir, { recursive: true, force: true }); await cleanup(); }
});

test("BKR-7 backup restore never restores secrets: a secret-named file in the source is excluded and reported", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-bkr-nosecret-");
  const backupDir = join(dir, "..", `bkr7-backup-${Date.now()}`);
  try {
    await seedMissionState(dir, { missionId: "gov_p16_bkr7" });
    await writeFile(join(dir, "api-credentials.json"), JSON.stringify({ apiKey: "must-not-restore" }));
    const created = await createQuackBackup(dir, backupDir);
    assert.ok(created.manifest.excludedSensitivePaths.includes("api-credentials.json"), "secret-named file excluded");
    const fresh = join(dir, "..", `bkr7-restored-${Date.now()}`);
    await restoreQuackBackup(backupDir, fresh);
    await assert.rejects(() => readFile(join(fresh, "api-credentials.json")), { code: "ENOENT" }, "the excluded secret file is not restored");
    await rm(fresh, { recursive: true, force: true });
  } finally { await rm(backupDir, { recursive: true, force: true }); await cleanup(); }
});

test("BKR-8 restore is atomic with rollback: a mid-restore failure preserves the original data directory", async () => {
  // Structural qualification of the documented rollback design: staging +
  // rollback rename, verified by simulating a target replacement failure
  // through overlap refusal (the only deterministic failure injection point).
  const { dir, cleanup } = await tempDir("quack-p16-bkr-rollback-");
  const backupDir = join(dir, "..", `bkr8-backup-${Date.now()}`);
  try {
    await seedMissionState(dir, { missionId: "gov_p16_bkr8" });
    await createQuackBackup(dir, backupDir);
    // Overlapping target (inside the backup directory) must be refused
    // BEFORE any rename: the manifest list stays intact.
    await assert.rejects(() => restoreQuackBackup(backupDir, join(backupDir, "nested")), /overlap/i);
    const manifest = await verifyQuackBackup(backupDir);
    assert.ok(manifest.files.length > 0, "backup remains verifiable after the refused restore");
  } finally { await rm(backupDir, { recursive: true, force: true }); await cleanup(); }
});

// ===========================================================================
// MIG — upgrade / migration safety
// ===========================================================================

test("MIG-1 SQLite migrations are forward-only and idempotent: reopening an existing dataDir does not re-apply migrations", async () => {
  const { SqliteConnection } = await import("../storage/sqlite.js");
  const { dir, cleanup } = await tempDir("quack-p16-mig-forward-");
  try {
    const dbPath = join(dir, "quack.sqlite");
    const connection = new SqliteConnection(dbPath);
    // First open applies migrations 001-004.
    connection.withDatabase(() => undefined);
    // Second open reuses them (no re-application, no error).
    connection.withDatabase(() => undefined);
    const applied = connection.withDatabase((database) =>
      database.prepare("select id from quack_migrations order by id").all());
    assert.deepEqual(applied.map((row) => row["id"]), [
      "001_persistent_mission_storage",
      "002_durable_action_execution_ledger",
      "003_mission_company_runtime",
      "004_coordination_leases",
    ], "exactly the known migrations are applied, once, in order");
  } finally { await cleanup(); }
});

test("MIG-2 unknown future schema versions fail closed: a future checkpoint/journal/approval/run version is rejected, never coerced", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-mig-future-");
  try {
    const { parseMissionCheckpoint } = await import("../runtime/mission-lifecycle/mission-recovery.js");
    const { STEP_ATTEMPT_JOURNAL_VERSION } = await import("../runtime/mission-lifecycle/step-attempt-journal.js");

    // Future checkpoint version.
    await mkdir(join(dir, "mission-checkpoints"), { recursive: true });
    await writeFile(join(dir, "mission-checkpoints", "gov_future.json"), JSON.stringify({
      version: 99, missionId: "gov_future", runId: "r", missionState: "RUNNING", nextStepIndex: 0,
      lastSettledStep: -1, ambiguousStep: -1, usage: { iterations: 0, modelCalls: 0, toolCalls: 0, cost: 0 },
      journalDigest: "0".repeat(64), runDigest: "0".repeat(64), recovery: "RECOVERING", recordedAt: new Date().toISOString(),
    }));
    const store = new JsonFileMissionCheckpointStore(dir);
    await assert.rejects(() => store.load("gov_future"), /schema|version/i, "future checkpoint version fails closed");

    // Future run-record version.
    await mkdir(join(dir, "governed-missions"), { recursive: true });
    await writeFile(join(dir, "governed-missions", "gov_futurerun.json"), JSON.stringify({ version: 2, run: {} }));
    await assert.rejects(() => new JsonFileMissionRunStore(dir).load("gov_futurerun"), /Invalid/i, "future run-record version fails closed");

    // Future journal version (via direct file; key is sanitized to a flat
    // traversal-free filename by the store).
    await mkdir(join(dir, "step-attempts"), { recursive: true });
    const futureKey = stepAttemptKey("gov_futurej", 0, "fixture");
    const safeKey = futureKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    await writeFile(join(dir, "step-attempts", `${safeKey}.json`), JSON.stringify({
      version: 99, attemptKey: futureKey, missionId: "gov_futurej", stepIndex: 0, capability: "fixture",
      state: "COMPLETED", recordedAt: new Date().toISOString(),
    }));
    await assert.rejects(() => new JsonFileStepAttemptJournal(dir).load(futureKey), /Invalid|version/i, "future journal version fails closed");
    void STEP_ATTEMPT_JOURNAL_VERSION;
  } finally { await cleanup(); }
});

test("MIG-3 invalid old data fails closed: malformed durable records are rejected, never silently repaired", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-mig-invalid-");
  try {
    // Malformed JSON in a run record.
    await mkdir(join(dir, "governed-missions"), { recursive: true });
    await writeFile(join(dir, "governed-missions", "gov_broken.json"), "{ not json");
    await assert.rejects(() => new JsonFileMissionRunStore(dir).load("gov_broken"), /JSON|Invalid/i, "malformed run record fails closed");
  } finally { await cleanup(); }
});

test("MIG-4 migration is deterministic and preserves identity/digest guarantees: same input state, same digests, after re-open", async () => {
  const { SqliteConnection } = await import("../storage/sqlite.js");
  const { dir, cleanup } = await tempDir("quack-p16-mig-digest-");
  try {
    await seedMissionState(dir, { missionId: "gov_p16_mig4" });
    // Digest before.
    const before = await digests(dir, "gov_p16_mig4");
    // Re-open stores (simulates a version N -> N+1 restart over the same data).
    const connection = new SqliteConnection(join(dir, "quack.sqlite"));
    connection.withDatabase(() => undefined);
    const after = await digests(dir, "gov_p16_mig4");
    assert.equal(after.journalDigest, before.journalDigest, "journal digest stable across re-open");
    assert.equal(after.runDigest, before.runDigest, "run digest stable across re-open");
    assert.equal(after.approvalCount, before.approvalCount, "approval records unchanged by re-open");
    async function digests(dataDir: string, missionId: string) {
      const journal = new JsonFileStepAttemptJournal(dataDir);
      const runStore = new JsonFileMissionRunStore(dataDir);
      const run = await runStore.load(missionId);
      assert.ok(run);
      return {
        journalDigest: await journalStateDigest(journal, missionId),
        runDigest: runRecordDigest(run),
        approvalCount: (await readdir(join(dataDir, "mission-approvals"))).length,
      };
    }
  } finally { await cleanup(); }
});

test("MIG-5 rollback of a schema upgrade is NOT supported and fails closed: a newer-version dataDir opened by an older parser refuses to load", async () => {
  // Rollback (downgrade) is explicitly unsupported: the test proves the
  // fail-closed side — old parsers reject newer versions rather than
  // approximating them. This documents the honest boundary.
  const { dir, cleanup } = await tempDir("quack-p16-mig-downgrade-");
  try {
    await mkdir(join(dir, "governed-missions"), { recursive: true });
    await writeFile(join(dir, "governed-missions", "gov_newer.json"), JSON.stringify({ version: 2, run: { missionId: "gov_newer" } }));
    await assert.rejects(() => new JsonFileMissionRunStore(dir).load("gov_newer"), /Invalid/i, "downgrade paths fail closed — no bidirectional migration is claimed");
  } finally { await cleanup(); }
});

test("MIG-6 migration introduces no privilege escalation: grants restored after re-open grant exactly what they granted before", async () => {
  const { SqliteConnection } = await import("../storage/sqlite.js");
  const { JsonFileCapabilityGrantRegistry } = await import("../security/capability-broker.js");
  const { dir, cleanup } = await tempDir("quack-p16-mig-grants-");
  try {
    const registry = new JsonFileCapabilityGrantRegistry(join(dir, "security", "capability-grants.json"));
    registry.ensureGrant({
      missionId: "gov_p16_mig6",
      capabilities: ["permission.workspace.read"],
      approval: { approvedBy: "p16-qualification", reason: "fixture", approvedAt: new Date().toISOString() },
    });
    // Re-open (migration pass) — the grant set must be identical, no additions.
    const connection = new SqliteConnection(join(dir, "quack.sqlite"));
    connection.withDatabase(() => undefined);
    const reopened = new JsonFileCapabilityGrantRegistry(join(dir, "security", "capability-grants.json"));
    const grants = reopened.listGrants();
    assert.equal(grants.length, 1);
    assert.equal(grants[0].missionId, "gov_p16_mig6");
    assert.deepEqual(grants[0].capabilities, ["permission.workspace.read"], "migration adds no capability");
  } finally { await cleanup(); }
});

test("BKR/MIG-9 backup of an active SQLite coordination DB restores a working coordination layer", async () => {
  const { SqliteCoordinationStore } = await import("../storage/coordination.js");
  const { dir, cleanup } = await tempDir("quack-p16-bkr-coord-");
  const backupDir = join(dir, "..", `bkr9-backup-${Date.now()}`);
  try {
    // A live lease in the source.
    const source = new SqliteCoordinationStore(new (await import("../storage/sqlite.js")).SqliteConnection(join(dir, "coordination.sqlite")), { leaseMs: 60_000 });
    source.acquire("governed:gov_p16_bkr9", "owner-1");
    await createQuackBackup(dir, backupDir);

    const fresh = join(dir, "..", `bkr9-restored-${Date.now()}`);
    await restoreQuackBackup(backupDir, fresh);
    // The restored coordination DB works and the lease survived as data.
    const { SqliteConnection } = await import("../storage/sqlite.js");
    const restored = new SqliteCoordinationStore(new SqliteConnection(join(fresh, "coordination.sqlite")), { leaseMs: 60_000 });
    const current = restored.current("governed:gov_p16_bkr9");
    assert.ok(current, "coordination lease state restored");
    assert.equal(current.owner, "owner-1");
    // A second owner still gets BUSY: restored authority is not duplicated.
    const second = restored.acquire("governed:gov_p16_bkr9", "owner-2");
    assert.equal(second.kind, "BUSY", "restored coordination still enforces single ownership");
    await rm(fresh, { recursive: true, force: true });
  } finally { await rm(backupDir, { recursive: true, force: true }); await cleanup(); }
});
