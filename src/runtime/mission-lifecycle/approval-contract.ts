import { createHash } from "node:crypto";
import type { JsonObject } from "../../core/types.js";
import type { ExecutionRiskLevel } from "./action-contract.js";

/**
 * P14 (ADR 0048): the governed approval contract for IRREVERSIBLE and
 * DESTRUCTIVE actions.
 *
 * AUTHORIZATION ≠ APPROVAL. The CapabilityBroker still decides WHETHER the
 * actor holds the capability; the approval runner decides whether a HUMAN
 * (or a trusted operator callback) accepts the irreversible consequence of
 * THIS EXACT action. Neither can substitute for the other:
 *
 *   MODEL PROPOSES → BROKER AUTHORIZATION → RISK = IRREVERSIBLE/DESTRUCTIVE
 *     → HUMAN APPROVAL CALLBACK (identity-bound, digest-bound, single-use)
 *     → EXECUTION POLICY → ISOLATION → EXECUTION → VERIFICATION
 *
 * The model cannot: approve itself, forge an approval, supply approval
 * tokens, alter approver identity, or alter risk classification. Approval
 * records are bound to the canonical digest of the exact proposal — an
 * approval for action A can never authorize action B, and the same approval
 * can never be replayed for a second dispatch.
 *
 * Approvals are consumed at a trusted boundary: the harness marks the record
 * CONSUMED when the approved dispatch settles (or is refused). Model output
 * never reaches the store; only the trusted approval callback does.
 */

export const APPROVAL_RECORD_VERSION = 1;

/** Human-trust decision surface. Injected by the composition, never by model output. */
export interface ApprovalRunnerCallback {
  /**
   * Ask for a human decision on one irreversible/destructive proposal.
   * Returns the decision; NEVER throws (a broken callback denies).
   */
  requestDecision(input: ApprovalRequestInput): Promise<ApprovalCallbackDecision>;
}

export interface ApprovalRequestInput {
  readonly missionId: string;
  readonly stepIndex: number;
  readonly capability: string;
  /** Canonical proposal digest the approval will be bound to. */
  readonly proposalDigest: string;
  readonly riskLevel: ExecutionRiskLevel;
  /** Metadata-only explanation (intent + bounded argument digests, never raw payloads). */
  readonly reason: string;
}

export interface ApprovalCallbackDecision {
  readonly approved: boolean;
  readonly approver: string;
  readonly reason: string;
}

/** The durable, identity-bound approval record. */
export interface ApprovalRecord {
  readonly version: typeof APPROVAL_RECORD_VERSION;
  readonly approvalId: string;
  readonly missionId: string;
  readonly stepIndex: number;
  readonly capability: string;
  /** Canonical sha256 of the exact ActionProposal (the binding). */
  readonly proposalDigest: string;
  readonly riskLevel: "IRREVERSIBLE" | "DESTRUCTIVE";
  readonly decision: "GRANTED" | "DENIED";
  readonly approver: string;
  readonly reason: string;
  readonly decidedAt: string;
  /** Single-use enforcement: a GRANTED approval is consumed exactly once. */
  state: "PENDING" | "GRANTED" | "CONSUMED" | "DENIED";
  /** sha256 over the canonical record form (without this field). */
  readonly digest: string;
}

/**
 * Canonical digest of the trusted proposal fields that define the action
 * identity: capability + arguments + intent + mission + step. Two proposals
 * with the same canonical digest ARE the same action; anything else is a
 * different action and cannot reuse an approval.
 */
