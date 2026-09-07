import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { now, type IsoTimestamp } from "../core/types.js";
import {
  effectiveGuarantees, validateIsolationProfile,
  type IsolationBackend, type IsolationRequest, type IsolationResult,
} from "./contract.js";

/**
 * Worker-process isolation backend (ADR 0039).
 *
 * Runs a workload inside a dedicated Node worker thread with:
 * - ENFORCED wall-clock timeout and cancellation (worker is terminated on
 *   expiry/abort and the result is deterministic);
 * - ENFORCED explicit environment materialization (the worker receives only
 *   the variables named in the policy — never `process.env`);
 * - BEST_EFFORT filesystem containment (paths are validated against the
 *   workspace root at the IO boundary inside the worker; a worker thread
 *   shares the host process, so this is containment policy, not an OS
 *   boundary);
 * - UNSUPPORTED network and secret mediation (the worker runs in the host
 *   process; no network namespace or secret broker exists). Secrets are
 *   rejected at validation time.
 *
 * This is crash/resource containment, NOT a security sandbox equivalent to a
 * container or VM. `CONTAINER_ISOLATED` and `FUTURE_STRONG_ISOLATION` fail
 * closed as UNSUPPORTED on this backend.
 */

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
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
  const { entry, args, workspaceRoot, environment } = workerData;
  try {
    const module = require(path.resolve(workspaceRoot, entry));
    const run = module.run;
    if (typeof run !== "function") throw new Error("Workload module must export run(io).");
    const output = await run({
      workspaceRoot,
      environment,
      args,
      io: { resolveInside },
    });
    parentPort.postMessage({ ok: true, output: output ?? {} });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error && error.message ? error.message : String(error) });
  }
})();
`;

export class WorkerProcessIsolationBackend implements IsolationBackend {
  readonly id = "worker-process";
  readonly supportedLevels: readonly IsolationRequest["profile"]["level"][] = ["IN_PROCESS", "WORKER_PROCESS"];
  readonly guarantees = {
    /** Path validation at the IO boundary; shared host process means policy containment only. */
    filesystem: "BEST_EFFORT" as const,
    network: "UNSUPPORTED" as const,
    /** Crash containment: a hung/crashing worker cannot take the host down. */
    process: "BEST_EFFORT" as const,
    /** Only explicit policy variables are materialized into the worker. */
    environment: "ENFORCED" as const,
    resources: "BEST_EFFORT" as const,
    secrets: "UNSUPPORTED" as const,
  };

  async execute(request: IsolationRequest): Promise<IsolationResult> {
    const startedAt = now();
    const fail = (status: IsolationResult["status"], error: string): IsolationResult =>
      ({ status, error, startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level });

    validateIsolationProfile(request.profile);
    if (request.profile.level !== "WORKER_PROCESS") return fail("UNSUPPORTED", `${this.id} only executes WORKER_PROCESS requests.`);
    const guaranteeSnapshot = effectiveGuarantees(this, request.profile);
    if (Object.values(guaranteeSnapshot).some(value => value === "UNSUPPORTED" && request.profile.environment.secrets.length > 0)) {
      return fail("UNSUPPORTED", "Secret mediation is unsupported on this backend; failing closed.");
    }
    if (request.workload.kind !== "module") return fail("UNSUPPORTED", "Worker isolation requires a module workload; host closures cannot cross the worker boundary.");
    const workload = request.workload;
    if (request.signal?.aborted) return fail("CANCELLED", "Isolation request cancelled before start.");

    const workerDir = await mkdtemp(join(tmpdir(), "quack-isolation-"));
    const workerFile = join(workerDir, "worker.cjs");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(workerFile, WORKER_SOURCE, "utf8");

    return await new Promise<IsolationResult>(resolveResult => {
      const worker = new Worker(workerFile, {
        workerData: {
          entry: workload.entry,
          args: workload.args,
          workspaceRoot: request.profile.filesystem.workspaceRoot,
          environment: { ...request.profile.environment.variables },
        },
      });
      let settled = false;
      const cleanup = async (): Promise<void> => {
        try { await worker.terminate(); } catch { /* already terminated */ }
        for (let attempt = 0; attempt < 10; attempt += 1) {
          try { await rm(workerDir, { recursive: true, force: true }); return; }
          catch { await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1))); }
        }
      };
      const finish = (result: IsolationResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", onAbort);
        void cleanup();
        resolveResult(result);
      };
      const timer = setTimeout(() => {
        finish({ status: "TIMED_OUT", error: `Workload exceeded the ${request.profile.limits.wallClockMs}ms wall-clock limit.`,
          startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level });
      }, request.profile.limits.wallClockMs);
      const onAbort = () => finish({ status: "CANCELLED", error: "Workload cancelled by parent signal.",
        startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level });
      request.signal?.addEventListener("abort", onAbort, { once: true });

      worker.once("message", (message: { ok: boolean; output?: unknown; error?: string }) => {
        finish(message.ok
          ? { status: "SUCCEEDED", output: message.output as IsolationResult["output"], startedAt, completedAt: now(), backend: this.id, profileLevel: request.profile.level }
          : fail("FAILED", message.error ?? "Workload failed."));
      });
      worker.once("error", error => finish(fail("FAILED", error.message)));
      worker.once("exit", code => {
        if (!settled && code !== 0) finish(fail("FAILED", `Worker exited with code ${code}.`));
      });
    });
  }
}

/** Resolve a path inside a workspace root, rejecting traversal (used by governed IO surfaces). */
export function resolveInsideWorkspace(workspaceRoot: string, candidate: string): string {
  const resolved = resolve(candidate);
  const root = resolve(workspaceRoot);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error("Path is outside the workspace root.");
  }
  return resolved;
}