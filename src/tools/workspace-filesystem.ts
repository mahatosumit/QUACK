import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type QuackError } from "../core/types.js";
import { fail, ok, type QuackResult } from "../core/types.js";
import { type QuackTool, type ToolExecutionContext, type ToolMetadata, type ToolResult } from "./tool.js";

export interface WorkspaceFilesystemOptions {
  readonly workspaceRoot: string;
  readonly maxReadBytes?: number;
  readonly ignoredDirectories?: readonly string[];
}

const DEFAULT_IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", ".quack"]);

export class WorkspaceListFilesTool implements QuackTool<{ readonly path?: string; readonly depth?: number }, { readonly files: readonly string[] }> {
  readonly id = "core.workspace.list-files";

  constructor(private readonly options: WorkspaceFilesystemOptions) {}

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "List Workspace Files",
      description: "Lists files under the configured workspace root.",
      permissions: ["workspace.read"],
    };
  }

  validateInput(input: unknown): QuackResult<{ readonly path?: string; readonly depth?: number }> {
    if (!isObject(input)) return invalidInput(this.id, "List files input must be an object.");
    if ("path" in input && typeof input.path !== "string") return invalidInput(this.id, "List files input.path must be a string.");
    if ("depth" in input && (typeof input.depth !== "number" || !Number.isInteger(input.depth) || input.depth < 0)) {
      return invalidInput(this.id, "List files input.depth must be a non-negative integer.");
    }
    return ok({ path: input.path as string | undefined, depth: input.depth as number | undefined });
  }

  async execute(
    input: { readonly path?: string; readonly depth?: number },
    _context: ToolExecutionContext,
  ): Promise<ToolResult<{ readonly files: readonly string[] }>> {
    const root = this.resolveInsideWorkspace(input.path ?? ".");
    const files = await listFiles(root, this.options.workspaceRoot, input.depth ?? 3, this.ignoredDirectories());
    return { output: { files } };
  }

  private resolveInsideWorkspace(path: string): string {
    return resolveInsideWorkspace(this.options.workspaceRoot, path);
  }

  private ignoredDirectories(): ReadonlySet<string> {
    return new Set(this.options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES);
  }
}

export class WorkspaceReadFileTool implements QuackTool<{ readonly path: string }, { readonly path: string; readonly content: string; readonly truncated: boolean }> {
  readonly id = "core.workspace.read-file";

  constructor(private readonly options: WorkspaceFilesystemOptions) {}

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Read Workspace File",
      description: "Reads a UTF-8 text file under the configured workspace root.",
      permissions: ["workspace.read"],
    };
  }

  validateInput(input: unknown): QuackResult<{ readonly path: string }> {
    if (!isObject(input) || typeof input.path !== "string" || input.path.trim().length === 0) {
      return invalidInput(this.id, "Read file tool requires non-empty string input.path.");
    }
    return ok({ path: input.path });
  }

  async execute(
    input: { readonly path: string },
    _context: ToolExecutionContext,
  ): Promise<ToolResult<{ readonly path: string; readonly content: string; readonly truncated: boolean }>> {
    const target = resolveInsideWorkspace(this.options.workspaceRoot, input.path);
    const bytes = await readFile(target);
    const maxReadBytes = this.options.maxReadBytes ?? 128_000;
    const truncated = bytes.byteLength > maxReadBytes;
    const content = bytes.subarray(0, maxReadBytes).toString("utf8");

    return {
      output: {
        path: normalizeRelativePath(relative(this.options.workspaceRoot, target)),
        content,
        truncated,
      },
    };
  }
}

export function workspacePathError(path: string): QuackError {
  return {
    code: "workspace.path_outside_root",
    message: `Path ${path} is outside the workspace root.`,
    category: "tool",
    recoverable: true,
  };
}

export function resolveInsideWorkspace(workspaceRoot: string, path: string): string {
  const root = resolve(workspaceRoot);
  const target = resolve(root, path);
  const rel = relative(root, target);

  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return target;
  }

  throw Object.assign(new Error(workspacePathError(path).message), workspacePathError(path));
}

async function listFiles(
  directory: string,
  workspaceRoot: string,
  depth: number,
  ignoredDirectories: ReadonlySet<string>,
): Promise<string[]> {
  if (depth < 0) return [];

  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath, workspaceRoot, depth - 1, ignoredDirectories)));
      continue;
    }

    if (entry.isFile()) {
      const details = await stat(fullPath);
      files.push(`${normalizeRelativePath(relative(workspaceRoot, fullPath))} (${details.size} bytes)`);
    }
  }

  return files.sort();
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/");
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
