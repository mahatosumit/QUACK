import { type CompanyExecutionPrincipal, type MissionCompanyRuntime } from "./runtime.js";
import { type CompanyTaskExecutionV1, type CompanyTaskPlanV1, type CompanyTaskResultV1, type MissionCompanyPlanV1 } from "./types.js";

export interface CompanyTaskExecutionContext {
  readonly missionId: string;
  readonly task: CompanyTaskPlanV1;
  readonly agentInstanceId: string;
  readonly principal: CompanyExecutionPrincipal;
  readonly signal: AbortSignal;
  readonly deadline: string;
  readonly attempt: number;
}

export interface CompanyTaskExecutionReportV1 {
  readonly missionId: string;
  readonly status: "COMPLETED" | "FAILED" | "CANCELLED";
  readonly tasks: readonly CompanyTaskExecutionV1[];
  readonly maxObservedConcurrency: number;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface CompanyTaskSchedulerOptions {
  readonly maxConcurrency?: number;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly signal?: AbortSignal;
  readonly onTransition?: (tasks: readonly CompanyTaskExecutionV1[]) => Promise<void> | void;
}

/**
 * Compatibility boundary for the former company-local scheduler.
 *
 * Company task plans lack typed tool invocations, so their arbitrary callback
 * cannot be translated into governed canonical runtime work. The callable API
 * remains available for source compatibility but fails closed.
 */
export class CompanyTaskScheduler {
  constructor(private readonly companyRuntime: MissionCompanyRuntime) {}

  async execute(
    inputPlan: MissionCompanyPlanV1,
    executor: (context: CompanyTaskExecutionContext) => Promise<CompanyTaskResultV1>,
    options: CompanyTaskSchedulerOptions = {},
  ): Promise<CompanyTaskExecutionReportV1> {
    const durablePlan = this.companyRuntime.get(inputPlan.missionId)?.plan;
    if (!durablePlan || JSON.stringify(durablePlan) !== JSON.stringify(inputPlan)) throw new Error("Scheduler plan does not match the durable mission company plan.");
    validateCompanyPlan(inputPlan);
    validateOptions(inputPlan, options);
    void executor;
    throw new Error("CompanyTaskScheduler direct execution is unsupported. Submit governed work through QuackRuntime.");
  }
}

function validateOptions(plan: MissionCompanyPlanV1, options: CompanyTaskSchedulerOptions): void {
  requireInteger("maxConcurrentAgents", plan.limits.maxConcurrentAgents, 1);
  requireInteger("maxConcurrency", options.maxConcurrency ?? plan.limits.maxConcurrentAgents, 1);
  requireInteger("maxRetries", options.maxRetries ?? 0, 0);
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be positive and finite.");
}

function requireInteger(name: string, value: number, minimum: number): void {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}.`);
}

function validateCompanyPlan(plan: MissionCompanyPlanV1): void {
  if (new Set(plan.tasks.map(task => task.id)).size !== plan.tasks.length) throw new Error("Duplicate company task ID.");
  const agents = new Set(plan.agents.map(agent => agent.id));
  if (agents.size !== plan.agents.length) throw new Error("Duplicate company agent ID.");
  for (const task of plan.tasks) {
    if (!agents.has(task.assignedAgentId)) throw new Error(`Task ${task.id} has no assigned company agent.`);
  }
  const verifiers = plan.agents.filter(agent => agent.verifier);
  if (verifiers.length !== 1) throw new Error("Company plan must have one verifier.");
  const verificationTasks = plan.tasks.filter(task => task.assignedAgentId === verifiers[0].id);
  if (verificationTasks.length !== 1 || verificationTasks[0].id !== "task-verification") throw new Error("Verifier must own exactly the terminal verification task.");
  if (!verificationTasks[0].dependencies.includes("task-synthesis")) throw new Error("Verification must depend on synthesis.");
}
