import { now, type JsonObject, type JsonValue } from "../core/types.js";
import { type ModelRuntime } from "../models/runtime.js";
import { type ToolInvocationExecutor, type ToolInvocationOutcome, type ToolInvocationExecutionContext } from "../tools/tool.js";
import { type WorkflowState, type WorkflowStatus, type TaskGraph, type TaskNode, type TaskNodeResult, type SchedulerConfig, type RetryPolicy } from "./types.js";
import { TaskGraphExecutor } from "./task-graph.js";
import { ExecutionScheduler } from "./scheduler.js";
import { ReflectionEngine } from "./reflection-engine.js";
import { RecoveryEngine } from "./recovery-engine.js";
import { CheckpointManager } from "./checkpoint-system.js";
import { JournalWriter } from "./execution-journal.js";

export interface WorkflowNodeExecutionContext extends ToolInvocationExecutionContext {
  readonly workflowId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly nodeId: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
  readonly deadline: string;
}
export interface WorkflowStartOptions {
  readonly workflowId?: string;
  readonly durable?: boolean;
  readonly signal?: AbortSignal;
  readonly deadline?: string;
  readonly maxParallelNodes?: number;
}
export interface WorkflowEngineConfig {
  readonly schedulerConfig: SchedulerConfig;
  readonly defaultRetryPolicy: RetryPolicy;
  readonly checkpointInterval: number;
  readonly executeTool?: ToolInvocationExecutor;
  /** Trusted host adapter; all effects must still use the governed runtime callback. */
  readonly executeNode?: (node: TaskNode, context: WorkflowNodeExecutionContext) => Promise<TaskNodeResult>;
  readonly onTransition?: (state: WorkflowState) => Promise<void> | void;
  readonly modelRuntime?: Pick<ModelRuntime, "selectModel">;
}

/** Owns all DAG operations until they settle, including after cancellation. */
export class WorkflowEngine {
  private executor?: TaskGraphExecutor;
  private scheduler?: ExecutionScheduler;
  private readonly reflection: ReflectionEngine;
  private readonly recovery = new RecoveryEngine();
  private readonly active = new Map<string, Promise<void>>();
  private controller?: AbortController;
  private completion?: Promise<WorkflowState>;
  private workflow?: WorkflowState;
  private running = false;
  private paused = false;
  private cancelled = false;
  private fatalError?: string;
  private terminalStatus?: WorkflowStatus;
  private wake?: () => void;
  private transitions: Promise<void> = Promise.resolve();
  private options: WorkflowStartOptions = {};
  private currentWorkflowId = "";
  private currentSessionId = "";
  private currentPlanId = "";

  constructor(
    private readonly config: WorkflowEngineConfig,
    private readonly checkpointManager: CheckpointManager,
    private readonly journal: JournalWriter,
  ) { this.reflection = new ReflectionEngine(config.modelRuntime); }

