import { type QuackTool, type ToolExecutionContext, type ToolMetadata, type ToolResult } from "./tool.js";
import { fail, ok, type QuackResult } from "../core/types.js";
import { classifyFile, isProtectedClassification } from "../selfmod/protected-core-policy.js";

/**
 * Input for the WorkspaceWriteFileTool.
 */
export interface WorkspaceWriteFileInput {
  readonly path: string;
  readonly content: string;
  readonly createDirectories?: boolean;
  readonly overwrite?: boolean;
}

/**
 * Output from the WorkspaceWriteFileTool.
 */
export interface WorkspaceWriteFileOutput {
  readonly path: string;
  readonly bytesWritten: number;
  readonly created: boolean;
  readonly overwritten: boolean;
}

/**
 * QuackTool that writes a file within the workspace.
 * Requires the workspace.write permission.
 */
export class WorkspaceWriteFileTool implements QuackTool<WorkspaceWriteFileInput, WorkspaceWriteFileOutput> {
  readonly id = "core.workspace.write-file";

  constructor(private readonly options: { readonly workspaceRoot: string; readonly maxWriteBytes?: number }) {}

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Write Workspace File",
      description: "Writes a UTF-8 text file under the configured workspace root.",
      permissions: ["workspace.write"],
    };
  }

  validateInput(input: unknown): QuackResult<WorkspaceWriteFileInput> {
    if (!isObject(input)) return invalidInput(this.id, "Write file input must be an object.");
    if (typeof input.path !== "string" || input.path.trim().length === 0) {
      return invalidInput(this.id, "Write file tool requires non-empty string input.path.");
    }
    if (typeof input.content !== "string") {
      return invalidInput(this.id, "Write file tool requires string input.content.");
    }
    if ("createDirectories" in input && typeof input.createDirectories !== "boolean") {
      return invalidInput(this.id, "Write file input.createDirectories must be a boolean.");
    }
    if ("overwrite" in input && typeof input.overwrite !== "boolean") {
      return invalidInput(this.id, "Write file input.overwrite must be a boolean.");
    }
    return ok({
      path: input.path,
      content: input.content,
      createDirectories: input.createDirectories as boolean | undefined,
      overwrite: input.overwrite as boolean | undefined,
    });
  }

  async execute(
    input: WorkspaceWriteFileInput,
    _context: ToolExecutionContext,
  ): Promise<ToolResult<WorkspaceWriteFileOutput>> {
    // Security: validate the workspace root is set and is a string
    if (typeof this.options.workspaceRoot !== "string" || this.options.workspaceRoot.trim().length === 0) {
      throw new Error("Workspace root is not properly configured.");
    }

    // Security: protected/security-critical files can never be mutated through this generic
    // tool, approved or not — only the governed self-mod worktree pipeline may touch them.
    const classification = classifyFile(input.path);
    if (isProtectedClassification(classification)) {
      throw new Error(
        `Refusing to write "${input.path}": classified as ${classification}, which cannot be modified through the generic write tool.`,
      );
    }
    const maxWriteBytes = this.options.maxWriteBytes ?? 5_000_000;
    if (input.content.length > maxWriteBytes) {
      throw new Error(`Content exceeds maximum write size of ${maxWriteBytes} bytes.`);
    }

    const { resolve: resolveFn, relative: relativeFn, dirname: dirnameFn } = await import("node:path");
    const { writeFile, access, constants: fsConstants, mkdir } = await import("node:fs/promises");

    const target = resolveWorkspacePath(resolveFn, relativeFn, this.options.workspaceRoot, input.path);
    const dir = dirnameFn(target);

    // Optionally create directories if configured to do so.
    if (input.createDirectories) {
      try {
        await mkdir(dir, { recursive: true });
      } catch (mkdirError) {
        throw new Error(`Failed to create directory ${dir}: ${mkdirError instanceof Error ? mkdirError.message : String(mkdirError)}`);
      }
    }

    // Check existence and handle overwrite policy
    let existed = false;
    try {
      await access(target, fsConstants.F_OK);
      existed = true;
    } catch {
      existed = false;
    }

    if (existed && !input.overwrite) {
      throw new Error(`File already exists at ${input.path}. Set overwrite: true to replace it.`);
    }

    await writeFile(target, input.content, { encoding: "utf-8" });

    return {
      output: {
        path: input.path,
        bytesWritten: Buffer.byteLength(input.content, "utf-8"),
        created: !existed,
        overwritten: existed,
      },
    };
  }
}

/**
 * Resolve a user-supplied relative path against the workspace root,
 * rejecting any path that escapes the workspace root.
 */
function resolveWorkspacePath(
  resolveFn: (typeof import("node:path"))["resolve"],
  relativeFn: (typeof import("node:path"))["relative"],
  workspaceRoot: string,
  relativePath: string,
): string {
  const target = resolveFn(workspaceRoot, relativePath);
  const rel = relativeFn(workspaceRoot, target);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error(`Path ${relativePath} is outside the workspace root.`);
  }
  return target;
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
