import { SessionRuntime } from "../engine/session-runtime.js";
import { TaskGraphBuilder } from "../engine/task-graph.js";
import type { Plan as EnginePlan, TaskGraph, WorkflowState } from "../engine/types.js";
import { DefaultLoopDriver } from "../agent-loop/driver.js";
import { DEFAULT_LOOP_BUDGET, type LoopBudget, type LoopResult, type LoopToolCall } from "../agent-loop/contract.js";
import { type Brain, type BrainContext } from "../brain/brain.js";
import { createId, errorToJson, fail, now, ok, type JsonObject, type QuackError, type QuackResult } from "../core/types.js";
import { type CompanyExecutionPrincipal, type CompanyExecutionClaims } from "../company/runtime.js";
import { EventBus } from "../events/event-bus.js";
import { MemoryBindingError, type MemoryOperationContext, type MemoryRecord, type MemoryStore } from "../memory/memory.js";
import { type ProviderRegistry } from "../providers/provider.js";
import {
  buildToolCapabilityRequest,
  capabilityIdForPermission,
  classifyPermissionAction,
  scopeForPermission,
  PermissionBackedCapabilityBroker,
  type CapabilityBroker,
  type CapabilityDecision,
  type CapabilityRequest,
} from "../security/capability-broker.js";
import { type Permission, type PermissionPolicy } from "../security/permissions.js";
import { InMemoryTaskStore, JsonFileTaskStore, type TaskStore } from "../storage/task-store.js";
import { SqliteConnection } from "../storage/sqlite.js";
import { MissionOwnershipGuard, type OwnershipEventPayload } from "./ownership.js";
import { join } from "node:path";
import { assertRecoveryCheckpoint, createWorkflowEvidence, graphDigest, invocationId, memoryOperationId, memoryWriteDigest,
  type ExecutionIdentity, type InvocationRecord, type MemoryWriteRecord } from "../engine/execution-recovery.js";
import { buildCompletionReceipt, receiptSnapshot, type CompletionReceiptV1 } from "../engine/completion-receipt.js";
import type { Checkpoint } from "../engine/types.js";
import { isTerminalMissionState, planMissionTransition, type MissionState, type MissionTransitionTrigger } from "./mission-lifecycle/mission-state-machine.js";
import { type ToolInvocation, type ToolInvocationExecutionContext, type ToolInvocationOutcome, type ToolRegistry, validateToolInput } from "../tools/tool.js";
import { type RuntimeLearningSink } from "../cos/runtime-learning.js";
import { type EvidenceExperienceStore } from "../cos/index.js";
import { type ContextualSkillSelector, type SkillFitnessIndex, type SkillSelectionDecision } from "../adaptive/skill-fitness.js";
import { type SkillExecutor } from "../skills/executor.js";
import { type SkillRegistry } from "../skills/registry.js";
import { type Task, type TaskStep, type MissionOrigin } from "./task.js";
import { type ImprovementCoordinator, type ImprovementTriggerContext } from "../adaptive/improvement-coordinator.js";

export interface PreparedTaskGraph {
  readonly graph: TaskGraph;
  readonly nodeSkillIds: ReadonlyMap<string, string>;
}

export interface QuackRuntimeDependencies {
  readonly brain?: Pick<Brain, "plan" | "verifyExecution">;
  readonly sessionRuntime?: SessionRuntime;
  readonly planGraph?: (task: Task, context: BrainContext) => Promise<QuackResult<EnginePlan>>;
  readonly verifyExecution?: (task: Task, state: WorkflowState, context: BrainContext) => Promise<{ readonly success: boolean; readonly reason: string; readonly record?: import("../contracts/v1/contracts.js").VerificationRecordV1 }>;
  readonly prepareGraph?: (graph: TaskGraph, task: Task, selection?: SkillSelectionDecision) => Promise<TaskGraph | PreparedTaskGraph>;
  readonly budgetFor?: (context: BrainContext) => Partial<LoopBudget>;
  readonly eventBus: EventBus;
  readonly memory: MemoryStore;
  readonly permissions: PermissionPolicy;
  readonly capabilityBroker?: CapabilityBroker;
  readonly providers: ProviderRegistry;
  readonly taskStore?: TaskStore;
  readonly tools: ToolRegistry;
  readonly learning?: RuntimeLearningSink;
  readonly skillSelector?: ContextualSkillSelector;
  readonly skillFitness?: SkillFitnessIndex;
  readonly skillExecutor?: SkillExecutor;
  readonly skills?: SkillRegistry;
  readonly workspaceRoot?: string;
  readonly dataDir?: string;
  readonly sessionId?: string;
  readonly workspaceId?: string;
  readonly missionId?: string;
  readonly agentId?: string;
  readonly skillId?: string;
  readonly improvementCoordinator?: ImprovementCoordinator;
  readonly experiences?: EvidenceExperienceStore;
  readonly companyAccess?: {
    readonly isActiveMission: (missionId: string) => boolean;
    readonly resolvePrincipal: (principal: unknown) => CompanyExecutionClaims | undefined;
  };
  /** Multi-process mission ownership (ADR 0031 lift): coordination DB path. */
  readonly coordinationDbPath?: string;
  /** Ownership lease duration in ms (default 30s; heartbeat at lease/3). */
  readonly ownershipLeaseMs?: number;
  /** Explicitly disable multi-process ownership (single-process mode). */
  readonly disableOwnership?: boolean;
  /**
   * Standing-consent grant provisioner: supplies default capability grants
   * for a freshly created mission from the operator's configured permission
   * set. Called once per new mission BEFORE execution; grants flow through
   * the normal grant registry (auditable, revocable) — never a broker bypass.
   */
  readonly missionGrantProvisioner?: (missionId: string, actor: string) => void;
}

function companyIdentityError(message: string): QuackError {
  return {
    code: "company.identity_denied",
    message,
    category: "permission",
    recoverable: false,
    context: { errorType: "CompanyExecutionIdentityError" },
  };
}

export interface RuntimeAccessOptions {
  readonly idempotencyKey?: string;
  readonly attemptId?: string;
  readonly taskId: string;
  readonly actor?: string;
  readonly missionId?: string;
  readonly agentId?: string;
  readonly skillId?: string;
  readonly companyPrincipal?: CompanyExecutionPrincipal;
  readonly signal?: AbortSignal;
  readonly deadline?: string;
}

export interface RuntimeGoalOptions {
  readonly signal?: AbortSignal;
  readonly deadline?: string;
  readonly budget?: Partial<LoopBudget>;
  readonly precompiledGraph?: TaskGraph;
  readonly missionId?: string;
  readonly agentId?: string;
  readonly skillId?: string;
  /** Origin of the mission (for recursion guard). */
  readonly origin?: MissionOrigin;
}

export class QuackRuntime {
  private readonly executionOwners = new Set<string>();
  private readonly taskStore: TaskStore;
  private readonly sessions: SessionRuntime;
  private readonly loopResults = new Map<string, LoopResult>();
  private readonly activeSessions = new Set<string>();
  private readonly sessionId: string;
  private readonly workspaceId: string;
  private readonly capabilityBroker: CapabilityBroker;

