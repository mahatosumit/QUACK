import { now, createId } from "../../core/types.js";
import { type EventBus } from "../../events/event-bus.js";
import { type Brain } from "../../brain/brain.js";
import { type SemanticLayer } from "../../intelligence/semantic-layer.js";
import { type EditingPlan, type EditingResult, type ValidationOutcome, type SeaConfig } from "../types.js";

export class EditingWorkflow {
  constructor(
    private readonly brain: Brain,
    private readonly sl: SemanticLayer,
    private readonly eventBus: EventBus,
    private readonly config: SeaConfig,
  ) {}

  async execute(plan: EditingPlan): Promise<EditingResult> {
    const patchEngine = this.sl.patches;

    const patch = await patchEngine.createFullPatch(
      plan.goal,
      plan.operations.map((op) => ({ path: op.path, content: op.newContent })),
    );

    const validationResults: ValidationOutcome[] = [];

    // Validate
    const validResult = await patchEngine.validatePatch(patch);
    validationResults.push({
      type: "architecture",
      passed: validResult.valid,
      errors: validResult.errors,
      warnings: validResult.warnings,
      durationMs: validResult.durationMs,
    });

    // Typecheck
    if (plan.goal.includes("type") || plan.goal.includes("ts") || plan.affectedFiles.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"))) {
      const t0 = Date.now();
      const typeErrors = await this.sl.validator.typeCheck();
      validationResults.push({
        type: "typecheck",
        passed: typeErrors.length === 0,
        errors: typeErrors,
        warnings: [],
        durationMs: Date.now() - t0,
      });
    }

    // Lint
    const t0 = Date.now();
    const lintErrors = await this.sl.validator.lint();
    validationResults.push({
      type: "lint",
      passed: lintErrors.length === 0,
      errors: lintErrors,
      warnings: [],
      durationMs: Date.now() - t0,
    });

    const hasErrors = validationResults.some((v) => !v.passed);
    if (hasErrors) {
      return {
        patch,
        validationResults,
        applied: false,
        rollbackAvailable: true,
        summary: `Validation failed: ${validationResults.filter((v) => !v.passed).map((v) => v.type).join(", ")}`,
      };
    }

    // Apply
    await patchEngine.applyPatch(patch);

    await this.eventBus.emit("task.completed" as any, {
      action: "editing",
      goal: plan.goal,
      files: plan.affectedFiles.length,
      patchId: patch.id,
    } as any, { actor: "sea" });

    return {
      patch,
      validationResults,
      applied: true,
      rollbackAvailable: true,
      summary: `Applied changes to ${plan.affectedFiles.length} file(s) with ${validationResults.filter((v) => v.passed).length}/${validationResults.length} validations passed.`,
    };
  }
}
