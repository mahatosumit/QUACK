import { type AgentRole, type AgentPriority } from "../organization/types.js";
import { type AgentRegistry } from "../organization/registry.js";

interface ResourceAllocation {
  agentId: string;
  taskId: string;
  allocatedAt: string;
  estimatedDurationMs: number;
}

interface CapacityPlan {
  role: AgentRole;
  total: number;
  available: number;
  busy: number;
  tasksPerAgent: number;
}

export class ResourceManager {
  private allocations = new Map<string, ResourceAllocation[]>();

  constructor(private registry: AgentRegistry) {}

  getAvailableCapacity(role: AgentRole): number {
    const agents = this.registry.findByRole(role);
    return agents.filter((a) => a.status === "idle" && a.config.enabled).length;
  }

  getCapacityPlan(): CapacityPlan[] {
    const roles = new Set(this.registry.getAll().map((a) => a.role));
    return [...roles].map((role) => {
      const agents = this.registry.findByRole(role);
      return {
        role,
        total: agents.length,
        available: agents.filter((a) => a.status === "idle" && a.config.enabled).length,
        busy: agents.filter((a) => a.status === "busy").length,
        tasksPerAgent: Math.max(...agents.map((a) => a.currentTaskIds.length), 0),
      };
    });
  }

  canAllocate(role: AgentRole, count: number): boolean {
    return this.getAvailableCapacity(role) >= count;
  }

  recordAllocation(agentId: string, taskId: string, estimatedDurationMs: number): void {
    if (!this.allocations.has(agentId)) {
      this.allocations.set(agentId, []);
    }
    this.allocations.get(agentId)!.push({
      agentId, taskId, allocatedAt: new Date().toISOString(), estimatedDurationMs,
    });
  }

  getAgentAllocations(agentId: string): ResourceAllocation[] {
    return this.allocations.get(agentId) ?? [];
  }

  getAllocationStats(): { totalAllocations: number; avgEstimatedMs: number } {
    let total = 0;
    let sum = 0;
    for (const [, allocs] of this.allocations) {
      total += allocs.length;
      sum += allocs.reduce((s, a) => s + a.estimatedDurationMs, 0);
    }
    return { totalAllocations: total, avgEstimatedMs: total > 0 ? sum / total : 0 };
  }

  clear(): void {
    this.allocations.clear();
  }
}
