import { createId, now } from "../core/types.js";
import { type SessionState, type SessionSnapshot, type SessionRuntimeConfig, type WorkflowState, type TaskGraph } from "./types.js";
import { JournalWriter, InMemoryJournalStore, JsonFileJournalStore } from "./execution-journal.js";
import { CheckpointManager, InMemoryCheckpointStore, JsonFileCheckpointStore } from "./checkpoint-system.js";
import { resolve } from "node:path";
import { type JournalStore, type CheckpointStore } from "./types.js";
import { WorkflowEngine, type WorkflowEngineConfig, type WorkflowStartOptions } from "./workflow-engine.js";
import { type ToolInvocationExecutor } from "../tools/tool.js";
import { assertRecoveryCheckpoint, type ExecutionRecovery } from "./execution-recovery.js";
import type { Checkpoint } from "./types.js";

interface InternalSessionState extends Omit<SessionState, "workflowIds"> {
  workflowEngine?: WorkflowEngine;
  journalWriter?: JournalWriter;
  undoStack: SessionSnapshot[];
  redoStack: SessionSnapshot[];
  workflowIds: string[];
}

export class SessionRuntime {
  private sessions = new Map<string, InternalSessionState>();
  private journalStores = new Map<string, JournalStore>();
  private checkpointStores = new Map<string, CheckpointStore>();
  private readonly executionUpdates = new Map<string, Promise<unknown>>();
  private readonly activeRuns = new Map<string, { controller: AbortController; promise: Promise<unknown> }>();
  private constructor(
    private readonly config: SessionRuntimeConfig & WorkflowEngineConfig,
  ) {}

  static create(config: SessionRuntimeConfig & WorkflowEngineConfig): SessionRuntime {
    return new SessionRuntime(config);
  }

  supportsDurableRecovery(): boolean {
    return Boolean(this.config.storageDir);
  }

  async createSession(sessionId?: string, metadata?: Record<string, string>): Promise<string> {
    const id = sessionId ?? createId("ses");
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(id)) throw new Error("Session ID must be a confined identifier.");
    if (this.sessions.has(id)) throw new Error("Session already exists: " + id);
    if (!Number.isInteger(this.config.maxActiveSessions) || this.config.maxActiveSessions < 1) throw new Error("maxActiveSessions must be a positive integer.");
    const journalStore = this.config.storageDir 
      ? new JsonFileJournalStore(resolve(this.config.storageDir, `sessions/${id}/journal.json`))
      : new InMemoryJournalStore();
    const checkpointStore = this.config.storageDir
      ? new JsonFileCheckpointStore(resolve(this.config.storageDir, `sessions/${id}/checkpoints.json`))
      : new InMemoryCheckpointStore();
    
    if (this.sessions.size >= (this.config.maxActiveSessions ?? 1000)) {
      const firstKey = [...this.sessions.keys()].find(key => !this.isActive(key));
      if (firstKey) {
        this.sessions.delete(firstKey);
        this.journalStores.delete(firstKey);
        this.checkpointStores.delete(firstKey);
      } else throw new Error("Session capacity is exhausted by active executions.");
    }

    this.journalStores.set(id, journalStore);
    this.checkpointStores.set(id, checkpointStore);

    const session: InternalSessionState = {
      sessionId: id,
      status: "idle",
      planId: "",
      workflowIds: [],
      currentWorkflowId: undefined,
      createdAt: now(),
      updatedAt: now(),
      metadata: { ...metadata },
      undoStack: [],
      redoStack: [],
    };

    this.sessions.set(id, session);

    const journal = new JournalWriter(journalStore, "", id);
    await journal.write("session.paused", { action: "created" });

