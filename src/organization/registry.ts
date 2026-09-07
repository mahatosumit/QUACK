import { createId, now } from "../core/types.js";
import { type AgentConfig, type AgentInstance, type AgentMetrics, type AgentProfile, type AgentRole, type AgentHealth, AgentStatus } from "./types.js";

export class AgentRegistry {
  private agents = new Map<string, AgentInstance>();
  private roleIndex = new Map<AgentRole, Set<string>>();

  register(id: string, config: AgentConfig): AgentInstance {
    if (this.agents.has(id)) {
      throw new Error(`Agent '${id}' already registered`);
    }
    const instance: AgentInstance = {
      id,
      role: config.profile.role,
      status: "idle",
      config,
      createdAt: now(),
      lastActiveAt: now(),
      currentTaskIds: [],
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        tasksDelegated: 0,
        avgExecutionTimeMs: 0,
        totalExecutionTimeMs: 0,
        totalTokensUsed: 0,
        communicationCount: 0,
        errorCount: 0,
        uptimeMs: 0,
      },
      health: {
        status: "idle",
        lastHeartbeat: now(),
        memoryUsage: 0,
        activeThreads: 0,
        responseTimeMs: 0,
        errorRate: 0,
      },
    };
    this.agents.set(id, instance);
    if (!this.roleIndex.has(config.profile.role)) {
      this.roleIndex.set(config.profile.role, new Set());
    }
    this.roleIndex.get(config.profile.role)!.add(id);
    return instance;
  }

  get(id: string): AgentInstance | undefined {
    return this.agents.get(id);
  }

  getAll(): AgentInstance[] {
    return [...this.agents.values()];
  }

  findByRole(role: AgentRole): AgentInstance[] {
    const ids = this.roleIndex.get(role);
    if (!ids) return [];
    return [...ids].map((id) => this.agents.get(id)!).filter(Boolean);
  }

  findAvailable(role: AgentRole): AgentInstance | undefined {
    return this.findByRole(role).find((a) => a.status === "idle" && a.config.enabled);
  }

  findBestFit(role: AgentRole, taskType: string): AgentInstance | undefined {
    const candidates = this.findByRole(role).filter((a) => a.config.enabled);
    return candidates
      .filter((a) => a.config.profile.supportedTaskTypes.includes(taskType))
      .sort((a, b) => a.metrics.tasksCompleted - b.metrics.tasksCompleted)[0];
  }

  updateStatus(id: string, status: AgentStatus): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = status;
      agent.lastActiveAt = now();
      agent.health.status = status;
      agent.health.lastHeartbeat = now();
    }
  }

  updateMetrics(id: string, partial: Partial<AgentMetrics>): void {
    const agent = this.agents.get(id);
    if (agent) {
      Object.assign(agent.metrics, partial);
    }
  }

  assignTask(id: string, taskId: string): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.currentTaskIds = [...agent.currentTaskIds, taskId];
      agent.status = "busy";
      agent.lastActiveAt = now();
    }
  }

  completeTask(id: string, taskId: string, durationMs: number): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.currentTaskIds = agent.currentTaskIds.filter((t) => t !== taskId);
      agent.metrics.tasksCompleted++;
      agent.metrics.totalExecutionTimeMs += durationMs;
      agent.metrics.avgExecutionTimeMs = agent.metrics.totalExecutionTimeMs / agent.metrics.tasksCompleted;
      if (agent.currentTaskIds.length === 0) {
        agent.status = "idle";
      }
    }
  }

  failTask(id: string, taskId: string, error?: string): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.currentTaskIds = agent.currentTaskIds.filter((t) => t !== taskId);
      agent.metrics.tasksFailed++;
      agent.metrics.errorCount++;
      agent.metrics.lastError = error;
      if (agent.currentTaskIds.length === 0) {
        agent.status = "idle";
      }
    }
  }

  heartbeat(id: string): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.health.lastHeartbeat = now();
      agent.health.responseTimeMs = 0;
    }
  }

  remove(id: string): boolean {
    const agent = this.agents.get(id);
    if (agent) {
      this.agents.delete(id);
      const roleSet = this.roleIndex.get(agent.role);
      if (roleSet) roleSet.delete(id);
      return true;
    }
    return false;
  }

  count(): number {
    return this.agents.size;
  }

  getByStatus(status: AgentStatus): AgentInstance[] {
    return this.getAll().filter((a) => a.status === status);
  }

  getBusy(): AgentInstance[] {
    return this.getByStatus("busy");
  }

  getIdle(): AgentInstance[] {
    return this.getByStatus("idle");
  }

  clear(): void {
    this.agents.clear();
    this.roleIndex.clear();
  }
}
