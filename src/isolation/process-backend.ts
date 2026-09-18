import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { executeProcess } from "../platform/process.js";
import { now, type IsoTimestamp } from "../core/types.js";
import {
  effectiveGuarantees, validateIsolationProfile,
  type BackendAvailability, type IsolationBackend, type IsolationProfile,
  type IsolationRequest, type IsolationResult, type ProbeableIsolationBackend,
} from "./contract.js";

/**
 * P13 (ADR 0047): OS process isolation backend.
 *
 * Runs a module workload inside a DEDICATED OS CHILD PROCESS — a real
 * process boundary, unlike the ADR 0039 worker-thread backend (which shares
 * the host process and therefore cannot seal `process.env` or contain
 * native crashes).
 *
 * Enforced on this backend:
 * - PROCESS: a separate OS process; the supervisor kills the whole tree on
 *   timeout/cancellation (taskkill /T on Windows, SIGKILL on POSIX). The
 *   workload cannot outlive its supervisor decision beyond the bounded
 *   tree-kill window.
 * - ENVIRONMENT: the child receives ONLY the policy variables (plus the
 *   runner spec) — an explicitly constructed env, never `process.env`.
 *   Host-planted secrets and custom host values are NOT inherited. Windows
 *   injects OS-identity variables (SYSTEMROOT, default system PATH, TEMP…)
 *   into every child process regardless of the passed environment block;
 *   those are platform-required defaults, not inherited host values.
 * - WORKING DIRECTORY: the child's cwd is the workspace root; the workload
 *   module must resolve inside it.
 * - WALL CLOCK / CANCELLATION / OUTPUT BYTES: enforced by the governed
 *   process abstraction (bounded stdout/stderr capture, deterministic
 *   terminal states).
 *
 * Honest non-boundaries (must never be claimed as isolation):
 * - FILESYSTEM: the child runs as the same OS user and can technically
 *   address other paths. Policy validation happens at the IO boundary the
 *   workload kit exposes (resolveInside), same as the worker backend.
 *   Guarantee stays BEST_EFFORT.
 * - NETWORK: the child process has normal network reach. Guarantee is
 *   UNSUPPORTED; a profile demanding ALLOWLIST networking fails closed
 *   here and must resolve a container backend instead.
 * - SECRETS: no secret broker exists across the process boundary; profiles
 *   naming secrets fail closed at validation.
 */

const RUNNER_SOURCE = `
// QUACK isolation child runner (P13). Loaded with an explicitly constructed
// environment; the workload module is required from the workspace root.
// The spec crosses via the QUACK_ISOLATION_SPEC env variable (the only
// non-policy env the child receives); the result returns as one bounded
// JSON line on stdout.
const path = require("node:path");
const fs = require("node:fs");

function resolveInside(root, candidate) {
  const resolved = path.resolve(candidate);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Sandbox IO escape blocked: path is outside the workspace root.");
  }
  return resolved;
}

(async () => {
  const spec = JSON.parse(process.env.QUACK_ISOLATION_SPEC);
  try {
    const module = require(path.resolve(spec.workspaceRoot, spec.entry));
    const run = module.run;
    if (typeof run !== "function") throw new Error("Workload module must export run(io).");
    const output = await run({
      workspaceRoot: spec.workspaceRoot,
      environment: spec.environment,
      args: spec.args,
      io: { resolveInside },
    });
    process.stdout.write(JSON.stringify({ ok: true, output: output ?? {} }) + "\\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) }) + "\\n");
  }
})();
`;

/** Minimum sane wall clock; also bounds the availability probe child. */
const PROBE_TIMEOUT_MS = 5_000;

export class ProcessIsolationBackend implements ProbeableIsolationBackend {
  readonly id = "os-process";
  readonly supportedLevels: readonly IsolationProfile["level"][] = ["WORKER_PROCESS"];
  readonly guarantees = {
    filesystem: "BEST_EFFORT" as const,
    network: "UNSUPPORTED" as const,
    process: "ENFORCED" as const,
    environment: "ENFORCED" as const,
    resources: "BEST_EFFORT" as const,
    secrets: "UNSUPPORTED" as const,
  };

  /** Node itself is the mechanism: availability is structural on every supported platform. */
  readonly availability = (): BackendAvailability =>
    ({ available: typeof process.execPath === "string" && process.execPath.length > 0,
       reason: "Node child-process execution is available on this host." });

