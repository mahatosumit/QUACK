import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createId, now } from "../core/types.js";
import { createQuackSystem, type QuackSystem } from "../distributions/swe-system.js";
import { type CodeExperimentRecord, type CodeImprovementProposal } from "./types.js";

/**
 * §9 — human-gated promotion & rollback integration tests, plus §8's
 * adversarial no-self-approval tests. Every test uses a real throwaway git
 * repository (no mocked git/verification) so the same `createQuackSystem`
 * wiring used in production drives the whole pipeline.
 *
 * The fixture's `test` npm script is written to fail if and only if `HEAD`
 * is a real merge commit (two parents). Pre-merge verification always runs
 * inside the linear-history worktree/baseline, so it always passes there;
 * post-merge verification runs against the merge commit in the main repo,
 * so it deterministically fails only after a real merge — a real,
 * unmocked way to exercise the rollback path.
 */

interface Fixture {
  readonly system: QuackSystem;
  readonly fixtureRoot: string;
  readonly dataDir: string;
  readonly git: (...args: string[]) => string;
}

/**
 * `regressOnMerge: true` swaps in a `test` script that fails once (and only
 * once) `HEAD` becomes a real two-parent merge commit — used solely by the
 * rollback test to force a deterministic, unmocked post-merge-only failure.
 * All other tests use the default always-passing script, since a genuinely
 * clean promotion must also produce a merge commit without regressing.
 */
