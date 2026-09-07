import { type SkillDefinition, type SkillInput, type SkillResult, type SkillExecutionPlan } from "./types.js";
import { SkillRegistry } from "./registry.js";
import { SkillValidator } from "./validator.js";
import { DurableSkillSandboxRuntime, type SkillSandboxRuntimeDependencies } from "./sandbox-runtime.js";

export interface SkillExecutionOptions {
  readonly allowCandidate?: boolean;
}

export class SkillExecutor {
  private readonly sandbox?: DurableSkillSandboxRuntime;

  constructor(
    private readonly registry: SkillRegistry,
    private readonly validator: SkillValidator,
    sandboxDeps?: SkillSandboxRuntimeDependencies,
  ) {
    this.sandbox = sandboxDeps ? new DurableSkillSandboxRuntime(sandboxDeps) : undefined;
  }

  async execute(definition: SkillDefinition, input: SkillInput, options: SkillExecutionOptions = {}): Promise<SkillResult> {
    const validation = await this.validator.validateInput(definition, input);
    if (!validation.valid) {
      return { ok: false, error: validation.errors.join("; "), durationMs: 0 };
    }

    const t0 = Date.now();
    try {
      const record = this.registry.getRecord(definition.manifest.id, definition.manifest.version);
      if (definition.portableExecution) {
        if (!this.sandbox) {
          return { ok: false, error: "Portable skill execution requires a sandbox runtime.", durationMs: Date.now() - t0 };
        }
        if (!record) {
          return { ok: false, error: `Skill '${definition.manifest.id}@${definition.manifest.version}' is not registered.`, durationMs: Date.now() - t0 };
        }
        if (record.status === "candidate" && !options.allowCandidate) {
          return { ok: false, error: `Candidate skill '${record.versionKey}' cannot execute outside experiment mode.`, durationMs: Date.now() - t0 };
        }
        if (!["active", "candidate"].includes(record.status)) {
          return { ok: false, error: `Skill '${record.versionKey}' lifecycle ${record.status} is not executable.`, durationMs: Date.now() - t0 };
        }
        const sandboxValidation = this.sandbox.validate(definition, record);
        if (!sandboxValidation.valid) {
          return { ok: false, error: sandboxValidation.errors.join("; "), durationMs: Date.now() - t0 };
        }
        const result = await this.sandbox.execute(definition, input, record);
        const durationMs = Date.now() - t0;
        this.registry.recordUsage(definition.manifest.id, durationMs, definition.manifest.version);
        return { ...result, durationMs };
      }

      const durationMs = Date.now() - t0;
      return {
        ok: false,
        error: "Direct callable skill execution is unsupported. Provide portableExecution to run through the canonical runtime.",
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - t0;
      this.registry.recordUsage(definition.manifest.id, durationMs, definition.manifest.version);
      return { ok: false, error: err instanceof Error ? err.message : String(err), durationMs };
    }
  }

  async executePlan(plan: SkillExecutionPlan, input: SkillInput, options: SkillExecutionOptions = {}): Promise<SkillResult[]> {
    const results: SkillResult[] = [];
    for (const entry of plan.skills) {
      const definition = this.registry.get(entry.skillId, entry.version);
      if (!definition) {
        results.push({ ok: false, error: `Skill '${entry.skillId}' not found`, durationMs: 0 });
        continue;
      }
      const result = await this.execute(definition, input, options);
      results.push(result);
    }
    return results;
  }
}
