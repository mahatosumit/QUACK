import { fail, ok, type QuackResult } from "../core/types.js";
import {
  type Brain,
  type BrainContext,
  type ExecutionResult,
  type Plan,
  type PlanStep,
  type Reasoning,
  type Reflection,
} from "./brain.js";
import { type Task } from "../runtime/task.js";
import { Planner } from "../engine/planner.js";

/**
 * Offline planning fallback: the same deterministic Planner graph
 * (workspace list-files + code-search invocations) the ExecutiveBrain uses,
 * without the provider/memory wiring. Missions on credential-free machines
 * still produce actionable, governed, read-only plans; deep reasoning still
 * requires wiring the ExecutiveBrain.
 */
export class SimpleBrain implements Brain {
  private readonly planner = new Planner({
    defaultRetryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 },
    defaultTimeoutMs: 30_000,
    maxNodesPerGraph: 20,
  });

  async plan(task: Task, _context: BrainContext): Promise<QuackResult<Plan>> {
    const proposal = this.planner.createPlan(task.goal, "");
    return ok({
      goal: task.goal,
      steps: proposal.taskGraph.nodes.map((node) => ({
        id: node.id,
        title: node.description,
        description: node.description,
        estimatedComplexity: "low",
        dependencies: node.dependencies,
        tools: node.requiredTools,
        toolInvocations: node.toolInvocations,
      })),
      strategy: proposal.strategy,
      estimatedTotalComplexity: "low",
      requiresPermissions: proposal.requiresPermissions,
    });
  }

  async execute(_task: Task, _context: BrainContext): Promise<QuackResult<ExecutionResult>> {
    return fail({
      code: "brain.execution_unsupported",
      message: "SimpleBrain cannot execute or verify goals. Configure an executable plan and a mission validator.",
      category: "runtime", recoverable: false,
    });
  }

  async reason(question: string, _context: BrainContext): Promise<QuackResult<Reasoning>> {
    return ok({
      question,
      analysis: `SimpleBrain cannot reason deeply; echoing question: ${question}`,
      conclusion: "SimpleBrain did not perform real reasoning. Wire the ExecutiveBrain for production use.",
      confidence: 0,
      alternativesConsidered: [],
      reasoningChain: ["receive-question", "no-op"],
    });
  }

  async reflect(targetId: string, _outcome: unknown, _context: BrainContext): Promise<QuackResult<Reflection>> {
    return ok({
      targetId,
      outcome: "partial",
      observations: ["No outcome validation was performed."],
      lessons: [],
      recommendations: ["Wire the ExecutiveBrain for substantive reflection."],
      shouldRetry: false,
    });
  }
}
