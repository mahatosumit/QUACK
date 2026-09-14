import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isMissingFile, atomicWriteFile } from "../../core/utils.js";

/**
 * P12 (ADR 0046): durable at-most-once dispatch journal for governed steps.
 *
 * P11 relied on the ActionRuntime idempotency ledger, which dedupes by
 * request hash {actionId, input, dryRun} — two different ARGUMENTS for the
 * same (mission, step, capability) are different requests, so a crash
 * between "model proposed" and "dispatched" could re-execute with fresh
 * arguments after restart. P12 closes the crash window at the STEP level:
 *
 *   before dispatch  → journal records DISPATCHING (durable, atomic)
 *   after settlement → journal records COMPLETED / FAILED / AMBIGUOUS
 *
 * On load, a DISPATCHING entry means the process died mid-execution: the
 * external effect is UNKNOWN. It is transitioned to AMBIGUOUS and NEVER
 * re-executed — recovery surfaces it for verification / operator
 * intervention instead of blindly replaying. This is replay-protected
 * at-most-once dispatch; exactly-once is NOT claimed (the underlying action
 * may or may not have reached an external effect before the crash).
 *
 * Honest semantics:
 * - COMPLETED  — runtime evidence of settlement; re-propagation replays the
 *                recorded outcome, never re-dispatches.
 * - FAILED     — terminal failure (denial/failure); no re-execution.
 * - AMBIGUOUS  — timeout / cancellation / crash-window; external state may
 *                have happened; requires verification or operator decision.
 * - RELEASED   — P15: the reservation was withdrawn under TRUSTED
 *                pre-execution evidence (a durable PENDING approval bound
 *                to this exact attempt proves the previous process died
 *                INSIDE the approval callback, before any execution could
 *                begin). A RELEASED attempt may be re-reserved exactly once
 *                per release; the release itself is recorded on the
 *                EventBus audit trail. RELEASED is never settled state and
 *                never blocks recovery: it is the ONE at-most-once exit
 *                that requires evidence the external effect never started.
 */

export const STEP_ATTEMPT_JOURNAL_VERSION = 1;

export type StepAttemptState = "DISPATCHING" | "COMPLETED" | "FAILED" | "AMBIGUOUS" | "RELEASED";

export interface StepAttemptRecord {
  readonly version: typeof STEP_ATTEMPT_JOURNAL_VERSION;
  /** missionId:stepIndex:capability — the P11 stable step identity. */
  readonly attemptKey: string;
  readonly missionId: string;
  readonly stepIndex: number;
  readonly capability: string;
  readonly state: StepAttemptState;
  readonly executionId?: string;
  readonly executionState?: string;
  readonly recordedAt: string;
  /** P15: provenance of a trusted RELEASE (evidence-backed pre-execution crash). */
  readonly releasedBy?: string;
  readonly releasedAt?: string;
  readonly releaseReason?: string;
  /** P15: provenance of a trusted ambiguous resolution (verify/refuse). */
  readonly resolvedBy?: string;
  readonly resolvedAt?: string;
  readonly resolutionReason?: string;
  /** P15: sha256 of the trusted evidence record that justified resolution. */
  readonly resolutionEvidenceDigest?: string;
}

