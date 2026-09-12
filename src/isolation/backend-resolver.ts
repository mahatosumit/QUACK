import type {
  IsolationBackend, IsolationLevel, IsolationProfile, IsolationRequest, IsolationResult,
  ProbeableIsolationBackend,
} from "./contract.js";
import { effectiveGuarantees, validateIsolationProfile } from "./contract.js";

/**
 * P13 (ADR 0047): provider-neutral isolation backend registry and resolver.
 *
 * Authorization (the CapabilityBroker) decides WHETHER an execution may run.
 * The resolver decides WHERE it runs: it maps a TRUSTED isolation requirement
 * onto an available backend by explicit capability negotiation. Resolution is
 * fail-closed: when no backend both supports the required level and is
 * currently available, the outcome is UNRESOLVED and the caller DENIES —
 * there is no downgrade to a weaker mode and no policy-only fallback for an
 * isolation-requiring execution.
 *
 * The resolver is trusted runtime code. Model output can never select,
 * upgrade, or downgrade a backend: the required level arrives only from
 * deployer configuration or registered descriptors.
 */

/** Honest resolution outcome; UNRESOLVED means "deny, do not execute". */
export type BackendResolution =
  | { readonly kind: "RESOLVED"; readonly backend: ProbeableIsolationBackend }
  | { readonly kind: "UNRESOLVED"; readonly requiredLevel: IsolationLevel; readonly reason: string };

/** Named, trusted backends. ids are deployer/operator vocabulary, never model vocabulary. */
export class IsolationBackendRegistry {
  private readonly backends = new Map<string, ProbeableIsolationBackend>();

  register(backend: ProbeableIsolationBackend): void {
    if (!backend?.id) throw new Error("Isolation backend requires an id.");
    if (typeof backend.execute !== "function" || typeof backend.availability !== "function") {
      throw new Error(`Isolation backend '${backend.id}' must implement execute() and availability().`);
    }
    if (this.backends.has(backend.id)) throw new Error(`Duplicate isolation backend id '${backend.id}'.`);
    this.backends.set(backend.id, backend);
  }

  list(): readonly ProbeableIsolationBackend[] {
    return [...this.backends.values()];
  }

  get(id: string): ProbeableIsolationBackend | undefined {
    return this.backends.get(id);
  }

  /**
   * Negotiate a backend for a required level. Preference order is the
   * registration order (strongest-first is the deployer's responsibility).
   * A backend qualifies only when it SUPPORTS the level, is AVAILABLE on
   * this host, and the profile validates. The first qualifying backend
   * wins; unsupported/unavailable backends never shadow each other.
   */
  async resolve(requiredLevel: IsolationLevel, profile: IsolationProfile): Promise<BackendResolution> {
    validateIsolationProfile(profile);
    const inspected: readonly ProbeableIsolationBackend[] = [...this.backends.values()];
    for (const backend of inspected) {
      if (!backend.supportedLevels.includes(requiredLevel)) continue;
      let availability;
      try {
        availability = await backend.availability();
      } catch {
        availability = { available: false, reason: "availability probe failed; treated as unavailable." };
      }
      if (!availability.available) continue;
      // The request-level guarantees must back the required level: a real
      // (non-IN_PROCESS) isolation requirement demands an ENFORCED process
      // boundary — a backend that merely contains crashes (worker-thread
      // class, BEST_EFFORT process) is NOT real process isolation and must
      // not host the requirement (P13 review finding 11). Dimensions beyond
      // the process boundary are checked at execute by each backend.
      const guarantees = effectiveGuarantees(backend, profile);
      if (requiredLevel !== "IN_PROCESS" && guarantees.process !== "ENFORCED") continue;
      return { kind: "RESOLVED", backend };
    }
    return {
      kind: "UNRESOLVED",
      requiredLevel,
      reason: inspected.length === 0
        ? "no isolation backends are registered"
        : `no registered backend both supports '${requiredLevel}' and is currently available`,
    };
  }
}

/** Execute through a RESOLVED backend; never called with UNRESOLVED. */
export async function executeIsolated(
  resolution: BackendResolution,
  request: IsolationRequest,
): Promise<IsolationResult> {
  if (resolution.kind !== "RESOLVED") {
    throw new Error("executeIsolated requires a RESOLVED backend; UNRESOLVED must deny, never execute.");
  }
  if (request.profile.level === "IN_PROCESS" && request.workload.kind === "function") {
    throw new Error("IN_PROCESS function workloads do not cross an isolation boundary; use the governed host path.");
  }
  return resolution.backend.execute(request);
}

/** Convenience for compositions: probe every backend's availability (metadata-only). */
export async function describeBackends(registry: IsolationBackendRegistry): Promise<
  readonly { readonly id: string; readonly levels: readonly IsolationLevel[]; readonly available: boolean; readonly reason: string }[]
> {
  const descriptions = [];
  for (const backend of registry.list()) {
    let availability;
    try {
      availability = await backend.availability();
    } catch {
      availability = { available: false, reason: "availability probe failed." };
    }
    descriptions.push({
      id: backend.id,
      levels: backend.supportedLevels,
      available: availability.available,
      reason: availability.reason,
    });
  }
  return descriptions;
}
