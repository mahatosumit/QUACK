import { createId, now, type QuackResult, ok, fail } from "../core/types.js";
import { type EventBus } from "../events/event-bus.js";
import { type AgentConfig, type AgentInstance, type AgentRole, type AgentStatus, type AgentPriority, type WorkflowPlan, type WorkflowStep, type TaskAssignment, AgentStatus as AS } from "./types.js";
import { AgentRegistry } from "./registry.js";
import { AgentCommunicationBus } from "./communication.js";
import { OrganizationalMemory } from "./memory.js";
import { AgentMetricsCollector } from "./metrics.js";
import { defaultAgentConfig } from "./profiles.js";

export interface OrganizationConfig {
  readonly maxWorkflows: number;
  readonly maxTasksPerAgent: number;
  readonly autoStartProjectManager: boolean;
  readonly defaultPriority: AgentPriority;
}

const DEFAULT_ORG_CONFIG: OrganizationConfig = {
  maxWorkflows: 50,
  maxTasksPerAgent: 10,
  autoStartProjectManager: true,
  defaultPriority: "medium",
};

export class AgentLifecycleManager {
  private workflows = new Map<string, WorkflowPlan>();
  private assignments = new Map<string, TaskAssignment>();
  private config: OrganizationConfig;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly comms: AgentCommunicationBus,
    private readonly memory: OrganizationalMemory,
    private readonly metrics: AgentMetricsCollector,
    private readonly eventBus?: EventBus,
    config?: Partial<OrganizationConfig>,
  ) {
    this.config = { ...DEFAULT_ORG_CONFIG, ...config };
  }

  // ── Agent Lifecycle ───────────────────────────────────────────

  spawnAgent(role: AgentRole, customId?: string): AgentInstance | undefined {
    const agentConfig = defaultAgentConfig(role);
    if (!agentConfig) return undefined;
    const id = customId ?? createId(role);
    const instance = this.registry.register(id, agentConfig);
    this.eventBus?.emit("task.created", { action: "spawn", role, agentId: id }, { actor: "organization" });
    return instance;
  }

  spawnAllAgents(): AgentInstance[] {
    const roles: AgentRole[] = [
      "executive-brain", "project-manager", "architect", "planner",
      "software-engineer", "debugger", "reviewer", "tester",
      "documentation-engineer", "research-engineer", "security-engineer",
      "performance-engineer", "devops-engineer", "release-engineer",
      "ui-ux-engineer", "plugin-engineer", "memory-curator", "knowledge-engineer",
    ];
    return roles.map((role) => this.spawnAgent(role)).filter((a): a is AgentInstance => a !== undefined);
  }

  shutdownAgent(id: string): boolean {
    const agent = this.registry.get(id);
    if (!agent) return false;
    if (agent.currentTaskIds.length > 0) {
      this.registry.updateStatus(id, "terminated");
      for (const taskId of agent.currentTaskIds) {
        this.reassignTask(taskId);
      }
    }
    this.registry.remove(id);
    this.eventBus?.emit("task.created", { action: "shutdown", agentId: id }, { actor: "organization" });
    return true;
  }

  enableAgent(id: string): void {
    const agent = this.registry.get(id);
    if (agent) {
      (agent.config as { enabled: boolean }).enabled = true;
    }
  }

  disableAgent(id: string): void {
    const agent = this.registry.get(id);
    if (agent) {
      (agent.config as { enabled: boolean }).enabled = false;
      if (agent.status === "idle") {
        this.registry.updateStatus(id, "offline");
      }
    }
  }

  // ── Task Assignment ───────────────────────────────────────────

  assignTask(goal: string, role: AgentRole, priority: AgentPriority = "medium", context?: Record<string, unknown>): string | undefined {
    const agent = this.registry.findAvailable(role);
    if (!agent) return undefined;

    const taskId = createId("task");
    const assignment: TaskAssignment = {
      taskId,
      assignedTo: agent.id,
      assignedBy: "organization",
      goal,
      priority,
      dependencies: [],
      context,
      status: "assigned",
      assignedAt: now(),
    };
    this.assignments.set(taskId, assignment);
    this.registry.assignTask(agent.id, taskId);
    this.registry.updateStatus(agent.id, "busy");

    this.comms.delegate("organization", agent.id, taskId, goal, { priority, ...context });

    this.eventBus?.emit("task.created", { action: "assign", taskId, agentId: agent.id, role, goal }, { actor: "organization" });
    this.memory.record({ type: "decision", tags: ["assignment", role], agents: [agent.id], content: `Assigned ${goal} to ${agent.id}` });

    return taskId;
  }

  completeTask(taskId: string, durationMs: number): void {
    const assignment = this.assignments.get(taskId);
    if (!assignment) return;
    assignment.status = "completed";
    assignment.completedAt = now();
    this.registry.completeTask(assignment.assignedTo, taskId, durationMs);
    this.metrics.recordSnapshot(assignment.assignedTo, this.registry.get(assignment.assignedTo)?.metrics ?? this.emptyMetrics());
    this.memory.recordSuccess([assignment.assignedTo], `Completed: ${assignment.goal}`);
  }

  failTask(taskId: string, error?: string): void {
    const assignment = this.assignments.get(taskId);
    if (!assignment) return;
    assignment.status = "failed";
    this.registry.failTask(assignment.assignedTo, taskId, error);
    this.metrics.recordSnapshot(assignment.assignedTo, this.registry.get(assignment.assignedTo)?.metrics ?? this.emptyMetrics());
    this.memory.recordFailure([assignment.assignedTo], `Failed: ${assignment.goal} - ${error ?? "unknown"}`);
  }

  reassignTask(taskId: string): string | undefined {
    const assignment = this.assignments.get(taskId);
    if (!assignment) return undefined;
    const sameRole = this.registry
      .findByRole(this.registry.get(assignment.assignedTo)?.role ?? "software-engineer")
      .find((a) => a.status === "idle" && a.config.enabled && a.id !== assignment.assignedTo);
    if (!sameRole) return undefined;

    assignment.status = "reassigned";
    this.registry.failTask(assignment.assignedTo, taskId, "reassigned");
    assignment.assignedTo = sameRole.id;
    assignment.assignedAt = now();
    assignment.status = "assigned";
    this.registry.assignTask(sameRole.id, taskId);

    this.comms.delegate("organization", sameRole.id, taskId, assignment.goal, { priority: assignment.priority, reassigned: true });
    return sameRole.id;
  }

  getAssignment(taskId: string): TaskAssignment | undefined {
    return this.assignments.get(taskId);
  }

  getAgentAssignments(agentId: string): TaskAssignment[] {
    return [...this.assignments.values()].filter((a) => a.assignedTo === agentId);
  }

  // ── Workflows ─────────────────────────────────────────────────

  createWorkflow(goal: string, steps: Omit<WorkflowStep, "status">[], owner: string): WorkflowPlan {
    if (this.workflows.size >= this.config.maxWorkflows) {
      this.pruneOldWorkflows();
    }
    const plan: WorkflowPlan = {
      id: createId("wf"),
      goal,
      steps: steps.map((s) => ({ ...s, status: "pending" as const })),
      status: "planned",
      createdAt: now(),
      owner,
      priority: this.config.defaultPriority,
    };
    this.workflows.set(plan.id, plan);
    return plan;
  }

  executeWorkflow(planId: string): void {
    const plan = this.workflows.get(planId);
    if (!plan) return;
    plan.status = "running";
    this.advanceWorkflow(planId);
  }

  private advanceWorkflow(planId: string): void {
    const plan = this.workflows.get(planId);
    if (!plan) return;

    const ready = plan.steps.filter((s) => s.status === "pending" && s.dependencies.every((d) => {
      const dep = plan.steps.find((st) => st.id === d);
      return dep?.status === "completed";
    }));

    for (const step of ready) {
      step.status = "ready";
      const agent = this.registry.findAvailable(
        this.registry.get(step.assignedAgent)?.role ?? "software-engineer",
      );
      if (agent) {
        step.status = "running";
        step.startedAt = now();
        this.assignTask(step.description, agent.role, plan.priority);
      }
    }

    // Check completion
    const allDone = plan.steps.every((s) => s.status === "completed" || s.status === "skipped" || s.status === "failed");
    if (allDone) {
      plan.status = plan.steps.some((s) => s.status === "failed") ? "failed" : "completed";
    }
  }

  getWorkflow(id: string): WorkflowPlan | undefined {
    return this.workflows.get(id);
  }

  getAllWorkflows(): WorkflowPlan[] {
    return [...this.workflows.values()];
  }

  cancelWorkflow(id: string): void {
    const plan = this.workflows.get(id);
    if (plan && (plan.status === "planned" || plan.status === "running")) {
      plan.status = "cancelled";
    }
  }

  // ── Agent Health ──────────────────────────────────────────────

  checkHealth(): { healthy: AgentInstance[]; unhealthy: AgentInstance[] } {
    const all = this.registry.getAll();
    const healthy: AgentInstance[] = [];
    const unhealthy: AgentInstance[] = [];
    for (const agent of all) {
      if (agent.status === "error" || agent.status === "offline" || agent.status === "terminated") {
        unhealthy.push(agent);
      } else {
        healthy.push(agent);
      }
    }
    return { healthy, unhealthy };
  }

  recoverAgent(id: string): boolean {
    const agent = this.registry.get(id);
    if (!agent || !agent.config.autoRecover) return false;
    this.registry.updateStatus(id, "idle");
    this.eventBus?.emit("task.created", { action: "recover", agentId: id }, { actor: "organization" });
    this.memory.record({ type: "success", tags: ["recovery", id], agents: [id], content: `Agent ${id} recovered` });
    return true;
  }

  // ── Monitoring ────────────────────────────────────────────────

  getOrganizationState(): { agents: AgentInstance[]; workflows: WorkflowPlan[]; assignments: TaskAssignment[]; memoryStats: { total: number; byType: Record<string, number> } } {
    return {
      agents: this.registry.getAll(),
      workflows: this.getAllWorkflows(),
      assignments: [...this.assignments.values()],
      memoryStats: this.memory.getStats(),
    };
  }

  getBottlenecks(): { agentId: string; role: string; taskCount: number; status: string }[] {
    return this.registry.getBusy().map((a) => ({
      agentId: a.id,
      role: a.role,
      taskCount: a.currentTaskIds.length,
      status: a.status,
    }));
  }

  private pruneOldWorkflows(): void {
    const sorted = [...this.workflows.values()]
      .filter((w) => w.status === "completed" || w.status === "failed" || w.status === "cancelled")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (sorted.length > 0) {
      this.workflows.delete(sorted[0].id);
    }
  }

  private emptyMetrics() {
    return {
      tasksCompleted: 0, tasksFailed: 0, tasksDelegated: 0,
      avgExecutionTimeMs: 0, totalExecutionTimeMs: 0, totalTokensUsed: 0,
      communicationCount: 0, errorCount: 0, uptimeMs: 0,
    };
  }
}