  async start(graph: TaskGraph, workflowId: string, sessionId: string, planId: string, options: WorkflowStartOptions = {}): Promise<WorkflowState> {
    if (this.running) throw new Error("Workflow engine already has an active execution.");
    validateWorkflowGraph(graph);
    if (options.deadline && !Number.isFinite(Date.parse(options.deadline))) throw new Error("Workflow deadline is invalid.");
    if (options.maxParallelNodes !== undefined && (!Number.isInteger(options.maxParallelNodes) || options.maxParallelNodes < 1)) throw new Error("maxParallelNodes must be a positive integer.");
    this.scheduler = new ExecutionScheduler({ ...this.config.schedulerConfig,
      maxParallelNodes: Math.min(this.config.schedulerConfig.maxParallelNodes, options.maxParallelNodes ?? this.config.schedulerConfig.maxParallelNodes) });
    this.executor = new TaskGraphExecutor(structuredClone(graph));
    this.controller = new AbortController();
    this.running = true;
    this.paused = this.cancelled = false;
    this.fatalError = this.terminalStatus = undefined;
    this.transitions = Promise.resolve();
    this.options = options;
    this.currentWorkflowId = workflowId;
    this.currentSessionId = sessionId;
    this.currentPlanId = planId;
    this.workflow = { workflowId, planId, sessionId, status: "running", taskGraph: structuredClone(graph),
      nodeStates: {}, nodeResults: {}, readyQueue: [], runningNodes: [], completedNodes: [],
      failedNodes: [], skippedNodes: [], startTime: now(), progress: 0, errors: [] };
    const abort = () => this.cancel();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted || (options.deadline && Date.parse(options.deadline) <= Date.now())) this.cancel();
    const deadlineTimer = options.deadline ? setTimeout(abort, Math.max(0, Date.parse(options.deadline) - Date.now())) : undefined;
    this.completion = this.executeLoop().finally(() => {
      this.running = false;
      options.signal?.removeEventListener("abort", abort);
      if (deadlineTimer) clearTimeout(deadlineTimer);
    });
    return this.getWorkflowState()!;
  }

  waitForCompletion(): Promise<WorkflowState> {
    if (!this.completion) return Promise.reject(new Error("Workflow has not started."));
    return this.completion;
  }
  async cancelAndWait(): Promise<WorkflowState | undefined> { this.cancel(); return this.completion; }
  pause(): void { if (this.running) this.paused = true; }
  resume(): void { this.paused = false; this.wake?.(); }
  cancel(): void {
    if (!this.running) return;
    this.cancelled = true;
    this.paused = false;
    this.controller?.abort(new Error("Workflow cancelled; active operations must drain."));
    this.wake?.();
  }
  isPaused(): boolean { return this.paused; }
  isCancelled(): boolean { return this.cancelled; }
  isRunning(): boolean { return this.running; }

  getWorkflowState(): WorkflowState | undefined {
    if (!this.executor || !this.workflow) return undefined;
    const graph = this.executor.getGraph();
    const terminal = graph.nodes.filter(node => ["completed", "failed", "skipped", "cancelled"].includes(node.status)).length;
    return structuredClone({ ...this.workflow, status: this.terminalStatus ?? (this.paused ? "paused" : "running"), taskGraph: graph,
      nodeStates: Object.fromEntries(graph.nodes.map(node => [node.id, node.status])),
      nodeResults: Object.fromEntries(graph.nodes.filter(node => node.result).map(node => [node.id, node.result!])),
      readyQueue: graph.nodes.filter(node => node.status === "ready").map(node => node.id),
      runningNodes: graph.nodes.filter(node => node.status === "running" || node.status === "retrying").map(node => node.id),
      completedNodes: graph.nodes.filter(node => node.status === "completed").map(node => node.id),
      failedNodes: graph.nodes.filter(node => node.status === "failed").map(node => node.id),
      skippedNodes: graph.nodes.filter(node => node.status === "skipped").map(node => node.id),
      progress: graph.nodes.length ? terminal / graph.nodes.length : 1 });
  }

  private async executeLoop(): Promise<WorkflowState> {
    try {
      await this.journal.write("graph.built", { nodeCount: this.executor!.getGraph().nodes.length });
      await this.journal.write("workflow.started", { graphId: this.executor!.getGraph().id });
      await this.publish();
      while (!this.executor!.isComplete() || this.active.size > 0) {
        if (this.fatalError) throw new Error(this.fatalError);
        if (this.controller!.signal.aborted) this.cancelPending();
        else if (!this.paused) {
          await this.skipBlockedNodes();
          const ready = this.executor!.getReadyNodes();
          this.scheduler!.enqueue(ready);
          for (const node of ready) this.executor!.markReady(node.id);
          while (!this.controller!.signal.aborted && !this.paused && this.scheduler!.canAccept()) {
            const node = this.scheduler!.dequeue();
            if (!node) break;
            const operation = this.executeNode(node).catch(error => {
              this.fatalError ??= errorMessage(error);
              this.controller!.abort(error);
              this.executor!.markFailed(node.id, failedResult(error, 0));
            }).finally(() => {
              const state = this.executor!.getStatus(node.id);
              if (state === "cancelled" || state === "skipped") this.scheduler!.skip(node.id);
              else this.scheduler!.complete(node.id, this.executor!.getResult(node.id) ?? failedResult("Operation did not settle.", 0));
              this.active.delete(node.id);
              this.wake?.();
            });
            this.active.set(node.id, operation);
          }
        }
        if (this.executor!.isComplete() && this.active.size === 0) break;
        if (!this.paused && !this.controller!.signal.aborted && this.active.size === 0) throw new Error("Workflow graph cannot make progress.");
        await this.checkpointIfDue();
        if (this.fatalError || (!this.active.size && !this.paused)) continue;
        await new Promise<void>(resolve => { this.wake = resolve; });
        this.wake = undefined;
      }
    } catch (error) {
      this.fatalError ??= errorMessage(error);
      this.controller!.abort(error);
      this.cancelPending();
    } finally {
      await Promise.allSettled(this.active.values());
      this.cancelPending();
      this.terminalStatus = this.fatalError ? "failed" : this.cancelled ? "cancelled" : this.executor!.isFailed() ? "failed" : "completed";
      if (this.fatalError) this.workflow!.errors.push(this.fatalError);
      this.workflow = { ...this.workflow!, endTime: now() };
      try {
        if (!this.options.durable) await this.checkpointManager.create(this.currentWorkflowId, this.currentSessionId, this.currentPlanId, this.getWorkflowState()!, {}, []);
        await this.journal.write("workflow.completed", { status: this.terminalStatus });
        await this.publish();
      } catch (error) {
        this.terminalStatus = "failed";
        this.workflow!.errors.push(errorMessage(error));
      }
    }
    return this.getWorkflowState()!;
  }

  private async executeNode(initial: TaskNode): Promise<void> {
    let node = initial;
    for (;;) {
      if (this.controller!.signal.aborted) { this.executor!.markCancelled(node.id); return; }
      this.executor!.markRunning(node.id);
      await this.journal.write("node.started", { nodeId: node.id, attempt: node.retryCount + 1 }, node.id);
      await this.publish();
      const started = Date.now();
      const controller = new AbortController();
      const signal = AbortSignal.any([this.controller!.signal, controller.signal]);
      const deadline = Math.min(started + node.timeoutMs, this.options.deadline ? Date.parse(this.options.deadline) : Infinity);
      const context: WorkflowNodeExecutionContext = { workflowId: this.currentWorkflowId, sessionId: this.currentSessionId,
        planId: this.currentPlanId, nodeId: node.id, taskId: this.currentPlanId || node.id, actor: "workflow",
        attempt: node.retryCount + 1, signal, deadline: new Date(deadline).toISOString() };
      const timer = setTimeout(() => controller.abort(new Error("Node timed out after " + node.timeoutMs + "ms.")), Math.max(0, deadline - Date.now()));
      let result: TaskNodeResult;
      try {
        if (deadline <= Date.now()) controller.abort(new Error("Node execution deadline expired."));
        signal.throwIfAborted();
        result = await this.executeNodeWork(node, started, context);
        if (signal.aborted) result = { ...result, success: false, error: errorMessage(signal.reason) };
      } catch (error) { result = failedResult(error, Date.now() - started); }
      finally { clearTimeout(timer); }
      if (this.controller!.signal.aborted) {
        this.executor!.markCancelled(node.id, result.error ?? "Workflow cancelled after active operation drained.");
        await this.publish();
        return;
      }
      const reflection = this.reflection.reflect(node, result, Date.now() - started);
      await this.journal.write("reflection.completed", { nodeId: node.id, verdict: reflection.verdict }, node.id);
      if (this.controller!.signal.aborted) { this.executor!.markCancelled(node.id); await this.publish(); return; }
      const recovery = !result.success ? this.recovery.buildRecoveryPlan(node, result) : undefined;
      if (recovery && recovery.action !== "escalate") {
        this.executor!.markRetrying(node.id);
        await this.journal.write("recovery.started", { nodeId: node.id, retryCount: recovery.retryCount, backoffDelayMs: recovery.backoffDelayMs }, node.id);
        await this.publish();
        await abortableDelay(recovery.backoffDelayMs, this.controller!.signal);
        if (this.controller!.signal.aborted) { this.executor!.markCancelled(node.id); return; }
        this.executor!.incrementRetry(node.id);
        node = this.executor!.getGraph().nodes.find(candidate => candidate.id === node.id)!;
        continue;
      }
      if (result.success) this.executor!.markCompleted(node.id, result);
      else this.executor!.markFailed(node.id, result);
      await this.journal.write(result.success ? "node.completed" : "node.failed", { nodeId: node.id, error: result.error ?? null }, node.id);
      await this.publish();
      return;
    }
  }

  private cancelPending(): void {
    if (!this.controller!.signal.aborted) return;
    for (const node of this.executor!.getGraph().nodes) {
      if (!this.active.has(node.id)) { this.executor!.markCancelled(node.id); this.scheduler!.release(node.id); }
    }
  }

  private async publish(): Promise<void> {
    if (!this.config.onTransition) return;
    const snapshot = this.getWorkflowState()!;
    this.transitions = this.transitions.then(() => this.config.onTransition!(snapshot));
    await this.transitions;
  }

  private async checkpointIfDue(): Promise<void> {
    if (this.options.durable) return;
    if (this.config.checkpointInterval <= 0) return;
    const latest = await this.checkpointManager.getLatest(this.currentWorkflowId);
    if (!latest || Date.now() - Date.parse(latest.timestamp) >= this.config.checkpointInterval) {
      await this.checkpointManager.create(this.currentWorkflowId, this.currentSessionId, this.currentPlanId, this.getWorkflowState()!, {}, []);
    }
  }

  private async executeNodeWork(node: TaskNode, nodeStartTime: number, context: WorkflowNodeExecutionContext): Promise<TaskNodeResult> {
    context.signal.throwIfAborted();
    if (this.config.executeNode) return this.config.executeNode(structuredClone(node), context);
    const invocations = node.toolInvocations ?? [];

    if (invocations.length === 0 && node.requiredTools.length > 0) {
      return {
        success: false,
        error: "Node declares required tools but no executable toolInvocations.",
        toolCalls: [],
        durationMs: Date.now() - nodeStartTime,
      };
    }

    if (invocations.length === 0) {
      return {
        success: true,
        output: { status: "completed" },
        toolCalls: [],
        durationMs: Date.now() - nodeStartTime,
      };
    }

    if (!this.config.executeTool) {
      return {
        success: false,
        error: "No tool executor is configured for workflow node execution.",
        toolCalls: [],
        durationMs: Date.now() - nodeStartTime,
      };
    }

    const outcomes: ToolInvocationOutcome[] = [];

    for (const [invocationIndex, invocation] of invocations.entries()) {
      context.signal.throwIfAborted();
      if (!node.requiredTools.includes(invocation.toolId)) {
        return {
          success: false,
          error: `Tool invocation ${invocation.toolId} is not declared in requiredTools for node ${node.id}.`,
          toolCalls: [],
          durationMs: Date.now() - nodeStartTime,
        };
      }

      const input = this.resolveInvocationInput(node, invocation.input);
      await this.journal.write("tool.invoked", {
        toolId: invocation.toolId,
        input,
        reason: invocation.reason ?? null,
      }, node.id);

      context.signal.throwIfAborted();
      const outcome = await this.config.executeTool(
        { ...invocation, input },
        {
          ...context,
          invocationIndex,
        },
      );

      outcomes.push(outcome);
      await this.journal.write("tool.completed", {
        toolId: outcome.toolId,
        success: outcome.success,
        output: outcome.output ?? null,
      }, node.id, undefined, outcome.error);

      if (!outcome.success) {
        return {
          success: false,
          error: outcome.error ?? `Tool ${outcome.toolId} failed.`,
          output: { toolResults: outcomes.map((o) => this.outcomeToJson(o)) },
          toolCalls: outcomes.map((o) => o.toolId),
          durationMs: Date.now() - nodeStartTime,
        };
      }
    }

    const last = outcomes[outcomes.length - 1];
    return {
      success: true,
      output: {
        toolResults: outcomes.map((o) => this.outcomeToJson(o)),
        lastToolOutput: last?.output ?? null,
      },
      toolCalls: outcomes.map((o) => o.toolId),
      durationMs: Date.now() - nodeStartTime,
    };
  }

  private resolveInvocationInput(node: TaskNode, input: JsonObject): JsonObject {
    const resolved = this.resolveJsonValue(node, input);
    if (!isJsonObject(resolved)) {
      throw new Error("Resolved tool input must be a JSON object.");
    }
    return resolved;
  }

  private resolveJsonValue(node: TaskNode, value: JsonValue): JsonValue {
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveJsonValue(node, item));
    }

    if (!isJsonObject(value)) {
      return value;
    }

    if ("$fromNode" in value && !this.isNodeOutputBinding(value)) {
      throw new Error("$fromNode binding requires string $fromNode and optional string path.");
    }

    if (this.isNodeOutputBinding(value)) {
      return this.resolveNodeOutputBinding(node, value);
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, this.resolveJsonValue(node, nested)]),
    ) as JsonObject;
  }

  private isNodeOutputBinding(value: JsonObject): value is JsonObject & { readonly $fromNode: string; readonly path?: string } {
    const allowedKeys = new Set(["$fromNode", "path"]);
    return Object.keys(value).every((key) => allowedKeys.has(key))
      && typeof value["$fromNode"] === "string"
      && (!("path" in value) || typeof value["path"] === "string");
  }

  private resolveNodeOutputBinding(node: TaskNode, binding: { readonly $fromNode: string; readonly path?: string }): JsonValue {
    if (!node.dependencies.includes(binding.$fromNode)) {
      throw new Error(`Node ${node.id} cannot bind from ${binding.$fromNode}; it is not a declared dependency.`);
    }

    const upstreamStatus = this.executor?.getStatus(binding.$fromNode);
    if (upstreamStatus !== "completed") {
      throw new Error(`Cannot bind from node ${binding.$fromNode}; dependency status is ${upstreamStatus ?? "missing"}.`);
    }

    const result = this.executor?.getResult(binding.$fromNode);
    if (!result) {
      throw new Error(`Cannot resolve output from node ${binding.$fromNode}; node result is missing.`);
    }
    if (!result.success) {
      throw new Error(`Cannot bind from node ${binding.$fromNode}; dependency did not succeed.`);
    }

    const source: JsonObject = {
      success: result.success,
      output: result.output ?? null,
      error: result.error ?? null,
      toolCalls: result.toolCalls,
      durationMs: result.durationMs,
    };
    return cloneJsonValue(this.readPath(source, binding.path ?? "output"));
  }

  private readPath(source: JsonValue, path: string): JsonValue {
    if (path.trim() === "") return source;
    let current: JsonValue | undefined = source;
    for (const part of path.split(".")) {
      if (Array.isArray(current)) {
        const index = Number(part);
        current = Number.isInteger(index) ? current[index] : undefined;
      } else if (isJsonObject(current)) {
        current = current[part];
      } else {
        current = undefined;
      }

      if (current === undefined) {
        throw new Error(`Cannot resolve node output path "${path}".`);
      }
    }
    return current;
  }

  private outcomeToJson(outcome: ToolInvocationOutcome): JsonObject {
    return {
      toolId: outcome.toolId,
      success: outcome.success,
      output: outcome.output ?? null,
      error: outcome.error ?? null,
    };
  }


  private async skipBlockedNodes(): Promise<void> {
    for (const node of this.executor!.getGraph().nodes) {
      if (node.status !== "pending") continue;
      const blocked = node.dependencies.filter(id => ["failed", "cancelled", "skipped"].includes(this.executor!.getStatus(id)));
      if (!blocked.length) continue;
      const reason = "Skipped because dependency node(s) did not complete: " + blocked.join(", ");
      this.executor!.markSkipped(node.id, reason);
      this.scheduler!.skip(node.id);
      await this.journal.write("node.skipped", { nodeId: node.id, reason }, node.id);
    }
  }
}

