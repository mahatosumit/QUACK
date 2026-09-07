import { createId, now, type JsonObject } from "../core/types.js";
import { type ToolInvocation } from "../tools/tool.js";
import { type TaskNode, type TaskGraph, type TaskNodeStatus, type TaskNodeResult, type TaskNodePriority, type RetryPolicy } from "./types.js";

export interface TaskGraphOptions {
  readonly description: string;
  readonly metadata?: JsonObject;
}

export class TaskGraphBuilder {
  private nodes = new Map<string, TaskNode>();
  private edges: { from: string; to: string }[] = [];
  private description: string;
  private metadata: JsonObject;

  constructor(opts: TaskGraphOptions) {
    this.description = opts.description;
    this.metadata = opts.metadata ?? {};
  }

  addNode(id: string, opts: {
    description: string;
    dependencies?: readonly string[];
    resources?: readonly string[];
    priority?: TaskNodePriority;
    tools?: readonly string[];
    toolInvocations?: readonly ToolInvocation[];
    timeoutMs?: number;
    retryPolicy?: RetryPolicy;
  }): this {
    const retryCount = 0;
    this.nodes.set(id, {
      id,
      description: opts.description,
      dependencies: [...(opts.dependencies ?? [])],
      resources: opts.resources ? [...opts.resources] : undefined,
      priority: opts.priority ?? "medium",
      estimatedCost: 1,
      estimatedDurationMs: 30_000,
      requiredTools: [...(opts.tools ?? [])],
      toolInvocations: opts.toolInvocations ? [...opts.toolInvocations] : undefined,
      timeoutMs: opts.timeoutMs ?? 60_000,
      retryPolicy: opts.retryPolicy ?? { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 30_000 },
      status: "pending",
      retryCount,
    });
    if (opts.dependencies) {
      for (const dep of opts.dependencies) {
        this.edges.push({ from: dep, to: id });
      }
    }
    return this;
  }

  addEdge(from: string, to: string): this {
    this.edges.push({ from, to });
    const node = this.nodes.get(to);
    if (node) {
      this.nodes.set(to, { ...node, dependencies: [...node.dependencies, from] });
    }
    return this;
  }

  build(): TaskGraph {
    return {
      id: createId("graph"),
      description: this.description,
      nodes: [...this.nodes.values()],
      edges: [...this.edges],
      createdAt: now(),
      updatedAt: now(),
      metadata: { ...this.metadata },
    };
  }
}

export class TaskGraphExecutor {
  private nodeResults = new Map<string, TaskNodeResult>();
  private nodeStatuses = new Map<string, TaskNodeStatus>();
  private retryCounts = new Map<string, number>();
  private startedAt = new Map<string, string>();
  private completedAt = new Map<string, string>();

  constructor(private readonly graph: TaskGraph) {
    for (const node of graph.nodes) {
      this.nodeStatuses.set(node.id, node.status);
      this.retryCounts.set(node.id, node.retryCount);
      if (node.result) this.nodeResults.set(node.id, structuredClone(node.result));
      if (node.startedAt) this.startedAt.set(node.id, node.startedAt);
      if (node.completedAt) this.completedAt.set(node.id, node.completedAt);
    }
  }

  getReadyNodes(): TaskNode[] {
    return this.getGraph().nodes.filter((node) => {
      if (!["pending", "ready"].includes(this.nodeStatuses.get(node.id)!)) return false;
      return node.dependencies.every((depId) => {
        const status = this.nodeStatuses.get(depId);
        return status === "completed";
      });
    });
  }

  markRunning(nodeId: string): void {
    if (!this.canTransition(nodeId)) return;
    this.nodeStatuses.set(nodeId, "running");
    this.startedAt.set(nodeId, now());
  }

  markCompleted(nodeId: string, result: TaskNodeResult): void {
    if (!this.canTransition(nodeId)) return;
    this.nodeStatuses.set(nodeId, "completed");
    this.nodeResults.set(nodeId, result);
    this.completedAt.set(nodeId, now());
  }

  markFailed(nodeId: string, result: TaskNodeResult): void {
    if (!this.canTransition(nodeId)) return;
    this.nodeStatuses.set(nodeId, "failed");
    this.nodeResults.set(nodeId, result);
    this.completedAt.set(nodeId, now());
  }

  markSkipped(nodeId: string, reason?: string): void {
    if (!this.canTransition(nodeId)) return;
    this.nodeStatuses.set(nodeId, "skipped");
    this.nodeResults.set(nodeId, { success: false, error: reason ?? "Skipped", toolCalls: [], durationMs: 0 });
    this.completedAt.set(nodeId, now());
  }

