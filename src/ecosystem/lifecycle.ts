/**
 * P10.10 extension lifecycle (ADR 0044). Explicit states, explicit
 * transitions, fail-closed on everything else. Removal is complete — no
 * stale registry entries, no ghost records.
 */

export const EXTENSION_LIFECYCLE_STATES = [
  "DISCOVERED", "VALIDATED", "ADMITTED", "INSTALLED", "ENABLED",
  "DISABLED", "QUARANTINED", "REMOVED",
] as const;
export type ExtensionLifecycleState = (typeof EXTENSION_LIFECYCLE_STATES)[number];

/** Explicit transition table. Anything absent is invalid — fail closed. */
const TRANSITIONS: Readonly<Record<ExtensionLifecycleState, readonly ExtensionLifecycleState[]>> = Object.freeze({
  DISCOVERED: ["VALIDATED", "QUARANTINED", "REMOVED"],
  VALIDATED: ["ADMITTED", "QUARANTINED", "REMOVED"],
  ADMITTED: ["INSTALLED", "QUARANTINED", "REMOVED"],
  INSTALLED: ["ENABLED", "DISABLED", "QUARANTINED", "REMOVED"],
  ENABLED: ["DISABLED", "QUARANTINED", "REMOVED"],
  DISABLED: ["ENABLED", "QUARANTINED", "REMOVED"],
  QUARANTINED: ["REMOVED"],
  REMOVED: [],
});

export interface LifecycleTransition {
  readonly from: ExtensionLifecycleState;
  readonly to: ExtensionLifecycleState;
  readonly reason: string;
}

/**
 * Validate one transition. Deterministic, fail-closed: invalid transitions
 * are rejected with the structured reason the caller reports verbatim.
 */
export function validateLifecycleTransition(
  from: ExtensionLifecycleState,
  to: ExtensionLifecycleState,
): { readonly ok: true; readonly transition: LifecycleTransition } | { readonly ok: false; readonly code: "extension.lifecycle_invalid_transition"; readonly message: string } {
  if (!(EXTENSION_LIFECYCLE_STATES as readonly string[]).includes(from) || !(EXTENSION_LIFECYCLE_STATES as readonly string[]).includes(to)) {
    return { ok: false, code: "extension.lifecycle_invalid_transition", message: `Unknown lifecycle state in ${from} -> ${to}.` };
  }
  const allowed = TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return { ok: false, code: "extension.lifecycle_invalid_transition", message: `Lifecycle transition ${from} -> ${to} is not allowed.` };
  }
  return { ok: true, transition: { from, to, reason: `explicit ${from} -> ${to}` } };
}

/** Whether a state is terminal (no further transitions). */
export function isTerminalState(state: ExtensionLifecycleState): boolean {
  return TRANSITIONS[state].length === 0;
}

/** Whether an extension state participates in resolution/install surfaces. */
export function isResolvableState(state: ExtensionLifecycleState): boolean {
  return state !== "QUARANTINED" && state !== "REMOVED";
}
