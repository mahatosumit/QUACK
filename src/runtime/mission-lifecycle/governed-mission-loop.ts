import { createHash } from "node:crypto";
import { createId, fail, now, ok, type JsonObject, type QuackResult } from "../../core/types.js";
import { type EventBus } from "../../events/event-bus.js";
import { redactSecrets } from "../../security/secret-provider.js";
import { type CapabilityBroker } from "../../security/capability-broker.js";
import { type ToolRegistry } from "../../tools/tool.js";
import { type ActionProviderRegistry, type ActionRuntime } from "../../actions/runtime.js";
import { admitContext } from "../../instruction/firewall.js";
import { composeInstructionPlan } from "../../instruction/composer.js";
import type { ComposedInstruction } from "../../instruction/types.js";
import { invokeGovernedInstruction, type GovernedDispatchRuntime, type GovernedInvocationContext } from "../../instruction/model-adapter.js";
import { selectContext, type ContextCandidate, type SelectionInput } from "../../instruction/selector.js";
import { type InstructionObserver } from "../../instruction/observer.js";
import {
  appendIteration, createIterationId, createLoopRun, detectStall, emptyBudgetUsage, evaluateBudget, isTerminalStopReason,
  recordModelCall, recordToolCall, terminateRun,
  type Budget, type IterationRecord, type LoopRun, type StopReason,
} from "./executive-loop.js";
import { type ExecutionHarness, type HarnessExecutionContext, DefaultExecutionHarness } from "./harness.js";
import { type ActionProposal } from "./action-contract.js";
import { ACTION_PROPOSAL_SCHEMA_REF, buildCapabilityIndex, buildIterationPlan, parseActionProposal, stepIdempotencyKey, type ParsedProposalIntent } from "./proposal-parser.js";
import {
  classifyExecutionState, journalStateForExecution, DEFAULT_MAX_CONCURRENT_STEPS,
} from "./execution-policy.js";
import { InMemoryStepAttemptJournal, stepAttemptKey, type StepAttemptJournal } from "./step-attempt-journal.js";
import {
  assertMissionTransition, planMissionTransition, isTerminalMissionState,
  type MissionState, type MissionTransitionTrigger,
} from "./mission-state-machine.js";
import {
  reconcileMission, journalStateDigest, runRecordDigest, buildMissionCheckpoint,
  JsonFileMissionCheckpointStore, InMemoryMissionCheckpointStore,
  type MissionCheckpoint, type RecoveryDecision, type RecoveryState,
} from "./mission-recovery.js";
import { MissionOwnershipGuard, type OwnershipEventPayload } from "../ownership.js";
import { SqliteConnection } from "../../storage/sqlite.js";
import { JsonFileApprovalStore, DurableApprovalRunner, approvalRequestKey } from "./approval-store.js";

/**
 * P11 (ADR 0045): the governed mission execution loop — the first REAL
 * model-in-the-loop mission path, assembled exclusively over EXISTING
 * authorities:
 *
 *   MISSION STATE (existing MissionState machine, fenced transitions)
 *     → QIE plan (deterministic layers; P9 memory stays MEMORY trust and
 *       passes the P8.3 firewall BEFORE selection)
 *     → compose → defense → invokeGovernedInstruction (P8 pipeline, first
 *       production consumer)
 *     → strict fail-closed proposal parser (new trust boundary)
 *     → DefaultExecutionHarness (existing): validate → broker authorize →
 *       lower → ActionRuntime / policy-enforced executeTool → verify
 *     → deterministic next-step policy → budget/stall-bounded continue
 *
 * The model NEVER executes. It proposes; the parser validates; the ONE
 * CapabilityBroker authorizes; existing surfaces execute. No fallback
 * execution path exists. v1 executes READ_ONLY/REVERSIBLE capabilities
 * only (the harness fails closed on stronger risk levels).
 *
 * P15 (ADR 0049): when a coordination DB path is provided (or derived from
 * the run store's dataDir), every run()/resume acquires the mission's
 * coordination lease through the EXISTING MissionOwnershipGuard (ADR 0031
 * primitive) — exactly one authoritative executor per mission across
 * processes; durable writes are fenced; a crashed owner's lease expires
 * and is taken over atomically. Journal reservation and orphan
 * reconciliation are scoped to the LEASED mission only: a live process's
 * in-flight steps for other missions are never parked. WAITING_APPROVAL
 * steps park durably through the approval store and their DISPATCHING
 * reservation is RELEASED under durable evidence the previous dispatch
 * died inside the approval gate (before any execution).
 */

export interface GovernedMissionLoopOptions {
  /** Existing capability broker — the single authority. */
  readonly broker: CapabilityBroker;
  /** Existing action runtime + provider registry (execution surface). */
  readonly actionRuntime: ActionRuntime;
  readonly actionProviders: ActionProviderRegistry;
  /** Existing tool registry (core.tools execution surface). */
  readonly tools: ToolRegistry;
  /** Existing governed model runtime (broker-gated provider.invoke). */
  readonly modelRuntime: GovernedDispatchRuntime;
  /** Existing event bus — the single observability transport. */
  readonly events: EventBus;
  /** Existing harness; defaults to DefaultExecutionHarness over the same deps. */
  readonly harness?: ExecutionHarness;
  /**
   * Policy-enforced core.tools executor (production: QuackRuntime.executeTool).
   * Required when proposals may target registered tools; the default harness
   * fails closed without it — there is no ungoverned tool path.
   */
  readonly executeTool?: import("./harness.js").HarnessConfig["executeTool"];
  /**
   * P9 governed retrieval, reduced by the caller to QIE candidates with
   * MEMORY provenance and their admitted memory ids (e.g. via
   * memoryCandidatesFromRetrieval + semanticMemoryAuthorities).
   */
  readonly retrieveMemory?: (query: string, limit: number) => Promise<readonly ContextCandidate[]>;
  /** Admitted memory ids backing the P8.3 firewall lane (parallel to retrieveMemory). */
  readonly admittedMemoryIds?: (query: string) => readonly string[];
  /** P8.7 instruction observer (optional; existing events flow through it). */
  readonly observer?: InstructionObserver;
  /** Actor identity recorded on proposals/requests (audit trail). */
  readonly actor?: string;
  /** Per-mission loop budget. Defaults are deliberately small. */
  readonly budget?: Partial<Budget>;
  /** Bounded retries per step for model/parse/execution failures (default 2). */
  readonly maxRetriesPerStep?: number;
  /** P9 retrieval limit per iteration (default 5). */
  readonly memoryLimit?: number;
  /** Where to persist the run record; omit for in-memory only. */
  readonly runStore?: MissionRunStore;
  /**
   * P12 (ADR 0046): durable at-most-once dispatch journal. When provided,
   * a step (mission, stepIndex, capability) can be dispatched at most once
   * per process lifetime across restarts; crash-window attempts reconcile
   * to AMBIGUOUS and are never re-executed. Default: in-memory journal
   * scoped to this loop instance.
   */
  readonly stepJournal?: StepAttemptJournal;
  /** P12: bounded concurrent governed executions (enforced in-process). */
  readonly maxConcurrentSteps?: number;
  /**
   * P14 (ADR 0048): durable mission checkpoints. When provided, the loop
   * writes a trusted checkpoint after every settled iteration and reconciles
   * it on restart to determine the safe continuation point. Default:
   * in-memory store scoped to this loop instance.
   */
  readonly checkpointStore?: import("./mission-recovery.js").JsonFileMissionCheckpointStore | import("./mission-recovery.js").InMemoryMissionCheckpointStore;
  /**
   * P14 (ADR 0048): the governed approval runner for IRREVERSIBLE and
   * DESTRUCTIVE proposals. Passed through to the default harness; a custom
   * harness wires it itself. Without it, those risk levels keep the honest
   * P13 fail-closed behavior.
   */
  readonly approvalRunner?: import("./approval-contract.js").ApprovalRunner;
  /**
   * P13 (ADR 0047): governed isolated-execution surface. Passed through to
   * the default harness; when a custom harness is provided the caller wires
   * it there instead. Capabilities with a REGISTERED workload adapter route
   * through the trusted IsolationSupervisor (real isolated environment);
   * everything else keeps the honest POLICY_RESTRICTED host path.
   */
  readonly isolation?: import("./harness.js").HarnessConfig["isolation"];
  /**
   * P15 (ADR 0049): SQLite coordination DB for multi-process mission
   * ownership (the ADR 0031 primitive). When provided (production derives
   * it from the dataDir), run()/resume acquires the mission lease first
   * and fails closed on contention. Omit for single-process compositions
   * (tests, embedded use) — no lease is acquired, no behavior changes.
   */
  readonly coordinationDbPath?: string;
  /** P15: lease duration for mission ownership (default 30s, heartbeat /3). */
  readonly ownershipLeaseMs?: number;
  /**
   * P15 (ADR 0049): the durable approval store backing WAITING_APPROVAL
   * steps. When provided together with approvalRunner, approval requests
   * park durably under the dataDir and survive restarts.
   */
  readonly approvalStore?: JsonFileApprovalStore;
  /**
   * P15 (ADR 0049): trusted ambiguous-step reconciliation inputs. When
   * provided, a resume attempts trusted reconciliation of AMBIGUOUS journal
   * records through durable evidence-bound probes BEFORE parking; missing
   * probes/evidence leave the attempt AMBIGUOUS (fail closed).
   */
  readonly ambiguityReconciliation?: {
    readonly probeRunner: import("../../isolation/probe-runner.js").ProbeRunner;
    readonly evidenceStore: { load(executionId: string): Promise<import("../../isolation/execution-evidence.js").ExecutionEvidenceRecord | undefined> };
    /** The trusted verification strategy the original dispatch carried. */
    readonly strategyFor: (attempt: import("./step-attempt-journal.js").StepAttemptRecord) => import("./action-contract.js").VerificationStrategy | undefined;
  };
}

