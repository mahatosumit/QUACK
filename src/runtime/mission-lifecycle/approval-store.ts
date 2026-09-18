import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isMissingFile, atomicWriteFile } from "../../core/utils.js";
import { redactSecrets } from "../../security/secret-provider.js";
import {
  APPROVAL_RECORD_VERSION, parseApprovalRecord, approvalRecordDigest,
  ApprovalRunner, type ApprovalRecord, type ApprovalRequestInput, type ApprovalCallbackDecision,
} from "./approval-contract.js";
import type { EventBus } from "../../events/event-bus.js";

/**
 * P15 (ADR 0049): the DURABLE governed approval queue.
 *
 * The P14 approval contract is unchanged: approvals remain identity-bound
 * (missionId, stepIndex, capability, canonicalProposalDigest), single-use,
 * and model-proof. What P15 adds is DURABILITY: a WAITING_APPROVAL step
 * whose process dies mid-callback now has a durable PENDING record under
 * `<dataDir>/mission-approvals/`, keyed DETERMINISTICALLY by the binding
 * (one approval request per mission/step/capability/digest). On restart:
 *
 *   PENDING (durable)  → the approval survives; a human may still decide.
 *   GRANTED, consumed  → the consumption survives; replay fails closed.
 *   DENIED            → durable; the same request can never upgrade.
 *   EXPIRED           → durable; never authorizes anything.
 *
 * SERVER-SIDE TTL: `expiresAt` is part of the digested canonical record and
 * is evaluated against the SERVER clock at every consume/load. A client or
 * model field can never extend it — any record alteration breaks the digest
 * and fails closed.
 *
 * Trust boundary (honest): the sha256 digest is INTEGRITY, not
 * authentication — an attacker with write access to the dataDir can forge a
 * record (documented, same model as execution evidence). The boundary is
 * the host OS trust around the dataDir, exactly as in P13/P14. Forbidding
 * model/agent approver identities at consume time remains enforced because
 * the store only ACCEPTS records produced by the trusted ApprovalRunner
 * seam (never model output).
 */

export const APPROVAL_TTL_MS_DEFAULT = 15 * 60_000;

/** Deterministic approval-request identity: the binding itself. */
export function approvalRequestKey(missionId: string, stepIndex: number, capability: string, proposalDigest: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ missionId, stepIndex, capability, proposalDigest }))
    .digest("hex").slice(0, 32);
}

/** Shape of a durable approval REQUEST (pre-decision). */
export interface DurableApprovalRequest {
  readonly version: 1;
  readonly key: string;
  readonly missionId: string;
  readonly stepIndex: number;
  readonly capability: string;
  readonly proposalDigest: string;
  readonly riskLevel: "IRREVERSIBLE" | "DESTRUCTIVE";
  /** Metadata-only reason (the P14 input reason; no raw payloads). */
  readonly reason: string;
  readonly requestedAt: string;
  /** Server-side expiry deadline (epoch ms), part of the digested form. */
  readonly expiresAt: number;
  /** sha256 over the canonical form (without this field). */
  readonly digest: string;
}

const REQUEST_FIELDS = new Set([
  "version", "key", "missionId", "stepIndex", "capability", "proposalDigest",
  "riskLevel", "reason", "requestedAt", "expiresAt", "digest",
]);

function serializeRequest(request: Omit<DurableApprovalRequest, "digest">): string {
  return JSON.stringify(sortKeysDeep(request));
}

export function durableRequestDigest(request: Omit<DurableApprovalRequest, "digest">): string {
  return createHash("sha256").update(serializeRequest(request)).digest("hex");
}