function validateWorkflowGraph(graph: TaskGraph): void {
  const nodes = new Map<string, TaskNode>();
  for (const node of graph.nodes) {
    if (!node.id.trim() || nodes.has(node.id)) throw new Error("Workflow graph contains an empty or duplicate node ID.");
    if (!["low", "medium", "high", "critical"].includes(node.priority)) throw new Error("Node priority is invalid.");
    if (!["pending", "ready", "running", "retrying", "paused", "completed", "failed", "skipped", "cancelled"].includes(node.status)) throw new Error("Node status is invalid.");
    if (!Number.isFinite(node.timeoutMs) || node.timeoutMs <= 0) throw new Error("Node timeout must be positive and finite.");
    if (!Number.isInteger(node.retryPolicy.maxRetries) || node.retryPolicy.maxRetries < 0
      || !Number.isInteger(node.retryCount) || node.retryCount < 0
      || [node.retryPolicy.baseDelayMs, node.retryPolicy.maxDelayMs].some(value => !Number.isFinite(value) || value < 0)) throw new Error("Node retry policy is invalid.");
    if (!["fixed", "linear", "exponential", "jitter"].includes(node.retryPolicy.backoff)) throw new Error("Node retry backoff is invalid.");
    if (node.resources && (!Array.isArray(node.resources) || node.resources.some(resource => typeof resource !== "string" || !resource.trim()))) throw new Error("Node resource identifiers must be non-empty strings.");
    if (["running", "retrying", "paused"].includes(node.status)) throw new Error("Active graph states cannot be replayed without recovery authorization.");
    nodes.set(node.id, node);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Workflow task graph contains a cycle.");
    if (visited.has(id)) return;
    const node = nodes.get(id);
    if (!node) throw new Error("Workflow task graph has a missing dependency: " + id);
    visiting.add(id);
    for (const dependency of node.dependencies) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const id of nodes.keys()) visit(id);
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function failedResult(error: unknown, durationMs: number): TaskNodeResult { return { success: false, error: errorMessage(error), toolCalls: [], durationMs }; }
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms === 0) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
function isJsonObject(value: JsonValue | undefined): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function cloneJsonValue(value: JsonValue): JsonValue { return structuredClone(value); }