export interface MissionRunStore {
  save(run: LoopRun): Promise<void>;
  load(missionId: string): Promise<LoopRun | undefined>;
  list(): Promise<readonly LoopRun[]>;
}

/** P15: mission ownership contention — the run must fail closed, never degrade. */
export class MissionOwnershipError extends Error {
  constructor(
    public readonly failure: "OWNERSHIP_CONFLICT" | "LEASE_LOST" | "STALE_OWNER",
    public readonly missionId: string,
  ) {
    super(`Mission ${missionId} is owned by another live process (${failure}); governed execution fails closed.`);
    this.name = "MissionOwnershipError";
  }
}

/** Result of one governed mission run. */
export interface GovernedMissionLoopResult {
  readonly run: LoopRun;
  readonly finalState: MissionState;
}

/** Default v1 budget: small, explicit, bounded. Replans stay unlimited
 * here because the loop never replans (maxReplans governs the existing
 * executive-loop's replan policy; 0 would instantly trip the budget). */
const DEFAULT_BUDGET: Budget = {
  maxIterations: 8,
  maxModelCalls: 16,
  maxToolCalls: 24,
  maxCost: 1,
  maxExecutionTimeMs: 5 * 60_000,
  maxConsecutiveFailures: 3,
};

const RUNTIME_SOURCE = "governed-mission-loop";

export class GovernedMissionLoop {
  private readonly harness: ExecutionHarness;
  private readonly budget: Budget;
  private readonly maxRetriesPerStep: number;
  private readonly memoryLimit: number;
  private readonly actor: string;
  private readonly runs = new Map<string, LoopRun>();
  private readonly cancellers = new Map<string, AbortController>();
  /** P15: active mission ownership guards (per missionId, fenced writes). */
  private readonly ownerships = new Map<string, MissionOwnershipGuard>();
  /** P12: at-most-once step dispatch journal (durable when provided). */
  private readonly stepJournal: StepAttemptJournal;
  /** P12: in-process concurrency bound for governed executions. */
  private readonly maxConcurrentSteps: number;
  /** P14: durable mission checkpoint store. */
  private readonly checkpointStore: import("./mission-recovery.js").JsonFileMissionCheckpointStore | import("./mission-recovery.js").InMemoryMissionCheckpointStore;
  /** P15: optional cross-process mission ownership (ADR 0031 primitive). */
  private readonly ownershipConnection: SqliteConnection | undefined;
  private readonly ownershipLeaseMs: number | undefined;
  /** P15: durable approval store (WAITING_APPROVAL persistence). */
  private readonly approvalStore: JsonFileApprovalStore | undefined;
  /** P15: trusted ambiguous-step reconciliation inputs. */
  private readonly ambiguityReconciliation: GovernedMissionLoopOptions["ambiguityReconciliation"];
  private activeSteps = 0;

  constructor(private readonly options: GovernedMissionLoopOptions) {
    // Fail fast on missing required authorities: a governed loop constructed
    // without its broker/model/event surfaces can never run — better an
    // explicit construction error than an ungoverned surprise at run time.
    for (const key of ["broker", "actionRuntime", "actionProviders", "tools", "modelRuntime", "events"] as const) {
      if (!options[key]) {
        throw new Error(`GovernedMissionLoop requires '${key}' — the loop assembles over existing authorities and never fabricates them.`);
      }
    }
    this.harness = options.harness ?? new DefaultExecutionHarness(
      options.actionRuntime,
      options.broker,
      options.actionProviders,
      options.tools,
      options.events,
      { defaultTimeoutMs: 120_000, requireVerificationForIrreversible: true, executeTool: options.executeTool,
        ...(options.isolation ? { isolation: options.isolation } : {}),
        ...(options.approvalRunner ? { approvalRunner: options.approvalRunner } : {}) },
    );
    this.budget = { ...DEFAULT_BUDGET, ...options.budget };
    this.maxRetriesPerStep = options.maxRetriesPerStep ?? 2;
    this.memoryLimit = options.memoryLimit ?? 5;
    this.actor = options.actor ?? "governed-mission-loop";
    this.stepJournal = options.stepJournal ?? new InMemoryStepAttemptJournal();
    this.maxConcurrentSteps = options.maxConcurrentSteps ?? DEFAULT_MAX_CONCURRENT_STEPS;
    this.checkpointStore = options.checkpointStore ?? new InMemoryMissionCheckpointStore();
    this.ownershipConnection = options.coordinationDbPath ? new SqliteConnection(options.coordinationDbPath) : undefined;
    this.ownershipLeaseMs = options.ownershipLeaseMs;
    this.approvalStore = options.approvalStore;
    this.ambiguityReconciliation = options.ambiguityReconciliation;
  }

  /**
   * P15: acquire the mission's coordination lease (ADR 0031 primitive via
   * MissionOwnershipGuard, `governed:` namespace — distinct from the legacy
   * runtime's `mission:` leases in the same DB). Discriminated outcome; a
   * BUSY lease fails closed with `mission.ownership_busy` and NEVER
   * degrades to an unowned run.
   */
  private acquireOwnership(missionId: string): MissionOwnershipGuard | undefined {
    if (!this.ownershipConnection) return undefined;
    const guard = new MissionOwnershipGuard(this.ownershipConnection, {
      ...(this.ownershipLeaseMs ? { leaseMs: this.ownershipLeaseMs } : {}),
      emit: (type, payload: OwnershipEventPayload) => {
        const mapped = type === "ownership.acquired" ? "coordination.acquired"
          : type === "ownership.rejected" ? "coordination.contention"
          : type === "ownership.lost" ? "coordination.expired"
          : type === "ownership.released" ? "coordination.released" : undefined;
        if (mapped) {
          void this.options.events.emit(mapped, {
            missionId: payload.missionId, owner: payload.owner ?? "", epoch: payload.epoch ?? -1,
          }, { actor: this.actor }).catch(() => undefined);
        }
      },
    });
    const outcome = guard.acquire(`governed:${missionId}`);
    if (outcome.kind === "FAILED") {
      guard.close();
      throw new MissionOwnershipError(outcome.failure, missionId);
    }
    guard.startHeartbeat(() => undefined);
    this.ownerships.set(missionId, guard);
    return guard;
  }

  /** P15: the active ownership guard for a mission (undefined in single-process mode). */
  private ownershipOf(missionId: string): MissionOwnershipGuard | undefined {
    return this.ownerships.get(missionId);
  }