/** Fail-closed parse of a persisted approval REQUEST. */
export function parseDurableApprovalRequest(raw: string): { readonly ok: true; readonly request: DurableApprovalRequest } | { readonly ok: false; readonly reason: string } {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, reason: "Approval request is not valid JSON." }; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "Approval request must be a JSON object." };
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!REQUEST_FIELDS.has(key)) return { ok: false, reason: `Unknown approval request field '${key}' is rejected.` };
  }
  if (record["version"] !== 1) return { ok: false, reason: "Unsupported approval request version." };
  const digest = record["digest"];
  if (typeof digest !== "string" || digest.length !== 64) return { ok: false, reason: "Approval request digest is missing or malformed." };
  const { digest: _ignored, ...rest } = record;
  void _ignored;
  const candidate = rest as unknown as Omit<DurableApprovalRequest, "digest">;
  if (durableRequestDigest(candidate) !== digest) {
    return { ok: false, reason: "Approval request digest mismatch: the record was tampered with." };
  }
  if (typeof candidate.key !== "string" || !/^[0-9a-f]{32}$/.test(candidate.key)) return { ok: false, reason: "Approval request key is malformed." };
  if (typeof candidate.missionId !== "string" || candidate.missionId.length === 0) return { ok: false, reason: "Approval request mission binding is malformed." };
  if (!Number.isInteger(candidate.stepIndex) || candidate.stepIndex < 0) return { ok: false, reason: "Approval request step binding is malformed." };
  if (typeof candidate.capability !== "string" || candidate.capability.length === 0) return { ok: false, reason: "Approval request capability binding is malformed." };
  if (typeof candidate.proposalDigest !== "string" || !/^[0-9a-f]{64}$/.test(candidate.proposalDigest)) return { ok: false, reason: "Approval request proposal digest is malformed." };
  if (candidate.riskLevel !== "IRREVERSIBLE" && candidate.riskLevel !== "DESTRUCTIVE") return { ok: false, reason: "Approval request risk level is malformed." };
  if (typeof candidate.reason !== "string" || candidate.reason.length === 0) return { ok: false, reason: "Approval request reason is malformed." };
  if (typeof candidate.requestedAt !== "string" || candidate.requestedAt.length === 0) return { ok: false, reason: "Approval request timestamp is malformed." };
  if (!Number.isFinite(candidate.expiresAt) || typeof candidate.expiresAt !== "number" || candidate.expiresAt <= 0) return { ok: false, reason: "Approval request expiry is malformed." };
  // The deterministic key MUST match the binding — a planted record under
  // another binding's filename fails closed.
  if (candidate.key !== approvalRequestKey(candidate.missionId, candidate.stepIndex, candidate.capability, candidate.proposalDigest)) {
    return { ok: false, reason: "Approval request key does not match its binding." };
  }
  return { ok: true, request: { ...candidate, digest } as DurableApprovalRequest };
}

/**
 * The durable approval store. One request file per binding under
 * `<dataDir>/mission-approvals/`; the decision record (P14 ApprovalRecord)
 * REPLACES the request on decision, keeping the same deterministic key so
 * a restart finds the decision, never a stale request.
 *
 * NOT an authority: it persists and validates records; only the trusted
 * ApprovalRunner seam writes GRANTED/DENIED decisions, and only the harness
 * consume path (via ApprovalRunner.consumeApproval) authorizes execution.
 */
export class JsonFileApprovalStore {
  constructor(
    private readonly dataDir: string,
    private readonly options: { readonly ttlMs?: number; readonly clock?: () => number } = {},
  ) {}

  private get ttlMs(): number { return this.options.ttlMs ?? APPROVAL_TTL_MS_DEFAULT; }
  private now(): number { return this.options.clock ? this.options.clock() : Date.now(); }

  /** Persist a PENDING approval request (deterministic key; idempotent). */
  async parkRequest(input: ApprovalRequestInput): Promise<DurableApprovalRequest> {
    if (input.riskLevel !== "IRREVERSIBLE" && input.riskLevel !== "DESTRUCTIVE") {
      throw new Error("The durable approval store is only for IRREVERSIBLE/DESTRUCTIVE actions.");
    }
    // P15-F security fix: the reason embeds model-derived intent text; the
    // durable record is METADATA-ONLY. Redact through the single repository
    // redaction authority (secret-provider) BEFORE persisting. Redaction
    // failure fails closed — the request is never persisted unredacted.
    const redactedReason = redactSecrets(input.reason);
    if (redactedReason.length === 0) {
      throw new Error("Approval request reason could not be redacted safely; the request fails closed.");
    }
    const key = approvalRequestKey(input.missionId, input.stepIndex, input.capability, input.proposalDigest);
    const base: Omit<DurableApprovalRequest, "digest"> = {
      version: 1,
      key,
      missionId: input.missionId,
      stepIndex: input.stepIndex,
      capability: input.capability,
      proposalDigest: input.proposalDigest,
      riskLevel: input.riskLevel,
      reason: redactedReason,
      requestedAt: new Date().toISOString(),
      expiresAt: this.now() + this.ttlMs,
    };
    const request: DurableApprovalRequest = { ...base, digest: durableRequestDigest(base) };
    await this.persist(key, JSON.stringify(request, null, 2) + "\n");
    return request;
  }

