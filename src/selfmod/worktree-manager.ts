import { fail, ok, type QuackResult } from "../core/types.js";
import { type ToolExecuteFn } from "./types.js";

const TERMINAL_TOOL_ID = "core.terminal.execute";

export interface WorktreeHandle {
  readonly branchName: string;
  /** Path relative to the repository root — required so terminal/tool calls stay inside the workspace boundary. */
  readonly relativePath: string;
  readonly baseCommit: string;
}

interface TerminalOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * All git operations route through the existing terminal tool (permission +
 * ToolRegistry gated) rather than calling child_process directly (§15/§16).
 */
export class GitWorktreeManager {
  constructor(
    private readonly deps: {
      readonly toolExecute: ToolExecuteFn;
      readonly taskId: string;
      readonly actor?: string;
    },
  ) {}

  async getHeadCommit(): Promise<QuackResult<string>> {
    const result = await this.runGit("rev-parse HEAD", ".");
    if (!result.ok) return result;
    return ok(result.data.stdout.trim());
  }

  async createWorktree(experimentId: string, baseCommit: string): Promise<QuackResult<WorktreeHandle>> {
    const branchName = `quack-selfmod/${experimentId}`;
    const relativePath = `.quack/selfmod-worktrees/${experimentId}`;

    const result = await this.runGit(`worktree add -b ${branchName} ${relativePath} ${baseCommit}`, ".");
    if (!result.ok) return result;

    return ok({ branchName, relativePath, baseCommit });
  }

  async removeWorktree(handle: WorktreeHandle): Promise<QuackResult<void>> {
    let firstFailure: QuackResult<void> | undefined;
    const removeResult = await this.runGitWithTransientRetry(`worktree remove ${handle.relativePath} --force`, ".");
    if (!removeResult.ok && !isAlreadyAbsent(removeResult.error.message)) firstFailure = removeResult;

    const pruneResult = await this.runGitWithTransientRetry("worktree prune --expire now", ".");
    if (!pruneResult.ok && !firstFailure) firstFailure = pruneResult;

    const branch = await this.runGit(`branch --list ${handle.branchName}`, ".");
    if (!branch.ok) {
      if (!firstFailure) firstFailure = branch;
    } else if (branch.data.stdout.trim().length > 0) {
      const branchResult = await this.runGitWithTransientRetry(`branch -D ${handle.branchName}`, ".");
      if (!branchResult.ok && !isAlreadyAbsent(branchResult.error.message) && !firstFailure) firstFailure = branchResult;
    }

    return firstFailure ?? ok(undefined);
  }

  private async runGitWithTransientRetry(args: string, workingDirectory: string): Promise<QuackResult<TerminalOutput>> {
    for (let attempt = 0; ; attempt += 1) {
      const result = await this.runGit(args, workingDirectory);
      if (result.ok || attempt >= 5 || !isTransientGitFailure(result.error.message)) return result;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }

  async runGit(args: string, workingDirectory: string): Promise<QuackResult<TerminalOutput>> {
    const result = await this.deps.toolExecute(
      TERMINAL_TOOL_ID,
      { command: `git ${args}`, workingDirectory },
      { taskId: this.deps.taskId, actor: this.deps.actor },
    );
    if (!result.ok) return result as QuackResult<never>;

    const output = result.data as unknown as TerminalOutput;
    if (output.exitCode !== 0) {
      return fail({
        code: "selfmod.git_command_failed",
        message: `git ${args} failed: ${output.stderr || output.stdout}`,
        category: "tool",
        recoverable: true,
        context: { args },
      });
    }
    return ok(output);
  }
}

function isAlreadyAbsent(message: string): boolean {
  return /not a working tree|is not a working tree|not found|does not exist|branch .* not found/i.test(message);
}

function isTransientGitFailure(message: string): boolean {
  return /EPERM|EACCES|EBUSY|permission denied|used by another process|cannot lock|index\.lock|could not remove/i.test(message);
}
