import { type CapabilityInventory } from "./types.js";
import { type AgentRegistry } from "../organization/registry.js";

export class CapabilityManager {
  private inventories = new Map<string, CapabilityInventory>();

  constructor(private registry: AgentRegistry) {}

  buildInventory(agentId: string): CapabilityInventory | undefined {
    const agent = this.registry.get(agentId);
    if (!agent) return undefined;
    const inventory: CapabilityInventory = {
      agentId,
      role: agent.role,
      capabilities: agent.config.profile.capabilities.map((c) => c.id),
      skillProficiencies: [],
      modelPreferences: [],
      performance: {
        avgExecutionMs: agent.metrics.avgExecutionTimeMs,
        successRate: agent.metrics.tasksCompleted > 0
          ? agent.metrics.tasksCompleted / (agent.metrics.tasksCompleted + agent.metrics.tasksFailed)
          : 1,
        tasksCompleted: agent.metrics.tasksCompleted,
      },
    };
    this.inventories.set(agentId, inventory);
    return inventory;
  }

  getInventory(agentId: string): CapabilityInventory | undefined {
    return this.inventories.get(agentId);
  }

  getAllInventories(): CapabilityInventory[] {
    return [...this.inventories.values()];
  }

  buildAll(): CapabilityInventory[] {
    this.inventories.clear();
    for (const agent of this.registry.getAll()) {
      this.buildInventory(agent.id);
    }
    return this.getAllInventories();
  }

  findAgentsWithCapability(capabilityId: string): CapabilityInventory[] {
    return this.getAllInventories().filter((i) => i.capabilities.includes(capabilityId));
  }

  getGaps(): { capabilityId: string; name: string; description: string; agentsWithIt: number }[] {
    const agents = this.registry.getAll();
    const allCaps = new Map<string, { name: string; description: string; count: number }>();
    for (const agent of agents) {
      for (const cap of agent.config.profile.capabilities) {
        const existing = allCaps.get(cap.id) ?? { name: cap.name, description: cap.description, count: 0 };
        existing.count++;
        allCaps.set(cap.id, existing);
      }
    }
    return [...allCaps.entries()]
      .filter(([, info]) => info.count < agents.length)
      .map(([id, info]) => ({ capabilityId: id, ...info, agentsWithIt: info.count }));
  }

  clear(): void {
    this.inventories.clear();
  }
}