  markRetrying(nodeId: string): void {
    if (!this.canTransition(nodeId)) return;
    this.nodeStatuses.set(nodeId, "retrying");
  }

  incrementRetry(nodeId: string): void {
    if (!this.canTransition(nodeId)) return;
    this.retryCounts.set(nodeId, (this.retryCounts.get(nodeId) ?? 0) + 1);
  }

  markPaused(nodeId: string): void {
    if (!this.canTransition(nodeId)) return;
    this.nodeStatuses.set(nodeId, "paused");
  }

  markPending(nodeId: string): void {
    if (!this.canTransition(nodeId)) return;
    this.nodeStatuses.set(nodeId, "pending");
  }

  markReady(nodeId: string): void {
    if (!this.canTransition(nodeId)) return;
    if (this.getStatus(nodeId) === "pending") this.nodeStatuses.set(nodeId, "ready");
  }

  markCancelled(nodeId: string, reason = "Workflow cancelled."): void {
    if (!this.canTransition(nodeId)) return;
    this.nodeStatuses.set(nodeId, "cancelled");
    this.nodeResults.set(nodeId, { success: false, error: reason, toolCalls: [], durationMs: 0 });
    this.completedAt.set(nodeId, now());
  }

  private canTransition(nodeId: string): boolean {
    const status = this.nodeStatuses.get(nodeId);
    if (!status) throw new Error(`Unknown task node ${nodeId}.`);
    return !["completed", "failed", "skipped", "cancelled"].includes(status);
  }

  getStatus(nodeId: string): TaskNodeStatus {
    return this.nodeStatuses.get(nodeId) ?? "pending";
  }

  getResult(nodeId: string): TaskNodeResult | undefined {
    return this.nodeResults.get(nodeId);
  }

  getGraph(): TaskGraph {
    const updatedNodes = this.graph.nodes.map((n) => ({
      ...n,
      status: this.nodeStatuses.get(n.id) ?? n.status,
      retryCount: this.retryCounts.get(n.id) ?? n.retryCount,
      result: this.nodeResults.get(n.id),
      startedAt: this.startedAt.get(n.id),
      completedAt: this.completedAt.get(n.id),
    }));
    return { ...this.graph, nodes: updatedNodes, updatedAt: now() };
  }

  isComplete(): boolean {
    return this.graph.nodes.every((n) => {
      const s = this.nodeStatuses.get(n.id);
      return s === "completed" || s === "failed" || s === "skipped" || s === "cancelled";
    });
  }

  isFailed(): boolean {
    return this.graph.nodes.some((n) => this.nodeStatuses.get(n.id) === "failed");
  }

  getProgress(): { completed: number; failed: number; running: number; pending: number; total: number } {
    let completed = 0, failed = 0, running = 0, pending = 0;
    for (const node of this.graph.nodes) {
      const s = this.nodeStatuses.get(node.id) ?? "pending";
      if (s === "completed" || s === "skipped") completed++;
      else if (s === "failed" || s === "cancelled") failed++;
      else if (s === "running" || s === "retrying") running++;
      else pending++;
    }
    return { completed, failed, running, pending, total: this.graph.nodes.length };
  }

  getCriticalPath(): TaskNode[] {
    const depths = new Map<string, number>();
    const calcDepth = (nodeId: string): number => {
      if (depths.has(nodeId)) return depths.get(nodeId)!;
      const node = this.graph.nodes.find((n) => n.id === nodeId);
      if (!node || node.dependencies.length === 0) {
        depths.set(nodeId, 1);
        return 1;
      }
      const d = 1 + Math.max(...node.dependencies.map(calcDepth));
      depths.set(nodeId, d);
      return d;
    };

    const maxDepth = Math.max(...this.graph.nodes.map((n) => calcDepth(n.id)), 0);
    const criticalNodes: TaskNode[] = [];
    let currentDepth = maxDepth;
    let currentId = this.graph.nodes.find((n) => calcDepth(n.id) === maxDepth)?.id;

    while (currentId && currentDepth > 0) {
      const node = this.graph.nodes.find((n) => n.id === currentId);
      if (node) criticalNodes.unshift(node);
      currentDepth--;
      const deps = this.graph.nodes.find((n) => n.id === currentId)?.dependencies ?? [];
      currentId = deps.find((d) => calcDepth(d) === currentDepth);
    }

    return criticalNodes;
  }
}
