import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createId, fail, now, ok, type QuackResult } from "../core/types.js";
import { isMissingFile, atomicWriteFile } from "../core/utils.js";
import { type EventBus } from "../events/event-bus.js";
import { PatchEngine } from "../intelligence/patch/patch-engine.js";
import {
  ObjectiveRegistry,
  type EvidenceExperienceStore,
  type ObjectiveSpecification,
  type ObjectiveEvaluation,
  type ObjectiveEvidence,
  type MetricObservation,
} from "../cos/index.js";
import { checkTestIntegrity } from "./integrity-checker.js";
import { classifyProposalScope, isProtectedClassification, riskForClassification } from "./protected-core-policy.js";
import { evaluateExperiment } from "./evaluator.js";
import { capturePatch } from "./patch.js";
import {
  type CodeExperimentRecord,
  type CodeImprovementProposal,
  type ExperimentLifecycleStatus,
  type HumanDecision,
  type ToolExecuteFn,
  type VerificationResult,
} from "./types.js";
import { GitWorktreeManager, type WorktreeHandle } from "./worktree-manager.js";
import { VerificationRunner } from "./verification-runner.js";

const ACTIVE_STATUSES: readonly ExperimentLifecycleStatus[] = [
  "WORKTREE_CREATED",
  "PATCHED",
  "VERIFYING",
  "EVALUATED",
  // PROMOTING is mid-merge: after a restart its outcome cannot be trusted (§38 applies to promotion too).
  "PROMOTING",
];

/**
 * §2/§8 — reserved internal identities that may never record a human decision.
 * This is defense in depth: the real guarantee is structural (no autonomous
 * code path in this class ever calls `recordHumanDecision`/`promote` itself),
 * but a caller-supplied actor string is cheap to check and costs nothing.
 */
const RESERVED_APPROVAL_ACTORS = new Set(["", "selfmod", "evaluator", "scheduler", "candidate", "system", "controller", "quack", "autonomous"]);

const PROMOTION_OBJECTIVE_ID = "quack.selfmod.promotion";

export interface HumanApprovalInput {
  readonly experimentId: string;
  readonly decision: HumanDecision;
  /** Must match `record.patch.fingerprint` exactly (§3); prevents approving a changed/stale patch. */
  readonly patchFingerprint: string;
  /** The real external human/API identity making the call (§2). Never defaulted. */
  readonly actor: string;
  readonly reason?: string;
}

function isConcreteSourcePath(path: string): boolean {
  return path.length > 0 && !path.includes("..") && !path.endsWith("/") && /\.[a-z0-9]+$/i.test(path);
}

export interface CodeExperimentLimits {
  readonly maxChangedFiles: number;
  readonly maxChangedLines: number;
  readonly maxCandidateRevisions: number;
  readonly maxConcurrentExperiments: number;
}

const DEFAULT_LIMITS: CodeExperimentLimits = {
  maxChangedFiles: 15,
  maxChangedLines: 800,
  maxCandidateRevisions: 1,
  maxConcurrentExperiments: 1,
};

export interface CodeExperimentStore {
  load(): Promise<readonly CodeExperimentRecord[]>;
  save(records: readonly CodeExperimentRecord[]): Promise<void>;
}

export class InMemoryCodeExperimentStore implements CodeExperimentStore {
  private records: readonly CodeExperimentRecord[] = [];
  async load(): Promise<readonly CodeExperimentRecord[]> {
    return this.records;
  }
  async save(records: readonly CodeExperimentRecord[]): Promise<void> {
    this.records = records;
  }
}

export class JsonFileCodeExperimentStore implements CodeExperimentStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<readonly CodeExperimentRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as CodeExperimentRecord[];
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  async save(records: readonly CodeExperimentRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await atomicWriteFile(this.filePath, JSON.stringify(records, null, 2));
  }
}

function buildPromotionObjective(): ObjectiveSpecification {
  return {
    id: PROMOTION_OBJECTIVE_ID,
    name: "Self-modification promotion outcome",
    description: "Whether a human-approved, fingerprint-matched code-change candidate survived post-merge verification in the real branch.",
    metrics: [
      {
        id: "selfmod.promotion.postmerge_passed",
        description: "Post-merge verification (typecheck + full test suite) passed after promotion.",
        direction: "target",
        measurementSource: "selfmod.promotion.postMergeVerification.allPassed",
        weight: 1,
        threshold: true,
      },
    ],
    constraints: [
      "Only a human-approved, fingerprint-matched patch may reach promotion.",
      "A passing pre-merge candidate is not sufficient evidence on its own; only post-merge verification counts here.",
    ],
    evaluationPolicy: {
      evaluatorId: "quack.selfmod.promotion-gate",
      minEvidenceCount: 1,
      requireBaseline: false,
    },
  };
}

export interface ProposeChangeInput {
  readonly proposal: CodeImprovementProposal;
  readonly edits: readonly { readonly path: string; readonly content: string }[];
}

export interface PendingProposalDecisionInput {
  readonly experimentId: string;
  readonly decision: HumanDecision;
  readonly actor: string;
  readonly reason?: string;
}

