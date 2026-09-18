import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { isMissingFile } from "../../core/utils.js";
import type { LoopRun, IterationRecord } from "./executive-loop.js";
import type { StepAttemptJournal, StepAttemptRecord } from "./step-attempt-journal.js";

/**
 * P14 (ADR 0048): durable mission recovery over EXISTING authorities.
 *
 * NOT a parallel recovery subsystem. This module orchestrates the durable
 * records P11-P13 already own — the mission run record (JsonFileMissionRunStore)
 * and the step-attempt journal (JsonFileStepAttemptJournal) — into a
 * recovery decision. It grants nothing, executes nothing, and verifies
 * nothing itself: recovery can only RESTORE previously-earned state, never
 * create authority that did not exist before the crash
 * (Authority_after ≤ Authority_before).
 *
 * Recovery semantics (honest, at-most-once):
 * - A step whose journal record is COMPLETED → the safe boundary is after it.
 * - A step whose journal record is FAILED     → the run follows its failure
 *   policy; the safe boundary is after it (it settled, terminally).
 * - A step whose journal record is AMBIGUOUS  → the external effect state is
 *   UNKNOWN. Recovery NEVER re-dispatches it. The mission can only resume
 *   BELOW the ambiguous step after a trusted reconciliation marked the
 *   attempt terminal (verify or refuse) — by default the mission parks
 *   AMBIGUOUS and a new operator decision is required.
 * - A step whose journal record is DISPATCHING (crash window) → reconciled to
 *   AMBIGUOUS by the existing journal pass before recovery reads it.
 *
 * The mission checkpoint is a DIGESTED, metadata-only record of trusted
 * runtime state: mission identity, state, iteration cursor, budget counters,
 * and the digests of the durable records it was derived from. It contains no
 * chain-of-thought, no prompts, no arguments, no secrets. Tampered or
 * unknown-schema checkpoints fail closed (mission cannot resume).
 */

export const MISSION_CHECKPOINT_VERSION = 1;

/** P14 recovery decision states — explicit, with legal transitions only. */
export type RecoveryState =
  | "CLEAN"
  | "RECOVERING"
  | "SAFE_TO_RESUME"
  | "REQUIRES_VERIFICATION"
  | "AMBIGUOUS"
  | "TERMINAL";

/** Legal recovery-state transitions (fenced; everything else is a bug). */
const RECOVERY_TRANSITIONS: ReadonlyMap<RecoveryState, ReadonlySet<RecoveryState>> = new Map([
  ["CLEAN", new Set(["RECOVERING", "TERMINAL"])],
  ["RECOVERING", new Set(["SAFE_TO_RESUME", "REQUIRES_VERIFICATION", "AMBIGUOUS", "TERMINAL"])],
  // SAFE_TO_RESUME may only go TERMINAL here; the mission-state machine owns
  // the actual RUNNING transition after the loop consumes the decision.
  ["SAFE_TO_RESUME", new Set(["TERMINAL"])],
  ["REQUIRES_VERIFICATION", new Set(["SAFE_TO_RESUME", "AMBIGUOUS", "TERMINAL"])],
  // AMBIGUOUS never resumes without TRUSTED reconciliation: the only legal
  // exits are an explicit verified resolution or the terminal refusal.
  ["AMBIGUOUS", new Set(["SAFE_TO_RESUME", "TERMINAL"])],
  ["TERMINAL", new Set()],
]);

export function assertRecoveryTransition(from: RecoveryState, to: RecoveryState): void {
  if (from !== to && !RECOVERY_TRANSITIONS.get(from)!.has(to)) {
    throw new Error(`Illegal recovery transition: ${from} → ${to}`);
  }
}

/**
 * The durable mission checkpoint. Deterministic identity (missionId +
 * runId + record digests); tamper-evident via a sha256 digest over the
 * canonical form. Metadata-only: it stores counters and digests, never
 * payload content.
 */