async function setupFixture(options: { readonly regressOnMerge?: boolean } = {}): Promise<Fixture> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "quack-promotion-fixture-"));
  const dataDir = join(fixtureRoot, ".quack-data");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: fixtureRoot, encoding: "utf8" });

  git("init", "-q");
  git("config", "user.email", "quack-promotion-test@example.com");
  git("config", "user.name", "QUACK Promotion Test");
  // npm scripts on Windows run through cmd.exe, where `^` is an escape
  // character (it would silently mangle `HEAD^2`); also pin autocrlf so
  // fixture file content read back by the test matches what was written.
  git("config", "core.autocrlf", "false");

  const testScript = options.regressOnMerge
    ? "node -e \"const {execSync}=require('child_process');const parents=execSync('git rev-list --parents -n 1 HEAD').toString().trim().split(' ');" +
      "const merge=parents.length>2;if(merge){console.log('# pass 0');console.log('# fail 1');process.exit(1);}else{console.log('# pass 3');console.log('# fail 0');process.exit(0);}\""
    : "node -e \"console.log('# pass 3');console.log('# fail 0');process.exit(0)\"";

  await mkdir(join(fixtureRoot, "src"), { recursive: true });
  await writeFile(
    join(fixtureRoot, "package.json"),
    JSON.stringify(
      {
        name: "quack-promotion-fixture",
        version: "1.0.0",
        private: true,
        scripts: {
          typecheck: "node -e \"process.exit(0)\"",
          test: testScript,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(join(fixtureRoot, "src", "app.ts"), "export const value = 1;\n", "utf8");
  await writeFile(join(fixtureRoot, ".gitignore"), ".quack/\n.quack-data/\n", "utf8");
  git("add", "-A");
  git("commit", "-q", "-m", "initial fixture commit");

  const system = createQuackSystem({
    workspaceRoot: fixtureRoot,
    dataDir,
    permissions: ["memory.read", "memory.write", "workspace.read", "terminal.execute"],
    approver: { requestApproval: async () => true },
  });

  return { system, fixtureRoot, dataDir, git };
}

async function teardown(fixture: Fixture): Promise<void> {
  const worktrees = fixture.git("worktree", "list", "--porcelain")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  for (const worktree of worktrees.slice(1)) fixture.git("worktree", "remove", "--force", worktree);
  fixture.git("worktree", "prune", "--expire", "now");
  const branches = fixture.git("for-each-ref", "--format=%(refname:short)", "refs/heads/quack-selfmod/").split(/\r?\n/).filter(Boolean);
  for (const branch of branches) fixture.git("branch", "-D", branch);
  assert.equal(fixture.git("worktree", "list", "--porcelain").split(/\r?\n/).filter((line) => line.startsWith("worktree ")).length, 1);
  await rm(fixture.fixtureRoot, { recursive: true, force: true, maxRetries: 5 });
}

function makeProposal(overrides: Partial<CodeImprovementProposal> = {}): CodeImprovementProposal {
  return {
    id: createId("selfmod-proposal"),
    sourceEvidenceRefs: ["evidence-fixture-1"],
    hypothesis: "Bumping the exported constant is a safe, in-scope change.",
    objectiveId: "demo-objective",
    targetScope: ["src/app.ts"],
    expectedFiles: ["src/app.ts"],
    description: "Update src/app.ts constant from 1 to 2.",
    createdAt: now(),
    ...overrides,
  };
}

async function proposeAndAwaitHuman(fixture: Fixture, proposal = makeProposal()): Promise<CodeExperimentRecord> {
  const result = await fixture.system.selfModification.proposeChange({
    proposal,
    edits: [{ path: "src/app.ts", content: "export const value = 2;\n" }],
  });
  assert.equal(result.ok, true, "proposeChange should succeed");
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.data.status, "AWAITING_HUMAN", JSON.stringify({
    reason: result.data.reason,
    staleBase: result.data.staleBase,
    candidateVerification: result.data.candidateVerification,
    baselineVerification: result.data.baselineVerification,
  }));
  return result.data;
}

async function readExperiments(fixture: Fixture): Promise<CodeExperimentRecord[]> {
  const raw = await readFile(join(fixture.dataDir, "selfmod", "experiments.json"), "utf8");
  return JSON.parse(raw) as CodeExperimentRecord[];
}

async function writeExperiments(fixture: Fixture, records: readonly CodeExperimentRecord[]): Promise<void> {
  await writeFile(join(fixture.dataDir, "selfmod", "experiments.json"), JSON.stringify(records, null, 2), "utf8");
}

// ── §9.1 — approved clean patch -> merge -> post-merge checks pass ──────────
test("promotion: approved clean patch merges and passes post-merge verification", async () => {
  const fixture = await setupFixture();
  try {
    const record = await proposeAndAwaitHuman(fixture);

    const approval = await fixture.system.selfModification.recordHumanDecision({
      experimentId: record.id,
      decision: "APPROVE",
      patchFingerprint: record.patch!.fingerprint,
      actor: "human:reviewer-1",
    });
    assert.equal(approval.ok, true);
    if (!approval.ok) return;
    assert.equal(approval.data.status, "APPROVED");
    assert.equal(approval.data.humanDecisionActor, "human:reviewer-1");

    const promoted = await fixture.system.selfModification.promote(record.id);
    assert.equal(promoted.ok, true);
    if (!promoted.ok) return;
    assert.equal(promoted.data.status, "PROMOTED", JSON.stringify({
      reason: promoted.data.reason,
      rollbackReason: promoted.data.rollbackReason,
      postMergeVerification: promoted.data.postMergeVerification,
    }));
    assert.ok(promoted.data.promotionCommit);
    assert.equal(promoted.data.postMergeVerification?.allPassed, true);

    const content = await readFile(join(fixture.fixtureRoot, "src", "app.ts"), "utf8");
    assert.equal(content, "export const value = 2;\n");
  } finally {
    await teardown(fixture);
  }
});

// ── §9.2 — human rejects -> no merge ────────────────────────────────────────
test("promotion: human rejection leaves the default branch untouched", async () => {
  const fixture = await setupFixture();
  try {
    const record = await proposeAndAwaitHuman(fixture);

    const rejection = await fixture.system.selfModification.recordHumanDecision({
      experimentId: record.id,
      decision: "REJECT",
      patchFingerprint: record.patch!.fingerprint,
      actor: "human:reviewer-1",
      reason: "Not needed right now.",
    });
    assert.equal(rejection.ok, true);
    if (!rejection.ok) return;
    assert.equal(rejection.data.status, "REJECTED");

    const promoted = await fixture.system.selfModification.promote(record.id);
    assert.equal(promoted.ok, false);
    if (promoted.ok) return;
    assert.equal(promoted.error.code, "selfmod.not_approved");

    const content = await readFile(join(fixture.fixtureRoot, "src", "app.ts"), "utf8");
    assert.equal(content, "export const value = 1;\n");
  } finally {
    await teardown(fixture);
  }
});

// ── §9.3 — stale base -> revalidation required ──────────────────────────────
test("promotion: stale base requires revalidation instead of merging", async () => {
  const fixture = await setupFixture();
  try {
    const record = await proposeAndAwaitHuman(fixture);

    const approval = await fixture.system.selfModification.recordHumanDecision({
      experimentId: record.id,
      decision: "APPROVE",
      patchFingerprint: record.patch!.fingerprint,
      actor: "human:reviewer-1",
    });
    assert.equal(approval.ok, true);

    // Advance HEAD on the default branch after approval, before promotion.
    await writeFile(join(fixture.fixtureRoot, "OTHER.md"), "unrelated change\n", "utf8");
    fixture.git("add", "OTHER.md");
    fixture.git("commit", "-q", "-m", "unrelated commit advancing HEAD");

    const promoted = await fixture.system.selfModification.promote(record.id);
    assert.equal(promoted.ok, true);
    if (!promoted.ok) return;
    assert.equal(promoted.data.status, "REVALIDATION_REQUIRED");

    const content = await readFile(join(fixture.fixtureRoot, "src", "app.ts"), "utf8");
    assert.equal(content, "export const value = 1;\n");
  } finally {
    await teardown(fixture);
  }
});

// ── §9.4 / §8 — fingerprint changed -> approval invalid ─────────────────────
test("promotion: forged/changed patch fingerprint is refused at approval time", async () => {
  const fixture = await setupFixture();
  try {
    const record = await proposeAndAwaitHuman(fixture);

    const forged = await fixture.system.selfModification.recordHumanDecision({
      experimentId: record.id,
      decision: "APPROVE",
      patchFingerprint: "0".repeat(64),
      actor: "human:reviewer-1",
    });
    assert.equal(forged.ok, false);
    if (forged.ok) return;
    assert.equal(forged.error.code, "selfmod.fingerprint_mismatch");

    const experiments = await readExperiments(fixture);
    assert.equal(experiments.find((r) => r.id === record.id)?.status, "AWAITING_HUMAN");
  } finally {
    await teardown(fixture);
  }
});

test("promotion: a stale/changed patch record cannot reuse an old approval at promotion time", async () => {
  const fixture = await setupFixture();
  try {
    const record = await proposeAndAwaitHuman(fixture);
    const approval = await fixture.system.selfModification.recordHumanDecision({
      experimentId: record.id,
      decision: "APPROVE",
      patchFingerprint: record.patch!.fingerprint,
      actor: "human:reviewer-1",
    });
    assert.equal(approval.ok, true);
    if (!approval.ok) return;

    // Simulate the patch having been regenerated after approval: tamper the
    // persisted fingerprint directly (the same on-disk format `promote()` reads).
    const experiments = await readExperiments(fixture);
    const tampered = experiments.map((r) =>
      r.id === record.id && r.patch ? { ...r, patch: { ...r.patch, fingerprint: "f".repeat(64) } } : r,
    );
    await writeExperiments(fixture, tampered);

    const promoted = await fixture.system.selfModification.promote(record.id);
    assert.equal(promoted.ok, false);
    if (promoted.ok) return;
    assert.equal(promoted.error.code, "selfmod.fingerprint_mismatch");
  } finally {
    await teardown(fixture);
  }
});

// ── §9.5 — post-merge regression -> rollback ────────────────────────────────
test("promotion: a post-merge-only regression triggers automatic rollback", async () => {
  const fixture = await setupFixture({ regressOnMerge: true });
  try {
    const record = await proposeAndAwaitHuman(fixture);
    const approval = await fixture.system.selfModification.recordHumanDecision({
      experimentId: record.id,
      decision: "APPROVE",
      patchFingerprint: record.patch!.fingerprint,
      actor: "human:reviewer-1",
    });
    assert.equal(approval.ok, true);

    const promoted = await fixture.system.selfModification.promote(record.id);
    assert.equal(promoted.ok, true);
    if (!promoted.ok) return;
    // The fixture's test script fails deterministically once HEAD is a merge commit.
    assert.equal(promoted.data.status, "ROLLED_BACK");
    assert.ok(promoted.data.rollbackReason);
    assert.equal(promoted.data.previousKnownGoodCommit, record.baseCommit);

    const headAfterRollback = fixture.git("rev-parse", "HEAD").trim();
    const baseCommit = fixture.git("rev-parse", record.baseCommit).trim();
    // A revert commit exists on top of the merge; content is restored to base, but
    // the merge commit itself is never erased from history (no history rewrite).
    assert.notEqual(headAfterRollback, baseCommit);
    const content = await readFile(join(fixture.fixtureRoot, "src", "app.ts"), "utf8");
    assert.equal(content, "export const value = 1;\n");
  } finally {
    await teardown(fixture);
  }
});

// ── §9.6 — restart while awaiting approval -> still awaiting human ──────────
test("promotion: restart while awaiting human approval leaves it awaiting human", async () => {
  const fixture = await setupFixture();
  try {
    const record = await proposeAndAwaitHuman(fixture);
    await fixture.system.selfModification.recoverInProgress();

    const experiments = await fixture.system.selfModification.listExperiments();
    const recovered = experiments.find((r) => r.id === record.id);
    assert.equal(recovered?.status, "AWAITING_HUMAN");
  } finally {
    await teardown(fixture);
  }
});

// ── §9.7 — default branch untouched until explicit approval ────────────────
test("promotion: default branch is untouched until an explicit human approval and promotion", async () => {
  const fixture = await setupFixture();
  try {
    const record = await proposeAndAwaitHuman(fixture);
    const before = await readFile(join(fixture.fixtureRoot, "src", "app.ts"), "utf8");
    assert.equal(before, "export const value = 1;\n");

    await fixture.system.selfModification.recordHumanDecision({
      experimentId: record.id,
      decision: "APPROVE",
      patchFingerprint: record.patch!.fingerprint,
      actor: "human:reviewer-1",
    });
    const stillBefore = await readFile(join(fixture.fixtureRoot, "src", "app.ts"), "utf8");
    assert.equal(stillBefore, "export const value = 1;\n", "approval alone must never merge");

    const promoted = await fixture.system.selfModification.promote(record.id);
    assert.equal(promoted.ok, true);
    if (!promoted.ok) return;
    assert.equal(promoted.data.status, "PROMOTED", JSON.stringify({
      reason: promoted.data.reason,
      rollbackReason: promoted.data.rollbackReason,
      postMergeVerification: promoted.data.postMergeVerification,
    }));
    const after = await readFile(join(fixture.fixtureRoot, "src", "app.ts"), "utf8");
    assert.equal(after, "export const value = 2;\n");
  } finally {
    await teardown(fixture);
  }
});

// ── §8 — no self-approval adversarial tests ─────────────────────────────────
for (const forbiddenActor of ["evaluator", "scheduler", "candidate", "selfmod", "system", "quack"]) {
  test(`no-self-approval: actor "${forbiddenActor}" cannot record a human decision`, async () => {
    const fixture = await setupFixture();
    try {
      const record = await proposeAndAwaitHuman(fixture);
      const result = await fixture.system.selfModification.recordHumanDecision({
        experimentId: record.id,
        decision: "APPROVE",
        patchFingerprint: record.patch!.fingerprint,
        actor: forbiddenActor,
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "selfmod.self_approval_forbidden");
      assert.equal(result.error.category, "permission");

      const experiments = await readExperiments(fixture);
      assert.equal(experiments.find((r) => r.id === record.id)?.status, "AWAITING_HUMAN");
    } finally {
      await teardown(fixture);
    }
  });
}

test("no-self-approval: protected-core-classified proposals never reach AWAITING_HUMAN, so the gate cannot be crossed", async () => {
  const fixture = await setupFixture();
  try {
    const proposal = makeProposal({
      targetScope: ["src/selfmod/fake-controller.ts"],
      expectedFiles: ["src/selfmod/fake-controller.ts"],
      description: "Attempt to modify the self-modification gate itself.",
    });
    const result = await fixture.system.selfModification.proposeChange({
      proposal,
      edits: [{ path: "src/selfmod/fake-controller.ts", content: "export const backdoor = true;\n" }],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.status, "REJECTED");
    assert.equal(result.data.classification, "PROTECTED_QUACK_CORE");

    // Even a forged human decision cannot move a REJECTED, never-awaiting experiment forward.
    const forged = await fixture.system.selfModification.recordHumanDecision({
      experimentId: result.data.id,
      decision: "APPROVE",
      patchFingerprint: result.data.patch?.fingerprint ?? "",
      actor: "human:reviewer-1",
    });
    assert.equal(forged.ok, false);
    if (forged.ok) return;
    assert.equal(forged.error.code, "selfmod.invalid_state");
  } finally {
    await teardown(fixture);
  }
});
