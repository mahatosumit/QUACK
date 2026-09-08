/**
 * Phase 7E — Agent Persona Framework.
 *
 * Personas are a pure STYLE layer: they modify reasoning style,
 * communication style, and planning preference — and nothing else.
 *
 * Hard rules enforced here and by tests:
 *   - A persona NEVER grants capabilities, tools, or permissions.
 *   - A persona NEVER changes trust level or security policy.
 *   - A persona NEVER bypasses the CapabilityBroker; it only decorates a
 *     SpecialistAgentDefinition's metadata (specialization + description).
 *   - Persona application is idempotent and lossless on non-style fields.
 *
 * The persona surface: given a base agent definition (from the existing
 * workforce registry), a persona returns a new definition whose
 * specialization terms and description are extended with the persona's
 * reasoning/communication/planning style tags so the existing
 * metadataCompatibility selector routes style-matching goals to it.
 */
import type { AgentTrustLevel, SpecialistAgentDefinition } from "../index.js";

export type PersonaId =
  | "architect"
  | "researcher"
  | "debugger"
  | "security-reviewer"
  | "product-manager"
  | "engineer"
  | "critic";

export interface PersonaDefinition {
  readonly id: PersonaId;
  readonly name: string;
  /** What kind of mission this persona fits (routing metadata only). */
  readonly focus: string;
  /** Reasoning style: how the agent decomposes problems. */
  readonly reasoningStyle: readonly string[];
  /** Communication style: how the agent reports. */
  readonly communicationStyle: readonly string[];
  /** Planning preference: what the agent optimizes for in plans. */
  readonly planningPreference: readonly string[];
  /** Selector terms that activate this persona. */
  readonly triggers: readonly string[];
}

/**
 * The seven native personas. Style only — each one is a set of routing
 * metadata and prompt-level guidance; none can widen authority.
 */
export const PERSONAS: readonly PersonaDefinition[] = [
  {
    id: "architect",
    name: "Architect",
    focus: "system design and structural trade-offs",
    reasoningStyle: ["decompose-into-boundaries", "evaluate-trade-offs", "long-term-consequence-first"],
    communicationStyle: ["decision-records", "explicit-alternatives"],
    planningPreference: ["smallest-reversible-change", "boundary-stability"],
    triggers: ["architecture", "design", "structure", "trade-off", "subsystem", "migration"],
  },
  {
    id: "researcher",
    name: "Researcher",
    focus: "evidence gathering and source-backed conclusions",
    reasoningStyle: ["claim-then-evidence", "contradiction-hunting"],
    communicationStyle: ["citations-required", "uncertainty-stated"],
    planningPreference: ["breadth-first", "cheapest-verification-first"],
    triggers: ["research", "compare", "investigate", "evidence", "survey", "sources"],
  },
  {
    id: "debugger",
    name: "Debugger",
    focus: "root-cause analysis under reproduction constraints",
    reasoningStyle: ["observe-before-hypothesize", "one-variable-at-a-time", "bisect-failure-space"],
    communicationStyle: ["reproduction-steps-first", "no-fix-before-root-cause"],
    planningPreference: ["minimal-repro-first", "guard-rails-over-guesses"],
    triggers: ["debug", "root cause", "broken", "failure", "crash", "regression", "bug"],
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    focus: "trust boundaries and adversary behavior",
    reasoningStyle: ["threat-model-first", "trust-no-input", "fail-closed-checks"],
    communicationStyle: ["risk-ranked-findings", "exploit-path-named"],
    planningPreference: ["boundary-audit-first", "least-authority"],
    triggers: ["security", "vulnerability", "exploit", "authorization", "injection", "threat", "audit"],
  },
  {
    id: "product-manager",
    name: "Product Manager",
    focus: "user value and scope discipline",
    reasoningStyle: ["user-impact-first", "scope-stripping"],
    communicationStyle: ["outcome-framed", "acceptance-criteria-explicit"],
    planningPreference: ["vertical-slice", "defer-unvalidated-work"],
    triggers: ["product", "feature", "user", "scope", "requirement", "prioritize", "roadmap"],
  },
  {
    id: "engineer",
    name: "Engineer",
    focus: "implementation correctness and maintainability",
    reasoningStyle: ["conventions-before-cleverness", "failure-path-design"],
    communicationStyle: ["diff-oriented", "evidence-of-execution"],
    planningPreference: ["smallest-complete-diff", "tests-with-behavior"],
    triggers: ["implement", "code", "fix", "refactor", "build", "test", "engineer"],
  },
  {
    id: "critic",
    name: "Critic",
    focus: "finding what is wrong before it ships",
    reasoningStyle: ["adversarial-review", "steelman-then-attack", "weakest-point-first"],
    communicationStyle: ["finding-location-fix", "no-praise-padding"],
    planningPreference: ["blocker-first-triage", "verify-claims-independently"],
    triggers: ["critique", "review", "challenge", "holes", "weakness", "poke"],
  },
];

export function getPersona(id: PersonaId): PersonaDefinition {
  const persona = PERSONAS.find(candidate => candidate.id === id);
  if (!persona) throw new Error(`Unknown persona '${id}'.`);
  return persona;
}

export interface ApplyPersonaOptions {
  /** Suffix persona id into the agent id so the persona form is distinct. */
  readonly distinctId?: boolean;
}

/**
 * Decorate a base agent definition with a persona. Style-only by
 * construction: only description, specialization (routing metadata), and
 * (optionally) the identity id receive additions. Skills, capabilities,
 * trust level, and model capability are preserved verbatim — a persona
 * cannot turn a read-only agent into a write agent.
 */
export function applyPersona(base: SpecialistAgentDefinition, persona: PersonaDefinition, options: ApplyPersonaOptions = {}): SpecialistAgentDefinition {
  const styleTerms = [...persona.reasoningStyle, ...persona.communicationStyle, ...persona.planningPreference, ...persona.triggers];
  const existing = new Set(base.specialization.map(term => term.toLowerCase()));
  const added = styleTerms.filter(term => !existing.has(term.toLowerCase()));
  return {
    ...base,
    identity: {
      ...base.identity,
      ...(options.distinctId ? { id: `${base.identity.id}:${persona.id}` } : {}),
      description: `${base.identity.description} Persona: ${persona.name} — ${persona.focus}.`,
    },
    // Style + routing terms only. No capability/tool/permission additions anywhere.
    specialization: [...base.specialization, ...added],
  };
}

/** Build the full persona workforce from base definitions (one persona per base agent). */
export function buildPersonaWorkforce(bases: readonly SpecialistAgentDefinition[]): SpecialistAgentDefinition[] {
  const workforce: SpecialistAgentDefinition[] = [];
  for (const persona of PERSONAS) {
    for (const base of bases) {
      workforce.push(applyPersona(base, persona, { distinctId: true }));
    }
  }
  return workforce;
}

/** All persona ids (for CLI listing). */
export function listPersonaIds(): readonly PersonaId[] {
  return PERSONAS.map(persona => persona.id);
}

export type { AgentTrustLevel };
