import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isMissingFile, atomicWriteFile } from "../core/utils.js";

/**
 * P13 (ADR 0047): identity-bound execution evidence for isolated execution.
 *
 * Evidence is the TRUSTED record of what ACTUALLY happened inside the
 * isolated domain — never what the model or workload CLAIMED. It is bound to
 * (mission, step, capability, attempt, backend): a forged or mismatched
 * record fails closed on load, and evidence from one execution can never
 * satisfy another.
 *
 * TRUST BOUNDARY (P13 review finding 9 — stated explicitly): the sha256
 * digest is an INTEGRITY/CONTENT-IDENTITY mechanism, NOT an authentication
 * mechanism. It detects accidental corruption and detects tampering only
 * against a party who cannot re-digest the record. An attacker with WRITE
 * access to the evidence store can re-digest a forged record and it will
 * parse (documented + proven by adversarial test S11); the digest does NOT
 * defend against that attacker. The actual defenses for that threat are the
 * host OS trust boundary around the dataDir, the identity binding at
 * settlement (evidenceMatchesIdentity — a forged record cannot satisfy
 * ANOTHER execution's settlement), and the CapabilityBroker/permission
 * controls on every execution path. Deliberately NOT HMAC: a keyed digest
 * would add key-management (where does the key live? — the same attacker
 * with store write access reads it from process env/config) without moving
 * the real boundary. If a future threat model adds an attacker who can
 * rewrite the evidence store but NOT grants/policy, revisit keyed integrity
 * with a key held outside that attacker's reach; until then this is the
 * simplest honest security model.
 *
 * Content policy: metadata only. No chain-of-thought, no raw secrets, no
 * environment dumps, no unrestricted output. Output is carried as a
 * sha256 digest plus bounded byte length — the payload itself stays in the
 * execution result channel.
 */

export const EXECUTION_EVIDENCE_VERSION = 1;

/** Honest cleanup accounting for an isolated execution. */
export type CleanupStatus = "PENDING" | "CLEANED" | "CLEANUP_FAILED" | "UNCERTAIN";

/** Honest verification accounting, derived by the trusted probe runner only. */
export type EvidenceVerificationState = "UNVERIFIED" | "VERIFIED" | "FAILED" | "INCONCLUSIVE" | "SKIPPED";

/** Identity tuple binding evidence to exactly one dispatch. */
export interface ExecutionEvidenceIdentity {
  readonly missionId: string;
  readonly stepIndex: number;
  readonly capability: string;
  /** The harness execution id recorded in the step-attempt journal. */
  readonly executionId: string;
  /** Isolation backend that ran the workload. */
  readonly backendId: string;
}

/** Runtime-observed outcome facts (P13.10). */
export interface ExecutionEvidenceFacts {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly exitState: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "UNSUPPORTED";
  readonly terminationReason?: string;
  /** Policy level the workload ran under. */
  readonly isolationLevel: string;
  /** Honest backend isolation strength (its guarantee record). */
  readonly backendGuarantees: Readonly<Record<string, string>>;
  /** Resource observations actually made (metadata only). */
  readonly resourceObservations?: Readonly<Record<string, number | string | boolean>>;
  /** sha256 over the canonical workload output JSON. */
  readonly outputDigest?: string;
  readonly outputBytes?: number;
  /** stdout/stderr metadata: byte counts only, never content. */
  readonly stdoutBytes?: number;
  readonly stderrBytes?: number;
}

/** What the trusted probe runner concluded about this evidence. */
export interface ExecutionEvidenceVerification {
  readonly state: EvidenceVerificationState;
  readonly probesRun: readonly string[];
  readonly checkedAt: string;
  /** Digest-bound probe summary (no payload content). */
  readonly summary?: string;
}

