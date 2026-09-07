import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type QuackResult, fail, ok } from "../core/types.js";
import { type ToolExecuteFn, type VerificationCheckResult, type VerificationResult } from "./types.js";

const TERMINAL_TOOL_ID = "core.terminal.execute";
const DEFAULT_TIMEOUT_MS = 180_000;

interface CheckSpec {
  readonly name: string;
  readonly command: string;
}

/** §22 — structured, code-run verification. Never natural-language-only. */
export class VerificationRunner {
  constructor(
    private readonly deps: {
      readonly toolExecute: ToolExecuteFn;
      readonly taskId: string;
      readonly actor?: string;
      readonly timeoutMs?: number;
    },
  ) {}

  /** Fast, cheap check run first: typecheck only. */
  async runTargeted(workingDirectory: string): Promise<QuackResult<VerificationResult>> {
    const results = await this.runChecks(workingDirectory, [{ name: "typecheck", command: npmCommand("run typecheck") }]);
    if (!results.ok) return results;
    return ok({ targeted: results.data, full: [], allPassed: results.data.every((r) => r.passed) });
  }

  /** Full suite: typecheck + build + test, compared against a recorded baseline elsewhere. */
  async runFull(workingDirectory: string): Promise<QuackResult<VerificationResult>> {
    const results = await this.runChecks(workingDirectory, [
      { name: "typecheck", command: npmCommand("run typecheck") },
      { name: "test", command: npmCommand("test") },
    ]);
    if (!results.ok) return results;
    return ok({ targeted: [], full: results.data, allPassed: results.data.every((r) => r.passed) });
  }

  private async runChecks(workingDirectory: string, specs: readonly CheckSpec[]): Promise<QuackResult<readonly VerificationCheckResult[]>> {
    const results: VerificationCheckResult[] = [];
    for (const spec of specs) {
      const result = await this.runOne(workingDirectory, spec);
      if (!result.ok) return result;
      results.push(result.data);
    }
    return ok(results);
  }

  private async runOne(workingDirectory: string, spec: CheckSpec): Promise<QuackResult<VerificationCheckResult>> {
    const startedAt = Date.now();
    const result = await this.deps.toolExecute(
      TERMINAL_TOOL_ID,
      { command: spec.command, workingDirectory, timeout: this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      { taskId: this.deps.taskId, actor: this.deps.actor },
    );
    if (!result.ok) return fail(result.error);

    const output = result.data as unknown as {
      stdout: string;
      stderr: string;
      exitCode: number;
      processErrorCode?: string;
      signal?: string;
      killed?: boolean;
    };
    const combined = `${output.stdout}\n${output.stderr}`;
    const { passCount, failCount } = parseTestSummary(combined);

    return ok({
      name: spec.name,
      command: spec.command,
      passed: output.exitCode === 0,
      summary: summarize(combined),
      durationMs: Date.now() - startedAt,
      passCount,
      failCount,
      exitCode: output.exitCode,
      processErrorCode: output.processErrorCode,
      signal: output.signal,
      killed: output.killed,
    });
  }
}

function npmCommand(args: string): string {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (process.platform !== "win32" || nodeMajor < 24) return `npm ${args}`;
  const npmCliCandidates = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
  const npmCli = npmCliCandidates.find((candidate) => existsSync(candidate));
  if (!npmCli || process.execPath.includes("\"") || npmCli.includes("\"")) return `npm ${args}`;
  return `"${process.execPath}" --no-maglev "${npmCli}" ${args}`;
}

function parseTestSummary(output: string): { passCount?: number; failCount?: number } {
  const pass = output.match(/# pass (\d+)/);
  const fail = output.match(/# fail (\d+)/);
  return {
    passCount: pass ? Number.parseInt(pass[1], 10) : undefined,
    failCount: fail ? Number.parseInt(fail[1], 10) : undefined,
  };
}

function summarize(output: string): string {
  const lines = output.split("\n").filter(Boolean);
  return lines.slice(-20).join("\n").slice(0, 4000);
}