  /**
   * Load the durable approval state for a binding: the REQUEST when still
   * pending, or the DECISION record once decided. Expiry is evaluated
   * against the server clock here (fail closed).
   */
  async loadBinding(binding: {
    readonly missionId: string;
    readonly stepIndex: number;
    readonly capability: string;
    readonly proposalDigest: string;
    readonly now?: number;
  }): Promise<
    | { readonly kind: "PENDING"; readonly request: DurableApprovalRequest }
    | { readonly kind: "EXPIRED"; readonly request: DurableApprovalRequest }
    | { readonly kind: "DECIDED"; readonly record: ApprovalRecord }
    | undefined
  > {
    const key = approvalRequestKey(binding.missionId, binding.stepIndex, binding.capability, binding.proposalDigest);
    let raw: string;
    try {
      raw = await readFile(this.filePath(key), "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
    const request = parseDurableApprovalRequest(raw);
    if (request.ok) {
      const nowMs = binding.now ?? this.now();
      if (request.request.expiresAt <= nowMs) return { kind: "EXPIRED", request: request.request };
      return { kind: "PENDING", request: request.request };
    }
    // Not a request anymore: it must be a decided ApprovalRecord.
    const decision = parseApprovalRecord(raw);
    if (decision.ok) return { kind: "DECIDED", record: decision.record };
    throw new Error(`Invalid durable approval record '${key}': ${request.reason} / ${decision.reason}`);
  }

  /** True when a PENDING request for this binding is still live (server clock). */
  async hasLiveRequest(binding: {
    readonly missionId: string;
    readonly stepIndex: number;
    readonly capability: string;
    readonly proposalDigest: string;
  }): Promise<boolean> {
    const loaded = await this.loadBinding(binding).catch(() => undefined);
    return loaded?.kind === "PENDING";
  }

  /**
   * Persist a DECISION (GRANTED/DENIED). Overwrites the PENDING request for
   * the same binding; a decided binding can never revert to PENDING.
   */
  async persistDecision(record: ApprovalRecord): Promise<void> {
    const key = approvalRequestKey(record.missionId, record.stepIndex, record.capability, record.proposalDigest);
    if (approvalRecordDigest(record) !== record.digest) {
      throw new Error("Refusing to persist an approval decision whose digest does not match its content.");
    }
    // P15-F security fix: decisions may quote the model-derived intent in
    // their reason; the durable record is metadata-only. Redact through the
    // repository redaction authority and RE-DIGEST (the same pattern
    // persistConsumed uses) so the durable record parses on restart. The
    // caller-supplied digest was already validated above over the exact
    // in-memory record — redaction only ever REMOVES secret material, it
    // can never alter the approval semantics or make it more permissive.
    if (record.reason !== redactSecrets(record.reason)) {
      const { digest: _old, ...rest } = record;
      void _old;
      const redacted: ApprovalRecord = { ...rest, reason: redactSecrets(record.reason), digest: approvalRecordDigest({ ...rest, reason: redactSecrets(record.reason) }) };
      await this.persist(key, JSON.stringify(redacted, null, 2) + "\n");
      return;
    }
    await this.persist(key, JSON.stringify(record, null, 2) + "\n");
  }

  /**
   * Mark a GRANTED decision CONSUMED (single-use). The in-memory record's
   * digest was computed over its PRE-consumption state; the durable CONSUMED
   * record is re-digested so it parses on restart. Idempotence of the state
   * itself is enforced by the P14 consumeApproval contract.
   */
  async persistConsumed(record: ApprovalRecord): Promise<void> {
    if (record.state !== "CONSUMED") {
      throw new Error("Only a CONSUMED approval can be persisted as consumed.");
    }
    const { digest: _old, ...rest } = record;
    void _old;
    const reDigested: ApprovalRecord = { ...rest, digest: approvalRecordDigest(rest) };
    await this.persistDecision(reDigested);
  }

  /** Metadata-only listing for inspection surfaces (CLI/Studio). */
  async list(): Promise<readonly (DurableApprovalRequest | ApprovalRecord)[]> {
    const directory = join(this.dataDir, "mission-approvals");
    let files: readonly string[] = [];
    try {
      files = await readdir(directory);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const records: (DurableApprovalRequest | ApprovalRecord)[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const raw = await readFile(join(directory, file), "utf8").catch(() => undefined);
      if (raw === undefined) continue;
      const request = parseDurableApprovalRequest(raw);
      if (request.ok) { records.push(request.request); continue; }
      const decision = parseApprovalRecord(raw);
      if (decision.ok) records.push(decision.record);
      // Corrupt individual entries are skipped on LIST (fail-closed on LOAD).
    }
    return records;
  }

  private async persist(key: string, contents: string): Promise<void> {
    await mkdir(join(this.dataDir, "mission-approvals"), { recursive: true });
    await atomicWriteFile(this.filePath(key), contents);
  }

  private filePath(key: string): string {
    return join(this.dataDir, "mission-approvals", `${key}.json`);
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

/**
 * P15: the durable approval runner seam. EXTENDS the EXISTING P14
 * ApprovalRunner (so the harness seam accepts it unchanged) and adds
 * durable queue semantics:
 *
 *   1. parkRequest() BEFORE the ask — a crash mid-ask leaves a durable
 *      PENDING record, never a lost decision.
 *   2. The callback decides (the ONLY human-trust surface, unchanged).
 *   3. persistDecision() immediately — GRANTED/DENIED is durable.
 *   4. On restart, a STILL-LIVE GRANTED record for the exact binding is
 *      REUSED (never re-asked — the human already said yes); an EXPIRED or
 *      DENIED one fails closed.
 *   5. Consumption is persisted so a restart can never replay it.
 *
 * Approver identity is enforced by the P14 base class; the durable record
 * only ever carries trusted-runner-produced content.
 */
export class DurableApprovalRunner extends ApprovalRunner {
  constructor(
    private readonly store: JsonFileApprovalStore,
    callback: import("./approval-contract.js").ApprovalRunnerCallback,
    private readonly options: { readonly events?: EventBus; readonly actor?: string } = {},
  ) {
    super(callback);
  }

  /** The P14 approval request, made durable. Reuses a live prior decision. */
  override async requestApproval(input: ApprovalRequestInput & { readonly actor: string }): Promise<ApprovalRecord> {
    // 1) Restart reuse: a durable GRANTED decision for this EXACT binding
    //    that is still live is returned as-is (already decided). A DENIED
    //    decision can never be upgraded; an expired request fails closed.
    const existing = await this.store.loadBinding(input).catch(() => undefined);
    if (existing?.kind === "DECIDED") {
      if (existing.record.decision === "GRANTED" && existing.record.state === "GRANTED") {
        await this.emit("mission.approval_restored", {
          missionId: input.missionId, stepIndex: input.stepIndex, capability: input.capability,
          approvalId: existing.record.approvalId,
        });
        return existing.record;
      }
      throw new Error(
        existing.record.decision === "DENIED"
          ? `Approval for this exact action was already DENIED by ${existing.record.approver}; re-request is refused.`
          : `Approval ${existing.record.approvalId} is ${existing.record.state}; re-request is refused.`,
      );
    }
    if (existing?.kind === "EXPIRED") {
      throw new Error("The approval request expired before a decision was recorded; the action fails closed (the step must be re-proposed).");
    }

    // 2) Park the request durably BEFORE the ask. The park proves a
    //    WAITING_APPROVAL dispatch to crash-recovery: the previous process
    //    died INSIDE the approval gate, before any execution.
    await this.store.parkRequest(input);
    await this.emit("mission.approval_parked", {
      missionId: input.missionId, stepIndex: input.stepIndex, capability: input.capability,
      riskLevel: input.riskLevel,
    });

    // 3) Ask through the P14 contract (callback failure ⇒ deny, forbidden
    //    approver ⇒ throw; both unchanged), then persist the decision.
    try {
      const record = await super.requestApproval(input);
      await this.store.persistDecision(record);
      await this.emit(record.decision === "GRANTED" ? "mission.approval_granted" : "mission.approval_denied", {
        missionId: input.missionId, stepIndex: input.stepIndex, capability: input.capability,
        approver: record.approver, approvalId: record.approvalId,
      });
      return record;
    } catch (error) {
      // super.requestApproval throws only for forbidden-approver cases
      // (the callback itself never throws — P14 contract). The parked
      // request stays parked: the TTL expires it; re-request is refused by
      // the EXPIRED branch above. Fail closed, rethrow.
      throw error;
    }
  }

  /** Consume a GRANTED approval and persist the consumption durably. */
  override consumeApproval(record: ApprovalRecord, binding: {
    readonly missionId: string;
    readonly stepIndex: number;
    readonly capability: string;
    readonly proposalDigest: string;
  }): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    const consumed = super.consumeApproval(record, binding);
    if (consumed.ok) {
      // Persist the CONSUMED state. A crash between the in-memory consume
      // and this persist leaves a GRANTED record that a restart may reuse
      // — but the step journal's own at-most-once reservation still refuses
      // a second dispatch, so the window cannot double-execute; the durable
      // consumption closes the replay channel for good.
      void this.store.persistConsumed(record).catch(() => undefined);
      void this.emit("mission.approval_consumed", {
        missionId: record.missionId, stepIndex: record.stepIndex, approvalId: record.approvalId,
      });
    }
    return consumed;
  }

  private async emit(
    type: "mission.approval_parked" | "mission.approval_restored" | "mission.approval_granted" | "mission.approval_denied" | "mission.approval_consumed",
    payload: import("../../core/types.js").JsonObject,
  ): Promise<void> {
    await this.options.events?.emit(type, payload, { actor: this.options.actor ?? "approval-store" }).catch(() => undefined);
  }
}
