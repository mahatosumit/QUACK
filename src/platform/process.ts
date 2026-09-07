import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createId } from "../core/types.js";

/**
 * QUACK process execution abstraction (ADR 0040).
 *
 * Governed argv-based process execution. There is no implicit shell: commands
 * are argv arrays; shell strings are only available through the explicitly
 * authorized shell path and never assembled from untrusted input. The
 * environment is materialized from an explicit allowlist — never
 * `process.env` wholesale. Working directory must resolve inside the
 * authorized root. stdout/stderr are size-bounded; the process tree is
 * terminated on timeout/cancellation (Windows: taskkill /T; POSIX: SIGKILL
 * to the process; best-effort child cleanup is documented per platform).
 */

export interface ProcessExecutionRequest {
  /** Executable path or resolvable binary name (never a shell string). */
  readonly command: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  /** Exact environment variables passed; host environment is never inherited. */
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly signal?: AbortSignal;
}

export interface ProcessExecutionResult {
  readonly status: "COMPLETED" | "TIMED_OUT" | "CANCELLED" | "FAILED_TO_START";
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly durationMs: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export async function executeProcess(request: ProcessExecutionRequest): Promise<ProcessExecutionResult> {
  const started = Date.now();
  const maxStdout = request.maxStdoutBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const maxStderr = request.maxStderrBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  let child: ChildProcess;
  try {
    child = spawn(request.command, [...request.args], {
      cwd: request.workingDirectory,
      env: { ...request.environment },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return { status: "FAILED_TO_START", exitCode: null, stdout: "", stderr: String(error),
      truncated: false, durationMs: Date.now() - started };
  }

  let stdout = "";
  let stderr = "";
  let truncated = false;
  let stdoutBytes = 0;
  let stderrBytes = 0;

  child.stdout?.on("data", (chunk: Buffer) => {
    if (stdoutBytes + chunk.length > maxStdout) {
      truncated = true;
      stdout += chunk.subarray(0, Math.max(0, maxStdout - stdoutBytes)).toString("utf8");
      stdoutBytes = maxStdout;
      return;
    }
    stdoutBytes += chunk.length;
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderrBytes + chunk.length > maxStderr) {
      truncated = true;
      stderr += chunk.subarray(0, Math.max(0, maxStderr - stderrBytes)).toString("utf8");
      stderrBytes = maxStderr;
      return;
    }
    stderrBytes += chunk.length;
    stderr += chunk.toString("utf8");
  });

  return await new Promise<ProcessExecutionResult>(resolveResult => {
    let settled = false;
    let terminalIntent: "TIMED_OUT" | "CANCELLED" | undefined;
    const finish = (result: ProcessExecutionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      resolveResult(result);
    };
    // Terminal intents are recorded BEFORE killing so the close handler cannot
    // report COMPLETED for a process we decided to terminate.
    const settleTerminated = (): ProcessExecutionResult => ({
      status: terminalIntent ?? "COMPLETED", exitCode: null, stdout, stderr, truncated,
      durationMs: Date.now() - started,
    });
    const timer = setTimeout(() => {
      terminalIntent = "TIMED_OUT";
      void killTree(child).then(() => finish(settleTerminated()));
    }, request.timeoutMs);
    const onAbort = () => {
      terminalIntent = "CANCELLED";
      void killTree(child).then(() => finish(settleTerminated()));
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", error => finish({ status: "FAILED_TO_START", exitCode: null,
      stdout, stderr: stderr + String(error), truncated, durationMs: Date.now() - started }));
    child.once("close", code => {
      if (terminalIntent === undefined) {
        finish({ status: "COMPLETED", exitCode: code, stdout, stderr, truncated, durationMs: Date.now() - started });
      } else {
        finish(settleTerminated());
      }
    });
  });
}

/** Terminate the process tree and wait until the child is gone (bounded). */
function killTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const gone = new Promise<void>(resolveGone => {
    child.once("close", () => resolveGone());
    setTimeout(resolveGone, 2000);
  });
  if (process.platform === "win32") {
    // taskkill /T kills the whole tree; best-effort only.
    try { spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
    catch { /* already gone */ }
  } else {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
  return gone;
}

/** Identity for audit records; never contains environment content. */
export function processExecutionId(): string {
  return createId("proc");
}

/**
 * Minimal environment for child tooling (git, node, npx, tsc, eslint): PATH
 * plus the OS-identity variables Windows requires to spawn at all. This is
 * an allowlist of names; VALUES come from the host env, and secret-shaped
 * variables are never included by construction. Never spread `process.env`.
 */
export function childProcessEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of [
    "PATH",
    "SystemRoot", "SystemDrive", "ComSpec", "TEMP", "TMP",
    "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
    "HOME", "LANG",
  ]) {
    const value = process.env[name];
    if (typeof value === "string") environment[name] = value;
  }
  return environment;
}

/**
 * Resolve a Node-distributed CLI (npx) to an argv-safe invocation.
 *
 * `npx` is a `.cmd` shim on Windows and cannot be spawned with shell:false
 * (ENOENT; Node rejects .cmd without a shell since CVE-2024-27980). The
 * portable argv form is [process.execPath, <npx-cli.js>, ...] against the
 * npm installation inside the running Node distribution. Returns undefined
 * when the layout is unrecognized so callers fail structured, not hung.
 */
export function resolveNodeCliArgv(cli: "npx", args: readonly string[]): { command: string; args: string[] } | undefined {
  const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (!existsSync(npxCli)) return undefined;
  return { command: process.execPath, args: [npxCli, ...args] };
}

/**
 * Synchronous platform-portable binary-availability probe: spawn the binary
 * with a trivial argv directly (no shell, no `which`/`where` shell strings).
 * True when the binary exists and starts; false on ENOENT or spawn failure.
 */
export function probeBinaryAvailable(binary: string): boolean {
  try {
    const result = spawnSync(binary, ["--version"], { shell: false, timeout: 2000, stdio: "ignore", windowsHide: true, env: {} });
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      return code !== "ENOENT";
    }
    return true;
  } catch {
    return false;
  }
}