export interface StepAttemptJournal {
  /** Reserve a step for dispatch; false if the step already exists (replay/refusal). */
  reserve(attempt: Omit<StepAttemptRecord, "version" | "state" | "recordedAt" | "releasedBy" | "releasedAt" | "releaseReason" | "resolvedBy" | "resolvedAt" | "resolutionReason" | "resolutionEvidenceDigest"> & { readonly executionId: string }): Promise<boolean>;
  /** Settle a reserved step. Unknown keys fail closed. */
  settle(attemptKey: string, settlement: { readonly state: "COMPLETED" | "FAILED" | "AMBIGUOUS"; readonly executionState?: string }): Promise<void>;
  /**
   * P15: trusted release of a DISPATCHING reservation. Legal ONLY with
   * durable evidence the previous process died BEFORE any execution could
   * start (a durable PENDING approval bound to this exact attempt proves
   * the crash happened inside the approval gate). The reservation becomes
   * re-reservable; the release is recorded on the attempt with provenance.
   */
  release(attemptKey: string, provenance: { readonly by: string; readonly reason: string }): Promise<void>;
  /**
   * P15: trusted resolution of an AMBIGUOUS attempt through verified
   * evidence (COMPLETED) or a definitive negative / operator refusal
   * (FAILED). Never legal from DISPATCHING; never without provenance.
   */
  resolveAmbiguous(attemptKey: string, resolution: {
    readonly to: "COMPLETED" | "FAILED";
    readonly by: string;
    readonly reason: string;
    readonly evidenceDigest?: string;
  }): Promise<void>;
  /** Look up a step attempt. */
  load(attemptKey: string): Promise<StepAttemptRecord | undefined>;
  /**
   * P14: list every durable attempt belonging to a mission (all step
   * indices, all capabilities). Recovery reconciliation reads this to
   * determine the safe continuation point; ordering is ascending stepIndex.
   */
  listByMission(missionId: string): Promise<readonly StepAttemptRecord[]>;
  /**
   * Transition crash-window DISPATCHING entries to AMBIGUOUS. Called on
   * recovery paths only; records that were mid-flight in a dead process are
   * NEVER re-executed.
   *
   * P15: when missionId is provided, reconciliation is SCOPED to that
   * mission. The caller must hold the mission's coordination lease: a live
   * process's in-flight DISPATCHING records for OTHER missions must never
   * be parked by an unrelated process sharing the dataDir.
   */
  reconcileOrphans(missionId?: string): Promise<readonly StepAttemptRecord[]>;
}

/** Attempt key identical to the P11 step idempotency key domain. */
export function stepAttemptKey(missionId: string, stepIndex: number, capability: string): string {
  return `${missionId}:${stepIndex}:${capability}`;
}

/** Durable JSON-file journal: one file per attempt key, atomic writes. */
export class JsonFileStepAttemptJournal implements StepAttemptJournal {
  constructor(private readonly dataDir: string) {}

  async reserve(attempt: Omit<StepAttemptRecord, "version" | "state" | "recordedAt" | "releasedBy" | "releasedAt" | "releaseReason" | "resolvedBy" | "resolvedAt" | "resolutionReason" | "resolutionEvidenceDigest"> & { readonly executionId: string }): Promise<boolean> {
    const existing = await this.load(attempt.attemptKey);
    // P15: a RELEASED attempt may be re-reserved — the release carried
    // trusted pre-execution crash evidence (durable PENDING approval bound
    // to this exact attempt). Every other existing state refuses.
    if (existing && existing.state !== "RELEASED") return false;
    if (existing?.state === "RELEASED" && existing.releasedBy === undefined) return false;
    const record: StepAttemptRecord = {
      version: STEP_ATTEMPT_JOURNAL_VERSION,
      ...attempt,
      state: "DISPATCHING",
      recordedAt: new Date().toISOString(),
    };
    await this.persist(record);
    // Re-read to prove durable reservation under a concurrent writer: if
    // another process wrote the same key first, the surviving file wins and
    // this writer refuses.
    const persisted = await this.load(attempt.attemptKey);
    return persisted?.state === "DISPATCHING" && persisted.recordedAt === record.recordedAt;
  }

  async settle(attemptKey: string, settlement: { readonly state: "COMPLETED" | "FAILED" | "AMBIGUOUS"; readonly executionState?: string }): Promise<void> {
    const existing = await this.load(attemptKey);
    if (!existing) throw new Error(`Step attempt journal: unknown attempt key '${attemptKey}'.`);
    if (existing.state !== "DISPATCHING") throw new Error(`Step attempt journal: attempt '${attemptKey}' is already settled (${existing.state}).`);
    await this.persist({
      ...existing,
      state: settlement.state,
      ...(settlement.executionState !== undefined ? { executionState: settlement.executionState } : {}),
      recordedAt: new Date().toISOString(),
    });
  }

  async release(attemptKey: string, provenance: { readonly by: string; readonly reason: string }): Promise<void> {
    const existing = await this.load(attemptKey);
    if (!existing) throw new Error(`Step attempt journal: unknown attempt key '${attemptKey}'.`);
    if (existing.state !== "DISPATCHING") {
      throw new Error(`Step attempt journal: attempt '${attemptKey}' is ${existing.state}; only a DISPATCHING reservation can be released.`);
    }
    await this.persist({
      ...existing,
      state: "RELEASED",
      releasedBy: provenance.by,
      releasedAt: new Date().toISOString(),
      releaseReason: provenance.reason,
      recordedAt: new Date().toISOString(),
    });
  }

