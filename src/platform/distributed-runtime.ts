import { now } from "../core/types.js";
import type { ClusterConfig, ClusterNode, NodeAdvert, NodeStatus, NodeRole, DistributedTask, HealthCheckResult, NodeCapability } from "./types.js";

const DEFAULT_CONFIG: ClusterConfig = {
  nodeId: "",
  nodeName: "local",
  role: "leader",
  port: 9876,
  discoveryMethod: "udp",
  heartbeatIntervalMs: 5000,
  heartbeatTimeoutMs: 15000,
  maxNodes: 100,
  autoJoin: true,
};

export class DistributedRuntime {
  private config: ClusterConfig;
  private nodes: Map<string, ClusterNode> = new Map();
  private tasks: Map<string, DistributedTask> = new Map();
  private healthHistory: Map<string, HealthCheckResult[]> = new Map();
  private heartBeatTimer: ReturnType<typeof setInterval> | null = null;
  private localNodeId: string;

  constructor(config?: Partial<ClusterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.localNodeId = config?.nodeId ?? createId();
  }

  getLocalNodeId(): string {
    return this.localNodeId;
  }

  async initialize(): Promise<void> {
    // No node is advertised until the caller supplies an observed NodeAdvert.
  }

  async shutdown(): Promise<void> {
    if (this.heartBeatTimer) {
      clearInterval(this.heartBeatTimer);
      this.heartBeatTimer = null;
    }
    const node = this.nodes.get(this.localNodeId);
    if (node) node.status = "offline";
  }

  discoverNodes(): ClusterNode[] {
    return Array.from(this.nodes.values());
  }

  registerNode(advert: NodeAdvert): string {
    const node: ClusterNode = {
      id: advert.nodeId,
      name: advert.nodeName,
      role: "worker",
      status: "online",
      advert,
      tasks: 0, maxTasks: 20,
      heartbeatIntervalMs: 5000,
      lastHeartbeat: now(), createdAt: now(),
    };
    this.nodes.set(advert.nodeId, node);
    return advert.nodeId;
  }

  unregisterNode(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    node.status = "offline";
    return true;
  }

  getNode(nodeId: string): ClusterNode | undefined {
    return this.nodes.get(nodeId);
  }

  getAllNodes(): ClusterNode[] {
    return Array.from(this.nodes.values());
  }

  getOnlineNodes(): ClusterNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.status === "online" && n.advert.availability === "available");
  }

  submitTask(taskDef: Omit<DistributedTask, "id" | "status" | "createdAt" | "retryCount" | "maxRetries">): string {
    const id = createId();
    const task: DistributedTask = {
      id,
      type: taskDef.type,
      payload: taskDef.payload,
      requiredCapabilities: taskDef.requiredCapabilities,
      preferredNode: taskDef.preferredNode,
      assignedTo: taskDef.assignedTo,
      status: "pending",
      priority: taskDef.priority,
      createdAt: now(),
      startedAt: taskDef.startedAt,
      completedAt: taskDef.completedAt,
      result: taskDef.result,
      error: taskDef.error,
      retryCount: 0,
      maxRetries: 3,
    };
    this.tasks.set(id, task);
    return id;
  }

  assignTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "pending") return false;
    const nodes = this.getOnlineNodes().filter((n) => n.tasks < n.maxTasks);
    if (nodes.length === 0) return false;
    const selected = task.preferredNode ? nodes.find((n) => n.id === task.preferredNode) : null;
    const node = selected ?? nodes.reduce((best, n) => n.tasks < best.tasks ? n : best, nodes[0]!);
    task.assignedTo = node.id;
    task.status = "assigned";
    task.startedAt = now();
    node.tasks++;
    return true;
  }

  completeTask(taskId: string, result: unknown): boolean {
    const task = this.tasks.get(taskId);
    if (!task || (task.status !== "assigned" && task.status !== "running")) return false;
    task.status = "completed";
    task.completedAt = now();
    task.result = result;
    return true;
  }

  failTask(taskId: string, error: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.status = "failed";
    task.error = error;
    task.completedAt = now();
    return true;
  }

  getTask(taskId: string): DistributedTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): DistributedTask[] {
    return Array.from(this.tasks.values());
  }

  getPendingTasks(): DistributedTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === "pending" || t.status === "assigned");
  }

  getNodeTasks(nodeId: string): DistributedTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.assignedTo === nodeId);
  }

  performHealthCheck(nodeId: string): HealthCheckResult {
    throw new Error("Distributed health checks are unsupported: no node transport is configured.");
  }

  getHealthHistory(nodeId: string): HealthCheckResult[] {
    return this.healthHistory.get(nodeId) ?? [];
  }

  getClusterStats() {
    const allTasks = Array.from(this.tasks.values());
    return {
      totalNodes: this.nodes.size,
      onlineNodes: this.getOnlineNodes().length,
      totalTasks: allTasks.length,
      pendingTasks: allTasks.filter((t) => t.status === "pending").length,
      runningTasks: allTasks.filter((t) => t.status === "assigned" || t.status === "running").length,
      completedTasks: allTasks.filter((t) => t.status === "completed").length,
      failedTasks: allTasks.filter((t) => t.status === "failed").length,
    };
  }

  private getDefaultCapabilities(): NodeCapability[] {
    return [];
  }
}

function createId(): string {
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
