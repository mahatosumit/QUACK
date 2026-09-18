import { PrivacyFirewall, type SensitiveDataClass } from "../skills/discovery/privacy.js";
import type { ContextCandidate } from "./selector.js";
import {
  CATEGORY_TRUST_PAIRING,
  INSTRUCTION_LAYER_ORDER,
  type ContextSourceCategory,
  type ContextSourceItem,
  type EvidenceStatus,
  type InstructionLayerName,
  type InstructionPlanIssue,
  type TrustClass,
} from "./types.js";

/**
 * P8.3 PrivacyFirewall admission boundary for the instruction pipeline
 * (ADR 0042). The firewall decides: "is this context source allowed to
 * enter the instruction pipeline, under what trust/provenance, and with
 * what restrictions?" — and nothing else.
 *
 * It is NOT a composer, renderer, budget manager, precedence engine, or
 * retriever. It performs zero I/O: every authority view (runtime sources,
 * granted capabilities, admitted skills/memory/evidence) is supplied
 * explicitly by the caller as a snapshot. Content is never rewritten —
 * admission or rejection only; redaction, when wanted, happens upstream.
 *
 * Governance lanes are keyed on the P8.1 trust class (the trust class IS
 * the lane): high-trust items require an authorized runtime source; SKILL/
 * MEMORY/EVIDENCE items require explicit lifecycle/policy/record backing;
 * capability declarations must be a subset of actually-granted capabilities.
 */

// ---------------------------------------------------------------------------
// Authority views (caller-supplied snapshots; the firewall queries nothing)
// ---------------------------------------------------------------------------

export interface FirewallAuthorities {
  /** Sources allowed to produce SYSTEM_POLICY / TRUSTED_RUNTIME context. */
  readonly runtimeSources?: readonly string[];
  /** Capability ids actually granted by the capability system. */
  readonly authorizedCapabilities?: readonly string[];
  /** Skill ids admitted by the skill lifecycle (ADR 0041 registry). */
  readonly admittedSkills?: readonly string[];
  /** Memory item ids that passed MemoryPolicy admission upstream. */
  readonly admittedMemory?: readonly string[];
  /** Evidence record ids that exist (EvidenceRecordV1). */
  readonly admittedEvidence?: readonly string[];
}

/** Firewall input: candidates + authority snapshots. */
export interface AdmissionInput {
  readonly candidates: readonly ContextCandidate[];
  readonly authorities: FirewallAuthorities;
}

// ---------------------------------------------------------------------------
// Rejection reporting (metadata only — no content echo)
// ---------------------------------------------------------------------------

export type FirewallRejectionCode =
  | "instruction.firewall_shape_invalid"
  | "instruction.firewall_trust_mismatch"
  | "instruction.firewall_source_unauthorized"
  | "instruction.firewall_skill_unadmitted"
  | "instruction.firewall_memory_unadmitted"
  | "instruction.firewall_evidence_unadmitted"
  | "instruction.firewall_evidence_status_invalid"
  | "instruction.firewall_capability_unbacked"
  | "instruction.firewall_sensitive_content"
  | "instruction.firewall_layer_invalid"
  | "instruction.duplicate_item_id";

/** A candidate rejected at admission — never admitted, never silent. */
export interface AdmissionRejection {
  readonly itemId: string;
  readonly code: FirewallRejectionCode;
  readonly message: string;
  readonly layer?: InstructionLayerName;
}