  async resolveAmbiguous(attemptKey: string, resolution: {
    readonly to: "COMPLETED" | "FAILED";
    readonly by: string;
    readonly reason: string;
    readonly evidenceDigest?: string;
  }): Promise<void> {
    const existing = await this.load(attemptKey);
    if (!existing) throw new Error(`Step attempt journal: unknown attempt key '${attemptKey}'.`);
    if (existing.state !== "AMBIGUOUS") {
      throw new Error(`Step attempt journal: attempt '${attemptKey}' is ${existing.state}; only an AMBIGUOUS attempt can be resolved.`);
    }
    await this.persist({
      ...existing,
      state: resolution.to,
      resolvedBy: resolution.by,
      resolvedAt: new Date().toISOString(),
      resolutionReason: resolution.reason,
      ...(resolution.evidenceDigest !== undefined ? { resolutionEvidenceDigest: resolution.evidenceDigest } : {}),
      recordedAt: new Date().toISOString(),
    });
  }

  async load(attemptKey: string): Promise<StepAttemptRecord | undefined> {
    const record = await this.readRecordFile(this.filePath(attemptKey));
    if (!record) return undefined;
    // Strict identity: the stored key must equal the requested key AND be
    // self-consistent with the file it lives in.
    if (record.attemptKey !== attemptKey) {
      throw new Error(`Step attempt journal: record identity mismatch for '${attemptKey}'.`);
    }
    return record;
  }

  async listByMission(missionId: string): Promise<readonly StepAttemptRecord[]> {
    const records = await this.readAllRecords();
    return records
      .filter((record) => record.missionId === missionId)
      .sort((a, b) => a.stepIndex - b.stepIndex);
  }

  async reconcileOrphans(missionId?: string): Promise<readonly StepAttemptRecord[]> {
    const orphaned = (await this.readAllRecords())
      .filter((record) => record.state === "DISPATCHING")
      .filter((record) => missionId === undefined || record.missionId === missionId);
    const reconciled: StepAttemptRecord[] = [];
    for (const record of orphaned) {
      const updated: StepAttemptRecord = { ...record, state: "AMBIGUOUS", recordedAt: new Date().toISOString() };
      await this.persist(updated);
      reconciled.push(updated);
    }
    return reconciled;
  }

  /** Read every record file; invalid/corrupt individual files are skipped fail-closed by readRecordFile's catch below. */
  private async readAllRecords(): Promise<readonly StepAttemptRecord[]> {
    const directory = join(this.dataDir, "step-attempts");
    let files: readonly string[] = [];
    try {
      files = await readdir(directory);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const records: StepAttemptRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      // Self-consistency check inside readRecordFile rejects records whose
      // claimed attemptKey does not belong in this file (forged records).
      const record = await this.readRecordFile(join(directory, file)).catch(() => undefined);
      if (record) records.push(record);
    }
    return records;
  }

  /**
   * Read and validate one record file. The record is trusted only when its
   * claimed attemptKey maps back to exactly this file path — a record
   * planted under another key's filename fails closed.
   */
  private async readRecordFile(filePath: string): Promise<StepAttemptRecord | undefined> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Corrupt step attempt record.");
    }
    const record = parsed as StepAttemptRecord;
    if (record.version !== STEP_ATTEMPT_JOURNAL_VERSION || typeof record.attemptKey !== "string") {
      throw new Error(`Invalid step attempt record '${filePath}'.`);
    }
    if (this.filePath(record.attemptKey) !== filePath) {
      throw new Error(`Invalid step attempt record '${filePath}' (identity mismatch).`);
    }
    if (!isAttemptState(record.state)) {
      throw new Error(`Invalid state in step attempt record '${filePath}'.`);
    }
    return record;
  }

  private async persist(record: StepAttemptRecord): Promise<void> {
    await mkdir(join(this.dataDir, "step-attempts"), { recursive: true });
    await atomicWriteFile(this.filePath(record.attemptKey), JSON.stringify(record, null, 2) + "\n");
  }

  private filePath(attemptKey: string): string {
    // Attempt keys contain ':' which is not filename-safe on Windows; hash
    // to a flat, traversal-free namespace.
    const safe = attemptKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.dataDir, "step-attempts", `${safe}.json`);
  }
}

/** In-memory journal for compositions and tests without durable persistence. */
export class InMemoryStepAttemptJournal implements StepAttemptJournal {
  private readonly records = new Map<string, StepAttemptRecord>();

