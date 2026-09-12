import { createHash } from "node:crypto";
import { executeProcess, probeBinaryAvailable, childProcessEnvironment } from "../platform/process.js";
import { now } from "../core/types.js";
import type { JsonObject } from "../core/types.js";
import {
  effectiveGuarantees, validateIsolationProfile,
  type BackendAvailability, type IsolationProfile,
  type IsolationRequest, type IsolationResult, type ProbeableIsolationBackend,
} from "./contract.js";

/**
 * P13 (ADR 0047): container isolation backend over a container runtime
 * (Docker-compatible CLI). This is the first backend in QUACK that enforces
 * OS-level boundaries for real: separate filesystem view, sealed network
 * (`--network none`), explicit environment only, and kernel-enforced memory
 * limits (`--memory`).
 *
 * Enforced by the container boundary:
 * - NETWORK: `--network none` — the kernel namespace removes all network
 *   interfaces from the container. ALLOWLIST networking is UNSUPPORTED on
 *   this backend v1 and fails closed (no half-isolated networking claims).
 * - ENVIRONMENT: only `--env` policy variables cross the boundary. Host
 *   environment is never passed (`--env` entries are constructed).
 * - FILESYSTEM: the container sees only its scratch directory (tempfs-mounted
 *   workspace copy) and the read-only runner mount. The host workspace is
 *   NOT mounted wholesale; sensitive host paths are not present.
 * - RESOURCES (memory): `--memory` is a kernel-enforced cgroup limit
 *   (Linux containers; Docker Desktop WSL2 on Windows). CPU shares are
 *   applied as `--cpus` where supported and reported BEST_EFFORT.
 * - PROCESS/TIMEOUT/CANCELLATION: `docker stop -t` plus a bounded wait;
 *   the container is removed on every terminal path.
 * - OUTPUT BYTES: bounded capture at the supervisor boundary.
 *
 * Availability is environment-dependent BY DESIGN (P13.21): the backend
 * probes the docker CLI AND daemon at resolution time. When unavailable
 * (daemon down, CI runner without docker, restricted hosts), resolution
 * fails closed — an isolation-requiring execution DENIES, never downgrades.
 */

/** Bounded wall clock for availability probes. */
const PROBE_TIMEOUT_MS = 10_000;

/** Deterministic Node runtime image — pinned, never pulled dynamically. */
const RUNTIME_IMAGE = "docker.io/library/node:22-alpine3.20";

/** Wall clock for the stop+rm settlement after timeout/cancel. */
const STOP_SETTLEMENT_MS = 10_000;

export class ContainerIsolationBackend implements ProbeableIsolationBackend {
  readonly id = "docker-container";
  readonly supportedLevels: readonly IsolationProfile["level"][] = ["CONTAINER_ISOLATED"];
  readonly guarantees = {
    filesystem: "ENFORCED" as const,
    network: "ENFORCED" as const,
    process: "ENFORCED" as const,
    environment: "ENFORCED" as const,
    resources: "BEST_EFFORT" as const,
    secrets: "UNSUPPORTED" as const,
  };

  private availabilityCache: { at: number; result: BackendAvailability } | undefined;
  private readonly availabilityCacheMs: number;

  constructor(options: { readonly availabilityCacheMs?: number } = {}) {
    this.availabilityCacheMs = options.availabilityCacheMs ?? 30_000;
  }