export interface ProposalLifecycleContext {
  readonly taskId?: string;
  readonly actor?: string;
}

/**
 * Orchestrates the full EVIDENCE PROPOSAL -> ISOLATED WORKTREE -> BOUNDED
 * PATCH -> VERIFICATION -> INDEPENDENT EVALUATION -> HUMAN GATE -> PROMOTION
 * pipeline (§ full spec). Every mutation/inspection step routes through the
 * injected `toolExecute` (== `QuackRuntime.executeTool`) so permissions stay
 * enforced; this class never calls child_process itself. `proposeChange` on
 * its own only ever reaches AWAITING_HUMAN, REJECTED, or ABORTED — it never
 * merges or replaces production code by itself. Crossing into the real
 * branch requires two further, separately-gated human-triggered calls:
 * `recordHumanDecision` (APPROVE/REJECT; rejects reserved internal actor
 * identities) and `promote` (re-validates approval/fingerprint/protected-core/
 * staleness, then `git merge --no-ff`, re-verifies post-merge, and
 * auto-rolls-back via `git revert` on regression) — see PROMOTED/ROLLED_BACK/
 * REVALIDATION_REQUIRED below.
 */
export class CodeImprovementController {
  private readonly limits: CodeExperimentLimits;
  private readonly baselineCache = new Map<string, VerificationResult>();

