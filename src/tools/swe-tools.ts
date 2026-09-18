/**
 * SWE Execution Tools - Git commit, Test runner, and Documentation generator.
 * Provides real implementations for core/swe execution capabilities.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { type QuackTool, type ToolExecutionContext, type ToolMetadata, type ToolResult } from "./tool.js";
import { resolveInsideWorkspace } from "./workspace-filesystem.js";
import { fail, ok, type QuackResult } from "../core/types.js";
import { childProcessEnvironment, executeProcess } from "../platform/process.js";

// --- Helpers ---
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

function parseCommandArgs(command: string): { cmd: string; args: string[] } {
  const tokens: string[] = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(command)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1]);
    } else if (match[2] !== undefined) {
      tokens.push(match[2]);
    } else {
      tokens.push(match[0]);
    }
  }
  return {
    cmd: tokens[0] ?? "npm",
    args: tokens.slice(1),
  };
}

// ── 1. Git Commit Tool ──────────────────────────────────────────────

export interface GitCommitInput {
  readonly message: string;
  readonly all?: boolean;
  readonly files?: readonly string[];
  readonly workingDirectory?: string;
}

export interface GitCommitOutput {
  readonly commitHash: string;
  readonly branch: string;
  readonly message: string;
  readonly summary: string;
}

export class GitCommitTool implements QuackTool<GitCommitInput, GitCommitOutput> {
  readonly id: string;

  constructor(
    private readonly options: { readonly workspaceRoot: string },
    toolId = "core.git.commit",
  ) {
    this.id = toolId;
  }

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Git Commit",
      description: "Stages changes and creates a Git commit in the workspace.",
      permissions: ["git.write", "terminal.execute"],
    };
  }

  validateInput(input: unknown): QuackResult<GitCommitInput> {
    if (!isObject(input)) return invalidInput(this.id, "Git commit input must be an object.");
    if (typeof input.message !== "string" || input.message.trim().length === 0) {
      return invalidInput(this.id, "Git commit requires a non-empty commit message.");
    }
    if ("workingDirectory" in input && typeof input.workingDirectory !== "string") {
      return invalidInput(this.id, "workingDirectory must be a string.");
    }
    if ("all" in input && typeof input.all !== "boolean") {
      return invalidInput(this.id, "all must be a boolean.");
    }
    if ("files" in input && (!Array.isArray(input.files) || !input.files.every((f) => typeof f === "string"))) {
      return invalidInput(this.id, "files must be an array of strings.");
    }
    return ok({
      message: input.message.trim(),
      all: input.all as boolean | undefined,
      files: input.files as string[] | undefined,
      workingDirectory: input.workingDirectory as string | undefined,
    });
  }

  async execute(input: GitCommitInput, _context: ToolExecutionContext): Promise<ToolResult<GitCommitOutput>> {
    const cwd = resolveInsideWorkspace(this.options.workspaceRoot, input.workingDirectory ?? ".");

    // Stage files
    if (input.files && input.files.length > 0) {
      const stageResult = await executeProcess({
        command: "git",
        args: ["add", "--", ...input.files],
        workingDirectory: cwd,
        environment: childProcessEnvironment(),
        timeoutMs: 15_000,
      });
      if (stageResult.status !== "COMPLETED" || stageResult.exitCode !== 0) {
        throw new Error(`Failed to stage files: ${stageResult.stderr || stageResult.stdout}`);
      }
    } else if (input.all !== false) {
      const addResult = await executeProcess({
        command: "git",
        args: ["add", "-A"],
        workingDirectory: cwd,
        environment: childProcessEnvironment(),
        timeoutMs: 15_000,
      });
      if (addResult.status !== "COMPLETED" || addResult.exitCode !== 0) {
        throw new Error(`Failed to stage all files: ${addResult.stderr || addResult.stdout}`);
      }
    }

    // Commit
    const commitResult = await executeProcess({
      command: "git",
      args: ["commit", "-m", input.message],
      workingDirectory: cwd,
      environment: childProcessEnvironment(),
      timeoutMs: 15_000,
    });

    if (commitResult.status !== "COMPLETED" || commitResult.exitCode !== 0) {
      // Check if working tree clean / nothing to commit
      if (commitResult.stdout.includes("nothing to commit") || commitResult.stderr.includes("nothing to commit")) {
        return {
          output: {
            commitHash: "HEAD",
            branch: "unknown",
            message: input.message,
            summary: "Nothing to commit, working tree clean",
          },
        };
      }
      throw new Error(`git commit failed (exit ${commitResult.exitCode}): ${commitResult.stderr || commitResult.stdout}`);
    }

    // Resolve commit hash and branch
    let commitHash = "HEAD";
    let branch = "HEAD";
    try {
      const hashResult = await executeProcess({
        command: "git",
        args: ["rev-parse", "HEAD"],
        workingDirectory: cwd,
        environment: childProcessEnvironment(),
        timeoutMs: 5_000,
      });
      if (hashResult.status === "COMPLETED" && hashResult.exitCode === 0) {
        commitHash = hashResult.stdout.trim();
      }
      const branchResult = await executeProcess({
        command: "git",
        args: ["rev-parse", "--abbrev-ref", "HEAD"],
        workingDirectory: cwd,
        environment: childProcessEnvironment(),
        timeoutMs: 5_000,
      });
      if (branchResult.status === "COMPLETED" && branchResult.exitCode === 0) {
        branch = branchResult.stdout.trim();
      }
    } catch {
      // Graceful fallback
    }

    return {
      output: {
        commitHash,
        branch,
        message: input.message,
        summary: commitResult.stdout.trim(),
      },
    };
  }
}

// ── 2. Test Run Tool ────────────────────────────────────────────────

export interface TestRunInput {
  readonly command?: string;
  readonly framework?: string;
  readonly pattern?: string;
  readonly timeoutMs?: number;
  readonly workingDirectory?: string;
}

export interface TestRunOutput {
  readonly passed: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly executionTimeMs: number;
  readonly summary: string;
}

export class TestRunTool implements QuackTool<TestRunInput, TestRunOutput> {
  readonly id: string;

  constructor(
    private readonly options: { readonly workspaceRoot: string },
    toolId = "core.test.run",
  ) {
    this.id = toolId;
  }

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Test Runner",
      description: "Executes unit, integration, or regression test suites in the workspace context.",
      permissions: ["terminal.execute"],
    };
  }

  validateInput(input: unknown): QuackResult<TestRunInput> {
    if (!isObject(input)) return invalidInput(this.id, "Test run input must be an object.");
    if ("command" in input && typeof input.command !== "string") {
      return invalidInput(this.id, "command must be a string.");
    }
    if ("framework" in input && typeof input.framework !== "string") {
      return invalidInput(this.id, "framework must be a string.");
    }
    if ("pattern" in input && typeof input.pattern !== "string") {
      return invalidInput(this.id, "pattern must be a string.");
    }
    if ("timeoutMs" in input && (typeof input.timeoutMs !== "number" || input.timeoutMs <= 0)) {
      return invalidInput(this.id, "timeoutMs must be a positive number.");
    }
    return ok({
      command: input.command as string | undefined,
      framework: input.framework as string | undefined,
      pattern: input.pattern as string | undefined,
      timeoutMs: input.timeoutMs as number | undefined,
      workingDirectory: input.workingDirectory as string | undefined,
    });
  }

  async execute(input: TestRunInput, _context: ToolExecutionContext): Promise<ToolResult<TestRunOutput>> {
    const cwd = resolveInsideWorkspace(this.options.workspaceRoot, input.workingDirectory ?? ".");
    const timeoutMs = Math.min(input.timeoutMs ?? 60_000, 180_000);

    let cmd = "npm";
    let args = ["test", "--silent"];
    if (input.command && input.command.trim()) {
      const parsed = parseCommandArgs(input.command.trim());
      cmd = parsed.cmd;
      args = parsed.args;
    } else if (input.pattern) {
      cmd = "node";
      args = ["--test", input.pattern];
    }

    const startTime = Date.now();
    const result = await executeProcess({
      command: cmd,
      args,
      workingDirectory: cwd,
      environment: childProcessEnvironment(),
      timeoutMs,
    });
    const executionTimeMs = Date.now() - startTime;

    const passed = result.status === "COMPLETED" && result.exitCode === 0;
    const summary = passed
      ? `Tests passed successfully in ${executionTimeMs}ms.`
      : `Test run failed with exit code ${result.exitCode ?? result.status} in ${executionTimeMs}ms.`;

    return {
      output: {
        passed,
        exitCode: result.exitCode ?? -1,
        stdout: result.stdout.slice(-10_000), // Bounded buffer
        stderr: result.stderr.slice(-10_000),
        executionTimeMs,
        summary,
      },
    };
  }
}

// ── 3. Documentation Generate Tool ──────────────────────────────────

export interface DocsGenerateInput {
  readonly outputPath?: string;
  readonly title?: string;
  readonly workingDirectory?: string;
}

export interface DocsGenerateOutput {
  readonly outputPath: string;
  readonly filesIndexed: number;
  readonly byteLength: number;
  readonly summary: string;
}

export class DocsGenerateTool implements QuackTool<DocsGenerateInput, DocsGenerateOutput> {
  readonly id: string;

  constructor(
    private readonly options: { readonly workspaceRoot: string },
    toolId = "core.docs.generate",
  ) {
    this.id = toolId;
  }

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Documentation Generator",
      description: "Generates structured project documentation from workspace structure and code.",
      permissions: ["workspace.read", "workspace.write"],
    };
  }

  validateInput(input: unknown): QuackResult<DocsGenerateInput> {
    if (!isObject(input)) return invalidInput(this.id, "Documentation generator input must be an object.");
    if ("outputPath" in input && typeof input.outputPath !== "string") {
      return invalidInput(this.id, "outputPath must be a string.");
    }
    if ("title" in input && typeof input.title !== "string") {
      return invalidInput(this.id, "title must be a string.");
    }
    return ok({
      outputPath: input.outputPath as string | undefined,
      title: input.title as string | undefined,
      workingDirectory: input.workingDirectory as string | undefined,
    });
  }

  async execute(input: DocsGenerateInput, _context: ToolExecutionContext): Promise<ToolResult<DocsGenerateOutput>> {
    const cwd = resolveInsideWorkspace(this.options.workspaceRoot, input.workingDirectory ?? ".");
    const relTarget = input.outputPath ?? "docs/WORKSPACE_OVERVIEW.md";
    const targetFile = resolveInsideWorkspace(this.options.workspaceRoot, relTarget);

    // Read package.json if present
    let pkgName = "Workspace Project";
    let pkgDesc = "Autonomous workspace managed by QUACK.";
    let pkgVersion = "1.0.0";
    try {
      const pkgPath = join(cwd, "package.json");
      const pkgContent = await readFile(pkgPath, "utf8");
      const pkg = JSON.parse(pkgContent);
      if (pkg.name) pkgName = String(pkg.name);
      if (pkg.description) pkgDesc = String(pkg.description);
      if (pkg.version) pkgVersion = String(pkg.version);
    } catch {
      // Ignore missing package.json
    }

    // Traverse files up to depth 3
    const files: string[] = [];
    async function scan(dir: string, depth: number) {
      if (depth > 3 || files.length >= 200) return;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await scan(fullPath, depth + 1);
          } else if (entry.isFile()) {
            files.push(relative(cwd, fullPath));
          }
        }
      } catch {
        // Skip unreadable
      }
    }
    await scan(cwd, 0);

    // Build Markdown
    const docTitle = input.title ?? `${pkgName} — Architecture & Documentation`;
    const lines = [
      `# ${docTitle}`,
      "",
      `> Version ${pkgVersion} | Generated by QUACK Documentation Generator on ${new Date().toISOString()}`,
      "",
      `## Overview`,
      pkgDesc,
      "",
      `## Indexed Files (${files.length} files scanned)`,
      "",
      ...files.slice(0, 100).map((f) => `- \`${f}\``),
      ...(files.length > 100 ? [`- ... and ${files.length - 100} more files`] : []),
      "",
      `## Architecture & Capabilities`,
      `This repository is configured with governed execution, verifiable intent, and capability boundaries.`,
      "",
    ];

    const content = lines.join("\n");
    await mkdir(dirname(targetFile), { recursive: true });
    await writeFile(targetFile, content, "utf8");

    return {
      output: {
        outputPath: relative(this.options.workspaceRoot, targetFile),
        filesIndexed: files.length,
        byteLength: Buffer.byteLength(content, "utf8"),
        summary: `Successfully generated documentation at ${relTarget} (${files.length} files indexed).`,
      },
    };
  }
}