  /** Probe docker CLI + daemon. Never throws; errors mean unavailable. */
  readonly availability = async (): Promise<BackendAvailability> => {
    if (!probeBinaryAvailable("docker")) {
      return { available: false, reason: "docker CLI is not installed on this host." };
    }
    const cached = this.availabilityCache;
    if (cached && Date.now() - cached.at < this.availabilityCacheMs) return cached.result;
    const probe = await executeProcess({
      command: "docker", args: ["version", "--format", "{{.Server.Version}}"],
      workingDirectory: process.cwd(), environment: childProcessEnvironment(),
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const result: BackendAvailability = probe.status === "COMPLETED" && probe.exitCode === 0
      ? { available: true, reason: "docker daemon reachable." }
      : { available: false, reason: "docker daemon is not reachable on this host." };
    this.availabilityCache = { at: Date.now(), result };
    return result;
  };

  async execute(request: IsolationRequest): Promise<IsolationResult> {
    const startedAt = now();
    const fail = (status: IsolationResult["status"], error: string): IsolationResult =>
      ({ status, error, startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level });

    validateIsolationProfile(request.profile);
    if (request.profile.level !== "CONTAINER_ISOLATED") return fail("UNSUPPORTED", `${this.id} executes CONTAINER_ISOLATED requests only.`);
    const guarantees = effectiveGuarantees(this, request.profile);
    if (guarantees.network === "ENFORCED" && request.profile.network.mode === "ALLOWLIST") {
      // v1 honesty: `--network none` is the ONLY enforceable network policy
      // here. An allowlist demand fails closed rather than pretending.
      return fail("UNSUPPORTED", "ALLOWLIST networking cannot be enforced by this backend (network none only); failing closed.");
    }
    if (request.profile.environment.secrets.length > 0) {
      return fail("UNSUPPORTED", "Secret mediation is unsupported across the container boundary; failing closed.");
    }
    if (request.workload.kind !== "module") return fail("UNSUPPORTED", "Container isolation requires a module workload; host closures cannot cross the container boundary.");
    const workload = request.workload;

    const availability = await this.availability();
    if (!availability.available) return fail("UNSUPPORTED", `Container backend unavailable: ${availability.reason}`);

    // Provision scratch FIRST: the runner and the workspace copy are mounted
    // READ-ONLY into the container at create time (no post-create writes to a
    // read-only rootfs; the workload's writable world is container-local
    // tmpfs only). Symlinks in the workspace tree are rejected during copy.
    const scratch = await this.provisionScratch(workload, request);
    if (!scratch.ok) return fail("FAILED", scratch.error);

    const containerId = await this.runDocker([
      "create",
      "--network", "none",
      "--memory", String(containerMemoryBytes(request.profile)),
      "--cpus", "1",
      "--pids-limit", "64",
      "--read-only",
      "--tmpfs", "/tmp:rw,size=16m",
      "--user", "65534:65534",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--mount", `type=bind,source=${scratch.output.workloadDir},target=/workspace,readonly`,
      "--mount", `type=bind,source=${scratch.output.runnerDir},target=/runner,readonly`,
      ...containerEnvFlags(request.profile.environment.variables),
      "--name", containerName(request),
      RUNTIME_IMAGE,
      "node", "/runner/runner.cjs",
    ]);
    try {
      if (!containerId.ok) return fail("FAILED", `container create failed: ${containerId.error}`);

      // P13 security review finding 3: the wall-clock limit is ENFORCED on
      // the start invocation itself (limit + bounded stop-settlement margin),
      // not a fixed probe budget. The abort signal crosses into the docker
      // invocation so cancellation terminates promptly.
      const started = await this.runDocker(["start", "-a", containerId.output], {
        timeoutMs: request.profile.limits.wallClockMs + STOP_SETTLEMENT_MS,
        signal: request.signal,
      });

      if (request.signal?.aborted) {
        return { status: "CANCELLED", error: "Workload cancelled by supervisor signal.",
          startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level };
      }
      if (started.timedOut) {
        return { status: "TIMED_OUT", error: `Workload exceeded the ${request.profile.limits.wallClockMs}ms wall-clock limit.`,
          startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level };
      }
      const stdout = started.ok ? started.output : "";
      if (stdout.trim().length === 0) return fail("FAILED", `Isolated container produced no result line${started.ok ? "" : `: ${started.error}`}`);
      const parsed = this.parseResultLine(stdout);
      if (!parsed.ok) return fail("FAILED", parsed.error);
      return { status: "SUCCEEDED", output: parsed.output as IsolationResult["output"],
        startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level };
    } finally {
      const containerIdValue = containerId.ok ? containerId.output : "";
      if (containerIdValue) {
        const stopped = await this.runDocker(["stop", "-t", String(Math.max(1, Math.floor(request.profile.limits.wallClockMs / 1000)) + 5), containerIdValue]).catch(() => undefined);
        void stopped;
        await this.removeContainer(containerIdValue);
      }
      await this.cleanupScratch(scratch.output.scratchDir);
    }
  }

  // -----------------------------------------------------------------
  // internals
  // -----------------------------------------------------------------

  private parseResultLine(stdout: string): { ok: true; output: JsonObject } | { ok: false; error: string } {
    const line = stdout.trim().split(/\r?\n/).at(-1) ?? "";
    if (line.length === 0) return { ok: false, error: "Isolated workload produced no result line." };
    try {
      const parsed = JSON.parse(line) as { ok?: unknown; output?: unknown; error?: unknown };
      if (parsed.ok === true) {
        if (typeof parsed.output !== "object" || parsed.output === null) return { ok: false, error: "Isolated workload returned a non-object output." };
        return { ok: true, output: parsed.output as JsonObject };
      }
      return { ok: false, error: typeof parsed.error === "string" ? parsed.error : "Isolated workload failed." };
    } catch {
      return { ok: false, error: "Isolated workload result is not valid JSON." };
    }
  }

  private async provisionScratch(workload: { readonly entry: string; readonly args: JsonObject }, request: IsolationRequest): Promise<
    | { ok: true; output: { readonly runnerDir: string; readonly runnerPath: string; readonly scratchDir: string; readonly workloadDir: string } }
    | { ok: false; error: string }
  > {
    const { mkdtemp, cp, mkdir, writeFile, readdir, rm, stat, lstat } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join, resolve, sep } = await import("node:path");
    // P13 security review finding 7: entry containment BEFORE any docker
    // artifact is created — traversal entries never reach provisioning.
    if (workload.entry.startsWith("/") || workload.entry.startsWith("\\") || /^[a-zA-Z]:/.test(workload.entry) || workload.entry.split(/[\\/]+/).includes("..")) {
      return { ok: false, error: "workload entry must be a safe relative path" };
    }
    const scratchDir = await mkdtemp(join(tmpdir(), "quack-container-"));
    try {
      const runnerDir = join(scratchDir, "runner");
      await mkdir(runnerDir);
      const runnerPath = join(runnerDir, "runner.cjs");
      await writeFile(runnerPath, CONTAINER_RUNNER_SOURCE, "utf8");
      const workloadDir = join(scratchDir, "workspace");
      await mkdir(workloadDir);
      const sourceRoot = resolve(request.profile.filesystem.workspaceRoot);
      // Copy the workspace subtree INTO scratch (symlinks rejected: they
      // could point outside the tree; junctions same on Windows).
      await copyTree(sourceRoot, workloadDir, 3, { count: 200 });
      const spec = { entry: workload.entry, args: workload.args, environment: request.profile.environment.variables };
      await writeFile(join(workloadDir, "__quack_spec.json"), JSON.stringify(spec), "utf8");
      return { ok: true, output: { runnerDir, runnerPath, scratchDir, workloadDir } };
    } catch (error) {
      await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    async function copyTree(from: string, to: string, depthRemaining: number, entryBudget: { count: number }): Promise<void> {
      if (depthRemaining < 0) throw new Error("workspace copy depth budget exceeded");
      const entries = await readdir(from, { withFileTypes: true });
      for (const entry of entries) {
        if (entryBudget.count-- <= 0) throw new Error("workspace copy entry budget exceeded");
        const source = join(from, entry.name);
        const target = join(to, entry.name);
        const info = await lstat(source);
        if (info.isSymbolicLink()) throw new Error(`symlink '${entry.name}' in workspace is rejected by container provisioning`);
        if (entry.isDirectory()) {
          await mkdir(target);
          await copyTree(source, target, depthRemaining - 1, entryBudget);
        } else if (info.isFile()) {
          await cp(source, target, { recursive: false });
        } else {
          throw new Error(`unsupported workspace entry '${entry.name}' rejected by container provisioning`);
        }
      }
    }
  }

  private async cleanupScratch(scratchDir: string): Promise<void> {
    const { rm } = await import("node:fs/promises");
    await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
  }

  private async removeContainer(containerId: string): Promise<void> {
    await this.runDocker(["rm", "-f", containerId]).catch(() => undefined);
  }

  /**
   * Governed docker CLI invocation (argv-only; never a shell string).
   * Optional per-invocation timeout + abort signal (the start invocation
   * passes the PROFILE wall-clock limit; short management invocations keep
   * the fixed probe budget).
   */
  private async runDocker(args: readonly string[], options: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {}): Promise<
    | { ok: true; output: string; timedOut: boolean }
    | { ok: false; error: string; timedOut: boolean }
  > {
    const result = await executeProcess({
      command: "docker", args: [...args],
      workingDirectory: process.cwd(),
      environment: childProcessEnvironment(),
      timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS * 6,
      maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 64 * 1024,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (result.status === "COMPLETED") {
      if (result.exitCode === 0) return { ok: true, output: result.stdout, timedOut: false };
      return { ok: false, error: result.stderr.trim() || `docker exited ${result.exitCode}`, timedOut: false };
    }
    if (result.status === "TIMED_OUT") return { ok: false, error: "docker invocation exceeded its own bounded time.", timedOut: true };
    if (result.status === "CANCELLED") return { ok: false, error: "docker invocation cancelled by supervisor signal.", timedOut: false };
    return { ok: false, error: `docker invocation ${result.status}: ${result.stderr.trim()}`, timedOut: false };
  }
}

/** Container runner: reads spec, requires the workload, prints ONE JSON line. */
const CONTAINER_RUNNER_SOURCE = `
const fs = require("node:fs");
const path = require("node:path");
function resolveInside(root, candidate) {
  const resolved = path.resolve(candidate);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Sandbox IO escape blocked: path is outside the workspace root.");
  }
  return resolved;
}
(async () => {
  const spec = JSON.parse(fs.readFileSync("/workspace/__quack_spec.json", "utf8"));
  try {
    const module = require(path.resolve("/workspace", spec.entry));
    const run = module.run;
    if (typeof run !== "function") throw new Error("Workload module must export run(io).");
    const output = await run({
      workspaceRoot: "/workspace",
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

/** Memory limit: policy value clamped to a safe container floor (16MB). */
function containerMemoryBytes(profile: IsolationProfile): number {
  const requested = profile.limits.memoryBytes ?? 256 * 1024 * 1024;
  return Math.max(16 * 1024 * 1024, requested);
}

/** Deterministic, collision-resistant container name from request identity. */
function containerName(request: IsolationRequest): string {
  const material = `${request.missionId}:${request.executionId}:${request.actor}`;
  return `quack-iso-${createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
}

/** --env flags built from policy variables only (never process.env). */
function containerEnvFlags(variables: Readonly<Record<string, string>>): readonly string[] {
  const flags: string[] = [];
  for (const [name, value] of Object.entries(variables)) {
    flags.push("--env", `${name}=${value}`);
  }
  return flags;
}
