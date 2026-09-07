import test from "node:test";
import assert from "node:assert/strict";
import { QUACK_CONTRACT_VERSION, type EvidenceRecordV1, type VerificationRecordV1 } from "../contracts/v1/contracts.js";
import { now } from "../core/types.js";
import { buildCompletionReceipt, assertCompletionReceipt, evidenceDigest, receiptSnapshot } from "./completion-receipt.js";
import type { ExecutionIdentity } from "./execution-recovery.js";

const identity: ExecutionIdentity = {
  missionId: "mission-1", executionId: "task-1", taskId: "task-1", sessionId: "session-1", workflowId: "workflow-1", actor: "tester",
};

function evidence(): EvidenceRecordV1 {
  return {
    contractVersion: QUACK_CONTRACT_VERSION, id: "evidence-1", missionId: identity.missionId, taskId: identity.taskId,
    executionId: identity.executionId, kind: "state", createdAt: "2026-01-01T00:00:00.000Z", source: "runtime.workflow",
    data: { status: "completed", completedNodes: ["left", "join"] }, redactions: [],
  };
}

function verification(overrides: Partial<VerificationRecordV1> = {}): VerificationRecordV1 {
  return {
    contractVersion: QUACK_CONTRACT_VERSION, id: "verification-1", missionId: identity.missionId,
    executionId: identity.executionId, verifier: "validator-1", status: "PASSED", checkedAt: "2026-01-01T00:00:01.000Z",
    evidenceIds: ["evidence-1"], message: "Combined measurement equals five.", ...overrides,
  };
}

test("buildCompletionReceipt mints a receipt citing the durable evidence and verification", () => {
  const durableEvidence = evidence();
  const result = buildCompletionReceipt({ identity, summary: "Mission validated.",
    evidence: durableEvidence, verification: { success: true, reason: "ok", evidenceId: "evidence-1", record: verification() }, independent: true });
  assert.ok(result.ok);
  if (!result.ok) return;
  const receipt = result.data;
  assert.equal(receipt.contractVersion, QUACK_CONTRACT_VERSION);
  assert.equal(receipt.missionId, identity.missionId);
  assert.equal(receipt.executionId, identity.executionId);
  assert.equal(receipt.taskId, identity.taskId);
  assert.equal(receipt.sessionId, identity.sessionId);
  assert.equal(receipt.workflowId, identity.workflowId);
  assert.equal(receipt.evidenceId, "evidence-1");
  assert.equal(receipt.evidenceDigest, evidenceDigest(durableEvidence));
  assert.equal(receipt.verifier, "validator-1");
  assert.equal(receipt.verificationStatus, "PASSED");
  assert.equal(receipt.verificationId, "verification-1");
  assert.equal(receipt.independent, true);
  assert.ok(receipt.id);
});

test("buildCompletionReceipt fails closed on unsuccessful verification", () => {
  const result = buildCompletionReceipt({ identity, summary: "s",
    evidence: evidence(), verification: { success: false, reason: "mismatch", evidenceId: "evidence-1" }, independent: true });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "completion.verification_failed");
});

test("buildCompletionReceipt fails closed when verification cites foreign evidence", () => {
  const result = buildCompletionReceipt({ identity, summary: "s",
    evidence: evidence(), verification: { success: true, reason: "ok", evidenceId: "other-evidence" }, independent: true });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "completion.evidence_mismatch");
});

test("buildCompletionReceipt fails closed on foreign evidence identity", () => {
  const foreign = { ...evidence(), missionId: "mission-other" };
  const result = buildCompletionReceipt({ identity, summary: "s",
    evidence: foreign, verification: { success: true, reason: "ok", evidenceId: foreign.id }, independent: true });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "completion.evidence_foreign");
});

test("buildCompletionReceipt fails closed on foreign verification record", () => {
  const forged = verification({ missionId: "mission-other" });
  const result = buildCompletionReceipt({ identity, summary: "s",
    evidence: evidence(), verification: { success: true, reason: "ok", evidenceId: "evidence-1", record: forged }, independent: true });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "completion.verification_foreign");
});

test("buildCompletionReceipt fails closed on failed verification record status", () => {
  const failed = verification({ status: "FAILED" });
  const result = buildCompletionReceipt({ identity, summary: "s",
    evidence: evidence(), verification: { success: true, reason: "ok", evidenceId: "evidence-1", record: failed }, independent: true });
  assert.ok(!result.ok);
  if (!result.ok) assert.equal(result.error.code, "completion.verification_foreign");
});

test("assertCompletionReceipt rejects forged, foreign, and stale receipts", () => {
  const built = buildCompletionReceipt({ identity, summary: "s",
    evidence: evidence(), verification: { success: true, reason: "ok", evidenceId: "evidence-1", record: verification() }, independent: true });
  assert.ok(built.ok);
  if (!built.ok) return;

  const okCheck = assertCompletionReceipt(built.data, identity);
  assert.ok(okCheck.ok);

  const foreign = assertCompletionReceipt({ ...built.data, missionId: "mission-other" }, identity);
  assert.ok(!foreign.ok);
  if (!foreign.ok) assert.equal(foreign.error.code, "completion.receipt_foreign");

  const unverified = assertCompletionReceipt({ ...built.data, verificationStatus: "FAILED" }, identity);
  assert.ok(!unverified.ok);

  const badDigest = assertCompletionReceipt({ ...built.data, evidenceDigest: "not-a-digest" }, identity);
  assert.ok(!badDigest.ok);

  const stale = assertCompletionReceipt({ ...built.data,
    verifiedAt: "2020-01-01T00:00:00.000Z", evidenceCreatedAt: "2024-01-01T00:00:00.000Z" }, identity);
  assert.ok(!stale.ok);
  if (!stale.ok) assert.equal(stale.error.code, "completion.receipt_invalid");
});

test("evidenceDigest is deterministic over the bound identity and payload", () => {
  const first = evidenceDigest(evidence());
  const second = evidenceDigest(evidence());
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  const mutated = evidenceDigest({ ...evidence(), data: { status: "completed", completedNodes: ["left", "join", "extra"] } });
  assert.notEqual(first, mutated);
});

test("receiptSnapshot is JSON-safe and complete", () => {
  const built = buildCompletionReceipt({ identity, summary: "s",
    evidence: evidence(), verification: { success: true, reason: "ok", evidenceId: "evidence-1", record: verification() }, independent: true });
  assert.ok(built.ok);
  if (!built.ok) return;
  const snapshot = receiptSnapshot(built.data) as Record<string, unknown>;
  assert.equal(snapshot.evidenceId, "evidence-1");
  assert.equal(snapshot.verificationId, "verification-1");
  assert.ok(JSON.stringify(snapshot));
});