  constructor(
    private readonly deps: {
      readonly toolExecute: ToolExecuteFn;
      readonly workspaceRoot: string;
      readonly store: CodeExperimentStore;
      readonly events?: EventBus;
      readonly limits?: Partial<CodeExperimentLimits>;
      readonly actor?: string;
      /** §6 — optional: feeds promotion outcomes into the existing evidence/objective learning system. */
      readonly evidence?: EvidenceExperienceStore;
      readonly objectives?: ObjectiveRegistry;
    },
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...(deps.limits ?? {}) };
  }

  /** Conservative crash recovery (§38): anything mid-flight is not trustworthy after a restart. */
  async recoverInProgress(): Promise<void> {
    const records = await this.deps.store.load();
    const recovered = records.map((record) =>
      ACTIVE_STATUSES.includes(record.status)
        ? { ...record, status: "ABORTED" as const, reason: `${record.reason} (aborted on restart: in-progress state cannot be trusted).`, updatedAt: now() }
        : record,
    );
    await this.deps.store.save(recovered);
    const reconciled: CodeExperimentRecord[] = [];
    for (const record of recovered) {
      reconciled.push(record.status === "ABORTED" ? await this.releaseTerminalWorktree(record, createId("selfmod-recovery"), "selfmod-recovery") : record);
    }
    await this.deps.store.save(reconciled);
  }

  async listExperiments(): Promise<readonly CodeExperimentRecord[]> {
    return this.deps.store.load();
  }

  /** Persists a concrete, evidence-backed proposal without touching git or source files. */
  async queueProposal(proposal: CodeImprovementProposal, lifecycle: ProposalLifecycleContext = {}): Promise<QuackResult<CodeExperimentRecord>> {
    const experimentId = createId("selfmod-exp");
    const rejection = this.rejectPendingIfInvalid(experimentId, proposal);
    if (rejection) return this.finalize(rejection);
    const classification = classifyProposalScope([...proposal.expectedFiles, ...proposal.targetScope]);
    if (isProtectedClassification(classification)) {
      return this.finalize(this.record(experimentId, proposal, { status: "REJECTED", classification, reason: `Proposal targets ${classification}, which cannot enter the autonomous code-change pipeline.`, integrityFindings: [] }));
    }
    const pending = this.record(experimentId, proposal, {
      status: "PROPOSED",
      classification,
      reason: "Evidence-backed proposal persisted; awaiting explicit human approval before any worktree or source mutation.",
      integrityFindings: [],
    });
    await this.persist(pending);
    const taskId = lifecycle.taskId ?? createId("selfmod-task");
    const actor = lifecycle.actor ?? "improvement-proposal-bridge";
    await this.deps.events?.emit("code.change.proposed", { experimentId, proposalId: proposal.id }, { taskId, actor });
    await this.deps.events?.emit("proposal.awaiting_approval", { experimentId, proposalId: proposal.id }, { taskId, actor });
    return ok(pending);
  }

  /** Records a human decision for a conceptual proposal. Approval alone cannot create a worktree or patch. */
  async recordPendingProposalDecision(input: PendingProposalDecisionInput): Promise<QuackResult<CodeExperimentRecord>> {
    const actor = input.actor.trim();
    if (RESERVED_APPROVAL_ACTORS.has(actor.toLowerCase())) {
      return fail({ code: "selfmod.self_approval_forbidden", message: `Actor "${input.actor}" is a reserved internal identity; only a real external human/API caller may approve or reject a self-modification proposal.`, category: "permission", recoverable: false });
    }
    const record = (await this.deps.store.load()).find((candidate) => candidate.id === input.experimentId);
    if (!record) return fail({ code: "selfmod.not_found", message: `Experiment ${input.experimentId} was not found.`, category: "runtime", recoverable: true });
    if (record.status !== "PROPOSED") return fail({ code: "selfmod.invalid_state", message: `Experiment ${record.id} is in status ${record.status}, not PROPOSED.`, category: "validation", recoverable: false });
    const updated: CodeExperimentRecord = input.decision === "REJECT"
      ? { ...record, status: "REJECTED", humanDecision: "REJECT", humanDecisionActor: actor, humanDecisionAt: now(), reason: input.reason ?? "Rejected by human reviewer.", updatedAt: now() }
      : { ...record, status: "APPROVED", humanDecision: "APPROVE", humanDecisionActor: actor, humanDecisionAt: now(), reason: input.reason ?? "Approved by human reviewer; an isolated candidate may now be materialized.", updatedAt: now() };
    await this.persist(updated);
    const taskId = createId("selfmod-task");
    await this.deps.events?.emit(input.decision === "REJECT" ? "code.change.rejected" : "code.change.approved", { experimentId: record.id, reason: updated.reason }, { taskId, actor });
    return ok(updated);
  }

  /** Starts the existing isolated-worktree pipeline only after conceptual proposal approval. */
  async materializeApprovedProposal(experimentId: string, edits: readonly { readonly path: string; readonly content: string }[]): Promise<QuackResult<CodeExperimentRecord>> {
    const record = (await this.deps.store.load()).find((candidate) => candidate.id === experimentId);
    if (!record || record.status !== "APPROVED" || record.humanDecision !== "APPROVE" || !record.proposal) {
      return fail({ code: "selfmod.not_approved", message: `Experiment ${experimentId} needs an explicit pending-proposal approval before a worktree can be created.`, category: "permission", recoverable: false });
    }
    return this.proposeChange({ proposal: record.proposal, edits });
  }

  async proposeChange(input: ProposeChangeInput): Promise<QuackResult<CodeExperimentRecord>> {
    const { proposal, edits } = input;
    const taskId = createId("selfmod-task");
    const experimentId = createId("selfmod-exp");

    const rejection = await this.rejectIfInvalid(proposal, edits);
    if (rejection) return this.finalize(rejection);

    const classification = classifyProposalScope([...proposal.expectedFiles, ...edits.map((e) => e.path)]);
    if (isProtectedClassification(classification)) {
      return this.finalize(this.record(experimentId, proposal, {
        status: "REJECTED",
        classification,
        reason: `Proposal targets ${classification}, which cannot be modified by an autonomous experiment.`,
        integrityFindings: [],
      }));
    }

    const git = new GitWorktreeManager({ toolExecute: this.deps.toolExecute, taskId, actor: this.deps.actor });
    const baseCommitResult = await git.getHeadCommit();
    if (!baseCommitResult.ok) return fail(baseCommitResult.error);
    const baseCommit = baseCommitResult.data;

    const worktreeResult = await git.createWorktree(experimentId, baseCommit);
    if (!worktreeResult.ok) return fail(worktreeResult.error);
    const handle = worktreeResult.data;
    await this.deps.events?.emit("code.worktree.created", { experimentId, branchName: handle.branchName, baseCommit }, { taskId, actor: "selfmod" });

    const pending = this.record(experimentId, proposal, {
      status: "WORKTREE_CREATED",
      classification,
      baseCommit,
      branchName: handle.branchName,
      worktreePath: handle.relativePath,
      reason: "Worktree created; applying bounded patch.",
      integrityFindings: [],
    });
    await this.persist(pending);

    const patched = await this.applyAndVerify(pending, proposal, handle, edits, git, taskId);
    return this.finalize(patched);
  }

  /** Human-triggered rollback: discard the worktree/branch entirely (§34 — trivial in this phase). */
  async discardExperiment(experimentId: string): Promise<QuackResult<void>> {
    const records = await this.deps.store.load();
    const record = records.find((r) => r.id === experimentId);
    if (!record) return fail({ code: "selfmod.not_found", message: `Experiment ${experimentId} was not found.`, category: "runtime", recoverable: true });
    if (!record.branchName || !record.worktreePath) return ok(undefined);

    const taskId = createId("selfmod-task");
    const git = new GitWorktreeManager({ toolExecute: this.deps.toolExecute, taskId, actor: this.deps.actor });
    const removed = await git.removeWorktree({ branchName: record.branchName, relativePath: record.worktreePath, baseCommit: record.baseCommit });
    if (!removed.ok) return removed;

    await this.persist({ ...record, status: "ABORTED", reason: "Discarded by human operator.", updatedAt: now() });
    return ok(undefined);
  }

  /**
   * §2/§3 — the ONLY path that may move an experiment out of AWAITING_HUMAN.
   * Callers must supply a real external actor identity; nothing in this
   * class ever calls this method on its own experiments (structural
   * guarantee), and reserved internal identities are rejected outright
   * (defense in depth, §8).
   */
  async recordHumanDecision(input: HumanApprovalInput): Promise<QuackResult<CodeExperimentRecord>> {
    const actor = input.actor?.trim() ?? "";
    if (RESERVED_APPROVAL_ACTORS.has(actor.toLowerCase())) {
      return fail({
        code: "selfmod.self_approval_forbidden",
        message: `Actor "${input.actor}" is a reserved internal identity; only a real external human/API caller may approve or reject a self-modification proposal.`,
        category: "permission",
        recoverable: false,
      });
    }

    const records = await this.deps.store.load();
    const record = records.find((r) => r.id === input.experimentId);
    if (!record) {
      return fail({ code: "selfmod.not_found", message: `Experiment ${input.experimentId} was not found.`, category: "runtime", recoverable: true });
    }
    if (record.status !== "AWAITING_HUMAN") {
      return fail({
        code: "selfmod.invalid_state",
        message: `Experiment ${record.id} is in status ${record.status}, not AWAITING_HUMAN; a human decision cannot be recorded.`,
        category: "validation",
        recoverable: false,
      });
    }
    if (!record.patch || input.patchFingerprint !== record.patch.fingerprint) {
      return fail({
        code: "selfmod.fingerprint_mismatch",
        message: "Supplied patch fingerprint does not match the evaluated patch; the approval is refused so a changed/stale patch can never reuse an old decision.",
        category: "validation",
        recoverable: false,
      });
    }
    if (isProtectedClassification(record.classification)) {
      const rejected: CodeExperimentRecord = {
        ...record,
        status: "REJECTED",
        reason: `Change touches protected classification ${record.classification}; it cannot cross the human-approval gate.`,
        updatedAt: now(),
      };
      await this.persist(rejected);
      return fail({ code: "selfmod.protected_core", message: rejected.reason, category: "permission", recoverable: false });
    }

    const taskId = createId("selfmod-task");
    if (input.decision === "REJECT") {
      const updated: CodeExperimentRecord = {
        ...record,
        status: "REJECTED",
        humanDecision: "REJECT",
        humanDecisionActor: actor,
        humanDecisionAt: now(),
        reason: input.reason ?? "Rejected by human reviewer.",
        updatedAt: now(),
      };
      await this.persist(updated);
      await this.deps.events?.emit("code.change.rejected", { experimentId: record.id, reason: updated.reason }, { taskId, actor });
      return ok(await this.releaseTerminalWorktree(updated, taskId, actor));
    }

    const approved: CodeExperimentRecord = {
      ...record,
      status: "APPROVED",
      humanDecision: "APPROVE",
      humanDecisionActor: actor,
      humanDecisionAt: now(),
      approvedPatchFingerprint: input.patchFingerprint,
      reason: input.reason ?? "Approved by human reviewer; awaiting promotion.",
      updatedAt: now(),
    };
    await this.persist(approved);
    await this.deps.events?.emit("code.change.approved", { experimentId: record.id, fingerprint: input.patchFingerprint }, { taskId, actor });
    return ok(approved);
  }

  /**
   * §3/§4/§5/§6 — the only path that crosses an approved candidate into the
   * real branch. Re-validates every precondition (status, fingerprint,
   * protected-core, base staleness) before touching git, commits the
   * worktree's diff onto its own branch, merges with no force-push/history
   * rewrite, then re-runs full verification in the merged branch. A failing
   * post-merge check triggers an automatic, non-destructive rollback
   * (`git revert`), never a "best effort" partial merge.
   */
  async promote(experimentId: string, options?: { readonly actor?: string }): Promise<QuackResult<CodeExperimentRecord>> {
    const records = await this.deps.store.load();
    const record = records.find((r) => r.id === experimentId);
    if (!record) {
      return fail({ code: "selfmod.not_found", message: `Experiment ${experimentId} was not found.`, category: "runtime", recoverable: true });
    }
    if (record.status !== "APPROVED" || record.humanDecision !== "APPROVE") {
      return fail({
        code: "selfmod.not_approved",
        message: `Experiment ${record.id} has not been approved by a human reviewer (status: ${record.status}); promotion refused.`,
        category: "permission",
        recoverable: false,
      });
    }
    if (isProtectedClassification(record.classification)) {
      const rejected: CodeExperimentRecord = { ...record, status: "REJECTED", reason: "Protected classification detected at promotion time; aborting.", updatedAt: now() };
      await this.persist(rejected);
      return fail({ code: "selfmod.protected_core", message: rejected.reason, category: "permission", recoverable: false });
    }
    if (!record.patch || record.approvedPatchFingerprint !== record.patch.fingerprint) {
      return fail({
        code: "selfmod.fingerprint_mismatch",
        message: "The approved fingerprint no longer matches the recorded patch; re-approval is required before promotion.",
        category: "validation",
        recoverable: false,
      });
    }

    const taskId = createId("selfmod-task");
    const actor = options?.actor ?? this.deps.actor;
    const git = new GitWorktreeManager({ toolExecute: this.deps.toolExecute, taskId, actor });

    const headResult = await git.getHeadCommit();
    if (!headResult.ok) return fail(headResult.error);
    if (headResult.data !== record.baseCommit) {
      const stale: CodeExperimentRecord = {
        ...record,
        status: "REVALIDATION_REQUIRED",
        reason: `Base branch advanced since evaluation (HEAD ${headResult.data} != pinned base ${record.baseCommit}); revalidation is required before promotion.`,
        updatedAt: now(),
      };
      await this.persist(stale);
      await this.deps.events?.emit("code.change.revalidation_required", { experimentId: record.id }, { taskId, actor: "selfmod" });
      return ok(stale);
    }

    const promoting: CodeExperimentRecord = { ...record, status: "PROMOTING", reason: "Promotion in progress.", updatedAt: now() };
    await this.persist(promoting);
    await this.deps.events?.emit("code.change.promoting", { experimentId: record.id }, { taskId, actor });

    const commitMessage = `selfmod: ${record.reason}`.replace(/"/g, "'").slice(0, 200);
    const addResult = await git.runGit("add -A", record.worktreePath);
    if (!addResult.ok) return this.abortPromotion(record, taskId, `Failed to stage promoted changes: ${addResult.error.message}`);
    const commitResult = await git.runGit(`commit -m "${commitMessage}"`, record.worktreePath);
    if (!commitResult.ok) return this.abortPromotion(record, taskId, `Failed to commit promoted changes: ${commitResult.error.message}`);

    const mergeResult = await git.runGit(`merge --no-ff --no-edit ${record.branchName}`, ".");
    if (!mergeResult.ok) {
      await git.runGit("merge --abort", ".");
      const revalidate: CodeExperimentRecord = {
        ...record,
        status: "REVALIDATION_REQUIRED",
        reason: `Merge could not complete safely (${mergeResult.error.message}); aborted cleanly with no conflict left behind. Revalidation required.`,
        updatedAt: now(),
      };
      await this.persist(revalidate);
      await this.deps.events?.emit("code.change.revalidation_required", { experimentId: record.id, reason: revalidate.reason }, { taskId, actor: "selfmod" });
      return ok(revalidate);
    }

    const mergeCommitResult = await git.getHeadCommit();
    if (!mergeCommitResult.ok) return this.abortPromotion(record, taskId, `Could not read merge commit: ${mergeCommitResult.error.message}`);
    const promotionCommit = mergeCommitResult.data;

    const runner = new VerificationRunner({ toolExecute: this.deps.toolExecute, taskId, actor });
    await this.deps.events?.emit("code.verification.started", { experimentId: record.id, phase: "post-merge" }, { taskId, actor: "selfmod" });
    const postTargeted = await runner.runTargeted(".");
    const postFull = postTargeted.ok && postTargeted.data.allPassed ? await runner.runFull(".") : undefined;
    const postMergeVerification: VerificationResult | undefined = postFull?.ok ? postFull.data : postTargeted.ok ? postTargeted.data : undefined;
    const postMergePassed = postTargeted.ok && postTargeted.data.allPassed && !!postFull?.ok && postFull.data.allPassed;

    if (!postMergePassed) {
      const reason = !postTargeted.ok
        ? `Post-merge targeted verification failed to run: ${postTargeted.error.message}`
        : !postTargeted.data.allPassed
          ? "Post-merge targeted verification (typecheck) failed after merge."
          : !postFull?.ok
            ? `Post-merge full verification failed to run: ${postFull?.error.message}`
            : "Post-merge full verification (typecheck + test) failed after merge.";
      return this.rollback(record, git, promotionCommit, postMergeVerification, reason, taskId, actor);
    }

    await this.deps.events?.emit("code.verification.completed", { experimentId: record.id, phase: "post-merge", passed: true }, { taskId, actor: "selfmod" });
    const promoted: CodeExperimentRecord = {
      ...record,
      status: "PROMOTED",
      promotionCommit,
      postMergeVerification,
      previousKnownGoodCommit: record.baseCommit,
      reason: "Promoted: merged into base branch and post-merge verification passed.",
      updatedAt: now(),
    };
    await this.persist(promoted);
    await this.deps.events?.emit("code.change.promoted", { experimentId: record.id, promotionCommit }, { taskId, actor });
    await this.recordPromotionEvidence(promoted, "completed", "IMPROVED", taskId);
    return ok(await this.releaseTerminalWorktree(promoted, taskId, actor));
  }

  private async abortPromotion(record: CodeExperimentRecord, taskId: string, reason: string): Promise<QuackResult<CodeExperimentRecord>> {
    const aborted: CodeExperimentRecord = { ...record, status: "REVALIDATION_REQUIRED", reason, updatedAt: now() };
    await this.persist(aborted);
    await this.deps.events?.emit("code.change.revalidation_required", { experimentId: record.id, reason }, { taskId, actor: "selfmod" });
    return ok(aborted);
  }

  /** §6 — non-destructive rollback: `git revert` creates a new commit, never rewrites history. */
  private async rollback(
    record: CodeExperimentRecord,
    git: GitWorktreeManager,
    promotionCommit: string,
    postMergeVerification: VerificationResult | undefined,
    reason: string,
    taskId: string,
    actor: string | undefined,
  ): Promise<QuackResult<CodeExperimentRecord>> {
    const revertResult = await git.runGit(`revert --no-edit -m 1 ${promotionCommit}`, ".");
    if (!revertResult.ok) {
      await git.runGit("revert --abort", ".");
      // ponytail: automatic revert-of-revert not implemented; this leaves the merge commit in
      // place and flags it for manual operator intervention rather than guessing at a fix.
      const stuck: CodeExperimentRecord = {
        ...record,
        status: "PROMOTED",
        promotionCommit,
        postMergeVerification,
        rollbackReason: `${reason} Automatic rollback via 'git revert' also failed (${revertResult.error.message}); manual intervention required.`,
        updatedAt: now(),
      };
      await this.persist(stuck);
      await this.deps.events?.emit("code.change.rollback_failed", { experimentId: record.id, promotionCommit }, { taskId, actor: "selfmod" });
      await this.recordPromotionEvidence(stuck, "failed", "REGRESSED", taskId);
      return fail({ code: "selfmod.rollback_failed", message: stuck.rollbackReason!, category: "runtime", recoverable: false });
    }

    const rolledBack: CodeExperimentRecord = {
      ...record,
      status: "ROLLED_BACK",
      promotionCommit,
      postMergeVerification,
      previousKnownGoodCommit: record.baseCommit,
      rollbackReason: reason,
      rolledBackAt: now(),
      reason: `Rolled back: ${reason}`,
      updatedAt: now(),
    };
    await this.persist(rolledBack);
    await this.deps.events?.emit("code.change.rolled_back", { experimentId: record.id, promotionCommit, reason }, { taskId, actor: actor ?? "selfmod" });
    await this.recordPromotionEvidence(rolledBack, "failed", "REGRESSED", taskId);
    return ok(await this.releaseTerminalWorktree(rolledBack, taskId, actor));
  }

  /** §6 — feeds the existing evidence/objective learning system so QUACK can learn which promoted changes survive. */
  private async recordPromotionEvidence(
    record: CodeExperimentRecord,
    resultStatus: "completed" | "failed",
    conclusion: "IMPROVED" | "REGRESSED",
    taskId: string,
  ): Promise<void> {
    if (!this.deps.evidence) return;

    let objective = this.deps.objectives?.get(PROMOTION_OBJECTIVE_ID);
    if (!objective) {
      objective = buildPromotionObjective();
      try {
        this.deps.objectives?.register(objective);
      } catch {
        // ponytail: race between get() and register() across concurrent promotions; the
        // in-memory literal built above is still a valid ObjectiveSpecification either way.
      }
    }

    const timestamp = now();
    const runId = record.id;
    const observation: MetricObservation = {
      id: createId("selfmod-metric"),
      objectiveId: PROMOTION_OBJECTIVE_ID,
      metricId: "selfmod.promotion.postmerge_passed",
      runId,
      source: "selfmod.promotion",
      value: resultStatus === "completed",
      valid: true,
      observedAt: timestamp,
      sequence: 0,
    };
    const evidenceItem: ObjectiveEvidence = {
      id: createId("selfmod-evidence"),
      objectiveId: PROMOTION_OBJECTIVE_ID,
      runId,
      metricId: observation.metricId,
      observationId: observation.id,
      evaluatorId: "quack.selfmod.promotion-gate",
      source: "selfmod.promotion",
      observedValue: observation.value,
      conclusion,
      confidence: 1,
      createdAt: timestamp,
    };
    const evaluation: ObjectiveEvaluation = {
      id: createId("selfmod-evaluation"),
      objectiveId: PROMOTION_OBJECTIVE_ID,
      runId,
      status: conclusion,
      summary:
        resultStatus === "completed"
          ? "Promoted patch passed post-merge verification (typecheck + full test suite)."
          : `Promoted patch regressed post-merge and was handled per rollback policy: ${record.rollbackReason ?? "unknown reason"}.`,
      observations: [observation],
      evidence: [evidenceItem],
      confidence: 1,
      createdAt: timestamp,
    };

    await this.deps.evidence.save({
      id: createId("selfmod-experience"),
      objective,
      runId,
      taskId,
      execution: { selectedSkills: [] },
      actions: [
        `Applied proposal ${record.proposalId} to branch ${record.branchName}`,
        `Merged commit ${record.promotionCommit ?? "unknown"} onto base ${record.baseCommit}`,
      ],
      outcomes: [record.reason],
      metricObservations: [observation],
      evaluation,
      evidence: [evidenceItem],
      resultStatus,
      traceRefs: [record.id],
      createdAt: timestamp,
    });
  }

  private async rejectIfInvalid(
    proposal: CodeImprovementProposal,
    edits: readonly { readonly path: string; readonly content: string }[],
  ): Promise<CodeExperimentRecord | undefined> {
    const experimentId = createId("selfmod-exp");
    if (proposal.sourceEvidenceRefs.length === 0 || proposal.hypothesis.trim().length === 0) {
      return this.record(experimentId, proposal, {
        status: "REJECTED",
        classification: "APPLICATION_CODE",
        reason: "Proposal lacks evidence references or a hypothesis.",
        integrityFindings: [],
      });
    }
    if (proposal.expectedFiles.length === 0) {
      return this.record(experimentId, proposal, {
        status: "REJECTED",
        classification: "APPLICATION_CODE",
        reason: "Proposal declares no expected file scope.",
        integrityFindings: [],
      });
    }
    if (edits.length > this.limits.maxChangedFiles) {
      return this.record(experimentId, proposal, {
        status: "REJECTED",
        classification: "APPLICATION_CODE",
        reason: `Edit set (${edits.length} files) exceeds maxChangedFiles (${this.limits.maxChangedFiles}).`,
        integrityFindings: [],
      });
    }
    const outOfScope = edits.filter((edit) => !proposal.expectedFiles.includes(edit.path));
    if (outOfScope.length > 0) {
      return this.record(experimentId, proposal, {
        status: "REJECTED",
        classification: "APPLICATION_CODE",
        reason: `Edits touch file(s) outside the declared scope: ${outOfScope.map((e) => e.path).join(", ")}.`,
        integrityFindings: [],
      });
    }

    // maxConcurrentExperiments defaults to 1, which by itself serializes every proposal —
    // no two active experiments can ever mutate overlapping scope concurrently (§36).
    const active = (await this.deps.store.load()).filter((r) => ACTIVE_STATUSES.includes(r.status));
    if (active.length >= this.limits.maxConcurrentExperiments) {
      return this.record(experimentId, proposal, {
        status: "REJECTED",
        classification: "APPLICATION_CODE",
        reason: `maxConcurrentExperiments (${this.limits.maxConcurrentExperiments}) is already in use.`,
        integrityFindings: [],
      });
    }
    return undefined;
  }

  private async applyAndVerify(
    pending: CodeExperimentRecord,
    proposal: CodeImprovementProposal,
    handle: WorktreeHandle,
    edits: readonly { readonly path: string; readonly content: string }[],
    git: GitWorktreeManager,
    taskId: string,
  ): Promise<CodeExperimentRecord> {
    const worktreeAbsPath = resolve(this.deps.workspaceRoot, handle.relativePath);
    const patchEngine = new PatchEngine({ workspaceRoot: worktreeAbsPath });

    const patch = await patchEngine.createFullPatch(proposal.description, [...edits]);
    const applied = await patchEngine.applyPatch(patch);
    if (!applied.success) {
      return { ...pending, status: "ABORTED", reason: `Failed to apply patch: ${applied.error}`, updatedAt: now() };
    }

    const artifactResult = await capturePatch(git, handle.relativePath, handle.baseCommit);
    if (!artifactResult.ok) {
      return { ...pending, status: "ABORTED", reason: `Failed to capture patch diff: ${artifactResult.error.message}`, updatedAt: now() };
    }
    const artifact = artifactResult.data;
    await this.deps.events?.emit("code.patch.generated", { experimentId: pending.id, fingerprint: artifact.fingerprint }, { taskId, actor: "selfmod" });

    if (artifact.changedFiles.length > this.limits.maxChangedFiles || artifact.insertions + artifact.deletions > this.limits.maxChangedLines) {
      return {
        ...pending,
        status: "REJECTED",
        patch: artifact,
        reason: `Realized patch (${artifact.changedFiles.length} files, ${artifact.insertions + artifact.deletions} lines) exceeds configured bounds.`,
        updatedAt: now(),
      };
    }

    const integrityFindings = checkTestIntegrity(artifact);
    const runner = new VerificationRunner({ toolExecute: this.deps.toolExecute, taskId, actor: this.deps.actor });

    await this.deps.events?.emit("code.verification.started", { experimentId: pending.id, phase: "targeted" }, { taskId, actor: "selfmod" });
    const targeted = await runner.runTargeted(handle.relativePath);
    if (!targeted.ok) {
      return { ...pending, status: "REJECTED", patch: artifact, integrityFindings, reason: `Targeted verification failed to run: ${targeted.error.message}`, updatedAt: now() };
    }
    if (!targeted.data.allPassed) {
      await this.deps.events?.emit("code.verification.completed", { experimentId: pending.id, phase: "targeted", passed: false }, { taskId, actor: "selfmod" });
      return { ...pending, status: "REJECTED", patch: artifact, integrityFindings, candidateVerification: targeted.data, reason: "Targeted verification (typecheck) failed.", updatedAt: now() };
    }

    const full = await runner.runFull(handle.relativePath);
    if (!full.ok) {
      return { ...pending, status: "REJECTED", patch: artifact, integrityFindings, reason: `Full verification failed to run: ${full.error.message}`, updatedAt: now() };
    }
    await this.deps.events?.emit("code.verification.completed", { experimentId: pending.id, phase: "full", passed: full.data.allPassed }, { taskId, actor: "selfmod" });

    const staleBase = await this.checkStaleBase(git, handle.baseCommit);
    const baselineVerification = await this.getOrComputeBaseline(handle.baseCommit, taskId);

    const outcome = evaluateExperiment({
      classification: pending.classification,
      staleBase,
      integrityFindings,
      baselineVerification,
      candidateVerification: full.data,
    });

    const status = outcome.promotionDecision === "ELIGIBLE_FOR_HUMAN_REVIEW" ? "AWAITING_HUMAN" : "REJECTED";
    if (status === "AWAITING_HUMAN") {
      await this.deps.events?.emit("code.change.awaiting_human", { experimentId: pending.id, fingerprint: artifact.fingerprint }, { taskId, actor: "selfmod" });
      await this.deps.events?.emit("code.change.eligible", { experimentId: pending.id }, { taskId, actor: "selfmod" });
    } else {
      await this.deps.events?.emit("code.change.rejected", { experimentId: pending.id, reason: outcome.reason }, { taskId, actor: "selfmod" });
    }

    return {
      ...pending,
      status,
      patch: artifact,
      integrityFindings,
      staleBase,
      baselineVerification,
      candidateVerification: full.data,
      evaluationDecision: outcome.evaluationDecision,
      promotionDecision: outcome.promotionDecision,
      reason: outcome.reason,
      updatedAt: now(),
    };
  }

  private async checkStaleBase(git: GitWorktreeManager, baseCommit: string): Promise<"CURRENT" | "REVALIDATE"> {
    const head = await git.getHeadCommit();
    if (!head.ok) return "REVALIDATE";
    return head.data === baseCommit ? "CURRENT" : "REVALIDATE";
  }

  private async getOrComputeBaseline(baseCommit: string, taskId: string): Promise<VerificationResult | undefined> {
    const cached = this.baselineCache.get(baseCommit);
    if (cached) return cached;

    const runner = new VerificationRunner({ toolExecute: this.deps.toolExecute, taskId, actor: this.deps.actor });
    const currentHead = await new GitWorktreeManager({ toolExecute: this.deps.toolExecute, taskId, actor: this.deps.actor }).getHeadCommit();
    if (!currentHead.ok || currentHead.data !== baseCommit) return undefined;

    const result = await runner.runFull(".");
    if (!result.ok) return undefined;
    this.baselineCache.set(baseCommit, result.data);
    return result.data;
  }

  private record(
    id: string,
    proposal: CodeImprovementProposal,
    fields: {
      readonly status: ExperimentLifecycleStatus;
      readonly classification: CodeExperimentRecord["classification"];
      readonly reason: string;
      readonly integrityFindings: CodeExperimentRecord["integrityFindings"];
      readonly baseCommit?: string;
      readonly branchName?: string;
      readonly worktreePath?: string;
    },
  ): CodeExperimentRecord {
    const timestamp = now();
    return {
      id,
      proposalId: proposal.id,
      proposal,
      objectiveId: proposal.objectiveId,
      branchName: fields.branchName ?? "",
      worktreePath: fields.worktreePath ?? "",
      baseCommit: fields.baseCommit ?? "",
      status: fields.status,
      classification: fields.classification,
      risk: riskForClassification(fields.classification),
      integrityFindings: fields.integrityFindings,
      reason: fields.reason,
      revisions: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private async persist(record: CodeExperimentRecord): Promise<void> {
    const records = await this.deps.store.load();
    const withoutRecord = records.filter((r) => r.id !== record.id);
    await this.deps.store.save([...withoutRecord, record]);
  }

  private rejectPendingIfInvalid(experimentId: string, proposal: CodeImprovementProposal): CodeExperimentRecord | undefined {
    if (proposal.sourceEvidenceRefs.length === 0 || proposal.hypothesis.trim().length === 0 || proposal.description.trim().length === 0) {
      return this.record(experimentId, proposal, { status: "REJECTED", classification: "APPLICATION_CODE", reason: "Proposal lacks evidence references, a hypothesis, or a concrete description.", integrityFindings: [] });
    }
    if (proposal.expectedFiles.length === 0 || proposal.targetScope.length === 0 || proposal.expectedFiles.some((path) => !isConcreteSourcePath(path))) {
      return this.record(experimentId, proposal, { status: "REJECTED", classification: "APPLICATION_CODE", reason: "Proposal declares no concrete source-file scope.", integrityFindings: [] });
    }
    return undefined;
  }

  private async finalize(record: CodeExperimentRecord): Promise<QuackResult<CodeExperimentRecord>> {
    await this.persist(record);
    return ok(record.status === "REJECTED" || record.status === "ABORTED"
      ? await this.releaseTerminalWorktree(record, createId("selfmod-cleanup"), "selfmod")
      : record);
  }

  private async releaseTerminalWorktree(record: CodeExperimentRecord, taskId: string, actor?: string): Promise<CodeExperimentRecord> {
    if (!record.branchName || !record.worktreePath) return record;
    const git = new GitWorktreeManager({ toolExecute: this.deps.toolExecute, taskId, actor });
    const released = await git.removeWorktree({ branchName: record.branchName, relativePath: record.worktreePath, baseCommit: record.baseCommit });
    if (released.ok) return record;
    const reconciled = { ...record, reason: `${record.reason} Worktree cleanup requires reconciliation: ${released.error.message}`, updatedAt: now() };
    await this.persist(reconciled);
    await this.deps.events?.emit("code.worktree.cleanup_failed", { experimentId: record.id, reason: released.error.message }, { taskId, actor: actor ?? "selfmod" });
    return reconciled;
  }
}
