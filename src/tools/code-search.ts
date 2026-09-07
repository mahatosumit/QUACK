/**
 * Code Search Tool - Provides grep-like code search within the workspace.
 */
import { readdir, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import readline from "node:readline";
import { type QuackTool, type ToolExecutionContext, type ToolMetadata, type ToolResult } from "./tool.js";
import { fail, ok, type QuackResult } from "../core/types.js";

export interface CodeSearchInput {
  readonly pattern: string;
  readonly path?: string;
  readonly filePattern?: string; // e.g., "*.ts"
  readonly maxResults?: number;
  readonly contextLines?: number;
  readonly caseSensitive?: boolean;
  readonly regex?: boolean;
}

export interface CodeSearchResult {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly context: {
    readonly before: readonly string[];
    readonly after: readonly string[];
  };
}

export interface CodeSearchOutput {
  readonly pattern: string;
  readonly results: readonly CodeSearchResult[];
  readonly totalFilesSearched: number;
  readonly totalMatches: number;
}

/**
 * CodeSearchTool provides grep-like code search within the workspace.
 */
export class CodeSearchTool implements QuackTool<CodeSearchInput, CodeSearchOutput> {
  readonly id = "core.workspace.code-search";

  constructor(private readonly workspaceRoot: string) {}

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Code Search",
      description: "Searches for text patterns in files within the workspace.",
      permissions: ["workspace.read"],
    };
  }

  validateInput(input: unknown): QuackResult<CodeSearchInput> {
    if (!isObject(input)) return invalidInput(this.id, "Code search input must be an object.");
    if (typeof input.pattern !== "string" || input.pattern.length === 0) {
      return invalidInput(this.id, "Code search tool requires non-empty string input.pattern.");
    }
    for (const key of ["path", "filePattern"] as const) {
      if (key in input && typeof input[key] !== "string") {
        return invalidInput(this.id, `Code search input.${key} must be a string.`);
      }
    }
    for (const key of ["maxResults", "contextLines"] as const) {
      if (key in input && (typeof input[key] !== "number" || input[key] < 0)) {
        return invalidInput(this.id, `Code search input.${key} must be a non-negative number.`);
      }
    }
    for (const key of ["caseSensitive", "regex"] as const) {
      if (key in input && typeof input[key] !== "boolean") {
        return invalidInput(this.id, `Code search input.${key} must be a boolean.`);
      }
    }
    return ok(input as unknown as CodeSearchInput);
  }

  async execute(input: CodeSearchInput, _context: ToolExecutionContext): Promise<ToolResult<CodeSearchOutput>> {
    const maxResults = input.maxResults ?? 100;
    const contextLines = input.contextLines ?? 2;
    const searchRoot = resolve(this.workspaceRoot, input.path ?? ".");

    // Gather files to search
    const files = await this.gatherFiles(searchRoot, input.filePattern);
    const results: CodeSearchResult[] = [];

    const pattern = input.regex ? new RegExp(input.pattern, input.caseSensitive ? "g" : "gi") : input.pattern;
    const isRegex = input.regex ?? false;

    for (const file of files) {
      if (results.length >= maxResults) break;

      try {
        const fileResults = await this.searchFile(file, pattern, isRegex, maxResults - results.length, contextLines);
        results.push(...fileResults);
      } catch {
        // Skip files that can't be read (binary, etc.)
        continue;
      }
    }

    return {
      output: {
        pattern: input.pattern,
        results: results.slice(0, maxResults),
        totalFilesSearched: files.length,
        totalMatches: results.length,
      },
    };
  }

  private async gatherFiles(searchRoot: string, filePattern?: string): Promise<string[]> {
    const files: string[] = [];
    const ignoredDirs = new Set([".git", "node_modules", "dist", ".quack", "coverage"]);

    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (!filePattern || fullPath.endsWith(filePattern.replace("*", ""))) {
            files.push(fullPath);
          }
        }
      }
    }

    await walk(searchRoot);
    return files;
  }

  private async searchFile(
    filePath: string,
    pattern: RegExp | string,
    isRegex: boolean,
    remainingResults: number,
    contextLines: number,
  ): Promise<CodeSearchResult[]> {
    const results: CodeSearchResult[] = [];
    const lines: string[] = [];

    // Read file line by line
    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream });

    for await (const line of rl) {
      lines.push(line);
    }

    for (let i = 0; i < lines.length && results.length < remainingResults; i++) {
      const line = lines[i];
      let matched: boolean;

      if (isRegex && pattern instanceof RegExp) {
        const testPattern = new RegExp(pattern.source, "g");
        matched = testPattern.test(line);
      } else if (typeof pattern === "string") {
        matched = line.toLowerCase().includes(pattern.toLowerCase());
      } else {
        matched = false;
      }

      if (matched) {
        const column = line.indexOf(typeof pattern === "string" ? pattern : pattern.source);
        const before = [];
        const after = [];
        for (let j = Math.max(0, i - contextLines); j < i; j++) {
          before.push(lines[j]);
        }
        for (let j = i + 1; j < Math.min(lines.length, i + 1 + contextLines); j++) {
          after.push(lines[j]);
        }

        results.push({
          file: relative(this.workspaceRoot, filePath),
          line: i + 1,
          column: Math.max(0, column),
          text: line.trim(),
          context: { before, after },
        });
      }
    }

    return results;
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
