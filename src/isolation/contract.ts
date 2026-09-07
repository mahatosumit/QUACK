import type { IsoTimestamp, JsonObject } from "../core/types.js";

/**
 * QUACK Execution Isolation Contract (ADR 0039).
 *
 * A narrow abstraction over workload isolation mechanisms. The runtime
 * depends on this contract, never on a concrete backend (worker process,
 * container, microVM). Every guarantee is classified as ENFORCED,
 * BEST_EFFORT, or UNSUPPORTED; unsupported combinations must fail closed
 * rather than silently degrade.
 */

export type IsolationLevel = "IN_PROCESS" | "WORKER_PROCESS" | "CONTAINER_ISOLATED" | "FUTURE_STRONG_ISOLATION";

export type Guarantee = "ENFORCED" | "BEST_EFFORT" | "UNSUPPORTED";

export interface FilesystemPolicy {
  /** Workspace root the workload may read and write. Everything else is denied. */
  readonly workspaceRoot: string;
  /** Additional read-only paths inside the workspace tree (must resolve inside workspaceRoot). */
  readonly extraReadOnlyPaths?: readonly string[];
}

export type NetworkPolicy =
  | { readonly mode: "DENY" }
  | { readonly mode: "ALLOWLIST"; readonly hosts: readonly string[]; readonly schemes: readonly string[] };

/** Environment policy: no host environment is inherited by default. */
export interface EnvironmentPolicy {
  /** Exact environment variables passed to the workload. */
  readonly variables: Readonly<Record<string, string>>;
  /** Secret access is denied unless explicitly listed; each entry requires a granted capability at execution. */
  readonly secrets: readonly string[];
}

export interface ResourceLimits {
  readonly wallClockMs: number;
  readonly memoryBytes?: number;
  readonly cpuMs?: number;
  readonly processCount?: number;
  readonly maxOutputBytes?: number;
}

/**
 * Conservative isolation profiles. IN_PROCESS provides no isolation and must
 * never be presented as sandboxing; WORKER_PROCESS contains crashes and
 * resource use but is not a security boundary; CONTAINER_ISOLATED requires a
 * supporting backend and fails closed where unavailable.
 */
export interface IsolationProfile {
  readonly level: IsolationLevel;
  readonly filesystem: FilesystemPolicy;
  readonly network: NetworkPolicy;
  readonly environment: EnvironmentPolicy;
  readonly limits: ResourceLimits;
}

export interface IsolationRequest {
  readonly missionId: string;
  readonly taskId?: string;
  readonly executionId: string;
  readonly actor: string;
  readonly profile: IsolationProfile;
  readonly workload: IsolatedWorkload;
  readonly signal?: AbortSignal;
  readonly deadline?: IsoTimestamp;
}

/**
 * The workload executed under isolation. For IN_PROCESS this is a function;
 * for process-based levels this is a module entry the backend loads inside
 * the isolated environment. The backend never accepts host closures across
 * process boundaries.
 */
export type IsolatedWorkload =
  | { readonly kind: "function"; readonly run: (io: IsolatedIo) => Promise<JsonObject> }
  | { readonly kind: "module"; readonly entry: string; readonly args: JsonObject };

/**
 * The only surface a workload receives: an explicit workspace root and the
 * environment materialized from policy. No host registries, brokers, or
 * runtime APIs are exposed.
 */
export interface IsolatedIo {
  readonly workspaceRoot: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface IsolationResult {
  readonly status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "UNSUPPORTED";
  readonly output?: JsonObject;
  readonly error?: string;
  readonly startedAt: IsoTimestamp;
  readonly completedAt: IsoTimestamp;
  /** Provenance for evidence integration: which backend ran the workload. */
  readonly backend: string;
  readonly profileLevel: IsolationLevel;
}

/**
 * Backend interface. Implementations must:
 * - validate the profile and fail closed (UNSUPPORTED) for levels/policies
 *   they cannot enforce;
 * - enforce timeout and cancellation deterministically;
 * - clean up all created resources on every terminal path.
 * Sandbox creation itself never grants additional capabilities.
 */
export interface IsolationBackend {
  readonly id: string;
  readonly supportedLevels: readonly IsolationLevel[];
  /** Honest per-dimension guarantees for evidence and documentation. */
  readonly guarantees: Readonly<Record<"filesystem" | "network" | "process" | "environment" | "resources" | "secrets", Guarantee>>;
  execute(request: IsolationRequest): Promise<IsolationResult>;
}

/** Validate a profile against conservative defaults; throws on contradictions. */
export function validateIsolationProfile(profile: IsolationProfile): void {
  if (!profile.filesystem.workspaceRoot?.trim()) throw new Error("Isolation requires a workspace root.");
  if (!Number.isInteger(profile.limits.wallClockMs) || profile.limits.wallClockMs <= 0) {
    throw new Error("Isolation requires a positive wall-clock limit.");
  }
  if (profile.network.mode === "ALLOWLIST" && profile.network.hosts.length === 0) {
    throw new Error("ALLOWLIST network policy requires at least one host.");
  }
  if (profile.environment.secrets.length > 0 && profile.level === "IN_PROCESS") {
    throw new Error("IN_PROCESS isolation cannot safely mediate secret access; fail closed.");
  }
}

/** Resolve the effective guarantees for a request, consulting backend honesty. */
export function effectiveGuarantees(backend: IsolationBackend, profile: IsolationProfile): Readonly<Record<"filesystem" | "network" | "process" | "environment" | "resources" | "secrets", Guarantee>> {
  if (!backend.supportedLevels.includes(profile.level)) {
    return { filesystem: "UNSUPPORTED", network: "UNSUPPORTED", process: "UNSUPPORTED", environment: "UNSUPPORTED", resources: "UNSUPPORTED", secrets: "UNSUPPORTED" };
  }
  return backend.guarantees;
}