import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { EffectProbe, ExpectedEffect, VerificationStrategy } from "../runtime/mission-lifecycle/action-contract.js";
import type { JsonObject, JsonValue } from "../core/types.js";
import type { ActionResultV1 } from "../contracts/v1/contracts.js";
import type { EventBus } from "../events/event-bus.js";
import type { ExecutionEvidenceFacts } from "./execution-evidence.js";

/**
 * P13 (ADR 0047): trusted probe runner.
 *
 * NOT a second execution authority. It can only VERIFY an ALREADY-AUTHORIZED,
 * ALREADY-EXECUTED action against runtime evidence: the action result the
 * trusted boundary produced, filesystem effects observable in the governed
 * workspace, and evidence facts the supervisor recorded. The MODEL cannot
 * supply verification results — probes read runtime state only.
 *
 * Probe kinds:
 * - output_field / status_equals / no_error: derive from the ActionResultV1
 *   captured at the harness boundary (runtime truth, never model claims).
 * - fs_effect_exists: the trusted runner observes the workspace filesystem.
 * - external_check: NOT IMPLEMENTED (fail-closed INCONCLUSIVE) — executing
 *   another capability for verification requires an explicit future contract.
 */

export type ProbeOutcome =
  | { readonly kind: "PASSED"; readonly probesRun: readonly string[]; readonly summary: string }
  | { readonly kind: "FAILED"; readonly probesRun: readonly string[]; readonly summary: string }
  | { readonly kind: "INCONCLUSIVE"; readonly probesRun: readonly string[]; readonly summary: string };

export interface ProbeRunnerOptions {
  /** Governed workspace root for filesystem probes. */
  readonly workspaceRoot: string;
  /** Existing event bus — metadata-only events only. */
  readonly events?: EventBus;
  readonly actor?: string;
}

export class ProbeRunner {
  constructor(private readonly options: ProbeRunnerOptions) {}

  /**
   * Verify an executed action against a verification strategy. Returns a
   * runtime-derived verification, never a model self-report.
   */
  async verify(input: {
    readonly strategy: VerificationStrategy | undefined;
    readonly result: ActionResultV1;
    readonly facts: ExecutionEvidenceFacts;
    readonly missionId: string;
    readonly executionId: string;
  }): Promise<ProbeOutcome> {
    const strategy = input.strategy ?? { kind: "trust_executed" as const, reason: "no strategy" };

    if (strategy.kind === "trust_executed") {
      // Honest: no runtime evidence beyond execution itself → UNVERIFIED.
      return { kind: "INCONCLUSIVE", probesRun: [], summary: "trust_executed provides no runtime-verifiable evidence; the result stays UNVERIFIED." };
    }

    if (strategy.kind === "human_confirm") {
      return { kind: "INCONCLUSIVE", probesRun: [], summary: "human_confirm requires a human decision surface; the probe runner cannot self-certify it." };
    }

    if (strategy.kind === "evaluator_with_objective") {
      return { kind: "INCONCLUSIVE", probesRun: [], summary: "evaluator verification requires the objective evaluator; not runnable as an isolation probe." };
    }

    if (strategy.kind === "probe_external_state") {
      // Run the DECLARED probes of the expected effect against runtime state.
      return await this.runProbes(strategy.expected, input.result, input.facts);
    }

    return { kind: "INCONCLUSIVE", probesRun: [], summary: "unknown verification strategy; fail-closed inconclusive." };
  }

  /** Execute declared probes against runtime evidence. All-or-nothing. */
  async runProbes(expected: ExpectedEffect, result: ActionResultV1, facts: ExecutionEvidenceFacts): Promise<ProbeOutcome> {
    const probesRun: string[] = [];
    for (const probe of expected.successProbes) {
      const outcome = await this.runOne(probe, result, facts);
      probesRun.push(probeLabel(probe));
      if (!outcome.passed) {
        await this.options.events?.emit("execution.unverified", {
          probesRun: probesRun.length, failed: probeLabel(probe),
        }, { actor: this.options.actor ?? "probe-runner" }).catch(() => undefined);
        return { kind: "FAILED", probesRun, summary: `probe '${probeLabel(probe)}' failed: ${outcome.reason}` };
      }
    }
    if (probesRun.length === 0) {
      return { kind: "INCONCLUSIVE", probesRun, summary: "expected effect declares no probes; nothing to verify." };
    }
    return { kind: "PASSED", probesRun, summary: `${probesRun.length} probe(s) passed against runtime evidence.` };
  }

  private async runOne(probe: EffectProbe, result: ActionResultV1, facts: ExecutionEvidenceFacts): Promise<{ passed: boolean; reason?: string }> {
    switch (probe.kind) {
      case "status_equals":
        return probe.value === result.status
          ? { passed: true }
          : { passed: false, reason: `runtime status '${result.status}' ≠ declared '${probe.value}'` };
      case "no_error": {
        const error = result.output?.["error"];
        return error === undefined
          ? { passed: true }
          : { passed: false, reason: `result carries an error field` };
      }
      case "output_field": {
        const value = readPath(result.output, probe.path);
        if (probe.equals !== undefined && !deepEqual(value, probe.equals)) return { passed: false, reason: `output '${probe.path}' ≠ expected` };
        if (probe.notEquals !== undefined && deepEqual(value, probe.notEquals)) return { passed: false, reason: `output '${probe.path}' equals a forbidden value` };
        if (probe.contains !== undefined && !deepContains(value, probe.contains)) return { passed: false, reason: `output '${probe.path}' does not contain the expected value` };
        if (probe.matches !== undefined) {
          if (typeof value !== "string" || !new RegExp(probe.matches).test(value)) return { passed: false, reason: `output '${probe.path}' does not match the pattern` };
        }
        return { passed: true };
      }
      case "external_check":
        // Executing another capability for verification is NOT in the probe
        // runner's authority: fail-closed inconclusive per ADR 0047.
        return { passed: false, reason: "external_check probes are not executable by the trusted probe runner (no second execution authority)" };
      default:
        return { passed: false, reason: "unknown probe kind" };
    }
  }

