import { type AgentInstance, type AgentStatus } from "../../organization/types.js";
import { type AgentRegistry } from "./agent-registry.js";

export interface AgentHealthReport {
  agentId: string;
  role: string;
  status: AgentStatus;
  healthy: boolean;
  issues: string[];
  lastActiveAt: string;
  errorRate: number;
}

/**
 * AgentMonitor — observes agent health and emits reports per quackos.md §8.
 * Read-only; never mutates agent state. Defers recovery to LifecycleManager.
 */
export class AgentMonitor {
  private history: { timestamp: string; reports: AgentHealthReport[] }[] = [];
  private readonly maxHistory = 100;

  constructor(private readonly registry: AgentRegistry, private readonly staleAfterMs = 5 * 60 * 1000) {}

  checkAll(): AgentHealthReport[] {
    const now = Date.now();
    const reports = this.registry.getAll().map((a) => this.buildReport(a, now));
    this.history.push({ timestamp: new Date().toISOString(), reports });
    if (this.history.length > this.maxHistory) this.history.shift();
    return reports;
  }

  checkOne(agentId: string): AgentHealthReport | undefined {
    const agent = this.registry.get(agentId);
    return agent ? this.buildReport(agent, Date.now()) : undefined;
  }

  getUnhealthy(): readonly AgentHealthReport[] {
    return this.checkAll().filter((r) => !r.healthy);
  }

  getHistory(limit = 10): readonly { timestamp: string; reports: AgentHealthReport[] }[] {
    return this.history.slice(-limit);
  }

  private buildReport(agent: AgentInstance, now: number): AgentHealthReport {
    const issues: string[] = [];
    const lastActive = Date.parse(agent.lastActiveAt);
    if (now - lastActive > this.staleAfterMs) issues.push("stale-heartbeat");
    if (agent.status === "error") issues.push("error-state");
    if (agent.status === "offline") issues.push("offline");
    if (agent.status === "terminated") issues.push("terminated");
    if (agent.health.errorRate > 0.2) issues.push("high-error-rate");
    return {
      agentId: agent.id,
      role: agent.role,
      status: agent.status,
      healthy: issues.length === 0,
      issues,
      lastActiveAt: agent.lastActiveAt,
      errorRate: agent.health.errorRate,
    };
  }
}