  async reserve(attempt: Omit<StepAttemptRecord, "version" | "state" | "recordedAt" | "releasedBy" | "releasedAt" | "releaseReason" | "resolvedBy" | "resolvedAt" | "resolutionReason" | "resolutionEvidenceDigest"> & { readonly executionId: string }): Promise<boolean> {
    const existing = this.records.get(attempt.attemptKey);
    // P15: RELEASED attempts are re-reservable — the release recorded
    // trusted pre-execution crash evidence. The re-reserve clears release
    // provenance (a new dispatch epoch owns the attempt now).
    if (existing && existing.state !== "RELEASED") return false;
    if (existing?.state === "RELEASED" && existing.releasedBy === undefined) return false;
    this.records.set(attempt.attemptKey, {
      version: STEP_ATTEMPT_JOURNAL_VERSION,
      ...attempt,
      state: "DISPATCHING",
      recordedAt: new Date().toISOString(),
    });
    return true;
  }

  async settle(attemptKey: string, settlement: { readonly state: "COMPLETED" | "FAILED" | "AMBIGUOUS"; readonly executionState?: string }): Promise<void> {
    const existing = this.records.get(attemptKey);
    if (!existing) throw new Error(`Step attempt journal: unknown attempt key '${attemptKey}'.`);
    if (existing.state !== "DISPATCHING") throw new Error(`Step attempt journal: attempt '${attemptKey}' is already settled (${existing.state}).`);
    this.records.set(attemptKey, {
      ...existing,
      state: settlement.state,
      ...(settlement.executionState !== undefined ? { executionState: settlement.executionState } : {}),
      recordedAt: new Date().toISOString(),
    });
  }

  async release(attemptKey: string, provenance: { readonly by: string; readonly reason: string }): Promise<void> {
    const existing = this.records.get(attemptKey);
    if (!existing) throw new Error(`Step attempt journal: unknown attempt key '${attemptKey}'.`);
    this.assertDispatching(existing, attemptKey, "released");
    this.records.set(attemptKey, {
      ...existing,
      state: "RELEASED",
      releasedBy: provenance.by,
      releasedAt: new Date().toISOString(),
      releaseReason: provenance.reason,
      recordedAt: new Date().toISOString(),
    });
  }

  async resolveAmbiguous(attemptKey: string, resolution: {
    readonly to: "COMPLETED" | "FAILED";
    readonly by: string;
    readonly reason: string;
    readonly evidenceDigest?: string;
  }): Promise<void> {
    const existing = this.records.get(attemptKey);
    if (!existing) throw new Error(`Step attempt journal: unknown attempt key '${attemptKey}'.`);
    if (existing.state !== "AMBIGUOUS") throw new Error(`Step attempt journal: attempt '${attemptKey}' is ${existing.state}; only an AMBIGUOUS attempt can be resolved.`);
    this.records.set(attemptKey, {
      ...existing,
      state: resolution.to,
      resolvedBy: resolution.by,
      resolvedAt: new Date().toISOString(),
      resolutionReason: resolution.reason,
      ...(resolution.evidenceDigest !== undefined ? { resolutionEvidenceDigest: resolution.evidenceDigest } : {}),
      recordedAt: new Date().toISOString(),
    });
  }

  async load(attemptKey: string): Promise<StepAttemptRecord | undefined> {
    return this.records.get(attemptKey);
  }

  async listByMission(missionId: string): Promise<readonly StepAttemptRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.missionId === missionId)
      .sort((a, b) => a.stepIndex - b.stepIndex);
  }

  async reconcileOrphans(missionId?: string): Promise<readonly StepAttemptRecord[]> {
    const orphaned: StepAttemptRecord[] = [];
    for (const [key, record] of this.records) {
      if (record.state === "DISPATCHING" && (missionId === undefined || record.missionId === missionId)) {
        const reconciled = { ...record, state: "AMBIGUOUS" as const, recordedAt: new Date().toISOString() };
        this.records.set(key, reconciled);
        orphaned.push(reconciled);
      }
    }
    return orphaned;
  }

  private assertDispatching(existing: StepAttemptRecord, attemptKey: string, operation: string): void {
    if (existing.state !== "DISPATCHING") {
      throw new Error(`Step attempt journal: attempt '${attemptKey}' is ${existing.state}; only a DISPATCHING reservation can be ${operation}.`);
    }
  }
}

function isAttemptState(state: unknown): state is StepAttemptState {
  return state === "DISPATCHING" || state === "COMPLETED" || state === "FAILED" || state === "AMBIGUOUS" || state === "RELEASED";
}
