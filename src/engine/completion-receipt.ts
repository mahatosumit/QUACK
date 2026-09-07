import { createHash } from "node:crypto";
import { QUACK_CONTRACT_VERSION, type EvidenceRecordV1, type QuackContractVersion, type VerificationRecordV1 } from "../contracts/v1/contracts.js";
import { createId, now, type IsoTimestamp, type JsonObject, type QuackResult, fail } from "../core/types.js";
import type { ExecutionIdentity } from "./execution-recovery.js";

/**
 * QUACK Completion Receipt v1.
 *
 * A completion receipt is the explainable proof chain for a COMPLETED
 * mission: it cites the execution identity, the durable workflow evidence,
 * and the verification record that the checkpoint already authoritatively
 * stores (ADR 0028). The receipt is derived output, not a second source of
 * truth: the versioned execution checkpoint remains authoritative for
 * execution state, invocation outcomes, evidence, and verification.
 */
export interface CompletionReceiptV1 {
  readonly contractVersion: QuackContractVersion;
  readonly id: string;
  readonly missionId: string;
  readonly executionId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly workflowId: string;
  readonly issuedAt: IsoTimestamp;
  readonly summary: string;
  readonly evidenceId: string;
  readonly evidenceDigest: string;
  readonly evidenceCreatedAt: IsoTimestamp;
  readonly verifier: string;
  readonly verificationStatus: "PASSED" | "FAILED" | "INCONCLUSIVE";
  readonly verificationId?: string;
  readonly verifiedAt: IsoTimestamp;
  readonly independent: boolean;
}

export interface CompletionReceiptInput {
  readonly identity: ExecutionIdentity;
  readonly summary: string;
  readonly evidence: EvidenceRecordV1;
  readonly verification: {
    readonly success: boolean;
    readonly reason: string;
    readonly evidenceId: string;
    readonly record?: VerificationRecordV1;
  };
  readonly independent: boolean;
}

/**
 * Build a validated completion receipt from the durable chain. Fails closed
 * when verification is missing, unsuccessful, unbound to the cited evidence,
 * or when evidence identity does not match the execution identity.
 */
export function buildCompletionReceipt(input: CompletionReceiptInput): QuackResult<CompletionReceiptV1> {
  const { identity, evidence, verification } = input;
  if (!input.summary?.trim()) {
    return fail({ code: "completion.summary_missing", message: "Completion receipt requires a summary.", category: "validation", recoverable: false });
  }
  if (!verification.success) {
    return fail({ code: "completion.verification_failed", message: `Cannot receipt an unverified execution: ${verification.reason}.`, category: "validation", recoverable: false });
  }
  if (verification.evidenceId !== evidence.id) {
    return fail({ code: "completion.evidence_mismatch", message: "Verification does not cite the supplied evidence.", category: "validation", recoverable: false });
  }
  if (evidence.missionId !== identity.missionId || evidence.executionId !== identity.executionId) {
    return fail({ code: "completion.evidence_foreign", message: "Evidence is bound to a different mission or execution.", category: "validation", recoverable: false });
  }
  const record = verification.record;
  if (record) {
    if (record.missionId !== identity.missionId || record.executionId !== identity.executionId
      || !record.evidenceIds.includes(evidence.id) || record.status !== "PASSED") {
      return fail({ code: "completion.verification_foreign", message: "Verification record is foreign, does not cite the evidence, or did not pass.", category: "validation", recoverable: false });
    }
  }
  const receipt: CompletionReceiptV1 = {
    contractVersion: QUACK_CONTRACT_VERSION,
    id: createId("receipt"),
    missionId: identity.missionId,
    executionId: identity.executionId,
    taskId: identity.taskId,
    sessionId: identity.sessionId,
    workflowId: identity.workflowId,
    issuedAt: now(),
    summary: input.summary,
    evidenceId: evidence.id,
    evidenceDigest: evidenceDigest(evidence),
    evidenceCreatedAt: evidence.createdAt,
    verifier: record?.verifier ?? "runtime.verification",
    verificationStatus: record?.status ?? "PASSED",
    ...(record ? { verificationId: record.id } : {}),
    verifiedAt: record?.checkedAt ?? now(),
    independent: input.independent,
  };
  return { ok: true, data: receipt };
}

/** Deterministic digest of the durable evidence payload. */
export function evidenceDigest(evidence: EvidenceRecordV1): string {
  return createHash("sha256").update(JSON.stringify({ id: evidence.id, missionId: evidence.missionId, executionId: evidence.executionId,
    kind: evidence.kind, createdAt: evidence.createdAt, source: evidence.source, data: evidence.data, redactions: evidence.redactions }))
    .digest("hex");
}

/**
 * Validate that a receipt is internally consistent and bound to the given
 * execution identity. Used to reject forged, stale, or foreign receipts.
 */
export function assertCompletionReceipt(receipt: CompletionReceiptV1, identity: ExecutionIdentity): QuackResult<CompletionReceiptV1> {
  if (receipt.contractVersion !== QUACK_CONTRACT_VERSION
    || receipt.missionId !== identity.missionId || receipt.executionId !== identity.executionId
    || receipt.taskId !== identity.taskId || receipt.sessionId !== identity.sessionId
    || receipt.workflowId !== identity.workflowId) {
    return fail({ code: "completion.receipt_foreign", message: "Receipt identity does not match the execution identity.", category: "validation", recoverable: false });
  }
  if (receipt.verificationStatus !== "PASSED" || !receipt.evidenceId || !/^[a-f0-9]{64}$/.test(receipt.evidenceDigest)
    || !Number.isFinite(Date.parse(receipt.issuedAt)) || !Number.isFinite(Date.parse(receipt.evidenceCreatedAt))
    || !Number.isFinite(Date.parse(receipt.verifiedAt)) || Date.parse(receipt.verifiedAt) < Date.parse(receipt.evidenceCreatedAt)) {
    return fail({ code: "completion.receipt_invalid", message: "Receipt is malformed or cites an unverified, stale, or forged chain.", category: "validation", recoverable: false });
  }
  return { ok: true, data: receipt };
}

/** JSON-safe projection for events and durable task results. */
export function receiptSnapshot(receipt: CompletionReceiptV1): JsonObject {
  return {
    contractVersion: receipt.contractVersion,
    id: receipt.id,
    missionId: receipt.missionId,
    executionId: receipt.executionId,
    taskId: receipt.taskId,
    sessionId: receipt.sessionId,
    workflowId: receipt.workflowId,
    issuedAt: receipt.issuedAt,
    summary: receipt.summary,
    evidenceId: receipt.evidenceId,
    evidenceDigest: receipt.evidenceDigest,
    evidenceCreatedAt: receipt.evidenceCreatedAt,
    verifier: receipt.verifier,
    verificationStatus: receipt.verificationStatus,
    verificationId: receipt.verificationId ?? null,
    verifiedAt: receipt.verifiedAt,
    independent: receipt.independent,
  };
}