export interface ExecutionEvidenceRecord {
  readonly version: typeof EXECUTION_EVIDENCE_VERSION;
  readonly identity: ExecutionEvidenceIdentity;
  readonly facts: ExecutionEvidenceFacts;
  readonly verification: ExecutionEvidenceVerification;
  readonly cleanup: CleanupStatus;
  /** sha256 over the canonical record form (without this field). */
  readonly digest: string;
  readonly recordedAt: string;
}

/** Canonical deterministic serialization (sorted keys, digest stripped). */
export function serializeExecutionEvidence(record: Omit<ExecutionEvidenceRecord, "digest">): string {
  return JSON.stringify(sortKeysDeep(record));
}

export function executionEvidenceDigest(record: Omit<ExecutionEvidenceRecord, "digest">): string {
  return createHash("sha256").update(serializeExecutionEvidence(record)).digest("hex");
}

/** Construct a fresh evidence record with its digest. */
export function createExecutionEvidence(input: {
  readonly identity: ExecutionEvidenceIdentity;
  readonly facts: ExecutionEvidenceFacts;
  readonly cleanup: CleanupStatus;
  readonly verification?: ExecutionEvidenceVerification;
}): ExecutionEvidenceRecord {
  const base: Omit<ExecutionEvidenceRecord, "digest"> = {
    version: EXECUTION_EVIDENCE_VERSION,
    identity: input.identity,
    facts: input.facts,
    verification: input.verification ?? {
      state: "UNVERIFIED",
      probesRun: [],
      checkedAt: new Date().toISOString(),
    },
    cleanup: input.cleanup,
    recordedAt: new Date().toISOString(),
  };
  return { ...base, digest: executionEvidenceDigest(base) };
}

/**
 * Fail-closed parse of a persisted evidence record. Rejects wrong version,
 * identity shape violations, digest mismatch (tampering), and verification
 * claims that were not produced by the trusted runner shape.
 */
export function parseExecutionEvidence(raw: string): { readonly ok: true; readonly record: ExecutionEvidenceRecord } | { readonly ok: false; readonly reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Evidence is not valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "Evidence must be a JSON object." };
  }
  const record = value as Partial<ExecutionEvidenceRecord>;
  if (record.version !== EXECUTION_EVIDENCE_VERSION) return { ok: false, reason: "Unsupported evidence version." };
  const identity = record.identity;
  if (typeof identity !== "object" || identity === null
    || typeof identity.missionId !== "string" || typeof identity.stepIndex !== "number"
    || typeof identity.capability !== "string" || typeof identity.executionId !== "string"
    || typeof identity.backendId !== "string") {
    return { ok: false, reason: "Evidence identity is malformed." };
  }
  if (typeof record.facts !== "object" || record.facts === null) return { ok: false, reason: "Evidence facts are missing." };
  const digest = record.digest;
  if (typeof digest !== "string" || digest.length !== 64) return { ok: false, reason: "Evidence digest is missing or malformed." };
  const { digest: _ignored, ...rest } = record;
  void _ignored;
  const candidate = rest as Omit<ExecutionEvidenceRecord, "digest">;
  if (executionEvidenceDigest(candidate) !== digest) {
    return { ok: false, reason: "Evidence digest mismatch: the record was tampered with." };
  }
  if (record.verification === undefined || typeof record.verification.state !== "string") {
    return { ok: false, reason: "Evidence verification state is missing." };
  }
  if (!isVerificationState(record.verification.state)) return { ok: false, reason: "Unknown evidence verification state." };
  if (!isCleanupStatus(record.cleanup)) return { ok: false, reason: "Unknown cleanup status." };
  return { ok: true, record: record as ExecutionEvidenceRecord };
}

/**
 * Bind an evidence record to a DIFFERENT execution context than its own
 * identity: always a mismatch. Compositions verify identity before trusting
 * verification state; this helper is the fail-closed check.
 */