export interface MissionCheckpoint {
  readonly version: typeof MISSION_CHECKPOINT_VERSION;
  /** Deterministic checkpoint identity: the mission + run it belongs to. */
  readonly missionId: string;
  readonly runId: string;
  /** Canonical mission state at checkpoint time (existing vocabulary). */
  readonly missionState: string;
  /** Iteration cursor: the next step index the loop would execute. */
  readonly nextStepIndex: number;
  /** Last step index that settled durably (journal-confirmed), or -1. */
  readonly lastSettledStep: number;
  /** Highest step index with an AMBIGUOUS journal record, or -1. */
  readonly ambiguousStep: number;
  /** Cumulative trusted budget counters at checkpoint time. */
  readonly usage: {
    readonly iterations: number;
    readonly modelCalls: number;
    readonly toolCalls: number;
    readonly cost: number;
  };
  /** sha256 of the journal records this checkpoint was reconciled from. */
  readonly journalDigest: string;
  /** sha256 of the run record this checkpoint was reconciled from. */
  readonly runDigest: string;
  /** Recovery status recorded at write time. */
  readonly recovery: RecoveryState;
  /** sha256 over the canonical checkpoint form (without this field). */
  readonly digest: string;
  readonly recordedAt: string;
}

/** Canonical deterministic serialization (sorted keys, digest stripped). */
export function serializeMissionCheckpoint(checkpoint: Omit<MissionCheckpoint, "digest">): string {
  return JSON.stringify(sortKeysDeep(checkpoint));
}

export function missionCheckpointDigest(checkpoint: Omit<MissionCheckpoint, "digest">): string {
  return createHash("sha256").update(serializeMissionCheckpoint(checkpoint)).digest("hex");
}

const CHECKPOINT_FIELDS = new Set([
  "version", "missionId", "runId", "missionState", "nextStepIndex", "lastSettledStep",
  "ambiguousStep", "usage", "journalDigest", "runDigest", "recovery", "digest", "recordedAt",
]);

/**
 * Fail-closed parse of a persisted checkpoint. Unknown schema, unknown
 * fields, malformed values, or a digest mismatch are ALL rejected — a
 * tampered checkpoint never authorizes a resume.
 */
export function parseMissionCheckpoint(raw: string): { readonly ok: true; readonly checkpoint: MissionCheckpoint } | { readonly ok: false; readonly reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Checkpoint is not valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "Checkpoint must be a JSON object." };
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!CHECKPOINT_FIELDS.has(key)) return { ok: false, reason: `Unknown checkpoint field '${key}' is rejected.` };
  }
  if (record["version"] !== MISSION_CHECKPOINT_VERSION) return { ok: false, reason: "Unsupported checkpoint schema version." };
  const digest = record["digest"];
  if (typeof digest !== "string" || digest.length !== 64) return { ok: false, reason: "Checkpoint digest is missing or malformed." };
  const { digest: _ignored, ...rest } = record;
  void _ignored;
  const candidate = rest as unknown as Omit<MissionCheckpoint, "digest">;
  if (missionCheckpointDigest(candidate) !== digest) {
    return { ok: false, reason: "Checkpoint digest mismatch: the checkpoint was tampered with." };
  }
  if (typeof candidate.missionId !== "string" || candidate.missionId.length === 0) return { ok: false, reason: "Checkpoint identity is malformed." };
  if (typeof candidate.runId !== "string" || candidate.runId.length === 0) return { ok: false, reason: "Checkpoint run identity is malformed." };
  for (const field of ["nextStepIndex", "lastSettledStep", "ambiguousStep"] as const) {
    const value = candidate[field];
    if (!Number.isInteger(value) || value < -1) return { ok: false, reason: `Checkpoint ${field} must be an integer ≥ -1.` };
  }
  const usage = candidate.usage;
  if (typeof usage !== "object" || usage === null
    || !Number.isInteger(usage.iterations) || usage.iterations < 0
    || !Number.isInteger(usage.modelCalls) || usage.modelCalls < 0
    || !Number.isInteger(usage.toolCalls) || usage.toolCalls < 0
    || typeof usage.cost !== "number" || !Number.isFinite(usage.cost) || usage.cost < 0) {
    return { ok: false, reason: "Checkpoint usage counters are malformed." };
  }
  if (!isRecoveryState(candidate.recovery)) return { ok: false, reason: "Unknown checkpoint recovery state." };
  return { ok: true, checkpoint: { ...candidate, digest } };
}

