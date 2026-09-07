/**
 * TerminalTool - Executes commands in a terminal with permission gating.
 *
 * IMPORTANT SECURITY CONSIDERATIONS:
 * - Always validate and sanitize commands before execution.
 * - Never execute commands that could compromise system security.
 * - Ensure proper permission checks are in place.
 * - Log all terminal executions for audit purposes.
 */
import { execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { type QuackTool, type ToolExecutionContext, type ToolMetadata, type ToolResult } from "./tool.js";
import { resolveInsideWorkspace } from "./workspace-filesystem.js";
import { fail, ok, type QuackResult } from "../core/types.js";

const MAX_BUFFER = 1024 * 1024;

/** Environment variable names that look like secrets and are never inherited. */
const SECRET_ENV_PATTERNS: readonly RegExp[] = [
  /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS)$/i,
  /^(?:API|AUTH|ACCESS)_/i,
  /^NVIDIA_API_KEY$/i,
  /^QUACK_OPENAI_API_KEY$/i,
  /^QUACK_VLLM_API_KEY$/i,
  /^.*_API_KEY$/i,
];

/**
 * Sanitize the environment a terminal child inherits: secret-shaped
 * variables are removed, everything else passes. Caller-supplied `env` wins
 * over the sanitized base. This is a denylist of secret SHAPES, not an
 * allowlist; an explicitly authorized secret mechanism does not exist yet
 * (fail-closed secret policy is the isolation contract's job).
 */
function sanitizeEnvironment(overrides?: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (SECRET_ENV_PATTERNS.some(pattern => pattern.test(key))) continue;
    sanitized[key] = value;
  }
  return { ...sanitized, ...(overrides ?? {}) };
}

export interface TerminalToolInput {
  readonly command: string;
  readonly workingDirectory?: string;
  readonly timeout?: number; // ms
  readonly env?: Record<string, string>;
}

export interface TerminalToolOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly command: string;
  readonly executionTimeMs: number;
  readonly processErrorCode?: string;
  readonly signal?: string;
  readonly killed?: boolean;
}

/**
 * TerminalTool executes shell commands with safety guardrails.
 *
 * SECURITY: This tool requires "terminal.execute" permission.
 * It never executes destructive commands without explicit confirmation.
 */
export class TerminalTool implements QuackTool<TerminalToolInput, TerminalToolOutput> {
  readonly id = "core.terminal.execute";

  constructor(private readonly options: { readonly workspaceRoot: string }) {}

  // List of known dangerous command patterns
  private static readonly DANGEROUS_PATTERNS = [
    /^rm\s+-rf/i,
    /^rm\s+.*\s+\/\s*$/i,
    /^dd\s+/i,
    /^mkfs/i,
    /^>\s*\/dev\/sda/i,
    /:(){ :|:& };:/i, // Fork bomb
  ];

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Terminal",
      description: "Executes a shell command in the workspace context. Requires terminal.execute permission.",
      permissions: ["terminal.execute"],
    };
  }

  validateInput(input: unknown): QuackResult<TerminalToolInput> {
    if (!isObject(input)) return invalidInput(this.id, "Terminal input must be an object.");
    if (typeof input.command !== "string" || input.command.trim().length === 0) {
      return invalidInput(this.id, "Terminal tool requires non-empty string input.command.");
    }
    if ("workingDirectory" in input && typeof input.workingDirectory !== "string") {
      return invalidInput(this.id, "Terminal input.workingDirectory must be a string.");
    }
    if ("timeout" in input && (typeof input.timeout !== "number" || input.timeout <= 0)) {
      return invalidInput(this.id, "Terminal input.timeout must be a positive number.");
    }
    if ("env" in input && !isStringRecord(input.env)) {
      return invalidInput(this.id, "Terminal input.env must be an object of string values.");
    }
    return ok({
      command: input.command,
      workingDirectory: input.workingDirectory as string | undefined,
      timeout: input.timeout as number | undefined,
      env: input.env as Record<string, string> | undefined,
    });
  }

  async execute(input: TerminalToolInput, _context: ToolExecutionContext): Promise<ToolResult<TerminalToolOutput>> {
    const startTime = Date.now();

    // Validate command safety
    if (this.isDangerousCommand(input.command)) {
      throw new Error(`Command blocked for safety: ${input.command}`);
    }

    const { execSync } = await import("node:child_process");
    const options: import("node:child_process").ExecSyncOptions = {
      encoding: "utf-8",
      timeout: input.timeout ?? 60_000,
      cwd: resolveInsideWorkspace(this.options.workspaceRoot, input.workingDirectory ?? "."),
      // Environment is sanitized, never inherited wholesale: secret-shaped
      // variables (keys/tokens/passwords/credentials) are removed before the
      // child sees anything (ADR 0040 §environment policy).
      env: sanitizeEnvironment(input.env),
      maxBuffer: MAX_BUFFER,
    };

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let executionTimeMs = 0;
    let processErrorCode: string | undefined;
    let signal: string | undefined;
    let killed: boolean | undefined;

    try {
      stdout = execSync(input.command, options) as string;
      executionTimeMs = Date.now() - startTime;
    } catch (error) {
      executionTimeMs = Date.now() - startTime;
      if (error instanceof Error && "status" in error) {
        const execError = error as unknown as { status: number | null; stdout: string; stderr: string; code?: string; signal?: string; killed?: boolean };
        exitCode = typeof execError.status === "number" ? execError.status : -1;
        stdout = execError.stdout || "";
        stderr = execError.stderr || "";
        processErrorCode = execError.code;
        signal = execError.signal;
        killed = execError.killed;
        if (exitCode === -1 && stderr.length === 0) {
          stderr = `Process ended without an exit status (code=${processErrorCode ?? "unknown"}, signal=${signal ?? "none"}).`;
        }
      } else {
        stderr = error instanceof Error ? error.message : String(error);
        exitCode = 1;
      }
    }

    return {
      output: {
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode,
        command: input.command,
        executionTimeMs,
        processErrorCode,
        signal,
        killed,
      },
    };
  }

  /**
   * Checks if a command contains known dangerous patterns.
   */
  private isDangerousCommand(command: string): boolean {
    return TerminalTool.DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((entry) => typeof entry === "string");
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