  constructor(private readonly deps: QuackRuntimeDependencies) {
    this.taskStore = deps.taskStore ?? (deps.dataDir
      ? new JsonFileTaskStore(join(deps.dataDir, "tasks.json"))
      : new InMemoryTaskStore());
    this.sessions = deps.sessionRuntime ?? SessionRuntime.create({
      storageDir: deps.dataDir,
      maxActiveSessions: 100, snapshotRetentionCount: 1, autoSnapshotIntervalMs: 0,
      schedulerConfig: { maxParallelNodes: 3, defaultTimeoutMs: 30000, queuePollIntervalMs: 5 },
      defaultRetryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 }, checkpointInterval: 0,
    });
    this.sessionId = deps.sessionId ?? createId("session");
    this.workspaceId = deps.workspaceId ?? "default";
    this.capabilityBroker = deps.capabilityBroker ?? new PermissionBackedCapabilityBroker(deps.permissions);
    // Multi-process ownership: enabled only with an explicit coordination
    // DB (or a dataDir to derive one from). Single-process compositions
    // without dataDir keep today's behavior — in-process guard only.
    // Multi-process ownership: on with a dataDir-derived (or explicit)
    // coordination DB unless explicitly disabled (single-process mode).
    const coordinationPath = deps.disableOwnership ? undefined
      : deps.coordinationDbPath ?? (deps.dataDir ? join(deps.dataDir, "coordination.sqlite") : undefined);
    this.coordinationConnection = coordinationPath ? new SqliteConnection(coordinationPath) : undefined;
    this.ownershipLeaseMs = deps.ownershipLeaseMs ?? 30_000;
  }

  private readonly coordinationConnection: SqliteConnection | undefined;
  private readonly ownershipLeaseMs: number;

  /** Multi-process mission ownership enabled iff a coordination DB exists. */
  private ownershipEnabled(): boolean {
    return this.coordinationConnection !== undefined;
  }

  private emitOwnership(type: "ownership.acquired" | "ownership.rejected" | "ownership.heartbeat" | "ownership.lost" | "ownership.released", payload: OwnershipEventPayload): void {
    void this.deps.eventBus.emit(type, payload as unknown as JsonObject, { taskId: payload.missionId, actor: "ownership" }).catch(() => undefined);
  }

  /**
   * Create a fresh ownership guard for one mission execution. The guard's
   * lease and fencing epoch come from the coordination store; a single
   * process can own multiple missions via separate guards.
   */
  private createOwnershipGuard(): MissionOwnershipGuard {
    if (!this.coordinationConnection) throw new Error("Mission ownership requires a coordination database.");
    return new MissionOwnershipGuard(this.coordinationConnection, {
      leaseMs: this.ownershipLeaseMs,
      emit: (type, payload) => this.emitOwnership(type as "ownership.acquired" | "ownership.rejected" | "ownership.heartbeat" | "ownership.lost" | "ownership.released", payload),
    });
  }

  private durableRecoveryEnabled(): boolean {
    return Boolean(this.deps.dataDir) && this.sessions.supportsDurableRecovery();
  }

  private brainContext(actor: string, taskId?: string, skillSelection?: SkillSelectionDecision, access: RuntimeGoalOptions = {}): BrainContext {
    return {
      actor,
      missionId: access.missionId ?? this.deps.missionId,
      agentId: access.agentId ?? this.deps.agentId,
      skillId: access.skillId ?? this.deps.skillId,
      signal: access.signal,
      deadline: access.deadline,
      sessionId: this.sessionId,
      workspaceId: this.workspaceId,
      skillSelection: skillSelection ? {
        id: skillSelection.id,
        contextKey: skillSelection.context.contextKey,
        contextTags: skillSelection.context.contextTags,
        selected: skillSelection.selected,
        reason: skillSelection.reason,
        confidence: skillSelection.confidence,
      } : undefined,
    };
  }

  async submitGoal(goal: string, actor = "user", options: RuntimeGoalOptions = {}): Promise<QuackResult<Task>> {
    if (!goal.trim()) {
      return fail({
        code: "task.goal_empty",
        message: "A goal is required.",
        category: "validation",
        recoverable: true,
      });
    }

    const taskId = createId("task");
    const sessionId = this.deps.sessionId ?? createId("session");
    const missionId = options.missionId ?? this.deps.missionId ?? taskId;
    const agentId = options.agentId ?? this.deps.agentId;
    const skillId = options.skillId ?? this.deps.skillId;
    const execution: ExecutionIdentity | undefined = this.durableRecoveryEnabled() ? {
      missionId, executionId: taskId, taskId, sessionId, workflowId: createId("wf"), actor,
      ...(agentId ? { agentId } : {}), ...(skillId ? { skillId } : {}),
      ...(this.deps.memory.binding ? { memoryProviderId: this.deps.memory.binding.providerId,
        memoryProviderVersion: this.deps.memory.binding.providerVersion,
        memoryNamespace: this.deps.memory.binding.namespace } : {}),
    } : undefined;
    let task = await this.store({
      id: taskId,
      goal,
      status: "created",
      createdAt: now(),
      updatedAt: now(),
      plan: [],
      origin: options.origin ?? "user",
      ...(execution ? { execution } : {}),
    });

    // Fresh durable missions take ownership too (same lease, same fencing)
    // so two processes cannot execute the same mission from the start.
    const freshOwnership = this.ownershipEnabled() && this.durableRecoveryEnabled() ? this.createOwnershipGuard() : undefined;
    if (freshOwnership) {
      const acquired = freshOwnership.acquire(missionId);
      if (acquired.kind === "FAILED") {
        const failed = await this.failTask(task, { code: "recovery.ownership_conflict", message: `Mission ${missionId} is owned by another process.`, category: "runtime", recoverable: true });
        return ok(failed);
      }
      freshOwnership.startHeartbeat();
    }

    this.executionOwners.add(task.id);
    try {
      // Standing consent: provision default mission grants (from the
      // operator's configured permission set) before execution begins.
      // No provisioner -> missions rely on explicitly configured grants.
      try {
        this.deps.missionGrantProvisioner?.(missionId, actor);
      } catch (error) {
        return fail({
          code: "runtime.grant_provisioning_failed",
          message: `Default mission grants could not be provisioned: ${error instanceof Error ? error.message : String(error)}`,
          category: "permission",
          recoverable: false,
        });
      }
      await this.deps.eventBus.emit("task.created", { goal }, { taskId: task.id, actor });
      const result = await this.runTask(task, actor, options, undefined, freshOwnership);
      return result;
    } finally {
      freshOwnership?.close();
      this.executionOwners.delete(task.id);
    }
  }

  async resumeMission(taskId: string, options: { readonly signal?: AbortSignal } = {}): Promise<QuackResult<Task>> {
    if (this.executionOwners.has(taskId)) return fail({ code: "recovery.busy", message: "Execution already has an owner in this runtime.", category: "runtime", recoverable: true });
    this.executionOwners.add(taskId);
    // Multi-process ownership (ADR 0031 lift): acquire the mission lease
    // before any durable state transition. Another live process holding
    // the mission fails closed here — no concurrent recovery execution.
    const ownership = this.ownershipEnabled() && this.durableRecoveryEnabled() ? this.createOwnershipGuard() : undefined;
    try {
      const task = await this.taskStore.get(taskId);
      if (!task) return fail({ code: "task.not_found", message: "Task not found.", category: "runtime", recoverable: false });
      if (["completed", "failed"].includes(task.status)) return ok(task);
      const identity = task.execution;
      if (!identity || !this.durableRecoveryEnabled()) throw new Error("Task has no supported durable execution checkpoint.");
      if (identity.taskId !== task.id || identity.executionId !== task.id) throw new Error("Task execution identity is invalid.");
      this.assertMemoryBinding(identity);
      if (ownership) {
        const acquired = ownership.acquire(identity.missionId);
        if (acquired.kind === "FAILED") {
          return fail({ code: "recovery.ownership_conflict", message: `Mission ${identity.missionId} is owned by another process (lease held, epoch ${acquired.lease?.version ?? "unknown"}).`, category: "runtime", recoverable: true });
        }
        ownership.startHeartbeat();
        await this.deps.eventBus.emit("mission.recovery_started", { missionId: identity.missionId, taskId } as unknown as JsonObject, { taskId, actor: "runtime" });
      }
      if (!this.sessions.getSession(identity.sessionId)) await this.sessions.createSession(identity.sessionId);
      let checkpoint = await this.sessions.loadExecution(identity.sessionId, identity.workflowId);
      if (!checkpoint) {
        if (task.status !== "created") throw new Error("Execution checkpoint is missing; automatic replay is refused.");
        return await this.runTask(task, identity.actor, { ...identity, signal: options.signal }, undefined, ownership);
      }
      assertRecoveryCheckpoint(checkpoint, identity);
      if (checkpoint.recovery.memoryWrites?.some(record => record.status === "STARTED")) {
        if (!isTerminalMissionState(checkpoint.recovery.status)) await this.fencedTransition(ownership, identity, "BLOCKED", "block");
        return fail({ code: "recovery.reconciliation_required", message: "A memory provider write may have completed without durable acknowledgement; automatic replay is refused.", category: "runtime", recoverable: false });
      }
      if (checkpoint.recovery.status === "BLOCKED") return fail({ code: "recovery.reconciliation_required", message: "Execution requires reconciliation before any retry.", category: "runtime", recoverable: false });
      if (isTerminalMissionState(checkpoint.recovery.status) && checkpoint.recovery.status !== "SUCCEEDED") {
        const failed = await this.failTask(task, { code: "runtime.execution_incomplete", message: `Execution is terminal: ${checkpoint.recovery.status}.`, category: "runtime", recoverable: false });
        return ok(failed);
      }
      if (!isTerminalMissionState(checkpoint.recovery.status)) {
        if (checkpoint.recovery.status !== "INTERRUPTED" && checkpoint.recovery.status !== "RECOVERING") {
          checkpoint = await this.fencedTransition(ownership, identity, "INTERRUPTED", "interrupt");
        }
        if (checkpoint.recovery!.status === "INTERRUPTED") checkpoint = await this.fencedTransition(ownership, identity, "RECOVERING", "recover");
        const ambiguous = checkpoint.recovery!.invocations.some(record => record.status === "STARTED" && !this.canRetryInvocation(record));
        if (ambiguous) {
          await this.fencedTransition(ownership, identity, "BLOCKED", "block");
          return fail({ code: "recovery.reconciliation_required", message: "A tool may have produced an unacknowledged side effect; automatic replay is refused.", category: "runtime", recoverable: false });
        }
        checkpoint = await this.fencedTransition(ownership, identity, "RUNNING", "resume");
      }
      const result = await this.runTask(task, identity.actor, { ...identity, signal: options.signal, deadline: checkpoint.recovery!.deadline }, checkpoint, ownership);
      if (ownership && result.ok && result.data.status === "completed") {
        await this.deps.eventBus.emit("mission.recovery_completed", { missionId: identity.missionId, taskId } as unknown as JsonObject, { taskId, actor: "runtime" });
      }
      return result;
    } catch (error) {
      return fail({ code: "recovery.invalid_checkpoint", message: error instanceof Error ? error.message : String(error), category: "runtime", recoverable: false });
    } finally {
      ownership?.close();
      this.executionOwners.delete(taskId);
    }
  }

  /** Ownership-fenced mission-state transition (stale writers throw). */
  private async fencedTransition(ownership: MissionOwnershipGuard | undefined, identity: ExecutionIdentity, status: MissionState, trigger: MissionTransitionTrigger): Promise<Checkpoint> {
    ownership?.assertOwnedForWrite(`transition:${status}`);
    return this.transitionExecution(identity, status, trigger);
  }

  private async runTask(initial: Task, actor: string, options: RuntimeGoalOptions, recovered?: Checkpoint, ownership?: MissionOwnershipGuard): Promise<QuackResult<Task>> {
    let task = initial;
    const goal = task.goal;
    const durable = this.durableRecoveryEnabled();
    let checkpoint = recovered;
    let identity = task.execution;

    const skillSelection = recovered ? undefined : this.deps.skillSelector?.select({ goal });
    if (skillSelection) {
      await this.deps.eventBus.emit(
        "skill.selected",
        { kind: "skill.selection", decision: structuredClone(skillSelection) as unknown as JsonObject },
        { taskId: task.id, actor: "skill-selector" },
      );
    }

    let sessionId: string | undefined;
    let loopResult: LoopResult | undefined;
    let memoryFailure: MemoryBindingError | undefined;
    try {
      if (options.deadline && !Number.isFinite(Date.parse(options.deadline))) throw new Error("Runtime deadline is invalid.");
      sessionId = identity?.sessionId ?? this.deps.sessionId ?? createId("session");
      if (!this.sessions.getSession(sessionId)) await this.sessions.createSession(sessionId);
      this.activeSessions.add(sessionId);
      const runSessionId = sessionId;
      const missionId = options.missionId ?? this.deps.missionId ?? task.id;
      if (durable && !identity) {
        identity = { missionId, executionId: task.id, taskId: task.id, sessionId, workflowId: createId("wf"), actor,
          ...(options.agentId ?? this.deps.agentId ? { agentId: options.agentId ?? this.deps.agentId } : {}),
          ...(options.skillId ?? this.deps.skillId ? { skillId: options.skillId ?? this.deps.skillId } : {}),
        };
        task = await this.store({ ...task, execution: identity });
      }
      const context = { ...this.brainContext(actor, task.id, skillSelection, options), sessionId, missionId };
      const profileBudget = this.deps.budgetFor?.(context) ?? {};
      const effectiveBudget = { ...DEFAULT_LOOP_BUDGET };
      for (const limits of [profileBudget, options.budget ?? {}, checkpoint?.recovery?.budget ?? {}]) {
        for (const [key, value] of Object.entries(limits)) {
          if (!(key in effectiveBudget) || typeof value !== "number" || !Number.isFinite(value) || value < 0
            || (key !== "maxCostUsd" && !Number.isInteger(value))) throw new Error(`Invalid runtime budget: ${key}.`);
          const name = key as keyof LoopBudget;
          Object.assign(effectiveBudget, { [name]: Math.min(effectiveBudget[name] ?? Infinity, value) });
        }
      }
      const executionDeadline = checkpoint?.recovery?.deadline ?? new Date(Math.min(Date.now() + effectiveBudget.maxDurationMs,
        options.deadline ? Date.parse(options.deadline) : Infinity)).toISOString();
      let toolCallsStarted = checkpoint?.recovery?.invocations.reduce((sum, call) => sum + call.attempts, 0) ?? 0;
      loopResult = await this.sessions.run(sessionId, async (sessionSignal) => {
        const signal = options.signal ? AbortSignal.any([options.signal, sessionSignal]) : sessionSignal;
        const verifier = this.deps.verifyExecution ?? this.deps.brain?.verifyExecution?.bind(this.deps.brain);
        let nodeSkillIds: ReadonlyMap<string, string> = new Map(Object.entries(checkpoint?.recovery?.nodeSkillIds ?? {}));
        const driver = new DefaultLoopDriver({
          capabilityBroker: this.capabilityBroker, eventBus: this.deps.eventBus, memory: this.deps.memory,
          workspaceRoot: this.deps.workspaceRoot, dataDir: this.deps.dataDir,
          plan: async (_goal, _observation, loopContext) => {
            const planningContext = { ...context, signal: loopContext.signal, deadline: loopContext.deadline };
            let graph: TaskGraph;
            let strategy = "Registered graph";
            let requiredCapabilities: readonly string[] = [];
            if (checkpoint) graph = structuredClone(checkpoint.workflowState.taskGraph);
            else if (options.precompiledGraph) graph = structuredClone(options.precompiledGraph);
            else if (this.deps.planGraph) {
              let proposal;
              try { proposal = await this.deps.planGraph(task, planningContext); }
              catch (error) {
                if (error instanceof MemoryBindingError) memoryFailure = error;
                throw error;
              }
              if (!proposal.ok) throw new Error(proposal.error.message);
              graph = proposal.data.taskGraph; strategy = proposal.data.strategy;
              requiredCapabilities = proposal.data.requiresPermissions;
            } else if (this.deps.brain) {
              const proposal = await this.deps.brain.plan(task, planningContext);
              if (!proposal.ok) throw new Error(proposal.error.message);
              strategy = proposal.data.strategy; requiredCapabilities = proposal.data.requiresPermissions;
              const builder = new TaskGraphBuilder({ description: goal });
              for (const step of proposal.data.steps) builder.addNode(step.id, {
                description: step.description, dependencies: step.dependencies, tools: step.tools,
                toolInvocations: step.toolInvocations,
                retryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 },
              });
              graph = builder.build();
            } else throw new Error("No planner strategy is registered.");
            if (!checkpoint && this.deps.prepareGraph) {
              const prepared = await this.deps.prepareGraph(graph, task, skillSelection);
              if ("graph" in prepared) { graph = prepared.graph; nodeSkillIds = new Map(prepared.nodeSkillIds); }
              else graph = prepared;
            }
            else if (!checkpoint && skillSelection?.selected.some((skill) => this.deps.skills?.get(skill.skillId, skill.version)?.portableExecution)) {
              throw new Error("Selected portable skills require a registered graph compiler.");
            }
            graph = structuredClone(graph);
            if (durable && identity) {
              if (!checkpoint) {
                if (graph.nodes.some(node => node.status !== "pending" || node.result)) throw new Error("New durable executions require a pending graph without supplied results.");
                ownership?.assertOwnedForWrite("checkpoint-initialize");
                checkpoint = await this.sessions.initializeExecution(runSessionId, graph, {
                  version: 1, identity, status: "STARTING", graphDigest: graphDigest(graph), budget: effectiveBudget,
                  deadline: executionDeadline, nodeSkillIds: Object.fromEntries(nodeSkillIds), invocations: [],
                  ...(identity.memoryProviderId ? { memoryWrites: [] } : {}),
                });
                checkpoint = await this.fencedTransition(ownership, identity, "RUNNING", "start");
              }
              graph = { ...graph, nodes: graph.nodes.map(node => ["running", "retrying", "paused", "ready"].includes(node.status)
                ? { ...node, status: "pending" as const } : node) };
            }
            ownership?.assertOwnedForWrite("task-planned");
            task = await this.store({ ...task, status: "planned", updatedAt: now(),
              plan: graph.nodes.map((node) => ({ id: node.id, title: node.description, status: "pending" })) });
            await this.deps.eventBus.emit("task.planned", { steps: graph.nodes.length, sessionId: runSessionId }, { taskId: task.id, actor: "runtime" });
            return { planId: graph.id, strategy, taskGraph: graph, requiredCapabilities,
              nodes: graph.nodes.map((node) => ({ ...node, toolInvocations: node.toolInvocations ?? [] })) };
          },
          executeGraph: async (plan, loopContext) => {
            if (!plan.taskGraph) throw new Error("Planner did not supply a task graph.");
            ownership?.assertOwnedForWrite("task-running");
            task = await this.store({ ...task, status: "running", updatedAt: now() });
            await this.deps.eventBus.emit("task.started", { goal, sessionId: runSessionId }, { taskId: task.id, actor: "runtime" });
            if (ownership && !recovered) {
              await this.deps.eventBus.emit("mission.started", { missionId, taskId: task.id } as unknown as JsonObject, { taskId: task.id, actor: "runtime" });
            } else if (ownership) {
              await this.deps.eventBus.emit("mission.resumed", { missionId, taskId: task.id } as unknown as JsonObject, { taskId: task.id, actor: "runtime" });
            }
            const calls: LoopToolCall[] = [];
            const restoredWorkflow = durable && checkpoint?.workflowState.status === "completed"
              ? structuredClone(checkpoint.workflowState)
              : undefined;
            const workflowState = restoredWorkflow ?? await this.sessions.executeWorkflow(runSessionId, plan.taskGraph, task.id, async (invocation, toolContext) => {
              const startedAt = now();
              const invoke = async (extra: { idempotencyKey?: string; attemptId?: string } = {}) => {
                if (toolCallsStarted >= (effectiveBudget.maxToolCalls ?? 1000)) return { toolId: invocation.toolId, success: false, error: "Tool-call budget exhausted." };
                toolCallsStarted++;
                return this.executeToolInvocation(invocation, {
                ...toolContext, taskId: task.id, actor, ...options,
                ...extra,
                missionId,
                agentId: options.agentId ?? this.deps.agentId,
                skillId: (toolContext.nodeId ? nodeSkillIds.get(toolContext.nodeId) : undefined) ?? options.skillId ?? this.deps.skillId,
                signal: toolContext.signal ? AbortSignal.any([toolContext.signal, loopContext.signal!]) : loopContext.signal,
                deadline: options.deadline && options.deadline < loopContext.deadline! ? options.deadline : loopContext.deadline,
                });
              };
              const outcome = durable && identity
                ? await this.executeRecoverableInvocation(identity, invocation, toolContext, invoke)
                : await invoke();
              calls.push({ toolId: invocation.toolId, input: structuredClone(invocation.input), success: outcome.success,
                output: outcome.output, error: outcome.error, startedAt, completedAt: now() });
              return outcome;
            }, loopContext.signal, { maxParallelNodes: effectiveBudget.maxConcurrentNodes,
              deadline: executionDeadline, ...(durable && identity ? { durable: true, workflowId: identity.workflowId } : {}) });
            if (durable && identity) {
              checkpoint = await this.sessions.loadExecution(identity.sessionId, identity.workflowId);
              for (const record of checkpoint!.recovery!.invocations) {
                if (record.outcome && !calls.some(call => call.toolId === record.invocation.toolId && JSON.stringify(call.input) === JSON.stringify(record.invocation.input))) {
                  calls.push({ input: record.invocation.input, ...record.outcome,
                    startedAt: record.startedAt, completedAt: record.completedAt ?? record.startedAt });
                }
              }
            }
            const success = workflowState.status === "completed" && workflowState.completedNodes.length === plan.taskGraph.nodes.length
              && workflowState.failedNodes.length === 0 && workflowState.skippedNodes.length === 0 && calls.length > 0;
            return { success, toolCalls: calls, workflowState,
              capabilityDenied: calls.some((call) => /denied|capability/i.test(call.error ?? "")),
              error: success ? undefined : workflowState.errors[0] ?? calls.find((call) => !call.success)?.error ?? "Workflow did not complete.",
            };
          },
          verifyExecution: verifier ? async (_action, execution) => {
            if (!execution.workflowState) return { success: false, reason: "No workflow evidence.", independent: false };
            let evidence: import("../contracts/v1/contracts.js").EvidenceRecordV1 | undefined;
            if (durable && identity) {
              checkpoint = await this.sessions.loadExecution(identity.sessionId, identity.workflowId);
              if (checkpoint?.recovery?.verification) return { ...checkpoint.recovery.verification, independent: true };
              evidence = checkpoint?.recovery?.evidence ?? createWorkflowEvidence({ missionId, executionId: task.id, taskId: task.id }, execution.workflowState);
              checkpoint = await this.sessions.updateExecution(identity.sessionId, identity.workflowId, current => ({ ...current,
                recovery: { ...current.recovery!, evidence } }));
            }
            const checked = await verifier(task, structuredClone(execution.workflowState), { ...context, signal, recoveryEvidence: evidence });
            if (durable && identity && evidence) {
              checkpoint = await this.sessions.updateExecution(identity.sessionId, identity.workflowId, current => ({ ...current,
                recovery: { ...current.recovery!, verification: { ...checked, evidenceId: evidence!.id } } }));
            }
            return { ...checked, independent: true };
          } : undefined,
        }, effectiveBudget, { enableEventWakeups: false });
        return driver.start({ goal, actor, origin: task.origin, missionId, runId: identity?.executionId,
          signal, budget: effectiveBudget });
      });
      this.loopResults.set(task.id, loopResult);
      this.loopResults.set(loopResult.runId, loopResult);
      const workflow = loopResult.iterations.at(-1)?.executionResult.workflowState;
      task = { ...task, plan: task.plan.map((step) => ({ ...step,
        status: workflow?.completedNodes.includes(step.id) ? "completed" : "failed" })) };
      if (loopResult.state !== "COMPLETED") throw memoryFailure ?? new Error(loopResult.error ?? `Mission stopped: ${loopResult.stopReason}.`);
      const summary = loopResult.iterations.at(-1)?.verificationResult.reason ?? "Mission validated.";
      // COMPLETING: the final durable persist phase; ownership must hold
      // through receipt + memory + SUCCEEDED + task-completed store, and is
      // released only afterwards (in resumeMission's finally / submitGoal).
      ownership?.beginCompleting();
      const receipt = await this.buildReceiptFor(identity, summary);
      await this.writeCompletionMemory(task, summary, actor, missionId, runSessionId, executionDeadline, options.signal, durable ? identity : undefined);
      if (durable && identity && checkpoint?.recovery?.status !== "SUCCEEDED") await this.fencedTransition(ownership, identity, "SUCCEEDED", "succeed");
      ownership?.assertOwnedForWrite("task-completed");
      task = await this.store({ ...task, status: "completed", updatedAt: now(), result: this.withSkillSelection({
        summary, runId: loopResult.runId, sessionId, workflowId: workflow?.workflowId ?? null,
        ...(receipt.ok ? { receipt: receiptSnapshot(receipt.data) } : {}),
        nodeResults: workflow?.nodeResults as unknown as JsonObject ?? {},
        totalSteps: task.plan.length, completedSteps: workflow?.completedNodes.length ?? 0,
        failedSteps: workflow?.failedNodes.length ?? 0, toolCallsMade: loopResult.totalToolCalls,
        metrics: { totalSteps: task.plan.length, completedSteps: workflow?.completedNodes.length ?? 0,
          failedSteps: workflow?.failedNodes.length ?? 0, toolCallsMade: loopResult.totalToolCalls },
      }, skillSelection) });
      await this.deps.eventBus.emit("task.completed", { summary }, { taskId: task.id, actor: "runtime" });
      if (ownership) await this.deps.eventBus.emit("mission.completed", { missionId: identity?.missionId ?? task.id, taskId: task.id } as unknown as JsonObject, { taskId: task.id, actor: "runtime" });
    } catch (error) {
      if (durable && identity) {
        const saved = await this.sessions.loadExecution(identity.sessionId, identity.workflowId);
        if (saved?.recovery && !isTerminalMissionState(saved.recovery.status)) {
          const cancelled = options.signal?.aborted || loopResult?.state === "CANCELLED";
          const timedOut = Date.parse(saved.recovery.deadline) <= Date.now();
          // A stale owner must not write its failure transitions either:
          // the fenced write throws (caught below as the task failure),
          // which is the correct fail-closed outcome after lease loss.
          try {
            await this.fencedTransition(ownership, identity, cancelled ? "CANCELLED" : timedOut ? "TIMED_OUT" : "FAILED", cancelled ? "cancel" : timedOut ? "timeout" : "fail");
          } catch (fenceError) {
            if (!`${fenceError instanceof Error ? fenceError.message : fenceError}`.includes("ownership")) throw fenceError;
          }
        }
      }
      const failure: QuackError = error instanceof MemoryBindingError
        ? { code: error.code, message: error.message, category: error.category, recoverable: error.recoverable }
        : { code: "runtime.execution_incomplete", message: error instanceof Error ? error.message : String(error), category: "runtime", recoverable: false };
      task = await this.failTask(task, failure);
      await this.deps.eventBus.emit("task.failed", { error: errorToJson(failure) }, { taskId: task.id, actor: "runtime" });
      if (ownership) await this.deps.eventBus.emit("mission.failed", { missionId: identity?.missionId ?? task.id, taskId: task.id, error: errorToJson(failure).message } as unknown as JsonObject, { taskId: task.id, actor: "runtime" });
      await this.recordLearningExperience(task, actor);
      return ok(task);
    } finally {
      if (sessionId) this.activeSessions.delete(sessionId);
    }
    await this.recordLearningExperience(task, actor);

    if (this.deps.improvementCoordinator) {
      const evidenceCount = await this.deps.experiences?.list().then((list) => list.length).catch(() => 0) ?? 0;
      const context: ImprovementTriggerContext = {
        taskId: task.id,
        missionId: options.missionId,
        origin: task.origin ?? "user",
        actor,
        goal,
        evidenceCount,
      };
      try {
        await this.deps.improvementCoordinator.onMissionCompleted(context);
      } catch (error) {
        await this.deps.eventBus.emit("improvement.failed", {
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        }, { taskId: task.id, actor: "improvement-coordinator" });
      }
    }

    return ok(task);
  }

  private async transitionExecution(identity: ExecutionIdentity, status: MissionState, trigger: MissionTransitionTrigger): Promise<Checkpoint> {
    return this.sessions.updateExecution(identity.sessionId, identity.workflowId, checkpoint => {
      planMissionTransition(identity.missionId, checkpoint.recovery!.status, status, trigger);
      return { ...checkpoint, recovery: { ...checkpoint.recovery!, status } };
    });
  }

  /**
   * Build the completion receipt from the durable evidence/verification chain
   * (ADR 0033). Durable executions cite the checkpoint-stored evidence and
   * verification; non-durable executions cannot mint a receipt because there is
   * no durable evidence chain to cite.
   */
  private async buildReceiptFor(identity: ExecutionIdentity | undefined, summary: string): Promise<QuackResult<CompletionReceiptV1>> {
    if (!identity || !this.durableRecoveryEnabled()) {
      return fail({ code: "completion.not_durable", message: "Completion receipts require a durable execution checkpoint.", category: "runtime", recoverable: false });
    }
    const checkpoint = await this.sessions.loadExecution(identity.sessionId, identity.workflowId);
    const recovery = checkpoint?.recovery;
    if (!recovery?.evidence || !recovery.verification) {
      return fail({ code: "completion.evidence_missing", message: "No durable evidence or verification is stored for this execution.", category: "runtime", recoverable: false });
    }
    return buildCompletionReceipt({ identity, summary, evidence: structuredClone(recovery.evidence),
      verification: structuredClone(recovery.verification), independent: true });
  }

  private assertMemoryBinding(identity: ExecutionIdentity): void {
    const current = this.deps.memory.binding;
    if (identity.memoryProviderId !== current?.providerId || identity.memoryProviderVersion !== current?.providerVersion
      || identity.memoryNamespace !== current?.namespace) {
      throw new Error("Configured memory provider does not match the durable execution identity.");
    }
  }

  private async writeCompletionMemory(task: Task, summary: string, actor: string, missionId: string, sessionId: string,
    deadline: string, signal: AbortSignal | undefined, identity?: ExecutionIdentity): Promise<void> {
    const input: Omit<MemoryRecord, "id" | "createdAt"> = {
      scope: "task", content: summary,
      metadata: { taskId: task.id, goal: task.goal, memoryClass: "working", source: "runtime.verification" },
    };
    const binding = this.deps.memory.binding;
    const operationId = memoryOperationId(identity?.executionId ?? task.id, "completion");
    const context: MemoryOperationContext = { missionId, taskId: task.id, executionId: identity?.executionId ?? task.id,
      sessionId, actor, agentId: identity?.agentId, skillId: identity?.skillId,
      namespace: binding?.namespace, operationId, signal, deadline };
    if (identity && binding) {
      const saved = await this.sessions.loadExecution(identity.sessionId, identity.workflowId);
      if (!saved) throw new MemoryBindingError("memory.checkpoint_missing", "Memory write requires the canonical execution checkpoint.");
      assertRecoveryCheckpoint(saved, identity);
      const prior = saved.recovery.memoryWrites?.find(record => record.id === operationId);
      const digest = memoryWriteDigest(input);
      if (prior) {
        if (prior.inputDigest !== digest) throw new MemoryBindingError("memory.checkpoint_invalid", "Durable memory input changed during recovery.");
        if (prior.status === "COMPLETED") return;
        throw new MemoryBindingError("memory.reconciliation_required", "Memory write outcome is ambiguous; automatic replay is refused.");
      }
      const started: MemoryWriteRecord = { id: operationId, providerId: binding.providerId,
        providerVersion: binding.providerVersion, purpose: "completion", inputDigest: digest,
        status: "STARTED", startedAt: now() };
      await this.sessions.updateExecution(identity.sessionId, identity.workflowId, current => ({ ...current,
        recovery: { ...current.recovery!, memoryWrites: [...(current.recovery!.memoryWrites ?? []), started] } }));
      const stored = await this.deps.memory.write(input, context);
      await this.sessions.updateExecution(identity.sessionId, identity.workflowId, current => ({ ...current,
        recovery: { ...current.recovery!, memoryWrites: current.recovery!.memoryWrites!.map(record => record.id === operationId
          ? { ...record, status: "COMPLETED", completedAt: now(), providerRecordId: stored.id } : record) } }));
    } else {
      await this.deps.memory.write(input, binding ? context : undefined);
    }
    await this.deps.eventBus.emit("memory.written", { scope: "task", providerId: binding?.providerId ?? "runtime.default" }, { taskId: task.id, actor: "memory" });
  }

  private canRetryInvocation(record: InvocationRecord): boolean {
    const tool = this.deps.tools.get(record.invocation.toolId);
    if (!tool.ok || tool.data.describe().retrySafety !== record.safety) return false;
    return record.safety === "READ_ONLY" || record.safety === "IDEMPOTENT_WRITE";
  }

  private async executeRecoverableInvocation(identity: ExecutionIdentity, invocation: ToolInvocation, context: ToolInvocationExecutionContext,
    invoke: (extra: { idempotencyKey?: string; attemptId?: string }) => Promise<ToolInvocationOutcome>): Promise<ToolInvocationOutcome> {
    if (!context.nodeId || context.invocationIndex === undefined) throw new Error("Recovery requires a stable node and invocation index.");
    const checkpoint = await this.sessions.loadExecution(identity.sessionId, identity.workflowId);
    if (!checkpoint) throw new Error("Execution checkpoint disappeared before dispatch.");
    assertRecoveryCheckpoint(checkpoint, identity);
    const id = invocationId(identity.executionId, context.nodeId, context.invocationIndex);
    const previous = checkpoint.recovery.invocations.find(record => record.id === id);
    if (previous) {
      if (JSON.stringify(previous.invocation) !== JSON.stringify(invocation)) throw new Error("Recovery invocation arguments changed.");
      if (previous.status === "COMPLETED") return structuredClone(previous.outcome!);
      if (previous.status === "FAILED" && !this.canRetryInvocation(previous)) return structuredClone(previous.outcome!);
      if (!this.canRetryInvocation(previous)) throw new Error("Ambiguous side effect requires reconciliation.");
    }
    const tool = this.deps.tools.get(invocation.toolId);
    const attempts = (previous?.attempts ?? 0) + 1;
    const record: InvocationRecord = { id, nodeId: context.nodeId, index: context.invocationIndex,
      attemptId: `${id}:${attempts}`, attempts, invocation: structuredClone(invocation),
      safety: tool.ok ? tool.data.describe().retrySafety ?? "UNKNOWN" : "UNKNOWN", status: "STARTED", startedAt: now() };
    await this.sessions.updateExecution(identity.sessionId, identity.workflowId, current => ({ ...current,
      recovery: { ...current.recovery!, invocations: [...current.recovery!.invocations.filter(value => value.id !== id), record] } }));
    const outcome = await invoke({ idempotencyKey: id, attemptId: record.attemptId });
    await this.sessions.updateExecution(identity.sessionId, identity.workflowId, current => ({ ...current,
      recovery: { ...current.recovery!, invocations: current.recovery!.invocations.map(value => value.id === id
        ? { ...value, status: outcome.success ? "COMPLETED" : "FAILED", outcome: structuredClone(outcome), completedAt: now() } : value) } }));
    return outcome;
  }

  async requestPermission(
    permission: Permission,
    reason: string,
    options: { readonly taskId?: string; readonly actor?: string; readonly context?: JsonObject; readonly missionId?: string; readonly agentId?: string; readonly skillId?: string } = {},
  ): Promise<boolean> {
    const actor = options.actor ?? "runtime";
    const request: CapabilityRequest = {
      id: createId("permission"),
      taskId: options.taskId,
      missionId: options.missionId ?? this.deps.missionId,
      agentId: options.agentId ?? this.deps.agentId,
      skillId: options.skillId ?? this.deps.skillId,
      actor,
      capabilityId: capabilityIdForPermission(permission),
      permission,
      action: classifyPermissionAction(permission),
      resource: scopeForPermission(permission, options.context ?? {}),
      reason,
      context: options.context,
    };

    const decision = await this.requestCapability(request);
    return decision.granted;
  }

  private async requestCapability(request: CapabilityRequest): Promise<CapabilityDecision> {
    await this.deps.eventBus.emit(
      "capability.requested",
      this.capabilityRequestPayload(request),
      { taskId: request.taskId, actor: request.actor },
    );
    if (request.permission) {
      await this.deps.eventBus.emit(
        "permission.requested",
        { permission: request.permission, reason: request.reason },
        { taskId: request.taskId, actor: request.actor },
      );
    }

    const decision = await this.capabilityBroker.resolve(request);
    const decisionPayload = this.capabilityDecisionPayload(request, decision);

    await this.deps.eventBus.emit(
      "capability.checked",
      decisionPayload,
      { taskId: request.taskId, actor: "security" },
    );

    if (request.permission) {
      await this.deps.eventBus.emit(
        "permission.decided",
        { permission: request.permission, granted: decision.granted, reason: decision.reason },
        { taskId: request.taskId, actor: "security" },
      );
    }
    await this.deps.eventBus.emit(
      decision.granted ? "capability.allowed" : "capability.denied",
      decisionPayload,
      { taskId: request.taskId, actor: "security" },
    );
    await this.deps.eventBus.emit(
      "capability.decided",
      decisionPayload,
      { taskId: request.taskId, actor: "security" },
    );

    return decision;
  }

  async executeTool(toolId: string, input: JsonObject, options: RuntimeAccessOptions): Promise<QuackResult<JsonObject>> {
    const interrupted = (): QuackResult<JsonObject> | undefined => {
      if (options.signal?.aborted) return fail({ code: "tool.cancelled", message: "Tool execution was cancelled; completed effects may remain.", category: "tool", recoverable: false });
      if (options.deadline && (!Number.isFinite(Date.parse(options.deadline)) || Date.now() >= Date.parse(options.deadline))) {
        return fail({ code: "tool.deadline_exceeded", message: "Tool execution deadline expired or is invalid; completed effects may remain.", category: "tool", recoverable: false });
      }
      return undefined;
    };
    const before = interrupted();
    if (before) return before;
    let actor = options.actor ?? "runtime";
    let missionId = options.missionId ?? this.deps.missionId;
    let agentId = options.agentId ?? this.deps.agentId;
    const skillId = options.skillId ?? this.deps.skillId;
    const activeCompany = missionId ? this.deps.companyAccess?.isActiveMission(missionId) : false;
    if (activeCompany || options.companyPrincipal) {
      const claims = this.deps.companyAccess?.resolvePrincipal(options.companyPrincipal);
      if (!claims) return fail(companyIdentityError("A valid live Company Runtime execution principal is required."));
      if ((missionId && missionId !== claims.missionId) || (agentId && agentId !== claims.agentInstanceId)) {
        return fail(companyIdentityError("Caller-supplied mission or agent identity does not match the execution principal."));
      }
      missionId = claims.missionId;
      agentId = claims.agentInstanceId;
      actor = claims.agentInstanceId;
    }
    const tool = this.deps.tools.get(toolId);
    if (!tool.ok) return tool;
    let executionInput: JsonObject;
    try { executionInput = structuredClone(input); }
    catch { return fail({ code: "tool.invalid_input", message: "Tool input must be cloneable JSON data.", category: "validation", recoverable: false }); }
    const validInput = validateToolInput(tool.data, structuredClone(executionInput));
    if (!validInput.ok) return validInput as QuackResult<JsonObject>;

    const metadata = tool.data.describe();
    const requiredPermissions = [...metadata.permissions];
    if (requiredPermissions.length === 0) return fail({ code: "tool.authority_missing", message: `Tool ${toolId} declares no capability authority and cannot execute.`, category: "permission", recoverable: false });
    const execute = tool.data.execute.bind(tool.data);
    for (const permission of requiredPermissions) {
      const request = buildToolCapabilityRequest({
        taskId: options.taskId,
        missionId,
        agentId,
        skillId,
        actor,
        toolId,
        permission,
        input: structuredClone(executionInput),
      });
      const decision = await this.requestCapability(request);

      if (!decision.granted) {
        return fail(this.capabilityDeniedError({
          request,
          decision,
          toolName: metadata.name,
          permission,
        }));
      }
    }

    await this.deps.eventBus.emit("tool.requested", { toolId, input: structuredClone(executionInput) }, { taskId: options.taskId, actor });

    try {
      const beforeDispatch = interrupted();
      if (beforeDispatch) return beforeDispatch;
      for (const permission of requiredPermissions) {
        const request = buildToolCapabilityRequest({ taskId: options.taskId, missionId, agentId, skillId, actor, toolId, permission, input: executionInput });
        const decision = this.capabilityBroker.revalidateAuthority?.(request);
        if (decision && !decision.granted) return fail(this.capabilityDeniedError({ request, decision, toolName: metadata.name, permission }));
      }
      const result = await execute(executionInput, { taskId: options.taskId, actor, signal: options.signal, deadline: options.deadline,
        idempotencyKey: options.idempotencyKey, attemptId: options.attemptId });
      const after = interrupted();
      await this.deps.eventBus.emit("tool.completed", { toolId, metrics: result.metrics ?? null, ...(after && !after.ok ? { error: errorToJson(after.error) } : {}) }, { taskId: options.taskId, actor: toolId });
      if (after) return after;
      return ok(result.output as unknown as JsonObject);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed.";
      const failure = {
        code: "tool.execution_failed",
        message,
        category: "tool" as const,
        recoverable: true,
        context: { toolId },
      };
      await this.deps.eventBus.emit("tool.completed", { toolId, error: errorToJson(failure) }, { taskId: options.taskId, actor: toolId });
      return fail(failure);
    }
  }

  private async executeToolInvocation(
    invocation: ToolInvocation,
    context: ToolInvocationExecutionContext & RuntimeGoalOptions,
  ): Promise<ToolInvocationOutcome> {
    const result = await this.executeTool(invocation.toolId, invocation.input, {
      taskId: context.taskId,
      actor: context.actor,
      missionId: context.missionId,
      agentId: context.agentId,
      skillId: context.skillId,
      signal: context.signal,
      deadline: context.deadline,
      idempotencyKey: context.idempotencyKey,
      attemptId: context.attemptId,
    });

    if (result.ok) {
      return { toolId: invocation.toolId, success: true, output: result.data };
    }

    return { toolId: invocation.toolId, success: false, error: result.error.message };
  }

  private capabilityRequestPayload(request: CapabilityRequest): JsonObject {
    return {
      requestId: request.id,
      missionId: request.missionId ?? null,
      agentId: request.agentId ?? null,
      skillId: request.skillId ?? null,
      capabilityId: request.capabilityId,
      permission: request.permission ?? null,
      toolId: request.toolId ?? null,
      action: request.action,
      resource: request.resource as unknown as JsonObject,
      reason: request.reason,
      context: request.context ?? null,
    };
  }

  private capabilityDecisionPayload(request: CapabilityRequest, decision: CapabilityDecision): JsonObject {
    return {
      ...this.capabilityRequestPayload(request),
      timestamp: now(),
      decision: decision.granted ? "allowed" : "denied",
      granted: decision.granted,
      reason: decision.reason,
      policyRef: decision.policyRef ?? null,
      grantId: decision.grantId ?? null,
      permissionDecision: decision.permissionDecision ? {
        granted: decision.permissionDecision.granted,
        reason: decision.permissionDecision.reason,
      } : null,
    };
  }

  private capabilityDeniedError(options: {
    readonly request: CapabilityRequest;
    readonly decision: CapabilityDecision;
    readonly toolName: string;
    readonly permission: Permission;
  }): QuackError {
    return {
      code: "tool.permission_denied",
      message: `CapabilityDeniedError: mission ${options.request.missionId ?? "none"} cannot execute ${options.toolName} because ${options.decision.capabilityId} was denied.`,
      category: "permission",
      recoverable: true,
      context: {
        errorType: "CapabilityDeniedError",
        missionId: options.request.missionId ?? null,
        toolId: options.request.toolId ?? null,
        toolName: options.toolName,
        capabilityId: options.decision.capabilityId,
        requiredCapability: options.decision.capabilityId,
        missingPermission: options.permission,
        action: options.request.action,
        resource: options.request.resource as unknown as JsonObject,
        decision: "denied",
        reason: options.decision.reason,
        policyRef: options.decision.policyRef ?? null,
        grantId: options.decision.grantId ?? null,
      },
    };
  }

  async getTask(id: string): Promise<QuackResult<Task>> {
    const task = await this.taskStore.get(id);
    if (!task) {
      return fail({
        code: "task.not_found",
        message: `Task ${id} was not found.`,
        category: "runtime",
        recoverable: true,
      });
    }

    return ok(task);
  }

  async listTasks(): Promise<Task[]> {
    return this.taskStore.list();
  }

  private async store(task: Task): Promise<Task> {
    return this.taskStore.save(task);
  }

  private async failTask(task: Task, error: QuackError): Promise<Task> {
    return this.store({
      ...task,
      status: "failed",
      error: errorToJson(error),
      updatedAt: now(),
    });
  }

  private async recordLearningExperience(task: Task, actor: string): Promise<void> {
    if (!this.deps.learning) return;
    try {
      const experience = await this.deps.learning.recordTaskCompletion(task, { actor });
      if (experience) {
        this.deps.skillFitness?.updateFromExperience(experience);
      }
    } catch (error) {
      await this.deps.memory.write({
        scope: "task",
        content: `Learning evidence recording failed: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { taskId: task.id, memoryClass: "experience", source: "runtime.learning" },
      }, this.deps.memory.binding ? {
        missionId: task.execution?.missionId ?? this.deps.missionId ?? task.id, taskId: task.id,
        executionId: task.execution?.executionId ?? task.id, sessionId: task.execution?.sessionId ?? this.sessionId,
        actor, agentId: task.execution?.agentId, skillId: task.execution?.skillId,
        namespace: "memory.experience", operationId: `memory-learning-failure:${task.id}`,
      } : undefined);
    }
  }

  private withSkillSelection(data: JsonObject, selection: SkillSelectionDecision | undefined): JsonObject {
    if (!selection) return data;
    return {
      ...data,
      selectedSkills: selection.selected.map((skill) => ({
        skillId: skill.skillId,
        version: skill.version ?? null,
        source: skill.source ?? null,
      })) as unknown as JsonObject[],
      skillSelectionId: selection.id,
      skillSelectionReason: selection.reason,
      contextKey: selection.context.contextKey,
      contextTags: selection.context.contextTags as unknown as string[],
    };
  }

  getLoopResult(taskOrRunId: string): LoopResult | undefined {
    const result = this.loopResults.get(taskOrRunId);
    return result ? structuredClone(result) : undefined;
  }

  async executeGraph(graph: TaskGraph, actor = "runtime", options: RuntimeGoalOptions = {}): Promise<QuackResult<WorkflowState>> {
    const task = await this.submitGoal(graph.description, actor, { ...options, precompiledGraph: graph });
    if (!task.ok) return task;
    const state = this.getLoopResult(task.data.id)?.iterations.at(-1)?.executionResult.workflowState;
    return state ? ok(state) : fail({ code: "runtime.graph_not_executed", message: String(task.data.error?.message ?? "No workflow was executed."), category: "runtime", recoverable: false });
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.activeSessions].map((id) => this.sessions.cancelAndWait(id)));
  }
}