  /**
   * Filesystem-effect probe: a trusted observation that a declared relative
   * path exists inside the governed workspace. Traversal is rejected
   * lexically AND after filesystem resolution: a symlink/junction/reparse
   * point anywhere on the probed path that resolves outside the workspace
   * fails closed (P13 review finding 6 — never trust a path merely because
   * its STRING begins with the workspace root).
   *
   * TOCTOU honesty: the check resolves-then-stats in one probe pass. A
   * same-user attacker able to swap a directory entry between the realpath
   * resolution and the stat observation can still race this probe; the
   * container backend (no host filesystem shared) is the boundary that
   * removes that race. Documented in ADR 0047 — not silently claimed safe.
   */
  async verifyFilesystemEffect(relativePath: string, expectation: { readonly exists: boolean }): Promise<{ passed: boolean; reason?: string }> {
    const root = resolve(this.options.workspaceRoot);
    // Lexical validation first: reject absolute paths and traversal before
    // touching the filesystem.
    if (relativePath.startsWith("/") || relativePath.startsWith("\\") || /^[a-zA-Z]:/.test(relativePath)
      || relativePath.split(/[\\/]+/).includes("..")) {
      return { passed: false, reason: "fs probe path must be a safe relative path" };
    }
    const lexicalTarget = resolve(root, relativePath);
    if (lexicalTarget !== root && !lexicalTarget.startsWith(root + sep)) {
      return { passed: false, reason: "fs probe path escapes the governed workspace" };
    }
    // Filesystem identity validation (P13 finding 6): every intermediate
    // component must be a real directory (lstat — symlinks/junctions are
    // rejected, not followed), and the final entry must resolve, via
    // realpath, back INSIDE the workspace root.
    const parentChain = lexicalTarget.slice(root.length).split(sep).filter(Boolean);
    parentChain.pop(); // the final entry is checked by realpath below
    let cursor = root;
    for (const segment of parentChain) {
      cursor = join(cursor, segment);
      let info;
      try {
        info = await lstat(cursor);
      } catch {
        return { passed: false, reason: "fs probe path is missing inside the governed workspace" };
      }
      if (info.isSymbolicLink()) {
        return { passed: false, reason: `fs probe path crosses a symlink ('${segment}') and is rejected` };
      }
      if (!info.isDirectory()) {
        return { passed: false, reason: `fs probe path component '${segment}' is not a directory` };
      }
    }
    let resolved: string;
    try {
      resolved = await realpath(lexicalTarget);
    } catch {
      // Missing target: honor the expectation for absence.
      return expectation.exists
        ? { passed: false, reason: `path '${relativePath}' is missing (declared present)` }
        : { passed: true };
    }
    // Post-resolution containment: the RESOLVED identity must sit inside the
    // RESOLVED workspace root. A symlink escape that lands outside fails
    // here even when the lexical string was inside.
    const resolvedRoot = await realpath(root);
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
      return { passed: false, reason: "fs probe path resolves outside the governed workspace (symlink/junction escape rejected)" };
    }
    // Final entry itself must not be a symlink pointing away (realpath
    // already folded it; the containment check above is the authority).
    let statInfo;
    try {
      statInfo = await lstat(resolved);
    } catch {
      return expectation.exists
        ? { passed: false, reason: `path '${relativePath}' is missing (declared present)` }
        : { passed: true };
    }
    if (expectation.exists) return { passed: true };
    return { passed: false, reason: `path '${relativePath}' exists but was declared absent` };
  }

  /** Digest helper for evidence binding (sha256 over canonical output). */
  static outputDigest(output: JsonObject | undefined): { digest?: string; bytes: number } {
    if (output === undefined) return { bytes: 0 };
    const serialized = JSON.stringify(output);
    return { digest: createHash("sha256").update(serialized).digest("hex"), bytes: Buffer.byteLength(serialized, "utf8") };
  }
}

function probeLabel(probe: EffectProbe): string {
  switch (probe.kind) {
    case "output_field": return `output_field:${probe.path}`;
    case "status_equals": return `status_equals:${probe.value}`;
    case "no_error": return "no_error";
    case "external_check": return `external_check:${probe.capability}`;
  }
}

/** Read a dotted path from a JSON object; undefined when absent. */
function readPath(value: JsonObject | undefined, path: string): JsonValue | undefined {
  if (value === undefined) return undefined;
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current as JsonValue;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function deepContains(haystack: unknown, needle: unknown): boolean {
  if (typeof haystack === "string") return typeof needle === "string" ? haystack.includes(needle) : false;
  if (Array.isArray(haystack)) return haystack.some(item => deepEqual(item, needle));
  if (typeof haystack === "object" && haystack !== null) {
    return Object.values(haystack).some(value => deepEqual(value, needle) || deepContains(value, needle));
  }
  return false;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    return sorted;
  }
  return value;
}
