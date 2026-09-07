import { isProtectedClassification } from "./protected-core-policy.js";
import {
  type EvaluationDecision,
  type MutationTargetClassification,
  type PromotionDecision,
  type StaleBaseDecision,
  type TestIntegrityFinding,
  type VerificationResult,
} from "./types.js";

export interface EvaluationInput {
  readonly classification: MutationTargetClassification;
  readonly staleBase: StaleBaseDecision;
  readonly integrityFindings: readonly TestIntegrityFinding[];
  readonly baselineVerification?: VerificationResult;
  readonly candidateVerification: VerificationResult;
}

export interface EvaluationOutcome {
  readonly evaluationDecision: EvaluationDecision;
  readonly promotionDecision: PromotionDecision;
  readonly reason: string;
}

/**
 * Deterministic, code-only evaluation (§29/§31). The patch author never
 * evaluates its own patch — this function only reads structured verification
 * results, never natural language, and never returns an auto-merge outcome:
 * the best any application-code change can reach is ELIGIBLE_FOR_HUMAN_REVIEW.
 */
export function evaluateExperiment(input: EvaluationInput): EvaluationOutcome {
  if (isProtectedClassification(input.classification)) {
    return {
      evaluationDecision: "INCONCLUSIVE",
      promotionDecision: "REJECT",
      reason: `Change touches ${input.classification}, which is not eligible for autonomous self-modification.`,
    };
  }

  if (input.staleBase === "REBASE_REQUIRED") {
    return {
      evaluationDecision: "INCONCLUSIVE",
      promotionDecision: "REVISE",
      reason: "Base commit is behind the current branch; the experiment must be rebased before it can be evaluated.",
    };
  }
  if (input.staleBase === "REVALIDATE") {
    return {
      evaluationDecision: "INSUFFICIENT_EVIDENCE",
      promotionDecision: "COLLECT_MORE_DATA",
      reason: "Base commit has diverged since verification ran; results must be revalidated against current HEAD.",
    };
  }

  if (!input.candidateVerification.allPassed) {
    return {
      evaluationDecision: "REGRESSED",
      promotionDecision: "REJECT",
      reason: "Candidate verification did not pass; see verification check results for the failing step.",
    };
  }

  if (input.integrityFindings.length > 0) {
    return {
      evaluationDecision: "INCONCLUSIVE",
      promotionDecision: "ELIGIBLE_FOR_HUMAN_REVIEW",
      reason: `Candidate passed verification, but ${input.integrityFindings.length} test/config-integrity finding(s) mean the green result cannot be trusted without human review.`,
    };
  }

  const baselinePass = countPassing(input.baselineVerification);
  const candidatePass = countPassing(input.candidateVerification) ?? 0;
  if (baselinePass === undefined) {
    return {
      evaluationDecision: "INSUFFICIENT_EVIDENCE",
      promotionDecision: "COLLECT_MORE_DATA",
      reason: "No baseline verification is recorded, so no regression comparison is possible.",
    };
  }

  const evaluationDecision: EvaluationDecision =
    candidatePass > baselinePass ? "IMPROVED" : candidatePass === baselinePass ? "UNCHANGED" : "REGRESSED";

  if (evaluationDecision === "REGRESSED") {
    return {
      evaluationDecision,
      promotionDecision: "REJECT",
      reason: `Candidate passed fewer checks (${candidatePass}) than baseline (${baselinePass}).`,
    };
  }

  return {
    evaluationDecision,
    promotionDecision: "ELIGIBLE_FOR_HUMAN_REVIEW",
    reason: "Candidate passed full verification with no integrity findings and no regression versus baseline.",
  };
}

function countPassing(result: VerificationResult | undefined): number | undefined {
  if (!result) return undefined;
  return [...result.targeted, ...result.full].filter((check) => check.passed).length;
}
