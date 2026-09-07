import { type AgentRole, type AgentPriority, type AgentInstance } from "../../organization/types.js";
import { AgentLifecycleManager as OrgLifecycleManager, type OrganizationConfig } from "../../organization/lifecycle.js";
import { AgentRegistry } from "./agent-registry.js";
import { AgentMonitor, type AgentHealthReport } from "./agent-monitor.js";

/**
 * LifecycleManager — quackos.md §8 wrapper exposing the agent lifecycle stages:
 * Create -> Spawn -> Assign -> Monitor -> Evaluate -> Terminate -> Archive.
 * Delegates to the existing organization AgentLifecycleManager.
 */
export class LifecycleManager {
  private readonly monitor: AgentMonitor;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly inner: OrgLifecycleManager,
    config?: Partial<OrganizationConfig>,
  ) {
    this.monitor = new AgentMonitor(registry);
    void config;
  }

  // ── Create / Spawn ───────────────────────────────────────────
  spawn(role: AgentRole, id?: string): AgentInstance | undefined {
    return this.registry.spawn(role, id);
  }

  spawnAll(): AgentInstance[] {
    return this.inner.spawnAllAgents();
  }

  // ── Assign ───────────────────────────────────────────────────
  assign(goal: string, role: AgentRole, priority: AgentPriority = "medium", context?: Record<string, unknown>): string | undefined {
    return this.inner.assignTask(goal, role, priority, context);
  }

  completeTask(taskId: string, durationMs: number): void {
    return this.inner.completeTask(taskId, durationMs);
  }

  failTask(taskId: string, error?: string): void {
    return this.inner.failTask(taskId, error);
  }

  // ── Monitor ──────────────────────────────────────────────────
  monitorAll(): AgentHealthReport[] {
    return this.monitor.checkAll();
  }

  monitorOne(id: string): AgentHealthReport | undefined {
    return this.monitor.checkOne(id);
  }

  getUnhealthy(): readonly AgentHealthReport[] {
    return this.monitor.getUnhealthy();
  }

  getMonitor(): AgentMonitor {
    return this.monitor;
  }

  // ── Evaluate ─────────────────────────────────────────────────
  evaluate(id: string): { tasksCompleted: number; errorRate: number; avgExecutionMs: number } | undefined {
    const agent = this.registry.get(id);
    if (!agent) return undefined;
    return {
      tasksCompleted: agent.metrics.tasksCompleted,
      errorRate: agent.health.errorRate,
      avgExecutionMs: agent.metrics.avgExecutionTimeMs,
    };
  }

  // ── Terminate / Archive ───────────────────────────────────────
  terminate(id: string): boolean {
    return this.registry.terminate(id);
  }

  archive(id: string): boolean {
    return this.registry.archive(id);
  }

  recover(id: string): boolean {
    return this.inner.recoverAgent(id);
  }

  shutdown(id: string): boolean {
    return this.inner.shutdownAgent(id);
  }

  enable(id: string): void {
    return this.inner.enableAgent(id);
  }

  disable(id: string): void {
    return this.inner.disableAgent(id);
  }

  // ── Org-level accessors ───────────────────────────────────────
  checkHealth(): { healthy: AgentInstance[]; unhealthy: AgentInstance[] } {
    return this.inner.checkHealth();
  }

  getBottlenecks(): readonly { agentId: string; role: string; taskCount: number; status: string }[] {
    return this.inner.getBottlenecks();
  }
}