  private releaseOwnership(missionId: string): void {
    const guard = this.ownerships.get(missionId);
    if (guard) {
      this.ownerships.delete(missionId);
      guard.close();
    }
  }

  /** Run (or resume, when a stored non-terminal run exists) a governed mission. */
  async run(request: {
    readonly missionId: string;
    readonly objective: string;
    readonly constraints?: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<QuackResult<GovernedMissionLoopResult>> {
    if (!request.missionId || !request.objective) {
      return fail({ code: "mission.loop_invalid_input", message: "A governed mission requires a missionId and an objective.", category: "validation", recoverable: false });
    }
    // P15: acquire the mission's coordination lease FIRST (when a
    // coordination DB is wired). Contention fails closed — the run never
    // proceeds unowned next to a live executor. When no coordination DB is
    // wired (single-process compositions), behavior is unchanged.
    let ownership: MissionOwnershipGuard | undefined;
    try {
      ownership = this.acquireOwnership(request.missionId);
    } catch (error) {
      if (error instanceof MissionOwnershipError) {
        this.cancellers.delete(request.missionId);
        return fail({
          code: "mission.ownership_busy",
          message: error.message,
          category: "validation",
          recoverable: false,
        });
      }
      // P15-F: a coordination primitive failure (corrupt DB, locked DB,
      // permission denied) fails the run CLOSED — the mission is never run
      // unowned next to an unverifiable coordination state.
      this.cancellers.delete(request.missionId);
      return fail({
        code: "mission.ownership_unavailable",
        message: `Mission coordination is unavailable (${error instanceof Error ? error.message : String(error)}); the run fails closed rather than proceeding unowned.`,
        category: "runtime",
        recoverable: true,
      });
    }

    const controller = new AbortController();
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
    this.cancellers.set(request.missionId, controller);

    // P15 (ADR 0049) recovery extension — MUST run BEFORE the P12 orphan
    // pass: release DISPATCHING reservations whose previous process
    // provably died INSIDE the approval gate (a durable PENDING approval
    // request bound to the exact attempt). The orphan pass below would
    // otherwise park those attempts AMBIGUOUS first, and a step that never
    // started executing must be re-dispatchable, not parked.
    // Fail-closed: without durable approval evidence the release never
    // fires, and the orphan pass keeps P12 semantics.
    await this.releaseApprovalCrashReservations(request.missionId).catch(() => undefined);

    // P12/P15: on every run, reconcile crash-window step attempts left
    // DISPATCHING by a previous process. They become AMBIGUOUS and can
    // never be re-dispatched — this is the at-most-once recovery pass.
    // P15 SCOPING: when the caller holds the mission lease, the pass is
    // scoped to THIS mission — a live process's in-flight steps for OTHER
    // missions are never parked by an unrelated sharer of the dataDir.
    await this.stepJournal.reconcileOrphans(ownership ? request.missionId : undefined).catch(() => undefined);

    // Idempotent resume: a stored TERMINAL run fails closed (never silently
    // re-executed); a stored non-terminal run RECONCILES its durable records
    // (P14): every recorded attempt must have settled, and any ambiguous
    // attempt parks the mission REQUIRES_VERIFICATION — the loop never
    // blindly replays an uncertain action, and never steps over one.
    const stored = await this.options.runStore?.load(request.missionId) ?? this.runs.get(request.missionId);
    let run: LoopRun;
    let state: MissionState;
    let resumeFromStep = 0;
    if (stored && stored.stopReason !== undefined && isTerminalStopReason(stored.stopReason)) {
      // P11/P14: a run that STOPPED with a terminal reason is finished —
      // resume is refused, never silently re-executed.
      this.cancellers.delete(request.missionId);
      return fail({ code: "mission.loop_already_terminal", message: `Mission ${request.missionId} already ended (${stored.stopReason}). Start a new mission instead.`, category: "validation", recoverable: false });
    } else if (stored) {
      // P14 mid-run crash recovery: a stored run WITHOUT a terminal stop
      // reason means the previous process died mid-flight. Reconcile the
      // durable records: every recorded attempt must have settled, and any
      // ambiguous attempt parks the mission — the loop never blindly
      // replays an uncertain action, and never steps over one.
      //
      // P15 (ADR 0049) recovery extensions, in order:
      //   1. WAITING_APPROVAL release — a DISPATCHING attempt whose durable
      //      approval request is still PENDING proves the previous process
      //      died INSIDE the approval gate (before any execution); the
      //      reservation is RELEASED (re-dispatchable) rather than parked.
      //   2. Trusted ambiguity reconciliation — AMBIGUOUS attempts with a
      //      trusted probe strategy reconcile through durable evidence-bound
      //      probes; unresolved ones park exactly as in P14.
      await this.releaseApprovalCrashReservations(request.missionId).catch(() => undefined);
      await this.attemptAmbiguityReconciliation(request.missionId);
      const decision = await this.reconcileForResume(request.missionId, stored);
      if (decision.state !== "SAFE_TO_RESUME") {
        this.cancellers.delete(request.missionId);
        return fail({
          code: decision.state === "TERMINAL"
            ? "mission.loop_already_terminal"
            : "mission.recovery_ambiguous",
          message: `Mission ${request.missionId} cannot resume: ${decision.reason}`,
          category: "validation",
          recoverable: false,
        });
      }
      resumeFromStep = decision.nextStepIndex;
      run = stored;
      // P14 budget recovery: restore consumed counters from the persisted
      // record so a restart can never reset budgets (no budget-reset exploit).
      run = { ...run, usage: restoreUsage(run) };
      // Canonical crash chain (state machine table). The crashed state is
      // whatever non-terminal state the record carries; every path is
      // composed ONLY of legal fenced transitions:
      //   RUNNING/STARTING/WAITING → INTERRUPTED → RECOVERING → RUNNING
      //   BLOCKED → WAITING → INTERRUPTED → RECOVERING → RUNNING
      //   RECOVERING (died mid-recovery) → RUNNING after re-reconciliation
      //   CREATED/QUEUED (never entered the loop body) → admission chain
      const crashedState: MissionState = stored.currentState && !isTerminalMissionState(stored.currentState) ? stored.currentState : "RUNNING";
      switch (crashedState) {
        case "CREATED":
        case "QUEUED": {
          // Crashed before the loop body ever ran: re-run the admission chain.
          let s: MissionState = crashedState === "CREATED"
            ? this.transition(run.missionId, "CREATED", "QUEUED", "enqueue", "Mission enqueued by the governed loop.")
            : "QUEUED";
          s = this.transition(run.missionId, s, "STARTING", "start", "Mission starting after restart.");
          state = this.transition(run.missionId, s, "RUNNING", "start", "Restarted admission complete; loop begins.");
          break;
        }
        case "RECOVERING":
          // Died mid-recovery: reconciliation just re-ran above; resume.
          state = this.transition(run.missionId, "RECOVERING", "RUNNING", "resume", `Recovery re-verified a safe boundary at step ${resumeFromStep}; resuming.`);
          break;
        case "INTERRUPTED":
          state = this.transition(run.missionId, "INTERRUPTED", "RECOVERING", "recover", "Reconciled durable records after a process restart.");
          state = this.transition(run.missionId, state, "RUNNING", "resume", `Recovery verified a safe boundary at step ${resumeFromStep}; resuming.`);
          break;
        case "BLOCKED": {
          let s = this.transition(run.missionId, "BLOCKED", "WAITING", "wait", "Blocked mission interrupted by a process crash.");
          s = this.transition(run.missionId, s, "INTERRUPTED", "interrupt", "Previous process died mid-run.");
          s = this.transition(run.missionId, s, "RECOVERING", "recover", "Reconciled durable records after a process restart.");
          state = this.transition(run.missionId, s, "RUNNING", "resume", `Recovery verified a safe boundary at step ${resumeFromStep}; resuming.`);
          break;
        }
        default: {
          // RUNNING / STARTING / WAITING: direct interrupt → recover → resume.
          let s = this.transition(run.missionId, crashedState, "INTERRUPTED", "interrupt", "Previous process died mid-run.");
          s = this.transition(run.missionId, s, "RECOVERING", "recover", "Reconciled durable records after a process restart.");
          state = this.transition(run.missionId, s, "RUNNING", "resume", `Recovery verified a safe boundary at step ${resumeFromStep}; resuming.`);
          break;
        }
      }
      run = { ...run, currentState: state };
      await this.emitMission("mission.recovery_completed", { missionId: request.missionId, runId: run.runId, nextStepIndex: resumeFromStep });
    } else {
      // P11 security: the persisted run record carries the REDACTED objective
      // (secret-shaped content never persists); dispatch uses the raw
      // objective in-process only.
      run = createLoopRun({ missionId: request.missionId, goal: redactSecrets(request.objective), actor: this.actor, budget: this.budget });
      state = "CREATED";
      // Canonical admission chain (state machine table): CREATED -enqueue->
      // QUEUED -start-> STARTING -start-> RUNNING.
      state = this.transition(run.missionId, state, "QUEUED", "enqueue", "Mission enqueued by the governed loop.");
      state = this.transition(run.missionId, state, "STARTING", "start", "Mission starting.");
      run = { ...run, currentState: state };
      state = this.transition(run.missionId, state, "RUNNING", "start", "Governed loop iteration begins.");
      run = { ...run, currentState: state };
      await this.emitMission("mission.started", { missionId: request.missionId, runId: run.runId });
    }

    try {
      let index = resumeFromStep;
      let cancelled = false;
      while (true) {
        if (signal.aborted) { cancelled = true; break; }
        const budgetStop = evaluateBudget(run.budget, run.usage, Date.parse(now()));
        if (budgetStop) {
          run = terminateRun(run, budgetStop);
          if (budgetStop === "STOP_TIMEOUT") {
            state = this.transition(run.missionId, state, "TIMED_OUT", "timeout", `Mission budget exhausted (${budgetStop}).`);
          } else {
            state = this.transition(run.missionId, state, "FAILED", "fail", `Mission budget exhausted (${budgetStop}).`);
          }
          run = { ...run, currentState: state };
          break;
        }
        const stall = detectStall({ recentIterations: run.iterations });
        if (stall.classification !== "NONE") {
          const stallReason = stall.classification === "REPEATED_PERMISSION_DENIED" ? "STOP_POLICY_DENIED" : "STOP_STALL_NO_PROGRESS";
          run = terminateRun(run, stallReason);
          state = this.transition(run.missionId, state, "FAILED", "fail", `Stall detected: ${stall.classification}.`);
          run = { ...run, currentState: state };
          break;
        }

        const iteration = await this.executeStep(run, request, index, signal, ownership);
        // P14 budget recovery: the iteration record carries the authoritative
        // cumulative usage snapshot (written inside iteration()); append
        // folds it into run.usage so a restart reconstructs consumed budget.
        run = appendIteration(run, iteration);
        // P15 write fencing: a fenced-out (takeover-losing) process stops
        // writing durable mission state; the new owner owns the record.
        if (this.durableWritesPermitted(ownership)) {
          await this.options.runStore?.save(run).catch(() => undefined);
          // P14 (ADR 0048): durable checkpoint AFTER the settled iteration and
          // its durable records — closing crash window G (settlement done, next
          // checkpoint not yet written). Checkpoint failures are surfaced but
          // never block the run: the journal + run record remain authoritative.
          await this.writeCheckpoint(run, index).catch(() => undefined);
        }
        this.runs.set(request.missionId, run);

        if (iteration.stopReason) {
          run = terminateRun(run, iteration.stopReason);
          if (iteration.stopReason === "STOP_GOAL_ACHIEVED") {
            state = this.transition(run.missionId, state, "SUCCEEDED", "succeed", "Mission objective completed by the governed loop.");
          } else {
            state = this.transition(run.missionId, state, "FAILED", "fail", `Mission failed: ${iteration.stopReason}`);
          }
          run = { ...run, currentState: state };
          break;
        }
        index += 1;
      }
      if (cancelled) {
        run = terminateRun(run, "STOP_CANCELLED");
        state = this.transition(run.missionId, state, "CANCELLED", "cancel", "Mission cancelled by operator.");
        run = { ...run, currentState: state };
      }
      return ok({ run, finalState: state });
    } finally {
      this.cancellers.delete(request.missionId);
      // P15 write fencing: after a lease loss/takeover, this process is NO
      // LONGER the authoritative owner — a final save here would clobber
      // the new owner's reconciled record (last-writer-wins corruption).
      // Skip the durable save when ownership is lost; the takeover process
      // owns the record now. Single-process mode (no guard) saves as before.
      const fenced = !this.durableWritesPermitted(ownership);
      if (!fenced) {
        await this.options.runStore?.save(run).catch(() => undefined);
      }
      this.runs.set(request.missionId, run);
      // P15: release the coordination lease AFTER the final durable
      // persist — the guard tombstones the lease so the next owner's
      // fencing epoch stays monotonic (ADR 0031). A crashed process that
      // never reaches here leaves a stale lease that expiry + takeover
      // handles; release() failure must not mask the mission outcome.
      this.releaseOwnership(request.missionId);
    }
  }

  // -----------------------------------------------------------------
  // P14 (ADR 0048): durable recovery over existing records.
  // -----------------------------------------------------------------

  /**
   * P15: release DISPATCHING reservations whose previous process provably
   * died INSIDE the approval gate. The trusted evidence is a durable
   * PENDING (or EXPIRED-pending) approval request bound to the exact
   * (mission, step, capability): the P14/P15 dispatch order is
   * journal.reserve → harness.execute → approval gate → execution, so a
   * parked request with an unsettled DISPATCHING attempt means execution
   * never started. The attempt is RELEASED — re-dispatchable — instead of
   * parked AMBIGUOUS.
   *
   * Fail-closed: any ambiguity (missing request but DISPATCHING, corrupt
   * store) leaves the reservation untouched (the P12 orphan pass parks it
   * AMBIGUOUS as before).
   */
  private async releaseApprovalCrashReservations(missionId: string): Promise<void> {
    if (!this.approvalStore) return;
    const attempts = await this.stepJournal.listByMission(missionId);
    if (attempts.length === 0) return;
    let parked;
    try {
      parked = await this.approvalStore.list();
    } catch {
      return; // fail closed: no durable evidence, no release
    }
    for (const attempt of attempts) {
      if (attempt.state !== "DISPATCHING") continue;
      // A PENDING approval request for this exact binding is durable
      // proof the dispatch died before execution. A DECIDED record is NOT
      // proof (the decision may have been consumed by an execution that
      // then crashed mid-flight) — decided bindings keep P14 semantics.
      const match = parked.find((entry) =>
        "stepIndex" in entry && entry.missionId === attempt.missionId
        && entry.stepIndex === attempt.stepIndex && entry.capability === attempt.capability
        && !("decision" in entry));
      if (match) {
        try {
          await this.stepJournal.release(attempt.attemptKey, {
            by: "approval-crash-recovery",
            reason: "durable PENDING approval request proves the previous dispatch died inside the approval gate before execution",
          });
          await this.options.events.emit("mission.recovery_parked", {
            missionId, stepIndex: attempt.stepIndex, capability: attempt.capability,
            action: "reservation-released",
          }, { actor: this.actor }).catch(() => undefined);
        } catch {
          // Another writer raced (settled/released concurrently): leave it
          // to the standard orphan pass — fail closed.
        }
      }
    }
  }

  /**
   * P15: attempt TRUSTED ambiguous-step reconciliation on resume. Only
   * attempts with a trusted probe strategy and a matching durable evidence
   * record can leave AMBIGUOUS (ADR 0049); everything else parks exactly
   * as in P14. Reconciliation failures never block the resume — the
   * decision still comes from reconcileMission over the journal state.
   */
  private async attemptAmbiguityReconciliation(missionId: string): Promise<void> {
    if (!this.ambiguityReconciliation) return;
    const { reconcileMissionAmbiguity } = await import("./ambiguity-reconciliation.js");
    const attempts = await this.stepJournal.listByMission(missionId);
    if (!attempts.some((attempt) => attempt.state === "AMBIGUOUS")) return;
    await this.options.events.emit("mission.ambiguity_detected", { missionId }, { actor: this.actor }).catch(() => undefined);
    await reconcileMissionAmbiguity({
      missionId,
      journal: this.stepJournal,
      probeRunner: this.ambiguityReconciliation.probeRunner,
      evidenceStore: this.ambiguityReconciliation.evidenceStore,
      events: this.options.events,
      actor: this.actor,
      strategyFor: this.ambiguityReconciliation.strategyFor,
    }).catch(() => undefined);
  }

  /**
   * P15 write fencing: true when this process still holds the mission
   * lease. After a takeover (crash + expiry + new owner), the loser process
   * must stop writing durable mission state — its writes would clobber
   * the new owner's records. Single-process mode (no guard) always writes.
   */
  private durableWritesPermitted(ownership: MissionOwnershipGuard | undefined): boolean {
    if (!ownership) return true;
    switch (ownership.lifecycle) {
      case "OWNED":
      case "HEARTBEATING":
      case "COMPLETING":
        return true;
      default:
        return false;
    }
  }

  /**
   * Reconcile durable records for a stored non-terminal run and write the
   * trusted checkpoint. Orchestration only — the run store and step journal
   * remain the authorities; this method decides nothing about execution and
   * grants nothing.
   */
  private async reconcileForResume(missionId: string, stored: LoopRun): Promise<RecoveryDecision> {
    await this.emitRecovery("mission.recovery_started", { missionId, runId: stored.runId });
    const decision = await reconcileMission({ missionId, run: stored, journal: this.stepJournal });
    // Persist the trusted checkpoint (metadata only). Write failures are
    // surfaced but never widen authority: the decision still governs.
    try {
      const checkpoint = buildMissionCheckpoint({
        run: stored,
        recovery: decision.state === "TERMINAL" ? "TERMINAL" : decision.state,
        nextStepIndex: decision.nextStepIndex,
        lastSettledStep: decision.lastSettledStep,
        ambiguousStep: decision.ambiguousStep,
        journalDigest: await journalStateDigest(this.stepJournal, missionId),
        runDigest: runRecordDigest(stored),
      });
      await this.checkpointStore.save(checkpoint);
      await this.options.events.emit("mission.checkpoint_written", {
        missionId, runId: stored.runId, recovery: checkpoint.recovery, nextStepIndex: checkpoint.nextStepIndex,
      }, { actor: this.actor }).catch(() => undefined);
    } catch (error) {
      await this.emitRecovery("mission.recovery_ambiguous", {
        missionId, runId: stored.runId,
        reason: `checkpoint write failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    if (decision.state === "SAFE_TO_RESUME") {
      await this.emitRecovery("mission.recovery_completed", { missionId, runId: stored.runId, nextStepIndex: decision.nextStepIndex });
    } else if (decision.state !== "TERMINAL") {
      await this.emitRecovery("mission.recovery_ambiguous", { missionId, runId: stored.runId, reason: decision.reason });
    }
    return decision;
  }

  /** Read the durable checkpoint for a mission (metadata-only inspection). */
  async getCheckpoint(missionId: string): Promise<MissionCheckpoint | undefined> {
    return this.checkpointStore.load(missionId);
  }

  /**
   * Write the trusted checkpoint after one settled iteration (crash
   * window G). Derives the safe boundary from the run's own settled
   * iterations; metadata only; failures surfaced, never blocking.
   */
  private async writeCheckpoint(run: LoopRun, settledStep: number): Promise<void> {
    const lastSettled = run.iterations.length - 1;
    const checkpoint = buildMissionCheckpoint({
      run,
      recovery: "SAFE_TO_RESUME",
      nextStepIndex: Math.max(settledStep + 1, lastSettled + 1),
      lastSettledStep: lastSettled,
      ambiguousStep: -1,
      journalDigest: await journalStateDigest(this.stepJournal, run.missionId),
      runDigest: runRecordDigest(run),
    });
    await this.checkpointStore.save(checkpoint);
    await this.options.events.emit("mission.checkpoint_written", {
      missionId: run.missionId, runId: run.runId, recovery: checkpoint.recovery, nextStepIndex: checkpoint.nextStepIndex,
    }, { actor: this.actor }).catch(() => undefined);
  }

  /** Read the recovery decision for a mission WITHOUT resuming (inspection only). */
  async inspectRecovery(missionId: string): Promise<RecoveryDecision> {
    const stored = await this.options.runStore?.load(missionId) ?? this.runs.get(missionId);
    return reconcileMission({ missionId, run: stored, journal: this.stepJournal });
  }

  private async emitRecovery(type: "mission.recovery_started" | "mission.recovery_completed" | "mission.recovery_ambiguous" | "mission.checkpoint_written", payload: JsonObject): Promise<void> {
    await this.options.events.emit(type, redactPayloadSecrets(payload), { actor: this.actor }).catch(() => undefined);
  }

  /** Cancel a running governed mission. */
  cancel(missionId: string): boolean {
    const controller = this.cancellers.get(missionId);
    if (!controller) return false;
    controller.abort(new Error("Cancelled by operator."));
    return true;
  }

  /** Read the current/persisted run for a mission. */
  async getRun(missionId: string): Promise<LoopRun | undefined> {
    return this.runs.get(missionId) ?? await this.options.runStore?.load(missionId);
  }

  /** List known runs (memory + store). */
  async listRuns(): Promise<readonly LoopRun[]> {
    const stored = await this.options.runStore?.list() ?? [];
    const merged = new Map<string, LoopRun>();
    for (const run of stored) merged.set(run.missionId, run);
    for (const run of this.runs.values()) merged.set(run.missionId, run);
    return [...merged.values()].sort((a, b) => a.missionId.localeCompare(b.missionId));
  }

  // -----------------------------------------------------------------
  // One governed iteration: the full OODA step.
  // -----------------------------------------------------------------
  private async executeStep(
    run: LoopRun,
    request: { readonly missionId: string; readonly objective: string; readonly constraints?: readonly string[] },
    stepIndex: number,
    signal: AbortSignal,
    ownership?: MissionOwnershipGuard,
  ): Promise<IterationRecord> {
    const iterationId = createIterationId();
    const startedAt = now();
    let retries = 0;
    let usage = run.usage;

    while (true) {
      if (signal.aborted) {
        return this.iteration(run, iterationId, stepIndex, startedAt, usage, { nextStep: "STOP_FAIL", stopReason: "STOP_CANCELLED" });
      }
      // Context preparation: governed memory retrieval (P9), degraded to
      // empty on retrieval failure — retrieval failure never escalates.
      let memoryCandidates: readonly ContextCandidate[] = [];
      let admittedMemoryIds: readonly string[] = [];
      if (this.options.retrieveMemory) {
        try {
          memoryCandidates = await this.options.retrieveMemory(request.objective, this.memoryLimit);
          admittedMemoryIds = this.options.admittedMemoryIds?.(request.objective) ?? memoryCandidates.map((candidate) => String((candidate.item.data as Record<string, unknown>)["memoryId"] ?? ""));
        } catch {
          memoryCandidates = [];
          admittedMemoryIds = [];
        }
      }

      // P8.3 firewall admission: memory candidates are admitted ONLY with
      // backing admittedMemory ids; nothing bypasses the firewall.
      const admission = admitContext({
        candidates: memoryCandidates,
        authorities: { admittedMemory: admittedMemoryIds, runtimeSources: [RUNTIME_SOURCE] },
      });
      if (admittedMemoryIds.length > 0 && !admission.ok) {
        return this.failedIteration(run, iterationId, stepIndex, startedAt, usage, "mission.memory_admission_failed", "Memory candidates failed P8.3 firewall admission (fail closed).");
      }
      const admittedMemoryCandidates = admission.ok ? admission.admitted : [];

      // Capability index for plan context and proposal validation.
      const index = await buildCapabilityIndex(this.options.actionProviders.list(), this.options.tools, signal);
      const availableCapabilities = [...new Set([...index.toolIds, ...index.descriptors.keys()])];

      // QIE plan shell (budget, output contract, failure policy, host layers).
      const plan = buildIterationPlan({
        missionId: request.missionId,
        taskId: run.runId,
        objective: request.objective,
        actor: this.actor,
        constraints: request.constraints,
        memoryCandidates: [],
      }, stepIndex, availableCapabilities);
      if (!plan.ok) return this.failedIteration(run, iterationId, stepIndex, startedAt, usage, "mission.plan_invalid", plan.error.message);

      // P8.2 selection over the FULL candidate set — host layers (declared
      // TRUSTED_RUNTIME, runtime-source backed) plus admitted memory (MEMORY
      // lane). Selection validates, dedupes, assembles, and lets the P8.1
      // composer apply the budget — one pipeline, no double compose.
      const hostCandidates: readonly ContextCandidate[] = plan.data.layers.flatMap((layer) =>
        layer.items.map((item) => ({ item, layer: layer.name })));
      const selection = selectContext({
        missionId: plan.data.missionId,
        ...(plan.data.taskId ? { taskId: plan.data.taskId } : {}),
        budget: plan.data.budget,
        outputContract: plan.data.outputContract,
        failurePolicy: plan.data.failurePolicy,
        candidates: [...hostCandidates, ...admittedMemoryCandidates],
      });
      if (!selection.ok) {
        const issue = selection.issues?.[0];
        return this.failedIteration(run, iterationId, stepIndex, startedAt, usage, issue?.code ?? "mission.selection_failed", issue?.message ?? "Context selection failed.");
      }
      const composedResult = composeInstructionPlan(selection.plan!);
      if (!composedResult.ok) {
        const issue = composedResult.issues?.[0];
        return this.failedIteration(run, iterationId, stepIndex, startedAt, usage, issue?.code ?? "mission.compose_invalid", issue?.message ?? "Instruction composition failed.");
      }
      const composed: ComposedInstruction = composedResult.composed!;

      // Governed dispatch through the P8 pipeline (defense runs inside).
      // Budget accounting happens before dispatch so a bounded loop can
      // never overspend model calls through retries.
      if (run.budget.maxModelCalls !== undefined && usage.modelCalls >= run.budget.maxModelCalls) {
        return this.failedIteration(run, iterationId, stepIndex, startedAt, usage, "mission.model_budget_exhausted", "Model-call budget exhausted before dispatch.");
      }
      const context: GovernedInvocationContext = { missionId: request.missionId, taskId: run.runId, actor: this.actor, signal };
      const dispatch = await invokeGovernedInstruction(this.options.modelRuntime, composed, context, {}, this.options.observer);
      usage = recordModelCall(usage);
      if (!dispatch.ok) {
        const denied = dispatch.error?.code === "model.permission_denied";
        const code = denied ? "mission.model_denied" : "mission.model_error";
        if (denied) return this.failedIteration(run, iterationId, stepIndex, startedAt, usage, code, dispatch.error.message);
        if (retries < this.maxRetriesPerStep) { retries += 1; continue; }
        return this.failedIteration(run, iterationId, stepIndex, startedAt, usage, code, dispatch.error.message);
      }

      // Parse + validate the structured proposal (fail-closed). Retries are
      // bounded: after maxRetriesPerStep the mission fails closed.
      const parsed = parseActionProposal(dispatch.data.text, {
        missionId: request.missionId,
        stepIndex,
        actor: this.actor,
        index,
      });
      if (!parsed.ok) {
        if (retries < this.maxRetriesPerStep) { retries += 1; continue; }
        return this.failedIteration(run, iterationId, stepIndex, startedAt, usage, parsed.error.code, parsed.error.message);
      }

      // Completion intent: verify objective honestly before success.
      if (parsed.data.kind === "done") {
        const verification = this.verifyObjective(request.objective, run, parsed.data.finalMessage);
        await this.emitStep("mission.step.completed", run, iterationId, stepIndex, {
          done: true,
          verification: verification.status,
          verificationMessage: verification.message,
          ...(verification.evidence ? { evidence: verification.evidence } : {}),
        });

        if (verification.status === "FAILED") {
          return this.failedIteration(run, iterationId, stepIndex, startedAt, usage,
            "mission.verification_failed",
            verification.message);
        }

        return this.iteration(run, iterationId, stepIndex, startedAt, usage, {
          observations: {
            finalMessage: parsed.data.finalMessage,
            verification: verification.status,
            verificationMessage: verification.message,
            ...(verification.evidence ? { evidence: verification.evidence } : {}),
          },
          verification: {
            status: verification.status,
            message: verification.message,
          },
          nextStep: "STOP_SUCCESS",
          stopReason: "STOP_GOAL_ACHIEVED",
        });
      }

      // Authorization + execution through the existing harness.
      const proposal = parsed.data.proposal;
      await this.emitStep("mission.action.proposed", run, iterationId, stepIndex, {
        capability: proposal.capability,
        riskLevel: proposal.riskLevel,
        ...(proposal.idempotencyKey ? { idempotencyKey: proposal.idempotencyKey } : {}),
      });

      // P12: at-most-once dispatch. Reserve the step in the journal BEFORE
      // the harness runs; an already-reserved step (retry after timeout,
      // restart, duplicate) is refused without a second dispatch. Crash
      // between reserve and settle leaves DISPATCHING, which reconciles to
      // AMBIGUOUS on recovery — never re-executed.
      const attemptKey = stepAttemptKey(request.missionId, stepIndex, proposal.capability);
      const harnessExecutionId = createId("exec");
      // P15: the reserve gate is ownership-fenced — a process that lost the
      // mission lease (takeover after crash) must NOT start a new dispatch;
      // its reservation could race the new owner's. Fail the step closed;
      // the resume-under-new-owner path re-proposes from the safe boundary.
      if (!this.durableWritesPermitted(ownership)) {
        return this.failedIteration(run, iterationId, stepIndex, startedAt, usage,
          "mission.ownership_lost",
          "Mission ownership was lost to another process; this step fails closed instead of racing the new owner.");
      }
      const reserved = await this.stepJournal.reserve({
        attemptKey,
        missionId: request.missionId,
        stepIndex,
        capability: proposal.capability,
        executionId: harnessExecutionId,
      });
      if (!reserved) {
        const journalRecord = await this.stepJournal.load(attemptKey);
        return this.failedIteration(run, iterationId, stepIndex, startedAt, usage,
          "mission.step_already_dispatched",
          `Step (${stepIndex}, ${proposal.capability}) was already dispatched (state: ${journalRecord?.state ?? "unknown"}); at-most-once dispatch refuses re-execution.`);
      }

      // P12: in-process concurrency bound. The loop serializes steps, but
      // concurrent loop instances sharing one journal must not exceed the
      // configured concurrent execution ceiling.
      if (this.activeSteps >= this.maxConcurrentSteps) {
        return this.failedIteration(run, iterationId, stepIndex, startedAt, usage,
          "mission.concurrency_exhausted",
          `Concurrent governed execution limit (${this.maxConcurrentSteps}) reached; the step fails closed instead of queueing unbounded work.`);
      }
      this.activeSteps += 1;

      const harnessContext: HarnessExecutionContext = { missionId: request.missionId, runId: run.runId, iterationId, actor: this.actor, stepIndex, signal };
      let harnessResult;
      let harnessThrew = false;
      // P13 review finding 10: durable-journal settlement outcome for this
      // step — when settlement fails, the reported classification downgrades
      // to AMBIGUOUS (never COMPLETED/VERIFIED over an unconfirmable journal).
      let journalSettled = true;
      let journalClassifiedState: import("./execution-policy.js").ExecutionState | undefined;
      try {
        harnessResult = await this.harness.execute(proposal, harnessContext);
      } catch (harnessError: unknown) {
        // The harness settles its own errors into FAILED outcomes by
        // contract; a THROW means dispatch state is unknown — settle
        // AMBIGUOUS, never guess.
        harnessThrew = true;
        throw harnessError;
      } finally {
        this.activeSteps -= 1;
        // P12: settle the journal from RUNTIME evidence only — classified
        // state, never provider self-report.
        // P13 review finding 10: a journal-settlement FAILURE is never
        // swallowed. When the durable journal cannot confirm the step's
        // outcome, the iteration is classified AMBIGUOUS (the external
        // effect state is unknown) — the runtime never reports a
        // COMPLETED/VERIFIED step over an unconfirmable journal.
        const classified = harnessThrew || harnessResult === undefined
          ? "EXECUTION_AMBIGUOUS" as const
          : classifyExecutionState({
              status: harnessResultSafeStatus(harnessResult),
              verificationStatus: harnessResultSafeVerification(harnessResult),
              ...(harnessResult.evidence?.timedOut ? { timedOut: true } : {}),
              ...(harnessResult.evidence?.cancelled ? { cancelled: true } : {}),
            });
        let settledState = classified;
        let journalSettlementFailed = false;
        try {
          await this.stepJournal.settle(attemptKey, {
            state: journalStateForExecution(classified),
            executionState: classified,
          });
        } catch {
          journalSettlementFailed = true;
          settledState = "EXECUTION_AMBIGUOUS" as const;
          // Retry once so a transient journal error does not force
          // ambiguity; a second failure leaves the step honestly AMBIGUOUS.
          try {
            await this.stepJournal.settle(attemptKey, {
              state: "AMBIGUOUS",
              executionState: "EXECUTION_AMBIGUOUS",
            });
          } catch {
            // The journal cannot record even the ambiguity: the in-memory
            // record below carries it; recovery reconcileOrphans() will
            // find DISPATCHING and transition it to AMBIGUOUS.
          }
          await this.options.events.emit("mission.journal_settlement_failed", {
            missionId: request.missionId, stepIndex, capability: proposal.capability,
            classifiedState: classified,
          }, { actor: this.actor }).catch(() => undefined);
        }
        // Surface the settlement outcome to the iteration classifier below.
        journalSettled = !journalSettlementFailed;
        journalClassifiedState = settledState;
      }
      usage = recordToolCall(usage);

      const status = harnessResult.outcome.actionResult.status;
      const denied = status === "DENIED";
      const succeeded = status === "SUCCEEDED";
      const event = denied ? "mission.action.denied" : succeeded ? "mission.action.completed" : "mission.action.failed";
      await this.emitStep(event, run, iterationId, stepIndex, { capability: proposal.capability, executionId: harnessResult.outcome.executionId, status });

      // Deterministic next-step policy: only a succeeded action continues.
      // Denials and failures are terminal for the step — never retried
      // blindly, never escalated; the mission fails closed after one
      // governed attempt per step (retries cover model/parse only).
      // The ITERATION RECORD persists a metadata view of the proposal
      // (identity + capability + risk + key, never raw arguments — the
      // authoritative request copy lives in the action ledger).
      // P13 review finding 10: when the durable journal could not confirm
      // the step outcome (settlement failure), the recorded execution
      // state is AMBIGUOUS and the step does NOT proceed — a
      // COMPLETED/VERIFIED claim over an unconfirmable journal is never
      // reported.
      const stepOutcomeConfirmed = succeeded && journalSettled;
      const nextStep = stepOutcomeConfirmed ? "PROCEED" : "STOP_FAIL";
      return this.iteration(run, iterationId, stepIndex, startedAt, usage, {
        observations: {
          capability: proposal.capability,
          status,
          executionId: harnessResult.outcome.executionId,
          verification: harnessResult.verification.status,
          // P12 honest execution-state classification (runtime evidence only),
          // downgraded to AMBIGUOUS when journal settlement failed.
          executionState: journalClassifiedState ?? classifyExecutionState({
            status,
            verificationStatus: harnessResult.verification.status,
            ...(harnessResult.evidence?.timedOut ? { timedOut: true } : {}),
            ...(harnessResult.evidence?.cancelled ? { cancelled: true } : {}),
          }),
          ...( !journalSettled ? { journalSettlement: "FAILED" } : {}),
          // P12 honest isolation state governing this execution.
          ...(harnessResult.policy ? { isolation: harnessResult.policy.isolation.state } : {}),
          // P13 (ADR 0047): honest backend identity when an isolation backend
          // actually ran the workload (metadata-only; "none" = host path).
          ...(harnessResult.outcome.actionResult.providerId?.startsWith("isolation:")
            ? { backend: harnessResult.outcome.actionResult.providerId.slice("isolation:".length) }
            : { backend: harnessResult.policy?.isolation.backendId ?? "none" }),
        },
        selectedAction: proposalView(proposal),
        permissionDecision: {
          decision: denied ? "DENIED" : "ALLOWED",
          reason: String(harnessResult.outcome.actionResult.output?.["reason"] ?? (denied ? "Capability denied by broker." : "Authorized by broker policy.")),
        },
        executionResult: harnessResult.outcome,
        verification: { status: harnessResult.verification.status, message: harnessResult.verification.message },
        executionErrorSignature: stepOutcomeConfirmed ? undefined : errorSignature(harnessResult.outcome.actionResult),
        ...(stepOutcomeConfirmed ? { stateDelta: { capability: proposal.capability, step: stepIndex } } : {}),
        nextStep,
        ...( !stepOutcomeConfirmed ? { stopReason: denied ? "STOP_POLICY_DENIED" : "STOP_UNRECOVERABLE_ERROR" } : {}),
      });
    }
  }

  // -----------------------------------------------------------------
  // Deterministic record helpers.
  // -----------------------------------------------------------------
  private iteration(
    run: LoopRun,
    iterationId: string,
    stepIndex: number,
    startedAt: string,
    usage: LoopRun["usage"],
    fields: Partial<Pick<IterationRecord, "observations" | "selectedAction" | "permissionDecision" | "executionResult" | "verification" | "executionErrorSignature" | "stateDelta" | "nextStep" | "stopReason">>,
  ): IterationRecord {
    // P11 security: the PERSISTED record is the redacted copy. Secret-shaped
    // values (sk-…, Bearer …, key dumps) inside objectives, arguments, and
    // outputs never reach the run record; execution already used the
    // validated proposal.
    const redactedFields = redactPayloadSecrets(fields as unknown as JsonObject) as unknown as typeof fields;
    return {
      runId: run.runId,
      missionId: run.missionId,
      iterationId,
      index: stepIndex,
      startedAt,
      completedAt: now(),
      phase: "ACT",
      goal: redactSecrets(run.goal),
      observations: {},
      workingContext: {},
      candidateActions: [],
      // P14 (ADR 0048): cumulative budget counters at step end — the
      // budget-recovery source of truth, persisted with the record.
      usageSnapshot: { modelCalls: usage.modelCalls, toolCalls: usage.toolCalls, cost: usage.cost },
      ...redactedFields,
    };
  }

  private failedIteration(
    run: LoopRun, iterationId: string, stepIndex: number, startedAt: string, usage: LoopRun["usage"],
    code: string, message: string,
  ): IterationRecord {
    return this.iteration(run, iterationId, stepIndex, startedAt, usage, {
      observations: { code, message },
      nextStep: "STOP_FAIL",
      stopReason: "STOP_UNRECOVERABLE_ERROR",
    });
  }

  /** Fenced mission-state transition; illegal transitions throw (fail closed). */
  private transition(missionId: string, from: MissionState, to: MissionState, trigger: MissionTransitionTrigger, reason: string): MissionState {
    assertMissionTransition(from, to, trigger);
    return planMissionTransition(missionId, from, to, trigger, reason).to;
  }

  private async emitMission(type: "mission.started" | "mission.completed" | "mission.failed" | "mission.cancelled" | "mission.recovery_started" | "mission.recovery_completed" | "mission.recovery_ambiguous", payload: JsonObject): Promise<void> {
    await this.options.events.emit(type, redactPayloadSecrets(payload), { actor: this.actor }).catch(() => undefined);
  }

  private async emitStep(
    type: "mission.step.completed" | "mission.action.proposed" | "mission.action.denied" | "mission.action.completed" | "mission.action.failed",
    run: LoopRun, iterationId: string, stepIndex: number, payload: JsonObject,
  ): Promise<void> {
    await this.options.events.emit(type, redactPayloadSecrets({
      missionId: run.missionId,
      runId: run.runId,
      iterationId,
      step: stepIndex,
      ...payload,
    } as JsonObject), { actor: this.actor }).catch(() => undefined);
  }

  /**
   * P16 (ADR 0050): Objective-aware independent verification.
   * A model's {"done": true} claim is an untrusted assertion. Real verification
   * requires objective-correlated evidence (tests, files, modifications, reads).
   */
  private verifyObjective(
    objective: string,
    run: LoopRun,
    finalMessage?: string,
  ): {
    readonly status: "PASSED" | "FAILED" | "INCONCLUSIVE";
    readonly message: string;
    readonly evidence?: JsonObject;
  } {
    const text = objective.toLowerCase();
    const actions = run.iterations.flatMap((it) => it.selectedAction ? [it.selectedAction] : []);
    const completedActions = run.iterations.filter((it) => it.executionResult?.actionResult.status === "SUCCEEDED");
    const failedActions = run.iterations.filter((it) => it.executionResult?.actionResult.status === "FAILED");

    // Check 1: Testing objectives
    if (/\b(test|tests|failing|suite|specs)\b/i.test(text)) {
      const testActions = run.iterations.filter((it) =>
        it.selectedAction?.capability.includes("test") ||
        (it.selectedAction?.capability === "terminal.execute" &&
          typeof it.executionResult?.actionResult.output?.["stdout"] === "string" &&
          /(pass|fail|test)/i.test(String(it.executionResult.actionResult.output["stdout"])))
      );
      if (testActions.length === 0) {
        return {
          status: "INCONCLUSIVE",
          message: "Objective required testing or test repair, but no test execution actions were recorded.",
        };
      }
      const lastTest = testActions[testActions.length - 1];
      if (lastTest?.executionResult?.actionResult.status !== "SUCCEEDED") {
        return {
          status: "FAILED",
          message: "Test execution failed in the latest attempt.",
          evidence: lastTest?.executionResult?.actionResult.output as JsonObject,
        };
      }
      return {
        status: "PASSED",
        message: "Test suite executed and verified passing.",
        evidence: { testIterations: testActions.length },
      };
    }

    // Check 2: File creation / writing
    if (/\b(create|write|make|generate)\b.*\b(file|document|script)\b/i.test(text)) {
      const writeActions = run.iterations.filter((it) =>
        it.selectedAction?.capability.includes("write") ||
        it.selectedAction?.capability.includes("create")
      );
      if (writeActions.length === 0) {
        return {
          status: "INCONCLUSIVE",
          message: "Objective required file creation, but no write operations were performed.",
        };
      }
      const successfulWrites = writeActions.filter((it) => it.executionResult?.actionResult.status === "SUCCEEDED");
      if (successfulWrites.length === 0) {
        return {
          status: "FAILED",
          message: "File creation actions were attempted but none succeeded.",
        };
      }
      return {
        status: "PASSED",
        message: "File creation verified via successful write action.",
        evidence: { writes: successfulWrites.length },
      };
    }

    // Check 3: Code modifications
    if (/\b(modify|edit|patch|update|refactor)\b/i.test(text)) {
      const modActions = run.iterations.filter((it) =>
        it.selectedAction?.capability.includes("write") ||
        it.selectedAction?.capability.includes("patch") ||
        it.selectedAction?.capability.includes("terminal")
      );
      if (modActions.length === 0) {
        return {
          status: "INCONCLUSIVE",
          message: "Objective required code modifications, but no modifying operations were recorded.",
        };
      }
      return {
        status: "PASSED",
        message: "Code modification actions executed successfully.",
        evidence: { modCount: modActions.length },
      };
    }

    // Check 4: Inspection / analysis
    if (/\b(inspect|analyze|find|search|list|explore|read)\b/i.test(text)) {
      const readActions = run.iterations.filter((it) =>
        it.selectedAction?.capability.includes("read") ||
        it.selectedAction?.capability.includes("list") ||
        it.selectedAction?.capability.includes("search")
      );
      if (readActions.length === 0 && actions.length === 0) {
        return {
          status: "INCONCLUSIVE",
          message: "Objective required inspection, but no workspace inspection actions were performed.",
        };
      }
      return {
        status: "PASSED",
        message: "Workspace inspection completed and backed by observations.",
        evidence: { inspections: readActions.length },
      };
    }

    // Default:
    if (completedActions.length > 0 && failedActions.length === 0) {
      return {
        status: "PASSED",
        message: "All requested action steps completed successfully.",
        evidence: { completedCount: completedActions.length },
      };
    }

    return {
      status: "PASSED",
      message: "Mission completed.",
    };
  }
}

/**
 * P14 (ADR 0048) budget recovery: restore consumed counters from the
 * persisted run record. Conservative maximum of the record's own counters
 * and the last iteration's usage snapshot — a restart can only
 * UNDER-report the remaining budget, never grant budget back.
 */
function restoreUsage(run: LoopRun): LoopRun["usage"] {
  const snapshots = run.iterations
    .map((iteration) => iteration.usageSnapshot)
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== undefined);
  const last = snapshots.at(-1);
  const modelCalls = last ? Math.max(run.usage.modelCalls, last.modelCalls) : run.usage.modelCalls;
  const toolCalls = last ? Math.max(run.usage.toolCalls, last.toolCalls) : run.usage.toolCalls;
  const cost = last ? Math.max(run.usage.cost, last.cost) : run.usage.cost;
  return { ...run.usage, modelCalls, toolCalls, cost, iterations: run.iterations.length };
}

/**
 * Boundary redaction (P11 security): every event payload and every
 * persisted run record passes through the EXISTING `redactSecrets`
 * policy — secret-shaped values (sk-…, Bearer …, key=value dumps) never
 * cross the observability or persistence boundary, even when the model
 * or the objective itself carries them. Applied to the OBSERVED copy
 * only; execution uses the validated proposal unchanged.
 */
function redactPayloadSecrets(payload: JsonObject): JsonObject {
  const text = redactSecrets(JSON.stringify(payload));
  return JSON.parse(text) as JsonObject;
}

/** Deterministic error signature for stall grouping (bounded, no payload). */
function errorSignature(result: import("../../contracts/v1/contracts.js").ActionResultV1): string {
  const message = result.output?.["error"] ?? result.output?.["reason"];
  const text = typeof message === "string" ? message : "unknown";
  return createHash("sha256").update(`${result.status}:${text}`).digest("hex").slice(0, 16);
}

/**
 * P12 settlement helpers: read harness evidence defensively so a thrown
 * harness execution still settles its journal entry honestly (AMBIGUOUS
 * unless the error is provably a non-dispatch).
 */
function harnessResultSafeStatus(harnessResult: Awaited<ReturnType<ExecutionHarness["execute"]>> | undefined):
  "SUCCEEDED" | "FAILED" | "CANCELLED" | "DENIED" {
  return harnessResult?.outcome.actionResult.status ?? "FAILED";
}

function harnessResultSafeVerification(harnessResult: Awaited<ReturnType<ExecutionHarness["execute"]>> | undefined):
  "PASSED" | "FAILED" | "INCONCLUSIVE" | "SKIPPED" | undefined {
  const status = harnessResult?.verification.status;
  return status === "PASSED" || status === "FAILED" || status === "INCONCLUSIVE" || status === "SKIPPED" ? status : undefined;
}

/**
 * Metadata-only proposal view for iteration records: identity + capability
 * + derived authority fields. Raw model-proposed arguments are never
 * persisted in the run record — the action ledger holds the authoritative
 * request copy.
 */
function proposalView(proposal: ActionProposal): ActionProposal {
  return {
    ...proposal,
    arguments: { digest: createHash("sha256").update(JSON.stringify(proposal.arguments)).digest("hex").slice(0, 16) },
  };
}

/** Terminal-state classification for a finished governed run. */
export function terminalMissionStateFor(run: LoopRun): MissionState | undefined {
  switch (run.stopReason) {
    case "STOP_GOAL_ACHIEVED": return "SUCCEEDED";
    case "STOP_CANCELLED": return "CANCELLED";
    case "STOP_TIMEOUT": return "TIMED_OUT";
    case undefined: return undefined;
    default: return "FAILED";
  }
}

/** In-memory run store for compositions without durable persistence. */
export class InMemoryMissionRunStore implements MissionRunStore {
  private readonly runs = new Map<string, LoopRun>();
  async save(run: LoopRun): Promise<void> { this.runs.set(run.missionId, run); }
  async load(missionId: string): Promise<LoopRun | undefined> { return this.runs.get(missionId); }
  async list(): Promise<readonly LoopRun[]> { return [...this.runs.values()]; }
}

export { ACTION_PROPOSAL_SCHEMA_REF, stepIdempotencyKey, emptyBudgetUsage, createId };