/** Result of admission. Fail-closed: `ok: false` means nothing was admitted. */
export interface AdmissionResult {
  readonly ok: boolean;
  /** Validated, unchanged candidates ready for the P8.2 selector. */
  readonly admitted: readonly ContextCandidate[];
  readonly rejected: readonly AdmissionRejection[];
  /** Op-level failures (duplicate ids across the batch). */
  readonly issues?: readonly InstructionPlanIssue[];
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

const VALID_LAYER_NAMES: ReadonlySet<string> = new Set<string>(INSTRUCTION_LAYER_ORDER);
const EVIDENCE_STATUSES: ReadonlySet<string> = new Set<string>(["verified", "unverified", "inferred", "missing"]);
/** Module-level stateless classifier (ADR 0041) — pure regex, no I/O. */
const classifier = new PrivacyFirewall();

/**
 * Admit context candidates into the instruction pipeline (fail-closed,
 * deterministic). Per-candidate problems are recorded as rejections and
 * admission proceeds; duplicate item ids across the batch fail the whole
 * operation (P8.2 semantics — never silently merged). Admitted candidates
 * are returned UNCHANGED: the firewall validates, it never rewrites.
 */
export function admitContext(input: AdmissionInput): AdmissionResult {
  const authorities = input?.authorities ?? {};
  const candidates = input?.candidates ?? [];
  const rejected: AdmissionRejection[] = [];
  const admitted: ContextCandidate[] = [];

  candidates.forEach((candidate, index) => {
    const admission = admitCandidate(candidate, index, authorities);
    if (admission.rejection) {
      rejected.push(admission.rejection);
    } else if (admission.candidate) {
      admitted.push(admission.candidate);
    }
  });

  // Duplicate ids fail the whole admission (op-level, P8.2 semantics).
  const seen = new Set<string>();
  const issues: InstructionPlanIssue[] = [];
  for (const candidate of admitted) {
    const id = candidate.item.id;
    if (seen.has(id)) {
      issues.push({ code: "instruction.duplicate_item_id", message: `duplicate item id ${id}`, itemId: id });
      rejected.push({ itemId: id, code: "instruction.duplicate_item_id", message: "conflicting same-id candidates fail closed", ...(candidate.layer ? { layer: candidate.layer } : {}) });
    }
    seen.add(id);
  }
  if (issues.length > 0) {
    return { ok: false, admitted: [], rejected: sortRejections(rejected), issues };
  }

  return { ok: true, admitted, rejected: sortRejections(rejected) };
}

interface CandidateAdmission {
  readonly candidate?: ContextCandidate;
  readonly rejection?: AdmissionRejection;
}

/** Per-candidate admission checks. Deterministic; no metadata is repaired. */
function admitCandidate(candidate: ContextCandidate, index: number, authorities: FirewallAuthorities): CandidateAdmission {
  const fallbackId = `candidate:${String(index)}`;
  const item = candidate?.item as ContextSourceItem | undefined;
  if (!item || typeof item.id !== "string" || item.id.length === 0) {
    return { rejection: { itemId: fallbackId, code: "instruction.firewall_shape_invalid", message: "candidate item requires a non-empty string id" } };
  }
  const reject = (code: FirewallRejectionCode, message: string): CandidateAdmission =>
    ({ rejection: { itemId: item.id, code, message, ...(candidate.layer ? { layer: candidate.layer } : {}) } });

  // Shape: provenance + data object.
  const provenance = item.provenance;
  if (!provenance || typeof provenance.source !== "string" || provenance.source.length === 0) {
    return reject("instruction.firewall_shape_invalid", "item provenance requires a non-empty source");
  }
  const category = provenance.category as ContextSourceCategory;
  if (!item.data || typeof item.data !== "object" || Array.isArray(item.data)) {
    return reject("instruction.firewall_shape_invalid", "item data must be a JSON object");
  }
  if (candidate.layer !== undefined && !VALID_LAYER_NAMES.has(candidate.layer)) {
    return reject("instruction.firewall_layer_invalid", `unknown layer ${String(candidate.layer)}`);
  }

  // Trust/category pairing (P8.1 rule, defense in depth at admission).
  const pairing = CATEGORY_TRUST_PAIRING[category];
  if (!pairing) {
    return reject("instruction.firewall_shape_invalid", `unknown category ${String(category)}`);
  }
  const trust = provenance.trust;
  if (!pairing.includes(trust)) {
    return reject("instruction.firewall_trust_mismatch", `category ${String(category)} may not claim trust ${String(trust)}`);
  }

  // Governance lanes, keyed on the trust class.
  if (trust === "SYSTEM_POLICY" || trust === "TRUSTED_RUNTIME") {
    const runtimeSources = authorities.runtimeSources;
    if (!runtimeSources || !runtimeSources.includes(provenance.source)) {
      return reject("instruction.firewall_source_unauthorized", `source ${provenance.source} is not authorized to produce ${trust} context`);
    }
  }
  if (trust === "SKILL") {
    const skillId = (item.data as Record<string, unknown>).skillId;
    const admittedSkills = authorities.admittedSkills;
    if (typeof skillId !== "string" || !admittedSkills || !admittedSkills.includes(skillId)) {
      return reject("instruction.firewall_skill_unadmitted", `skill item ${item.id} is not backed by an admitted skill (got ${String(skillId)})`);
    }
  }
  if (trust === "MEMORY") {
    const memoryId = (item.data as Record<string, unknown>).memoryId;
    const admittedMemory = authorities.admittedMemory;
    if (typeof memoryId !== "string" || !admittedMemory || !admittedMemory.includes(memoryId)) {
      return reject("instruction.firewall_memory_unadmitted", `memory item ${item.id} is not backed by an admitted memory record (got ${String(memoryId)})`);
    }
  }
  if (trust === "EVIDENCE") {
    const status = (item as { status?: unknown }).status;
    if (typeof status !== "string" || !EVIDENCE_STATUSES.has(status)) {
      return reject("instruction.firewall_evidence_status_invalid", `evidence item ${item.id} must declare a valid status (got ${String(status)})`);
    }
    const evidenceId = (item.data as Record<string, unknown>).evidenceId;
    const admittedEvidence = authorities.admittedEvidence;
    if (typeof evidenceId !== "string" || !admittedEvidence || !admittedEvidence.includes(evidenceId)) {
      return reject("instruction.firewall_evidence_unadmitted", `evidence item ${item.id} is not backed by an existing evidence record (got ${String(evidenceId)})`);
    }
  }
  // Capability declarations are governance data: a capability item may only
  // declare capabilities that the capability system actually granted.
  if (category === "capability") {
    const declared = (item.data as Record<string, unknown>).capabilities;
    const authorized = authorities.authorizedCapabilities;
    if (!Array.isArray(declared) || declared.some((id) => typeof id !== "string")) {
      return reject("instruction.firewall_capability_unbacked", `capability item ${item.id} must declare capabilities as an array of ids`);
    }
    if (!authorized || !(declared as string[]).every((id) => authorized.includes(id))) {
      return reject("instruction.firewall_capability_unbacked", `capability item ${item.id} declares ungranted capabilities`);
    }
  }

  // Sensitive content: classify every string field (ADR 0041 patterns).
  // Rejection only — never rewriting. Class names in the reason, no content.
  const sensitive = findSensitiveClasses(item.data);
  if (sensitive.length > 0) {
    return reject("instruction.firewall_sensitive_content", `item ${item.id} contains sensitive content (${sensitive.join(", ")}); redact upstream and resubmit`);
  }

  // Admitted unchanged — validation, not transformation.
  return { candidate };
}

/** Deterministic recursive sensitive-class scan over item data. */
function findSensitiveClasses(data: Record<string, unknown>): readonly SensitiveDataClass[] {
  const classes: SensitiveDataClass[] = [];
  const walk = (value: Record<string, unknown>): void => {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string") {
        for (const match of classifier.classify(entry, key)) {
          if (!classes.includes(match.dataClass)) classes.push(match.dataClass);
        }
      } else if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
        walk(entry as Record<string, unknown>);
      }
    }
  };
  walk(data);
  return classes;
}

function sortRejections(rejected: readonly AdmissionRejection[]): readonly AdmissionRejection[] {
  return [...rejected].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}