export function canonicalProposalDigest(proposal: {
  readonly capability: string;
  readonly arguments: JsonObject;
  readonly intent: string;
  readonly missionId: string;
  readonly stepIndex: number;
}): string {
  const canonical = {
    capability: proposal.capability,
    arguments: sortKeysDeep(proposal.arguments),
    intent: proposal.intent,
    missionId: proposal.missionId,
    stepIndex: proposal.stepIndex,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Canonical deterministic serialization (sorted keys, digest stripped). */
export function serializeApprovalRecord(record: Omit<ApprovalRecord, "digest">): string {
  const { digest: _ignored, ...rest } = record as ApprovalRecord;
  void _ignored;
  return JSON.stringify(sortKeysDeep(rest));
}

export function approvalRecordDigest(record: Omit<ApprovalRecord, "digest">): string {
  return createHash("sha256").update(serializeApprovalRecord(record)).digest("hex");
}

const APPROVAL_FIELDS = new Set([
  "version", "approvalId", "missionId", "stepIndex", "capability", "proposalDigest",
  "riskLevel", "decision", "approver", "reason", "decidedAt", "state", "digest",
]);

/** Fail-closed parse of a persisted approval record. */
export function parseApprovalRecord(raw: string): { readonly ok: true; readonly record: ApprovalRecord } | { readonly ok: false; readonly reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Approval record is not valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "Approval record must be a JSON object." };
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!APPROVAL_FIELDS.has(key)) return { ok: false, reason: `Unknown approval field '${key}' is rejected.` };
  }
  if (record["version"] !== APPROVAL_RECORD_VERSION) return { ok: false, reason: "Unsupported approval record version." };
  const digest = record["digest"];
  if (typeof digest !== "string" || digest.length !== 64) return { ok: false, reason: "Approval digest is missing or malformed." };
  const candidate = record as unknown as Omit<ApprovalRecord, "digest">;
  if (approvalRecordDigest(candidate) !== digest) {
    return { ok: false, reason: "Approval digest mismatch: the record was tampered with." };
  }
  if (typeof candidate.approvalId !== "string" || candidate.approvalId.length === 0) return { ok: false, reason: "Approval id is malformed." };
  if (typeof candidate.missionId !== "string" || candidate.missionId.length === 0) return { ok: false, reason: "Approval mission binding is malformed." };
  if (!Number.isInteger(candidate.stepIndex) || candidate.stepIndex < 0) return { ok: false, reason: "Approval step binding is malformed." };
  if (typeof candidate.capability !== "string" || candidate.capability.length === 0) return { ok: false, reason: "Approval capability binding is malformed." };
  if (typeof candidate.proposalDigest !== "string" || !/^[0-9a-f]{64}$/.test(candidate.proposalDigest)) return { ok: false, reason: "Approval proposal digest is malformed." };
  if (candidate.riskLevel !== "IRREVERSIBLE" && candidate.riskLevel !== "DESTRUCTIVE") return { ok: false, reason: "Approval risk level must be IRREVERSIBLE or DESTRUCTIVE." };
  if (candidate.decision !== "GRANTED" && candidate.decision !== "DENIED") return { ok: false, reason: "Approval decision is malformed." };
  if (typeof candidate.approver !== "string" || candidate.approver.length === 0) return { ok: false, reason: "Approver identity is malformed." };
  if (candidate.state !== "PENDING" && candidate.state !== "GRANTED" && candidate.state !== "CONSUMED" && candidate.state !== "DENIED") return { ok: false, reason: "Approval state is malformed." };
  if (candidate.decision === "GRANTED" && candidate.state === "DENIED") return { ok: false, reason: "Approval decision/state contradiction." };
  return { ok: true, record: candidate as ApprovalRecord };
}

/**
 * The trusted approval runner: orchestrates the callback and enforces
 * single-use, digest-bound approvals. NOT an authority — it neither grants
 * capabilities nor executes anything; a GRANTED approval only unlocks the
 * harness gate for ONE dispatch of the EXACT bound proposal.
 */
export class ApprovalRunner {
  /** P14.9: the model can never be an approver. */
  private static readonly FORBIDDEN_APPROVERS = new Set([
    "model", "llm", "agent", "proposal", "system", "runtime", "harness",
  ]);

  constructor(private readonly callback: ApprovalRunnerCallback) {}

