import { now } from "../core/types.js";
import type { PipelineDefinition, PipelineExecution, PipelineStep, PipelineStepExecution, ExecutionStatus, AiCapability } from "./types.js";
import { IntelligenceRouter } from "./intelligence-router.js";

export class PipelineManager {
  private pipelines: Map<string, PipelineDefinition> = new Map();
  private executions: Map<string, PipelineExecution> = new Map();
  private router: IntelligenceRouter;

  constructor(router: IntelligenceRouter) {
    this.router = router;
  }

  register(pipeline: PipelineDefinition): void {
    this.pipelines.set(pipeline.id, pipeline);
  }

  unregister(id: string): boolean {
    return this.pipelines.delete(id);
  }

  get(id: string): PipelineDefinition | undefined {
    return this.pipelines.get(id);
  }

  getAll(): PipelineDefinition[] {
    return Array.from(this.pipelines.values());
  }

  async execute(pipelineId: string, input: unknown): Promise<PipelineExecution> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline not found: ${pipelineId}`);

    const id = createId();
    const execution: PipelineExecution = {
      id, pipelineId, status: "running", currentStep: 0,
      steps: [], input, output: null, startedAt: now(),
    };
    this.executions.set(id, execution);

    if (pipeline.steps.length === 0) {
      execution.status = "failed";
      execution.error = "Pipeline execution requires at least one executable step.";
      execution.completedAt = now();
      return execution;
    }

    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i]!;
      execution.currentStep = i;
      const stepExec = await this.executeStep(step, i === 0 ? input : execution.steps[i - 1]?.output);
      execution.steps.push(stepExec);
      if (stepExec.status === "failed") {
        execution.status = "failed";
        execution.error = stepExec.error;
        execution.completedAt = now();
        return execution;
      }
    }

    execution.status = "completed";
    execution.output = execution.steps[execution.steps.length - 1]?.output ?? null;
    execution.completedAt = now();
    return execution;
  }

  private async executeStep(step: PipelineStep, input: unknown): Promise<PipelineStepExecution> {
    return { stepId: step.id, status: "failed", input, output: null,
      error: "AIRM pipeline execution is unsupported: no model executor is configured.", completedAt: now() };
  }

  getExecution(id: string): PipelineExecution | undefined {
    return this.executions.get(id);
  }

  getExecutions(pipelineId?: string): PipelineExecution[] {
    const all = Array.from(this.executions.values());
    return pipelineId ? all.filter((e) => e.pipelineId === pipelineId) : all;
  }

  getStats(): { totalPipelines: number; totalExecutions: number; success: number; failed: number } {
    const all = Array.from(this.executions.values());
    return {
      totalPipelines: this.pipelines.size,
      totalExecutions: all.length,
      success: all.filter((e) => e.status === "completed").length,
      failed: all.filter((e) => e.status === "failed").length,
    };
  }

  createDefaults(): void {
    this.register({
      id: "code-review-pipeline", name: "Code Review Pipeline", description: "Review code changes with reasoning and verification",
      steps: [
        { id: "plan", type: "planner", modelCapability: "planning", config: {} },
        { id: "reason", type: "reasoning", modelCapability: "reasoning", config: {} },
        { id: "review", type: "reviewer", modelCapability: "coding", config: {} },
        { id: "verify", type: "verifier", modelCapability: "reasoning", config: {} },
      ], version: "1.0", tags: ["code", "review"], createdAt: now(), updatedAt: now(),
    });
    this.register({
      id: "vision-ocr-pipeline", name: "Vision OCR Pipeline", description: "Extract text from images",
      steps: [
        { id: "vision", type: "vision", modelCapability: "vision", config: {} },
        { id: "ocr", type: "ocr", modelCapability: "ocr", config: {} },
        { id: "reason", type: "reasoning", modelCapability: "reasoning", config: {} },
      ], version: "1.0", tags: ["vision", "ocr"], createdAt: now(), updatedAt: now(),
    });
  }
}

function createId(): string {
  return `p-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
