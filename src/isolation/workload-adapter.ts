import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { JsonObject } from "../core/types.js";

/**
 * P13 (ADR 0047): governed workload adapter registry.
 *
 * Every executable isolated workload must have an EXPLICIT adapter: a
 * trusted, deployer-registered mapping from a capability id to a module
 * entry inside the isolated workspace. There is NO path from
 *
 *   - a capability name → arbitrary command
 *   - a model string → executable code
 *   - tool arguments → shell commands
 *   - user/model input → module paths
 *
 * The model can only NAME a registered capability; arguments are JSON data
 * passed to the registered module's run(io). Unknown capabilities DENY.
 * Registry entries are deployer/operator decisions, never runtime-discovered
 * and never model-influenced.
 */

export interface GovernedWorkloadAdapter {
  /** The registered capability id this adapter executes under isolation. */
  readonly capability: string;
  /** Entry module path RELATIVE to the isolated workspace root (no traversal). */
  readonly entry: string;
  /** Required isolation level for this workload (trusted registration data). */
  readonly requiredLevel: "WORKER_PROCESS" | "CONTAINER_ISOLATED";
  /** Bounded argument validation before launch (fail-closed). */
  readonly validateArguments: (args: JsonObject) => { ok: boolean; reason?: string };
  /** Human-readable description for audit surfaces (metadata only). */
  readonly description: string;
  /**
   * TRUSTED source directory (deployer-controlled) containing the entry
   * module. The supervisor copies the entry into the isolated workspace
   * before launch; the workload can only import what the isolated copy
   * provides. Never derived from model/user input.
   */
  readonly sourceDirectory: string;
}

export class WorkloadAdapterRegistry {
  private readonly adapters = new Map<string, GovernedWorkloadAdapter>();

  register(adapter: GovernedWorkloadAdapter): void {
    if (!adapter?.capability) throw new Error("Workload adapter requires a capability id.");
    if (typeof adapter.entry !== "string" || adapter.entry.length === 0) throw new Error("Workload adapter requires an entry module path.");
    if (isAbsoluteOrTraversal(adapter.entry)) throw new Error(`Workload entry '${adapter.entry}' must be a relative path without traversal.`);
    if (typeof adapter.sourceDirectory !== "string" || adapter.sourceDirectory.length === 0) {
      throw new Error("Workload adapter requires a trusted source directory.");
    }
    if (adapter.requiredLevel !== "WORKER_PROCESS" && adapter.requiredLevel !== "CONTAINER_ISOLATED") {
      throw new Error("Workload adapter requires a real isolation level (WORKER_PROCESS or CONTAINER_ISOLATED).");
    }
    if (typeof adapter.validateArguments !== "function") throw new Error("Workload adapter requires argument validation.");
    if (this.adapters.has(adapter.capability)) throw new Error(`Duplicate workload adapter for '${adapter.capability}'.`);
    this.adapters.set(adapter.capability, adapter);
  }

  list(): readonly GovernedWorkloadAdapter[] {
    return [...this.adapters.values()];
  }

  /**
   * Resolve an adapter for an already-authorized capability. THREE distinct
   * outcomes — callers must treat them differently:
   * - REGISTERED: an adapter exists and validated the arguments; execution
   *   MUST go through isolation.
   * - REJECTED: an adapter exists but the ARGUMENTS failed validation —
   *   the caller must DENY. Falling through to the host path here would
   *   let model-controlled arguments select the execution environment
   *   (a silent downgrade).
   * - UNREGISTERED: no adapter; the capability is not isolation-eligible
   *   and keeps the honest POLICY_RESTRICTED host path.
   */
  resolve(capability: string, args: JsonObject): AdapterResolutionOutcome {
    const adapter = this.adapters.get(capability);
    if (!adapter) return { kind: "UNREGISTERED" };
    const validated = adapter.validateArguments(args);
    if (!validated.ok) return { kind: "REJECTED", reason: `arguments rejected by the '${capability}' adapter: ${validated.reason ?? "invalid arguments"}` };
    return { kind: "REGISTERED", adapter };
  }

  /** Content digest over an entry module (integrity witness for evidence). */
  entryDigest(entry: string): string {
    return createHash("sha256").update(entry).digest("hex").slice(0, 16);
  }
}

/**
 * Explicit tri-state adapter resolution outcome (P13 security review
 * finding 1: argument rejection must DENY, never fall to the host path).
 */
export type AdapterResolutionOutcome =
  | { readonly kind: "REGISTERED"; readonly adapter: GovernedWorkloadAdapter }
  | { readonly kind: "REJECTED"; readonly reason: string }
  | { readonly kind: "UNREGISTERED" };

/** Reject absolute paths and traversal segments before any filesystem use. */
export function isAbsoluteOrTraversal(entry: string): boolean {
  if (entry.startsWith("/") || entry.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(entry)) return true;
  const segments = entry.split(/[\\/]+/);
  return segments.includes("..");
}

/** Resolve an entry inside a root, throwing on escape (defense in depth). */
export function resolveEntryInsideRoot(root: string, entry: string): string {
  if (isAbsoluteOrTraversal(entry)) throw new Error("workload entry must be a safe relative path");
  const resolved = resolve(root, entry);
  const normalizedRoot = resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + sep)) {
    throw new Error("workload entry resolves outside the workspace root");
  }
  return resolved;
}