  /** Ask the trusted callback for a decision on one exact proposal. */
  async requestApproval(input: ApprovalRequestInput & { readonly actor: string }): Promise<ApprovalRecord> {
    if (input.riskLevel !== "IRREVERSIBLE" && input.riskLevel !== "DESTRUCTIVE") {
      throw new Error("The approval runner is only for IRREVERSIBLE/DESTRUCTIVE actions; other risk levels never reach it.");
    }
    // The model may never approve its own proposal: an approver identity
    // that matches the proposing actor is refused before the callback runs.
    if (ApprovalRunner.FORBIDDEN_APPROVERS.has(input.actor.toLowerCase())) {
      throw new Error("Approval refused: the proposing actor can never be the approver.");
    }
    const decision = await this.callback.requestDecision(input).catch(() => ({
      approved: false, approver: "callback-error", reason: "The approval callback failed; the action is denied.",
    }) satisfies ApprovalCallbackDecision);
    const record: Omit<ApprovalRecord, "digest"> = {
      version: APPROVAL_RECORD_VERSION,
      approvalId: `appr_${createHash("sha256").update(`${input.missionId}:${input.stepIndex}:${input.proposalDigest}:${Date.now()}${Math.random()}`).digest("hex").slice(0, 16)}`,
      missionId: input.missionId,
      stepIndex: input.stepIndex,
      capability: input.capability,
      proposalDigest: input.proposalDigest,
      riskLevel: input.riskLevel,
      decision: decision.approved ? "GRANTED" : "DENIED",
      approver: decision.approver,
      reason: decision.reason,
      decidedAt: new Date().toISOString(),
      state: decision.approved ? "GRANTED" : "DENIED",
    };
    return { ...record, digest: approvalRecordDigest(record) };
  }

  /**
   * Consume a GRANTED approval for one dispatch. Fails closed on: wrong
   * digest (action B), wrong mission, wrong step, wrong capability,
   * DENIED decision, or already-CONSUMED state. The ONLY legal use is a
   * GRANTED record whose binding matches exactly — and it can happen once.
   */
  consumeApproval(record: ApprovalRecord, binding: {
    readonly missionId: string;
    readonly stepIndex: number;
    readonly capability: string;
    readonly proposalDigest: string;
  }): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (record.decision !== "GRANTED" || record.state !== "GRANTED") {
      return { ok: false, reason: `Approval ${record.approvalId} is ${record.state}, not consumable.` };
    }
    if (record.missionId !== binding.missionId) return { ok: false, reason: "Approval belongs to a different mission." };
    if (record.stepIndex !== binding.stepIndex) return { ok: false, reason: "Approval belongs to a different step." };
    if (record.capability !== binding.capability) return { ok: false, reason: "Approval belongs to a different capability." };
    if (record.proposalDigest !== binding.proposalDigest) return { ok: false, reason: "Approval digest mismatch: it authorizes a different action." };
    record.state = "CONSUMED";
    return { ok: true };
  }
}

/** Console human-approval callback (stdin y/N) — the default operator surface. */
export class ConsoleApprovalRunnerCallback implements ApprovalRunnerCallback {
  async requestDecision(input: ApprovalRequestInput): Promise<ApprovalCallbackDecision> {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(`[APPROVAL] ${input.riskLevel} action '${input.capability}' (step ${input.stepIndex}, mission ${input.missionId}). ${input.reason}\nApprove this exact action? (y/N): `, (answer) => {
        rl.close();
        const approved = /^y(es)?$/i.test(answer.trim());
        resolve({
          approved,
          approver: "operator:console",
          reason: approved ? "Approved by console operator." : "Denied by console operator.",
        });
      });
    });
  }
}

/** Auto-DENY callback for compositions without a human surface. */
export class DenyApprovalRunnerCallback implements ApprovalRunnerCallback {
  async requestDecision(_input: ApprovalRequestInput): Promise<ApprovalCallbackDecision> {
    return { approved: false, approver: "operator:none", reason: "No approval surface is wired; irreversible actions fail closed." };
  }
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    return sorted;
  }
  return value;
}
