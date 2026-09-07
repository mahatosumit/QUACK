import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createId, now } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";
import { type CodeImprovementProposal } from "./types.js";
import { type ImprovementReviewItem } from "../adaptive/evidence-improvement-cycle.js";

/**
 * Production-path integration test (§59): a real git repository, real
 * worktree creation, real PatchEngine file writes, real diff/fingerprint
 * capture, and the real evaluator/controller state machine — all wired
 * through `createQuackSystem`, exactly as QUACK boots in production. Only
 * the fixture repo's own `typecheck`/`test` npm scripts are stubbed (plain
 * `node -e` one-liners) so the check is fast and deterministic without
 * needing a full TypeScript toolchain inside the throwaway fixture.
 */
test("self-modification gate runs a real proposal end-to-end to AWAITING_HUMAN with no merge", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "quack-selfmod-fixture-"));
  const dataDir = join(fixtureRoot, ".quack-data");

  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: fixtureRoot, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "quack-selfmod-test@example.com");
    git("config", "user.name", "QUACK Selfmod Test");

    await mkdir(join(fixtureRoot, "src"), { recursive: true });
    await writeFile(
      join(fixtureRoot, "package.json"),
      JSON.stringify(
        {
          name: "quack-selfmod-fixture",
          version: "1.0.0",
          private: true,
          scripts: {
            typecheck: "node -e \"process.exit(0)\"",
            test: "node -e \"console.log('# pass 3'); console.log('# fail 0');\"",
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

    const proposal: CodeImprovementProposal = {
      id: createId("selfmod-proposal"),
      sourceEvidenceRefs: ["evidence-fixture-1"],
      hypothesis: "Bumping the exported constant is a safe, in-scope change.",
      objectiveId: "demo-objective",
      targetScope: ["src/app.ts"],
      expectedFiles: ["src/app.ts"],
      description: "Update src/app.ts constant from 1 to 2.",
      createdAt: now(),
    };

    const result = await system.selfModification.proposeChange({
      proposal,
      edits: [{ path: "src/app.ts", content: "export const value = 2;\n" }],
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    const record = result.data;
    assert.equal(record.status, "AWAITING_HUMAN");
    assert.equal(record.promotionDecision, "ELIGIBLE_FOR_HUMAN_REVIEW");
    assert.equal(record.classification, "APPLICATION_CODE");
    assert.equal(record.integrityFindings.length, 0);
    assert.ok(record.patch);
    assert.deepEqual(record.patch?.changedFiles, ["src/app.ts"]);
    assert.equal(record.candidateVerification?.allPassed, true);

    // The gate never merges: the fixture's default working tree must be
    // untouched, while the isolated worktree holds the patched content.
    const defaultBranchContent = await readFile(join(fixtureRoot, "src", "app.ts"), "utf8");
    assert.equal(defaultBranchContent, "export const value = 1;\n");
    const worktreeContent = await readFile(join(fixtureRoot, record.worktreePath, "src", "app.ts"), "utf8");
    assert.equal(worktreeContent, "export const value = 2;\n");
  } finally {
    await cleanupFixture(fixtureRoot);
  }
});

test("approved improvement proposal enters the existing isolated-worktree gate", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "quack-bridge-fixture-"));
  const dataDir = join(fixtureRoot, ".quack-data");
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: fixtureRoot, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "quack-bridge-test@example.com");
    git("config", "user.name", "QUACK Bridge Test");
    await mkdir(join(fixtureRoot, "src"), { recursive: true });
    await writeFile(join(fixtureRoot, "package.json"), JSON.stringify({
      name: "quack-bridge-fixture", version: "1.0.0", private: true,
      scripts: { typecheck: "node -e \"process.exit(0)\"", test: "node -e \"console.log('# pass 3'); console.log('# fail 0');\"" },
    }), "utf8");
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
    const timestamp = now();
    const review: ImprovementReviewItem = {
      id: "review-bridge", key: "review-bridge", kind: "degraded_skill", status: "queued",
      objectiveId: "demo-objective", priority: 1, risk: "REQUIRES_APPROVAL", evidenceRefs: ["evidence-fixture-1"],
      experimentIds: [], reason: "A bounded source change is supported by evidence.", retries: 0, createdAt: timestamp, updatedAt: timestamp,
      codeProposal: {
        sourceEvidenceRefs: ["evidence-fixture-1"], hypothesis: "Changing the constant removes the observed failure.",
        targetScope: ["src/app.ts"], expectedFiles: ["src/app.ts"], description: "Update src/app.ts constant from 1 to 2.",
      },
    };
    const queued = await system.improvementProposalBridge.createPendingProposals([review], { taskId: "mission-bridge", origin: "user" });
    assert.equal(queued.proposals.length, 1);
    const pending = queued.proposals[0];
    assert.ok(pending);
    if (!pending) return;
    assert.equal(pending.status, "PROPOSED");
    assert.equal(await readFile(join(fixtureRoot, "src", "app.ts"), "utf8"), "export const value = 1;\n");

    const approval = await system.selfModification.recordPendingProposalDecision({ experimentId: pending.id, decision: "APPROVE", actor: "human-reviewer" });
    assert.equal(approval.ok, true);
    const materialized = await system.selfModification.materializeApprovedProposal(pending.id, [{ path: "src/app.ts", content: "export const value = 2;\n" }]);
    assert.equal(materialized.ok, true);
    if (!materialized.ok) return;
    assert.equal(materialized.data.status, "AWAITING_HUMAN");
    assert.equal(await readFile(join(fixtureRoot, "src", "app.ts"), "utf8"), "export const value = 1;\n");
    assert.equal(await readFile(join(fixtureRoot, materialized.data.worktreePath, "src", "app.ts"), "utf8"), "export const value = 2;\n");
  } finally {
    await cleanupFixture(fixtureRoot);
  }
});

async function cleanupFixture(fixtureRoot: string): Promise<void> {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: fixtureRoot, encoding: "utf8" });
  const worktrees = git("worktree", "list", "--porcelain")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  for (const worktree of worktrees.slice(1)) git("worktree", "remove", "--force", worktree);
  git("worktree", "prune", "--expire", "now");
  const branches = git("for-each-ref", "--format=%(refname:short)", "refs/heads/quack-selfmod/").split(/\r?\n/).filter(Boolean);
  for (const branch of branches) git("branch", "-D", branch);
  assert.equal(git("worktree", "list", "--porcelain").split(/\r?\n/).filter((line) => line.startsWith("worktree ")).length, 1);
  await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5 });
}
