import { createId, fail, ok, type JsonObject, type QuackResult } from "../core/types.js";
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

/** Offline planning fallback. It cannot execute or certify mission completion. */
export class SimpleBrain implements Brain {
  async plan(task: Task, _context: BrainContext): Promise<QuackResult<Plan>> {
    const steps: PlanStep[] = [
      {
        id: createId("step"),
        title: `Understand goal: ${task.goal}`,
        description: `Parse and validate the user goal "${task.goal}".`,
        estimatedComplexity: "low",
        dependencies: [],
        tools: [],
      },
      {
        id: createId("step"),
        title: "Select runtime capabilities",
        description: "Identify which tools, providers, and memory scopes are relevant.",
        estimatedComplexity: "low",
        dependencies: [],
        tools: [],
      },
      {
        id: createId("step"),
        title: "Produce verified response",
        description: "Return a structured result after self-checking the output.",
        estimatedComplexity: "medium",
        dependencies: [],
        tools: [],
      },
    ];

    return ok({
      goal: task.goal,
      steps,
      strategy: "Deterministic stub plan: understand, select, produce.",
      estimatedTotalComplexity: "low",
      requiresPermissions: [],
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