    return id;
  }

  getSession(sessionId: string): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return { sessionId: session.sessionId, status: session.status, planId: session.planId, workflowIds: [...session.workflowIds],
      currentWorkflowId: session.currentWorkflowId, createdAt: session.createdAt, updatedAt: session.updatedAt, metadata: { ...session.metadata } };
  }

  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  deleteSession(sessionId: string): boolean {
    if (this.isActive(sessionId)) throw new Error("Cannot delete a session while execution is active; cancel and drain first.");
    this.journalStores.delete(sessionId);
    this.checkpointStores.delete(sessionId);
    return this.sessions.delete(sessionId);
  }

  async startWorkflow(
    sessionId: string,
    planId: string,
    workflowState: WorkflowState,
    executeTool?: ToolInvocationExecutor,
    options: WorkflowStartOptions = {},
  ): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.workflowEngine?.isRunning()) throw new Error("Session already has an active workflow.");
    const runSignal = this.activeRuns.get(sessionId)?.controller.signal;
    const signal = options.signal && runSignal ? AbortSignal.any([options.signal, runSignal]) : options.signal ?? runSignal;

    const workflowId = options.workflowId ?? createId("wf");
    if (options.durable) {
      if (this.config.executeNode) throw new Error("Durable workflows cannot use a custom node executor.");
      const checkpoint = await this.loadExecution(sessionId, workflowId);
      if (!checkpoint?.recovery || checkpoint.planId !== planId) throw new Error("Durable workflow requires its initialized execution checkpoint.");
      assertRecoveryCheckpoint(checkpoint, checkpoint.recovery.identity);
    }
    const journalStore = this.journalStores.get(sessionId)!;
    const checkpointStore = this.checkpointStores.get(sessionId)!;
    const checkpointManager = new CheckpointManager(checkpointStore);
    const journalWriter = new JournalWriter(journalStore, workflowId, sessionId);

    const engine = new WorkflowEngine(
      {
        ...this.config,
        schedulerConfig: this.config.schedulerConfig,
        defaultRetryPolicy: this.config.defaultRetryPolicy,
        checkpointInterval: this.config.checkpointInterval,
        executeTool: executeTool ?? this.config.executeTool,
        executeNode: options.durable ? undefined : this.config.executeNode,
        onTransition: options.durable ? async state => {
          await this.updateExecution(sessionId, workflowId, checkpoint => ({ ...checkpoint, workflowState: state, nodeResults: state.nodeResults }));
          await this.config.onTransition?.(state);
        } : this.config.onTransition,
      },
      checkpointManager,
      journalWriter,
    );

    const preSnapshot = this.createSnapshot(session);
    session.workflowEngine = engine;
    session.journalWriter = journalWriter;
    session.planId = planId;
    session.currentWorkflowId = workflowId;
    if (!session.workflowIds.includes(workflowId)) session.workflowIds = [...session.workflowIds, workflowId];
    session.status = "running";
    session.updatedAt = now();

    // Checkpoint pre-execution state for undo
    session.undoStack = [...session.undoStack, preSnapshot];
    session.redoStack = [];

    try {
      await engine.start(workflowState.taskGraph, workflowId, sessionId, planId, { ...options, signal });
      void engine.waitForCompletion().then(state => {
        if (session.workflowEngine !== engine || this.activeRuns.has(sessionId)) return;
        session.status = state.status === "cancelled" ? "cancelled" : state.status === "failed" ? "failed" : "completed";
        session.updatedAt = now();
      });
    } catch (error) { session.status = "failed"; throw error; }
    return workflowId;
  }

  async executeWorkflow(sessionId: string, graph: TaskGraph, planId: string, executeTool?: ToolInvocationExecutor, signal?: AbortSignal, options: Omit<WorkflowStartOptions, "signal"> = {}): Promise<WorkflowState> {
    const state: WorkflowState = { workflowId: "", sessionId, planId, status: "created", taskGraph: graph,
      nodeStates: {}, nodeResults: {}, readyQueue: [], runningNodes: [], completedNodes: [], failedNodes: [], skippedNodes: [], progress: 0, errors: [] };
    await this.startWorkflow(sessionId, planId, state, executeTool, { ...options, signal });
    return this.sessions.get(sessionId)!.workflowEngine!.waitForCompletion();
  }

  async run<T>(sessionId: string, callback: (signal: AbortSignal) => Promise<T>, statusForResult?: (result: T) => "completed" | "failed" | "cancelled"): Promise<T> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found: " + sessionId);
    if (this.isActive(sessionId)) throw new Error("Session already has an active execution.");
    const controller = new AbortController();
    const previousWorkflowId = session.currentWorkflowId;
    session.status = "running";
    session.updatedAt = now();
    let failed = false;
    let resultStatus: "completed" | "failed" | "cancelled" | undefined;
    const promise = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return callback(controller.signal); }).then(result => {
      resultStatus = statusForResult?.(result);
      if (resultStatus !== undefined && !["completed", "failed", "cancelled"].includes(resultStatus)) throw new Error("Invalid session result status.");
      return result;
    }).catch(async error => {
      failed = !controller.signal.aborted;
      controller.abort(error);
      await session.workflowEngine?.cancelAndWait();
      throw error;
    }).finally(async () => {
      if (session.workflowEngine?.isRunning()) await session.workflowEngine.waitForCompletion();
      const workflowStatus = previousWorkflowId !== session.currentWorkflowId ? session.workflowEngine?.getWorkflowState()?.status : undefined;
      session.status = failed || resultStatus === "failed" || workflowStatus === "failed" ? "failed"
        : controller.signal.aborted || resultStatus === "cancelled" || workflowStatus === "cancelled" ? "cancelled" : "completed";
      session.updatedAt = now();
      this.activeRuns.delete(sessionId);
    });
    this.activeRuns.set(sessionId, { controller, promise });
    return promise;
  }

  async cancelAndWait(sessionId: string): Promise<void> {
    this.cancelWorkflow(sessionId);
    const run = this.activeRuns.get(sessionId)?.promise;
    const engine = this.sessions.get(sessionId)?.workflowEngine;
    await Promise.allSettled([...(run ? [run] : []), ...(engine?.isRunning() ? [engine.waitForCompletion()] : [])]);
  }

  private isActive(sessionId: string): boolean {
    return this.activeRuns.has(sessionId) || (this.sessions.get(sessionId)?.workflowEngine?.isRunning() ?? false);
  }

  pauseWorkflow(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.workflowEngine?.isRunning()) return;
    session.workflowEngine.pause();
    session.status = "paused";
    session.updatedAt = now();
    void session.journalWriter?.write("session.paused", {}).catch(() => session.workflowEngine?.cancel());
  }

  resumeWorkflow(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.workflowEngine?.isRunning()) return;
    session.workflowEngine.resume();
    session.status = "running";
    session.updatedAt = now();
    void session.journalWriter?.write("session.resumed", {}).catch(() => session.workflowEngine?.cancel());
  }

  cancelWorkflow(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.activeRuns.get(sessionId)?.controller.abort(new Error("Session cancelled."));
    session.workflowEngine?.cancel();
    if (!this.isActive(sessionId)) session.status = "cancelled";
    session.updatedAt = now();
  }

  getWorkflowEngine(sessionId: string): WorkflowEngine | undefined {
    return this.sessions.get(sessionId)?.workflowEngine;
  }

  async snapshot(sessionId: string): Promise<SessionSnapshot> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const snapshot = this.createSnapshot(session);
    session.undoStack = [...session.undoStack, snapshot];
    session.redoStack = [];
    return snapshot;
  }

  async undo(sessionId: string): Promise<boolean> {
    if (this.isActive(sessionId)) throw new Error("Cannot restore session history while execution is active.");
    const session = this.sessions.get(sessionId);
    if (!session || session.undoStack.length === 0) return false;

    const current = this.createSnapshot(session);
    session.redoStack = [...session.redoStack, current];

    const prev = session.undoStack[session.undoStack.length - 1];
    session.undoStack = session.undoStack.slice(0, -1);
    this.restoreSnapshot(session, prev);
    return true;
  }

  async redo(sessionId: string): Promise<boolean> {
    if (this.isActive(sessionId)) throw new Error("Cannot restore session history while execution is active.");
    const session = this.sessions.get(sessionId);
    if (!session || session.redoStack.length === 0) return false;

    const current = this.createSnapshot(session);
    session.undoStack = [...session.undoStack, current];

    const next = session.redoStack[session.redoStack.length - 1];
    session.redoStack = session.redoStack.slice(0, -1);
    this.restoreSnapshot(session, next);
    return true;
  }

  getJournal(sessionId: string): JournalStore | undefined {
    return this.journalStores.get(sessionId);
  }

  getCheckpointStore(sessionId: string): CheckpointStore | undefined {
    return this.checkpointStores.get(sessionId);
  }

  async initializeExecution(sessionId: string, graph: TaskGraph, recovery: ExecutionRecovery): Promise<Checkpoint> {
    const snapshot = structuredClone(recovery);
    const taskGraph = structuredClone(graph);
    return this.queueExecutionUpdate(sessionId, snapshot.identity.workflowId, async store => {
      const identity = snapshot.identity;
      if (identity.sessionId !== sessionId) throw new Error("Execution session identity mismatch.");
      if (await store.load(identity.workflowId)) throw new Error("Execution checkpoint already exists.");
      const workflowState: WorkflowState = { workflowId: identity.workflowId, sessionId, planId: identity.taskId,
        status: "created", taskGraph, nodeStates: {}, nodeResults: {}, readyQueue: [], runningNodes: [], completedNodes: [],
        failedNodes: [], skippedNodes: [], progress: 0, errors: [] };
      const checkpoint: Checkpoint = { id: identity.workflowId, workflowId: identity.workflowId, sessionId, planId: identity.taskId,
        timestamp: now(), workflowState, nodeResults: {}, journalSinceLastCheckpoint: [], metadata: {}, recovery: snapshot };
      assertRecoveryCheckpoint(checkpoint, identity);
      await store.save(checkpoint);
      return structuredClone(checkpoint);
    });
  }

  async loadExecution(sessionId: string, workflowId: string): Promise<Checkpoint | undefined> {
    const store = this.checkpointStores.get(sessionId);
    if (!store) throw new Error(`Session not found: ${sessionId}`);
    await this.executionUpdates.get(JSON.stringify([sessionId, workflowId]))?.catch(() => undefined);
    const checkpoint = await store.load(workflowId);
    if (checkpoint) {
      if (!checkpoint.recovery || checkpoint.sessionId !== sessionId || checkpoint.workflowId !== workflowId) throw new Error("Invalid execution checkpoint.");
      assertRecoveryCheckpoint(checkpoint, checkpoint.recovery.identity);
    }
    return structuredClone(checkpoint);
  }

  async updateExecution(sessionId: string, workflowId: string, mutate: (checkpoint: Checkpoint) => Checkpoint): Promise<Checkpoint> {
    return this.queueExecutionUpdate(sessionId, workflowId, async store => {
      const current = await store.load(workflowId);
      if (!current?.recovery || current.sessionId !== sessionId || current.workflowId !== workflowId) throw new Error("Execution checkpoint not found.");
      assertRecoveryCheckpoint(current, current.recovery.identity);
      const next = structuredClone({ ...mutate(structuredClone(current)), timestamp: now() });
      assertRecoveryCheckpoint(next, current.recovery.identity);
      await store.save(next);
      return structuredClone(next);
    });
  }

  private queueExecutionUpdate<T>(sessionId: string, workflowId: string, operation: (store: CheckpointStore) => Promise<T>): Promise<T> {
    const store = this.checkpointStores.get(sessionId);
    if (!store) return Promise.reject(new Error(`Session not found: ${sessionId}`));
    const key = JSON.stringify([sessionId, workflowId]);
    const update = (this.executionUpdates.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => operation(store));
    this.executionUpdates.set(key, update);
    void update.finally(() => { if (this.executionUpdates.get(key) === update) this.executionUpdates.delete(key); }).catch(() => undefined);
    return update;
  }

  private createSnapshot(session: InternalSessionState): SessionSnapshot {
    return {
      sessionId: session.sessionId,
      timestamp: now(),
      status: session.status,
      planId: session.planId,
      workflowIds: [...session.workflowIds],
      currentWorkflowId: session.currentWorkflowId,
    };
  }

  private restoreSnapshot(session: InternalSessionState, snapshot: SessionSnapshot): void {
    session.status = snapshot.status;
    session.planId = snapshot.planId;
    session.workflowIds = [...snapshot.workflowIds];
    session.currentWorkflowId = snapshot.currentWorkflowId;
    session.updatedAt = now();
  }
}
