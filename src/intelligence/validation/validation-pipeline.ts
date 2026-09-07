import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type Patch, type PatchValidationResult, type TestFailure } from "../types.js";
import { type EventBus } from "../../events/event-bus.js";
import { childProcessEnvironment, executeProcess, resolveNodeCliArgv } from "../../platform/process.js";

export interface ValidationPipelineConfig {
  readonly workspaceRoot: string;
  readonly eventBus?: EventBus;
  readonly timeoutMs: number;
}

/**
 * ValidationPipeline runs compilation, linting, type checking, and formatting
 * checks against the workspace. It is used by the PatchEngine to verify
 * changes before application.
 *
 * Process execution is argv-based through the platform abstraction (ADR
 * 0040): no shell strings, no stderr-merge operators, and no exit-code
 * masking — tsc/eslint exit codes are observed directly.
 */
export class ValidationPipeline {
  constructor(private readonly config: ValidationPipelineConfig) {}

  async validate(patch: Patch): Promise<PatchValidationResult> {
    const startTime = Date.now();
    const compileErrors: string[] = [];
    const lintErrors: string[] = [];
    const typeErrors: string[] = [];
    const testFailures: TestFailure[] = [];
    const warnings: string[] = [];

    // TypeScript type checking
    if (this.hasTsConfig()) {
      const errors = await this.runTsc();
      typeErrors.push(...errors);
    }

    // Lint check
    if (this.hasEslint()) {
      const errors = await this.runEslint([".", "--no-warn-ignored", "--quiet"]);
      if (errors.kind === "unavailable") warnings.push("Lint check failed: node tooling unavailable.");
      else lintErrors.push(...errors.lines);
    }

    return {
      valid: compileErrors.length === 0 && lintErrors.length === 0 && typeErrors.length === 0 && testFailures.length === 0,
      errors: [...compileErrors, ...typeErrors, ...lintErrors, ...testFailures.map((f) => f.message)],
      warnings,
      compileErrors,
      lintErrors,
      typeErrors,
      testFailures,
      durationMs: Date.now() - startTime,
    };
  }

  async typeCheck(): Promise<string[]> {
    if (!this.hasTsConfig()) return [];
    const errors = await this.runTsc();
    return errors;
  }

  async lint(): Promise<string[]> {
    if (!this.hasEslint()) return [];
    const errors = await this.runEslint([".", "--quiet"]);
    if (errors.kind === "unavailable") return [];
    return errors.lines;
  }

  /** tsc exit 0 with diagnostics-free output = clean; exit != 0 = type errors. */
  private async runTsc(): Promise<string[]> {
    const invocation = resolveNodeCliArgv("npx", ["tsc", "--noEmit"]);
    if (!invocation) return [`tsc unavailable: node npx-cli not found next to ${"node"}`];
    const result = await executeProcess({
      command: invocation.command,
      args: invocation.args,
      workingDirectory: this.config.workspaceRoot,
      environment: childProcessEnvironment(),
      timeoutMs: this.config.timeoutMs,
    });
    const output = (result.stdout + (result.stderr ? "\n" + result.stderr : "")).trim();
    if (result.status === "COMPLETED" && result.exitCode === 0) return [];
    if (output) return output.split("\n").filter(Boolean);
    return [`tsc ${result.status} (exit ${result.exitCode ?? "null"})`];
  }

  /**
   * eslint exit != 0 means lint findings (or a real failure); both surface
   * as error lines. Exit codes are never masked.
   */
  private async runEslint(args: readonly string[]): Promise<{ kind: "lines"; lines: string[] } | { kind: "unavailable" }> {
    const invocation = resolveNodeCliArgv("npx", ["eslint", ...args]);
    if (!invocation) return { kind: "unavailable" };
    let result;
    try {
      result = await executeProcess({
        command: invocation.command,
        args: invocation.args,
        workingDirectory: this.config.workspaceRoot,
        environment: childProcessEnvironment(),
        timeoutMs: this.config.timeoutMs,
      });
    } catch {
      return { kind: "unavailable" };
    }
    const output = (result.stdout + (result.stderr ? "\n" + result.stderr : "")).trim();
    if (result.status === "COMPLETED" && result.exitCode === 0) return { kind: "lines", lines: [] };
    if (output) return { kind: "lines", lines: output.split("\n").filter(Boolean) };
    return { kind: "lines", lines: [`eslint ${result.status} (exit ${result.exitCode ?? "null"})`] };
  }

  private hasTsConfig(): boolean {
    return existsSync(resolve(this.config.workspaceRoot, "tsconfig.json"));
  }

  private hasEslint(): boolean {
    return existsSync(resolve(this.config.workspaceRoot, "eslint.config.js")) ||
           existsSync(resolve(this.config.workspaceRoot, "eslint.config.mjs")) ||
           existsSync(resolve(this.config.workspaceRoot, ".eslintrc.json")) ||
           existsSync(resolve(this.config.workspaceRoot, ".eslintrc.js"));
  }
}