export function evidenceMatchesIdentity(
  record: ExecutionEvidenceRecord,
  identity: Pick<ExecutionEvidenceIdentity, "missionId" | "stepIndex" | "capability" | "executionId">,
): boolean {
  return record.identity.missionId === identity.missionId
    && record.identity.stepIndex === identity.stepIndex
    && record.identity.capability === identity.capability
    && record.identity.executionId === identity.executionId;
}

/** Durable JSON-file evidence store: one file per execution id, atomic writes. */
export class JsonFileExecutionEvidenceStore {
  constructor(private readonly dataDir: string) {}

  async save(record: ExecutionEvidenceRecord): Promise<void> {
    await mkdir(join(this.dataDir, "execution-evidence"), { recursive: true });
    await atomicWriteFile(this.filePath(record.identity.executionId), JSON.stringify(record, null, 2) + "\n");
  }

  async load(executionId: string): Promise<ExecutionEvidenceRecord | undefined> {
    const record = await this.readRecordFile(this.filePath(executionId));
    if (!record) return undefined;
    if (record.identity.executionId !== executionId) {
      throw new Error(`Execution evidence identity mismatch for '${executionId}'.`);
    }
    return record;
  }

  /**
   * Recovery pass (P13.13): PENDING/UNCERTAIN cleanup or an absent
   * settlement means the supervisor died mid-flight. Orphaned records are
   * marked CLEANUP UNCERTAIN and never treated as verified.
   */
  async reconcileOrphans(): Promise<readonly ExecutionEvidenceRecord[]> {
    const directory = join(this.dataDir, "execution-evidence");
    let files: readonly string[] = [];
    try {
      files = await readdir(directory);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const orphaned: ExecutionEvidenceRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const record = await this.readRecordFile(join(directory, file)).catch(() => undefined);
      if (record && record.cleanup === "PENDING") {
        const reconciled: ExecutionEvidenceRecord = createExecutionEvidence({
          identity: record.identity,
          facts: record.facts,
          cleanup: "UNCERTAIN",
          verification: { ...record.verification, state: "UNVERIFIED", probesRun: [] },
        });
        await this.save(reconciled);
        orphaned.push(reconciled);
      }
    }
    return orphaned;
  }

  private async readRecordFile(filePath: string): Promise<ExecutionEvidenceRecord | undefined> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
    const parsed = parseExecutionEvidence(raw);
    if (!parsed.ok) throw new Error(`Invalid execution evidence record '${filePath}': ${parsed.reason}`);
    return parsed.record;
  }

  private filePath(executionId: string): string {
    const safe = executionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.dataDir, "execution-evidence", `${safe}.json`);
  }
}

/** In-memory evidence store for compositions and tests. */
export class InMemoryExecutionEvidenceStore {
  private readonly records = new Map<string, ExecutionEvidenceRecord>();

  async save(record: ExecutionEvidenceRecord): Promise<void> { this.records.set(record.identity.executionId, record); }
  async load(executionId: string): Promise<ExecutionEvidenceRecord | undefined> { return this.records.get(executionId); }

  async reconcileOrphans(): Promise<readonly ExecutionEvidenceRecord[]> {
    const orphaned: ExecutionEvidenceRecord[] = [];
    for (const [id, record] of this.records) {
      if (record.cleanup === "PENDING") {
        const reconciled = createExecutionEvidence({
          identity: record.identity,
          facts: record.facts,
          cleanup: "UNCERTAIN",
          verification: { ...record.verification, state: "UNVERIFIED", probesRun: [] },
        });
        this.records.set(id, reconciled);
        orphaned.push(reconciled);
      }
    }
    return orphaned;
  }
}

function isVerificationState(state: unknown): state is EvidenceVerificationState {
  return state === "UNVERIFIED" || state === "VERIFIED" || state === "FAILED" || state === "INCONCLUSIVE" || state === "SKIPPED";
}

function isCleanupStatus(status: unknown): status is CleanupStatus {
  return status === "PENDING" || status === "CLEANED" || status === "CLEANUP_FAILED" || status === "UNCERTAIN";
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
