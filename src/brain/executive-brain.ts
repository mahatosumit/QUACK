import { fail, ok, type QuackResult } from "../core/types.js";
import type { EventBus } from "../events/event-bus.js";
import type { ToolRegistry } from "../tools/tool.js";
import type { ProviderRegistry } from "../providers/provider.js";
import type { MemoryStore } from "../memory/memory.js";
import type { Brain, BrainContext, ExecutionResult, Plan, Reasoning, Reflection } from "./brain.js";
import type { Task } from "../runtime/task.js";
import { Planner } from "../engine/planner.js";
import { ReflectionEngine } from "../engine/reflection-engine.js";
import type { SessionRuntime } from "../engine/session-runtime.js";
import type { TaskNode, TaskNodeResult, WorkflowState, ProviderCapabilityProfile, RoutingPolicy, RetryPolicy, SchedulerConfig } from "../engine/types.js";

export interface ExecutiveBrainConfig {
  readonly maxRetries: number;
  readonly reflectionThreshold: number;
  readonly defaultRoutingPolicy: RoutingPolicy;
  readonly providerProfiles?: ProviderCapabilityProfile[];
  readonly schedulerConfig?: SchedulerConfig;
  readonly retryPolicy?: RetryPolicy;
  readonly checkpointIntervalMs?: number;
  readonly verifyExecution?: (task: Task, state: WorkflowState) => Promise<{ readonly success: boolean; readonly reason: string }>;

}

/** Compatibility planning strategy. Execution and session ownership belong to QuackRuntime. */
export class ExecutiveBrain implements Brain {
  private readonly planner: Planner;
  private readonly reflectionEngine = new ReflectionEngine();
  readonly verifyExecution?: ExecutiveBrainConfig["verifyExecution"];

  constructor(private readonly deps: { eventBus: EventBus; tools: ToolRegistry; providers: ProviderRegistry; memory: MemoryStore },
    config: ExecutiveBrainConfig = { maxRetries: 0, reflectionThreshold: 1, defaultRoutingPolicy: "balanced" }) {
    this.planner = new Planner({ defaultRetryPolicy: config.retryPolicy ?? { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 },
      defaultTimeoutMs: config.schedulerConfig?.defaultTimeoutMs ?? 30000, maxNodesPerGraph: 20 });
    this.verifyExecution = config.verifyExecution;
  }

  async plan(task: Task, context: BrainContext): Promise<QuackResult<Plan>> {
    try {
      const records = await this.deps.memory.search({ text: task.goal, scope: "workspace", limit: 5 });
      const proposal = this.planner.createPlan(task.goal, records.map((record) => record.content).join("\n"));
      return ok({ goal: task.goal, strategy: proposal.strategy, estimatedTotalComplexity: "medium",
        requiresPermissions: proposal.requiresPermissions,
        steps: proposal.taskGraph.nodes.map((node) => ({ id: node.id, title: node.description, description: node.description,
          estimatedComplexity: "medium", dependencies: node.dependencies, tools: node.requiredTools, toolInvocations: node.toolInvocations })) });
    } catch (error) {
      return fail({ code: "brain.planning_failed", message: error instanceof Error ? error.message : String(error), category: "runtime", recoverable: false });
    }
  }

  async execute(_task: Task, _context: BrainContext): Promise<QuackResult<ExecutionResult>> {
    return fail({ code: "brain.execution_unsupported", message: "ExecutiveBrain is planning-only. Submit execution through QuackRuntime.", category: "runtime", recoverable: false });
  }

  async reason(_question: string, _context: BrainContext): Promise<QuackResult<Reasoning>> {
    return fail({ code: "brain.reasoning_unsupported", message: "No model-backed reasoning executor is configured.", category: "runtime", recoverable: false });
  }

  async reflect(targetId: string, outcome: unknown, context: BrainContext): Promise<QuackResult<Reflection>> {
    const isFailure = outcome instanceof Error || (typeof outcome === "object" && outcome !== null && "ok" in outcome && !(outcome as { ok: boolean }).ok);

    const node: TaskNode = {
      id: targetId,
      description: `Reflection target: ${targetId}`,
      dependencies: [],
      priority: "medium",
      estimatedCost: 0,
      estimatedDurationMs: 0,
      requiredTools: [],
      timeoutMs: 60000,
      retryPolicy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, maxDelayMs: 60000 },
      status: isFailure ? "failed" : "completed",
      retryCount: 0,
    };

    const result: TaskNodeResult = {
      success: !isFailure,
      toolCalls: [],
      durationMs: 0,
    };

    const reflection = this.reflectionEngine.reflect(node, result, 0);

    return ok({
      targetId,
      outcome: isFailure ? "failure" : "partial",
      observations: reflection.observations,
      lessons: reflection.lessons,
      recommendations: reflection.recommendations,
      shouldRetry: reflection.requiresRetry,
      retryApproach: reflection.requiresRetry ? "Escalate or adjust strategy." : undefined,
    });
  }

  getSessionRuntime(): SessionRuntime { throw new Error("ExecutiveBrain does not own sessions; use QuackRuntime."); }
  getCurrentSessionId(): undefined { return undefined; }
}
