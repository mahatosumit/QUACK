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
 */

export const STEP_ATTEMPT_JOURNAL_VERSION = 1;

export type StepAttemptState = "DISPATCHING" | "COMPLETED" | "FAILED" | "AMBIGUOUS";

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
}

export interface StepAttemptJournal {
  /** Reserve a step for dispatch; false if the step already exists (replay/refusal). */
  reserve(attempt: Omit<StepAttemptRecord, "version" | "state" | "recordedAt"> & { readonly executionId: string }): Promise<boolean>;
  /** Settle a reserved step. Unknown keys fail closed. */
  settle(attemptKey: string, settlement: { readonly state: "COMPLETED" | "FAILED" | "AMBIGUOUS"; readonly executionState?: string }): Promise<void>;
  /** Look up a step attempt. */
  load(attemptKey: string): Promise<StepAttemptRecord | undefined>;
  /**
   * Transition crash-window DISPATCHING entries to AMBIGUOUS. Called on
   * recovery paths only; records that were mid-flight in a dead process are
   * NEVER re-executed.
   */
  reconcileOrphans(): Promise<readonly StepAttemptRecord[]>;
}

/** Attempt key identical to the P11 step idempotency key domain. */
export function stepAttemptKey(missionId: string, stepIndex: number, capability: string): string {
  return `${missionId}:${stepIndex}:${capability}`;
}

/** Durable JSON-file journal: one file per attempt key, atomic writes. */
export class JsonFileStepAttemptJournal implements StepAttemptJournal {
  constructor(private readonly dataDir: string) {}

  async reserve(attempt: Omit<StepAttemptRecord, "version" | "state" | "recordedAt"> & { readonly executionId: string }): Promise<boolean> {
    const existing = await this.load(attempt.attemptKey);
    if (existing) return false;
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

  async reconcileOrphans(): Promise<readonly StepAttemptRecord[]> {
    const directory = join(this.dataDir, "step-attempts");
    let files: readonly string[] = [];
    try {
      files = await readdir(directory);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const orphaned: StepAttemptRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      // Self-consistency check inside readRecordFile rejects records whose
      // claimed attemptKey does not belong in this file (forged records).
      const record = await this.readRecordFile(join(directory, file)).catch(() => undefined);
      if (record?.state === "DISPATCHING") {
        const reconciled: StepAttemptRecord = { ...record, state: "AMBIGUOUS", recordedAt: new Date().toISOString() };
        await this.persist(reconciled);
        orphaned.push(reconciled);
      }
    }
    return orphaned;
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

  async reserve(attempt: Omit<StepAttemptRecord, "version" | "state" | "recordedAt"> & { readonly executionId: string }): Promise<boolean> {
    if (this.records.has(attempt.attemptKey)) return false;
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

  async load(attemptKey: string): Promise<StepAttemptRecord | undefined> {
    return this.records.get(attemptKey);
  }

  async reconcileOrphans(): Promise<readonly StepAttemptRecord[]> {
    const orphaned: StepAttemptRecord[] = [];
    for (const [key, record] of this.records) {
      if (record.state === "DISPATCHING") {
        const reconciled = { ...record, state: "AMBIGUOUS" as const, recordedAt: new Date().toISOString() };
        this.records.set(key, reconciled);
        orphaned.push(reconciled);
      }
    }
    return orphaned;
  }
}

function isAttemptState(state: unknown): state is StepAttemptState {
  return state === "DISPATCHING" || state === "COMPLETED" || state === "FAILED" || state === "AMBIGUOUS";
}