/** The reconciliation decision recovery derives from durable records. */
export interface RecoveryDecision {
  readonly state: RecoveryState;
  readonly missionId: string;
  readonly runId: string;
  /** The safe continuation point: the next step index a resume may execute. */
  readonly nextStepIndex: number;
  readonly lastSettledStep: number;
  readonly ambiguousStep: number;
  /** Human/metadata-only explanation of the decision. */
  readonly reason: string;
  /** Journal records that drove the decision (metadata only). */
  readonly attempts: readonly StepAttemptRecord[];
}

/**
 * Reconcile durable records for one mission into a recovery decision.
 * Reads ONLY trusted durable state: the stored run record and the journal.
 * Never re-executes, never fabricates success, never grants authority.
 */
export async function reconcileMission(input: {
  readonly missionId: string;
  readonly run: LoopRun | undefined;
  readonly journal: StepAttemptJournal;
}): Promise<RecoveryDecision> {
  const attempts = await input.journal.listByMission(input.missionId);
  const ambiguous = attempts.filter((attempt) => attempt.state === "AMBIGUOUS" || attempt.state === "DISPATCHING");
  const settled = attempts.filter((attempt) => attempt.state === "COMPLETED" || attempt.state === "FAILED");
  const ambiguousStep = ambiguous.length > 0 ? Math.max(...ambiguous.map((a) => a.stepIndex)) : -1;
  const lastSettledStep = settled.length > 0 ? Math.max(...settled.map((a) => a.stepIndex)) : -1;

  if (!input.run) {
    return {
      state: "CLEAN",
      missionId: input.missionId,
      runId: "",
      nextStepIndex: 0,
      lastSettledStep: -1,
      ambiguousStep: -1,
      reason: "No durable run record exists; the mission has never started (or never persisted).",
      attempts,
    };
  }

  // A terminal run is never resumed — the run record's stop reason is the
  // honest terminal state; recovery only confirms it.
  if (input.run.stopReason !== undefined) {
    return {
      state: "TERMINAL",
      missionId: input.missionId,
      runId: input.run.runId,
      nextStepIndex: -1,
      lastSettledStep,
      ambiguousStep,
      reason: `Run is terminal (${input.run.stopReason}); resume is refused by design.`,
      attempts,
    };
  }

  // Ambiguity dominates: an unknown external effect can never be re-executed
  // or stepped over. The mission parks REQUIRES_VERIFICATION — a trusted
  // reconciliation (verified evidence or operator refusal) must resolve the
  // ambiguous step before any resume. There is no AMBIGUOUS → resume path.
  // A DISPATCHING record read during recovery IS a crash window (the
  // previous process died mid-dispatch): its external effect is unknown and
  // it parks identically. The distinction between AMBIGUOUS and DISPATCHING
  // matters only to the journal's reconcile pass, not to the decision.
  if (ambiguous.length > 0) {
    return {
      state: "REQUIRES_VERIFICATION",
      missionId: input.missionId,
      runId: input.run.runId,
      nextStepIndex: -1,
      lastSettledStep,
      ambiguousStep,
      reason: `Step ${ambiguousStep} has an ambiguous external-effect state; the runtime never re-dispatches an uncertain action. Resolve (verify or refuse) before resuming.`,
      attempts,
    };
  }

  // Clean mid-run crash: every recorded attempt settled. The safe boundary is
  // the step AFTER the highest settled attempt (or AFTER the run record's own
  // iteration cursor when the journal has no attempts for this mission —
  // e.g. a crash between record-append and journal-reserve); the loop's own
  // per-step journal refuses anything already dispatched, so a resume can
  // never duplicate a settled step even if the run record lagged behind.
  const recordBoundary = input.run.iterations.length > 0
    ? Math.max(...input.run.iterations.map((iteration) => iteration.index)) + 1
    : 0;
  const safeBoundary = Math.max(lastSettledStep + 1, recordBoundary);
  return {
    state: "SAFE_TO_RESUME",
    missionId: input.missionId,
    runId: input.run.runId,
    nextStepIndex: safeBoundary,
    lastSettledStep,
    ambiguousStep,
    reason: `All recorded attempts settled; the safe continuation point is step ${safeBoundary}.`,
    attempts,
  };
}

/** Digest the durable journal state for a mission (binds checkpoints to records). */
export async function journalStateDigest(journal: StepAttemptJournal, missionId: string): Promise<string> {
  const attempts = await journal.listByMission(missionId);
  const canonical = attempts.map((a) => ({ key: a.attemptKey, state: a.state, executionId: a.executionId ?? null }));
  return createHash("sha256").update(JSON.stringify(canonical.sort((a, b) => a.key.localeCompare(b.key)))).digest("hex");
}

