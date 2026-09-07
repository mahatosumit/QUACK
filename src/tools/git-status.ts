/**
 * Git Tool - Provides Git status and operations for the workspace.
 */
import { type QuackTool, type ToolExecutionContext, type ToolMetadata, type ToolResult } from "./tool.js";
import { resolveInsideWorkspace } from "./workspace-filesystem.js";
import { fail, ok, type QuackResult } from "../core/types.js";
import { childProcessEnvironment, executeProcess } from "../platform/process.js";

export interface GitStatusInput {
  readonly workingDirectory?: string;
}

export interface GitStatusOutput {
  readonly branch: string;
  readonly aheadBehind?: { ahead: number; behind: number };
  readonly staged: readonly string[];
  readonly modified: readonly string[];
  readonly untracked: readonly string[];
  readonly deleted: readonly string[];
  readonly clean: boolean;
  readonly raw: string;
}

/**
 * GitTool provides git status information for the workspace.
 * Requires git.read permission.
 */
export class GitStatusTool implements QuackTool<GitStatusInput, GitStatusOutput> {
  readonly id = "core.git.status";

  constructor(private readonly options: { readonly workspaceRoot: string }) {}

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Git Status",
      description: "Returns the current git status including branch, staged, modified, and untracked files.",
      permissions: ["git.read"],
    };
  }

  validateInput(input: unknown): QuackResult<GitStatusInput> {
    if (!isObject(input)) return invalidInput(this.id, "Git status input must be an object.");
    if ("workingDirectory" in input && typeof input.workingDirectory !== "string") {
      return invalidInput(this.id, "Git status input.workingDirectory must be a string.");
    }
    return ok({ workingDirectory: input.workingDirectory as string | undefined });
  }

  async execute(input: GitStatusInput, _context: ToolExecutionContext): Promise<ToolResult<GitStatusOutput>> {
    const cwd = resolveInsideWorkspace(this.options.workspaceRoot, input.workingDirectory ?? ".");

    // Get branch
    let branch = "unknown";
    try {
      const result = await this.git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
      if (result.status === "COMPLETED" && result.exitCode === 0) branch = result.stdout.trim();
    } catch {
      branch = "unknown";
    }

    // Get ahead/behind
    let aheadBehind: { ahead: number; behind: number } | undefined;
    try {
      const result = await this.git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], cwd);
      if (result.status === "COMPLETED" && result.exitCode === 0) {
        const [ahead, behind] = result.stdout.trim().split("\t").map(Number);
        aheadBehind = { ahead, behind };
      }
    } catch {
      aheadBehind = undefined;
    }

    // Get status
    const statusResult = await this.git(["status", "--short"], cwd);
    if (statusResult.status !== "COMPLETED" || statusResult.exitCode !== 0) {
      throw new Error(`git status failed (${statusResult.status}, exit ${statusResult.exitCode ?? "null"}): ${statusResult.stderr.trim()}`);
    }
    const statusRaw = statusResult.stdout;
    const lines = statusRaw.split("\n").filter(Boolean);

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];
    const deleted: string[] = [];

    for (const line of lines) {
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filename = line.slice(3).trim();

      if (indexStatus !== "?" && indexStatus !== " ") {
        staged.push(filename);
      }
      if (workTreeStatus === "M" || workTreeStatus === "?") {
        if (workTreeStatus === "?") {
          untracked.push(filename);
        } else {
          modified.push(filename);
        }
      }
      if (indexStatus === "D" || workTreeStatus === "D") {
        deleted.push(filename);
      }
    }

    return {
      output: {
        branch,
        aheadBehind,
        staged,
        modified,
        untracked,
        deleted,
        clean: lines.length === 0,
        raw: statusRaw,
      },
    };
  }

  /** Governed argv git execution: no shell, explicit environment, bounded. */
  private async git(args: readonly string[], cwd: string) {
    return executeProcess({
      command: "git",
      args,
      workingDirectory: cwd,
      environment: childProcessEnvironment(),
      timeoutMs: 15_000,
    });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidInput<T>(toolId: string, message: string): QuackResult<T> {
  return fail({
    code: "tool.invalid_input",
    message,
    category: "tool",
    recoverable: true,
    context: { toolId },
  });
}
