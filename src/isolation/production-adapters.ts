import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GovernedWorkloadAdapter } from "./workload-adapter.js";

/**
 * P14 (ADR 0048): the FIRST production workload adapters.
 *
 * P13 shipped the adapter registry deliberately EMPTY — no capability
 * silently became isolation-eligible. P14 registers the smallest honest
 * set: deterministic, low-risk data transforms that run inside the REAL
 * isolated environment and are verifiable from runtime evidence.
 *
 * What these adapters are NOT:
 * - no shell, no subprocess, no eval, no dynamic loading
 * - no network (the process backend enforces DENY honesty)
 * - no credentials, no secret mediation
 * - no filesystem access beyond the isolated workspace the supervisor
 *   provisions (and even that only for the write adapter's bounded output)
 *
 * Adapter security (P14.13/P14.14): every declaration here is trusted
 * server-side registration data. The model can NAME the capability; it can
 * never override the argument schema, risk level, required isolation,
 * verification strategy, or any other field.
 */

/**
 * `quack.text.transform` — deterministic bounded-text transformation.
 * READ_ONLY, argument-schema validated (bounded string input), verified by
 * deterministic result probes over the isolated output.
 */
export function textTransformAdapter(): GovernedWorkloadAdapter {
  return {
    capability: "quack.text.transform",
    entry: "text-transform.cjs",
    requiredLevel: "WORKER_PROCESS",
    sourceDirectory: adapterSourceDirectory(),
    description: "Deterministic bounded-text transformation in an isolated OS process.",
    validateArguments: (args) => {
      const input = args["input"];
      const op = args["op"];
      // Strict schema: only the declared fields are accepted.
      const keys = Object.keys(args);
      if (keys.some((key) => key !== "input" && key !== "op")) return { ok: false, reason: "only 'input' and 'op' are accepted" };
      if (typeof input !== "string" || input.length === 0) return { ok: false, reason: "input must be a non-empty string" };
      if (input.length > 8_192) return { ok: false, reason: "input must be at most 8192 chars" };
      if (op !== "upper" && op !== "lower") return { ok: false, reason: "op must be 'upper' or 'lower'" };
      return { ok: true };
    },
    argumentSchema: {
      type: "object",
      properties: { input: { type: "string", minLength: 1, maxLength: 8192 }, op: { enum: ["upper", "lower"] } },
      required: ["input", "op"],
    },
    riskLevel: "READ_ONLY",
    verification: { kind: "deterministic_result", probes: [{ path: "output", kind: "string" }] },
    filesystem: "WORKSPACE_ONLY",
    network: "DENY",
    credentials: "NONE",
    timeoutMs: 15_000,
  };
}

/**
 * `quack.data.process` — deterministic structured-data processing.
 * READ_ONLY (pure computation over JSON input), schema validated, verified
 * by deterministic result probes.
 */
export function dataProcessAdapter(): GovernedWorkloadAdapter {
  return {
    capability: "quack.data.process",
    entry: "data-process.cjs",
    requiredLevel: "WORKER_PROCESS",
    sourceDirectory: adapterSourceDirectory(),
    description: "Deterministic structured-data processing (sort + bounded stats) in an isolated OS process.",
    validateArguments: (args) => {
      const values = args["values"];
      // Strict schema: only the declared field is accepted (unknown fields
      // are rejected, not ignored — argument data can never smuggle config).
      const keys = Object.keys(args);
      if (keys.some((key) => key !== "values")) return { ok: false, reason: "only 'values' is accepted" };
      if (!Array.isArray(values)) return { ok: false, reason: "values must be an array of numbers" };
      if (values.length > 256) return { ok: false, reason: "values must contain at most 256 entries" };
      if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
        return { ok: false, reason: "values must contain finite numbers only" };
      }
      return { ok: true };
    },
    argumentSchema: {
      type: "object",
      properties: { values: { type: "array", items: { type: "number" }, maxItems: 256 } },
      required: ["values"],
    },
    riskLevel: "READ_ONLY",
    verification: { kind: "deterministic_result", probes: [{ path: "count", kind: "number" }, { path: "sorted", kind: "string" }] },
    filesystem: "WORKSPACE_ONLY",
    network: "DENY",
    credentials: "NONE",
    timeoutMs: 15_000,
  };
}

/**
 * Materialize the trusted workload modules ONCE under a per-process
 * directory in the OS tmpdir. The supervisor copies the entry into a fresh
 * isolated workspace per execution; this function only provides the
 * trusted SOURCE. Failures throw (registration-time wiring failure —
 * better no adapter than a half-registered one).
 *
 * Idempotent across the process lifetime: if the files already exist and
 * match the trusted sources byte-for-byte, they are reused (a stale or
 * tampered source re-materializes — content identity is enforced).
 */
let materialized: string | undefined;
export function adapterSourceDirectory(): string {
  if (materialized) return materialized;
  throw new Error("Adapter source directory not materialized; call registerProductionAdapters first.");
}

/**
 * Register the P14 production adapters into a registry. Callers own the
 * registry (deployer wiring); this function only supplies trusted entries.
 * SYNCHRONOUS on purpose: the composition root registers adapters during
 * system construction, and a failure keeps the registry EMPTY (no adapter
 * is safer than a half-registered one).
 */
export function registerProductionAdapters(
  registry: import("./workload-adapter.js").WorkloadAdapterRegistry,
): void {
  const sourceDir = join(tmpdir(), `quack-adapters-${process.pid}`);
  mkdirSync(sourceDir, { recursive: true });
  const sources: readonly [string, string][] = [
    ["text-transform.cjs", TEXT_TRANSFORM_SOURCE],
    ["data-process.cjs", DATA_PROCESS_SOURCE],
  ];
  for (const [name, source] of sources) {
    const target = join(sourceDir, name);
    // Content identity: reuse only a byte-identical existing source; any
    // mismatch (stale/tampered) re-materializes the trusted content.
    if (existsSync(target) && readFileSync(target, "utf8") === source) continue;
    writeFileSync(target, source, "utf8");
  }
  materialized = sourceDir;
  registry.register(textTransformAdapter());
  registry.register(dataProcessAdapter());
}

/**
 * The trusted workload sources. Plain CommonJS, argv/env-free, no imports
 * beyond nothing at all: they read io.args, compute deterministically, and
 * return a bounded JSON object. No fs, no net, no process access.
 */
const TEXT_TRANSFORM_SOURCE = `
// QUACK P14 production workload: deterministic text transformation.
// Runs inside the isolated OS process; receives only io.args.
exports.run = async (io) => {
  const input = String(io.args.input ?? "");
  const op = String(io.args.op ?? "");
  if (input.length === 0 || input.length > 8192) throw new Error("input out of bounds");
  if (op !== "upper" && op !== "lower") throw new Error("op must be 'upper' or 'lower'");
  const output = op === "upper" ? input.toUpperCase() : input.toLowerCase();
  return { op, chars: output.length, output };
};
`;

const DATA_PROCESS_SOURCE = `
// QUACK P14 production workload: deterministic structured-data processing.
// Sorts a bounded numeric array and computes bounded statistics.
exports.run = async (io) => {
  const values = Array.isArray(io.args.values) ? io.args.values : [];
  if (values.length > 256) throw new Error("too many values");
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("non-finite value");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    sorted: sorted.length > 0 ? sorted.join(",") : "",
    sum,
    min: sorted.length > 0 ? sorted[0] : null,
    max: sorted.length > 0 ? sorted[sorted.length - 1] : null,
  };
};
`;