  async execute(request: IsolationRequest): Promise<IsolationResult> {
    const startedAt = now();
    const fail = (status: IsolationResult["status"], error: string): IsolationResult =>
      ({ status, error, startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level });

    validateIsolationProfile(request.profile);
    if (request.profile.level !== "WORKER_PROCESS") return fail("UNSUPPORTED", `${this.id} executes WORKER_PROCESS requests only.`);
    const guarantees = effectiveGuarantees(this, request.profile);
    if (guarantees.network === "UNSUPPORTED" && request.profile.network.mode !== "DENY") {
      return fail("UNSUPPORTED", "Network policy beyond DENY cannot be enforced by the process backend; failing closed.");
    }
    if (request.profile.environment.secrets.length > 0) {
      return fail("UNSUPPORTED", "Secret mediation is unsupported on this backend; failing closed.");
    }
    if (request.workload.kind !== "module") return fail("UNSUPPORTED", "Process isolation requires a module workload; host closures cannot cross the process boundary.");
    const workload = request.workload;
    if (request.signal?.aborted) return fail("CANCELLED", "Isolation request cancelled before start.");

    // The entry must resolve inside the workspace root before any spawn.
    const entryResolved = resolveInsideRoot(request.profile.filesystem.workspaceRoot, workload.entry);
    if (existsSync(entryResolved) !== true) return fail("FAILED", `Workload entry '${workload.entry}' does not exist inside the workspace root.`);

    const runnerDir = await mkdtemp(join(tmpdir(), "quack-isolation-proc-"));
    const runnerFile = join(runnerDir, "runner.cjs");
    await writeFile(runnerFile, RUNNER_SOURCE, "utf8");
    const spec = {
      workspaceRoot: resolve(request.profile.filesystem.workspaceRoot),
      entry: workload.entry,
      args: workload.args,
      environment: { ...request.profile.environment.variables },
    };
    const maxOutputBytes = request.profile.limits.maxOutputBytes ?? 262_144;

    try {
      const run = await executeProcess({
        command: process.execPath,
        args: [runnerFile],
        // OS-level environment boundary: the child receives the policy
        // variables plus the runner spec — NOTHING else. Host secrets and
        // host PATH are absent from the child's environment block.
        workingDirectory: spec.workspaceRoot,
        environment: {
          QUACK_ISOLATION_SPEC: JSON.stringify(spec),
          NODE_OPTIONS: "",
          NODE_ENV: "production",
        },
        timeoutMs: request.profile.limits.wallClockMs,
        maxStdoutBytes: maxOutputBytes,
        maxStderrBytes: 64 * 1024,
        signal: request.signal,
      });
      switch (run.status) {
        case "TIMED_OUT":
          return { status: "TIMED_OUT", error: `Workload exceeded the ${request.profile.limits.wallClockMs}ms wall-clock limit.`,
            startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level };
        case "CANCELLED":
          return { status: "CANCELLED", error: "Workload cancelled by supervisor signal.",
            startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level };
        case "FAILED_TO_START":
          return fail("FAILED", `Isolated process failed to start: ${run.stderr}`);
        case "COMPLETED": {
          if (run.truncated) {
            return { status: "FAILED", error: "Isolated workload output exceeded the containment limit; the result is dropped.",
              startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level };
          }
          const parsed = parseResultLine(run.stdout);
          if (!parsed.ok) return fail("FAILED", parsed.error);
          return { status: "SUCCEEDED", output: parsed.output as IsolationResult["output"], startedAt, completedAt: now(),
            backend: this.id, profileLevel: request.profile.level };
        }
      }
    } finally {
      await rm(runnerDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Metadata for evidence/observability; never carries payload content. */
  async describeRequest(request: IsolationRequest): Promise<Record<string, unknown>> {
    const entry = request.workload.kind === "module"
      ? { entryDigest: createHash("sha256").update(request.workload.entry).digest("hex").slice(0, 16) }
      : {};
    return { backend: this.id, level: request.profile.level, ...entry };
  }
}

/** Parse the single JSON result line from the child's stdout. */
function parseResultLine(stdout: string): { ok: true; output: Record<string, unknown> } | { ok: false; error: string } {
  const line = stdout.trim().split(/\r?\n/).at(-1) ?? "";
  if (line.length === 0) return { ok: false, error: "Isolated workload produced no result line." };
  try {
    const parsed = JSON.parse(line) as { ok?: unknown; output?: unknown; error?: unknown };
    if (parsed.ok === true) {
      if (typeof parsed.output !== "object" || parsed.output === null) return { ok: false, error: "Isolated workload returned a non-object output." };
      return { ok: true, output: parsed.output as Record<string, unknown> };
    }
    return { ok: false, error: typeof parsed.error === "string" ? parsed.error : "Isolated workload failed." };
  } catch {
    return { ok: false, error: "Isolated workload result is not valid JSON." };
  }
}

/** Entry must resolve inside the workspace root (traversal rejected before spawn). */
function resolveInsideRoot(workspaceRoot: string, entry: string): string {
  const resolved = resolve(workspaceRoot, entry);
  const root = resolve(workspaceRoot);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error("Workload entry resolves outside the workspace root.");
  }
  return resolved;
}

/** Async existence check preserved for symmetric style with the runner probe. */
export async function ensureProcessBackendAvailable(backend: ProcessIsolationBackend): Promise<BackendAvailability> {
  const availability = backend.availability();
  return availability.available
    ? { available: true, reason: availability.reason }
    : { available: false, reason: availability.reason };
}

/** Bounded structural check used by tests: runner file lands under the OS temp dir. */
export async function processBackendRunnerProbe(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), "quack-isolation-probe-"));
  try {
    const file = join(dir, "runner.cjs");
    await writeFile(file, RUNNER_SOURCE, "utf8");
    const stats = await stat(file);
    return stats.isFile();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
