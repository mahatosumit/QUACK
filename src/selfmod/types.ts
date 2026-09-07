import { type IsoTimestamp, type JsonObject, type QuackResult } from "../core/types.js";

/** §4 — every proposed change targets exactly one classification. */
export type MutationTargetClassification =
  | "APPLICATION_CODE"
  | "QUACK_NONCRITICAL_EXTENSION"
  | "PROTECTED_QUACK_CORE"
  | "SECURITY_CRITICAL"
  | "EVALUATOR_CRITICAL"
  | "CONFIGURATION"
  | "TEST_ONLY";

/** §8 — reused, not duplicated, risk vocabulary. */
export type CodeChangeRisk = "SAFE_AUTOMATIC" | "REQUIRES_APPROVAL" | "PROHIBITED_AUTONOMOUSLY";

/** §38 — crash-recovery lifecycle states. */
export type ExperimentLifecycleStatus =
  | "PROPOSED"
  | "WORKTREE_CREATED"
  | "PATCHED"
  | "VERIFYING"
  | "EVALUATED"
  | "AWAITING_HUMAN"
  | "REJECTED"
  | "ABORTED"
  | "APPROVED"
  | "REVALIDATION_REQUIRED"
  | "PROMOTING"
  | "PROMOTED"
  | "ROLLED_BACK";

/** Human promotion gate (§2): only a real external/human/API caller may ever produce APPROVE. */
export type HumanDecision = "APPROVE" | "REJECT";

/** §6 — structured proposal. Weak/missing evidence must be rejected before any mutation. */
export interface CodeImprovementProposal {
  readonly id: string;
  readonly sourceEvidenceRefs: readonly string[];
  readonly hypothesis: string;
  readonly objectiveId: string;
  readonly targetScope: readonly string[];
  readonly expectedFiles: readonly string[];
  readonly description: string;
  readonly createdAt: IsoTimestamp;
}

/** §11/§17/§18 — pinned base commit and machine-readable patch artifact. */
export interface PatchArtifact {
  readonly baseCommit: string;
  readonly changedFiles: readonly string[];
  readonly addedFiles: readonly string[];
  readonly deletedFiles: readonly string[];
  readonly diff: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly fingerprint: string;
}

export interface VerificationCheckResult {
  readonly name: string;
  readonly command: string;
  readonly passed: boolean;
  readonly summary: string;
  readonly durationMs: number;
  readonly passCount?: number;
  readonly failCount?: number;
  readonly evidenceRef?: string;
  readonly exitCode?: number;
  readonly processErrorCode?: string;
  readonly signal?: string;
  readonly killed?: boolean;
}

/** §22 — structured verification contract, never natural-language-only. */
export interface VerificationResult {
  readonly targeted: readonly VerificationCheckResult[];
  readonly full: readonly VerificationCheckResult[];
  readonly allPassed: boolean;
}

/** §29 — evaluator decision vocabulary, independent of the patch author. */
export type EvaluationDecision = "IMPROVED" | "REGRESSED" | "UNCHANGED" | "INCONCLUSIVE" | "INSUFFICIENT_EVIDENCE";

/** §29/§31 — promotion vocabulary. ELIGIBLE_FOR_HUMAN_REVIEW is a terminal, non-merging state. */
export type PromotionDecision = "ELIGIBLE_FOR_HUMAN_REVIEW" | "REJECT" | "REVISE" | "COLLECT_MORE_DATA";

/** §12 — stale-base vocabulary. */
export type StaleBaseDecision = "CURRENT" | "REBASE_REQUIRED" | "REVALIDATE" | "REQUIRE_HUMAN_REVIEW";

/** §25 — test/config gaming heuristics. Heuristics only; never proof of semantic correctness. */
export interface TestIntegrityFinding {
  readonly file: string;
  readonly kind: "skip" | "only" | "assertion_weakened" | "test_deleted" | "test_script_changed" | "config_changed";
  readonly detail: string;
}

/** §10 — full experiment ownership + provenance record. */
export interface CodeExperimentRecord {
  readonly id: string;
  readonly proposalId: string;
  /** Present for persisted conceptual proposals that have not created a worktree or patch. */
  readonly proposal?: CodeImprovementProposal;
  readonly objectiveId?: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly baseCommit: string;
  readonly status: ExperimentLifecycleStatus;
  readonly classification: MutationTargetClassification;
  readonly risk: CodeChangeRisk;
  readonly patch?: PatchArtifact;
  readonly baselineVerification?: VerificationResult;
  readonly candidateVerification?: VerificationResult;
  readonly integrityFindings: readonly TestIntegrityFinding[];
  readonly staleBase?: StaleBaseDecision;
  readonly evaluationDecision?: EvaluationDecision;
  readonly promotionDecision?: PromotionDecision;
  readonly reason: string;
  readonly revisions: number;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  /** §2/§3 — set only by `recordHumanDecision`; never written by any autonomous code path. */
  readonly humanDecision?: HumanDecision;
  readonly humanDecisionActor?: string;
  readonly humanDecisionAt?: IsoTimestamp;
  /** §3 — the exact fingerprint a human approved; re-checked bit-for-bit at promotion time. */
  readonly approvedPatchFingerprint?: string;
  /** §4 — set once the worktree diff is committed and merged into the base branch. */
  readonly promotionCommit?: string;
  /** §5 — result of running the full verification suite again after promotion, in the base branch. */
  readonly postMergeVerification?: VerificationResult;
  /** §6 — rollback bookkeeping; `previousKnownGoodCommit` is always the pinned `baseCommit`. */
  readonly rollbackReason?: string;
  readonly rolledBackAt?: IsoTimestamp;
  readonly previousKnownGoodCommit?: string;
}

/** §33 — concise human review package. */
export interface ReviewArtifact {
  readonly experimentId: string;
  readonly proposal: CodeImprovementProposal;
  readonly baseCommit: string;
  readonly filesChanged: readonly string[];
  readonly patchFingerprint: string;
  readonly patchSummary: string;
  readonly targetedVerification: readonly VerificationCheckResult[];
  readonly fullVerification: readonly VerificationCheckResult[];
  readonly integrityFindings: readonly TestIntegrityFinding[];
  readonly classification: MutationTargetClassification;
  readonly risk: CodeChangeRisk;
  readonly evaluationDecision: EvaluationDecision;
  readonly promotionDecision: PromotionDecision;
  readonly reason: string;
}

/**
 * §15/§16 — the only mutation/inspection path. Every git/test/build command
 * must route through the existing ToolRegistry + permission gate; this type
 * is intentionally the same shape as `QuackRuntime.executeTool`.
 */
export type ToolExecuteFn = (
  toolId: string,
  input: JsonObject,
  options: { readonly taskId: string; readonly actor?: string },
) => Promise<QuackResult<JsonObject>>;