/** Digest the run record (binds checkpoints to the authoritative run). */
export function runRecordDigest(run: LoopRun): string {
  // Canonical form: identity + cursor + budget counters + per-iteration
  // terminal facts. Payload content (goals, observations) is NOT digested —
  // checkpoints bind to identity/progress, never to prompts.
  const canonical = {
    runId: run.runId,
    missionId: run.missionId,
    iterations: run.iterations.map((iteration: IterationRecord) => ({
      id: iteration.iterationId,
      index: iteration.index,
      stopReason: iteration.stopReason ?? null,
    })),
    stopReason: run.stopReason ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Build (but do not trust) a fresh checkpoint from reconciled durable state. */
export function buildMissionCheckpoint(input: {
  readonly run: LoopRun;
  readonly recovery: RecoveryState;
  readonly nextStepIndex: number;
  readonly lastSettledStep: number;
  readonly ambiguousStep: number;
  readonly journalDigest: string;
  readonly runDigest: string;
}): MissionCheckpoint {
  const base: Omit<MissionCheckpoint, "digest"> = {
    version: MISSION_CHECKPOINT_VERSION,
    missionId: input.run.missionId,
    runId: input.run.runId,
    missionState: input.run.currentState ?? "RUNNING",
    nextStepIndex: input.nextStepIndex,
    lastSettledStep: input.lastSettledStep,
    ambiguousStep: input.ambiguousStep,
    usage: {
      iterations: input.run.usage.iterations,
      modelCalls: input.run.usage.modelCalls,
      toolCalls: input.run.usage.toolCalls,
      cost: input.run.usage.cost,
    },
    journalDigest: input.journalDigest,
    runDigest: input.runDigest,
    recovery: input.recovery,
    recordedAt: new Date().toISOString(),
  };
  return { ...base, digest: missionCheckpointDigest(base) };
}

/**
 * Durable JSON-file checkpoint store: one file per mission, atomic writes,
 * fail-closed identity checks. Reuses the repository's atomic-write
 * pattern; checkpooints live under `<dataDir>/mission-checkpoints/`.
 */
export class JsonFileMissionCheckpointStore {
  constructor(private readonly dataDir: string) {}

  async save(checkpoint: MissionCheckpoint): Promise<void> {
    await mkdir(dirname(this.filePath(checkpoint.missionId)), { recursive: true });
    await atomicWriteFile(this.filePath(checkpoint.missionId), JSON.stringify(checkpoint, null, 2) + "\n");
  }

  async load(missionId: string): Promise<MissionCheckpoint | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.filePath(missionId), "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
    const parsed = parseMissionCheckpoint(raw);
    if (!parsed.ok) throw new Error(`Invalid mission checkpoint for '${missionId}': ${parsed.reason}`);
    if (parsed.checkpoint.missionId !== missionId) {
      throw new Error(`Mission checkpoint identity mismatch for '${missionId}'.`);
    }
    return parsed.checkpoint;
  }

  private filePath(missionId: string): string {
    // Defensive encoding keeps the namespace flat and traversal-free.
    const safe = missionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.dataDir, "mission-checkpoints", `${safe}.json`);
  }
}

/** In-memory checkpoint store for compositions and tests. */
export class InMemoryMissionCheckpointStore {
  private readonly checkpoints = new Map<string, MissionCheckpoint>();
  async save(checkpoint: MissionCheckpoint): Promise<void> { this.checkpoints.set(checkpoint.missionId, checkpoint); }
  async load(missionId: string): Promise<MissionCheckpoint | undefined> { return this.checkpoints.get(missionId); }
}

function isRecoveryState(value: unknown): value is RecoveryState {
  return value === "CLEAN" || value === "RECOVERING" || value === "SAFE_TO_RESUME"
    || value === "REQUIRES_VERIFICATION" || value === "AMBIGUOUS" || value === "TERMINAL";
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

/** Crash-safe write (same pattern as core.utils.atomicWriteFile, local to avoid import cycles in dist layouts). */
async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tmpPath, data, "utf8");
  await rename(tmpPath, filePath);
}
