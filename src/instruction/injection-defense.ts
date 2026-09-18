import { createHash } from "node:crypto";
import { fail, ok, type JsonObject, type QuackError, type QuackResult } from "../core/types.js";
import { canonicalJson } from "./composer.js";
import {
  CATEGORY_TRUST_PAIRING,
  INSTRUCTION_LAYER_ORDER,
  type ComposedInstruction,
  type ContextSourceCategory,
  type TrustClass,
} from "./types.js";

/**
 * P8.5 Injection Defense Enforcement (ADR 0042).
 *
 * The invariant enforced here is structural, not textual:
 *
 *   UNTRUSTED CONTENT CANNOT ACQUIRE INSTRUCTION AUTHORITY MERELY BY
 *   CONTAINING INSTRUCTION-LIKE LANGUAGE. DATA REMAINS DATA.
 *
 * This module is the final pre-dispatch tripwire between the composed
 * instruction (P8.1) and the governed model runtime (P8.4). It separates
 * two mechanisms:
 *
 * - STRUCTURAL ENFORCEMENT (fail-closed rejections): the composed
 *   instruction is re-verified against the P8.1 contracts — digest
 *   correspondence (any post-composition mutation of layers, output
 *   contract, failure policy, or identity is detected by recomputing the
 *   canonical SHA-256 digest), trust/category pairing, evidence status,
 *   duplicate ids, and render-safe item ids (item ids are the only raw
 *   field in the model-facing rendering; an id that could forge section
 *   structure is rejected, never rewritten). Violations never reach the
 *   runtime. No content is modified.
 *
 * - HEURISTIC DETECTION (defense-in-depth flags): a small deterministic
 *   pattern family flags instruction-like language in item DATA. Flags
 *   are metadata-only (item id, trust, category, pattern kind names —
 *   never matched content). Flagged content is NOT rewritten, NOT
 *   rejected, and its trust class does NOT change: "looks like an
 *   injection attempt" never means "therefore trusted" or "therefore
 *   deleted". Structural trust/provenance remains the primary defense.
 *
 * The component is pure: no I/O, no clock, no randomness, no retrieval,
 * no provider/broker calls. The ADR 0041 classifier is not reused here
 * because it classifies sensitive DATA classes (secrets, keys), not
 * instruction-override language — different semantics; P8.3 already
 * applies it at admission.
 */

// ---------------------------------------------------------------------------
// Result contract
// ---------------------------------------------------------------------------

/** A metadata-only detection flag. Never contains matched content. */
export interface InjectionFlag {
  readonly itemId: string;
  readonly trust: TrustClass;
  readonly category: ContextSourceCategory;
  /** Pattern kind names (fixed vocabulary), sorted deterministically. */
  readonly patterns: readonly string[];
}

/** Result of enforcement. Fail-closed: `ok: false` means no dispatch. */
export interface InstructionDefenseResult {
  readonly ok: boolean;
  /** Present only on failure (structured, metadata-safe). */
  readonly error?: QuackError;
  /** Heuristic detection flags (defense-in-depth; informational only). */
  readonly flags: readonly InjectionFlag[];
  /** Number of items scanned — deterministic, useful for audit. */
  readonly scannedItems: number;
}

export type InstructionDefenseErrorCode =
  | "instruction.defense_shape_invalid"
  | "instruction.defense_digest_mismatch"
  | "instruction.defense_item_id_unsafe"
  | "instruction.defense_trust_pairing_violated"
  | "instruction.defense_evidence_status_invalid"
  | "instruction.duplicate_item_id";

// ---------------------------------------------------------------------------
// Deterministic injection-pattern family (defense-in-depth only)
// ---------------------------------------------------------------------------

/**
 * Fixed pattern family for flagging instruction-like language. Kinds are a
 * closed vocabulary; patterns are deliberately conservative. A match NEVER
 * changes trust, precedence, or content — it only records a flag so the
 * dispatch (and later harness/trace phases) knows the instruction carries
 * instruction-like data content.
 */
const INJECTION_PATTERNS: ReadonlyArray<{ readonly kind: string; readonly pattern: RegExp }> = [
  { kind: "instruction_override", pattern: /\b(?:ignore|disregard|forget)\b.{0,40}\b(?:previous|prior|above|earlier|all|your)\b.{0,30}\b(?:instruction|rule|policy|directive|message|constraint)s?\b/i },
  { kind: "instruction_override", pattern: /\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions\b/i },
  { kind: "authority_claim", pattern: /\byou\s+are\s+now\b/i },
  { kind: "authority_claim", pattern: /\b(?:act|behave)\s+as\s+(?:an?\s+)?(?:administrator|admin|root|developer|system)\b/i },
  { kind: "authority_claim", pattern: /\bidentity\s+authority\b/i },
  { kind: "policy_claim", pattern: /\b(?:system|security|company|official|developer|runtime)\b.{0,20}\b(?:policy|instruction|directive|message)\s*:/i },
  { kind: "policy_claim", pattern: /\b(?:SYSTEM_POLICY|TRUSTED_RUNTIME)\s*[:=]/ },
  { kind: "policy_claim", pattern: /\bbegin\s+(?:system|developer)\s+(?:message|prompt|block)\b/i },
  { kind: "policy_claim", pattern: /\bend\s+(?:system|developer)\s+(?:message|prompt|block)\b/i },
  { kind: "capability_claim", pattern: /\b(?:you\s+(?:now\s+)?(?:have|are granted)|is\s+now\s+authorized|granted)\b.{0,50}\b(?:permission|capability|access|privilege|authorized)\b/i },
  { kind: "capability_claim", pattern: /\b(?:capability\s+grants|permissions?)\s+(?:approved|granted)\b/i },
  { kind: "privilege_claim", pattern: /\b(?:administrator|admin|root|developer)\s+privileges?\b/i },
  { kind: "privilege_claim", pattern: /\b(?:trusted|verified|official)\s+skill\b/i },
  { kind: "privilege_claim", pattern: /\bignore\s+(?:the\s+)?(?:skill\s+)?sandbox\b/i },
  { kind: "privilege_claim", pattern: /\bunrestricted\s+execution\b/i },
  { kind: "verification_claim", pattern: /\b(?:verified|peer[\s-]?reviewed|experimentally\s+confirmed|trusted\s+source)\b.{0,20}[:;]/i },
  { kind: "runtime_bypass", pattern: /\b(?:skip|bypass|disable|override)\b.{0,30}\b(?:governed|runtime|firewall|policy|governance|broker)\b/i },
  { kind: "role_marker", pattern: /\bchange\s+your\s+role\b/i },
  { kind: "role_marker", pattern: /(?:^|\n)\s*(?:system|developer|assistant|tool)\s*:/i },
  { kind: "role_marker", pattern: /<\|?(?:im_start|im_end|system|assistant|developer)\|?>/i },
  { kind: "role_marker", pattern: /<\/?(?:system|developer|assistant)_?(?:message|prompt|role)>/i },
  { kind: "secret_disclosure", pattern: /\b(?:reveal|print|show|output|disclose)\b.{0,40}\b(?:secret|hidden|system\s+prompt|private\s+key|credential)s?\b/i },
];

// ---------------------------------------------------------------------------
// Structural validation helpers
// ---------------------------------------------------------------------------

const VALID_LAYER_NAMES: ReadonlySet<string> = new Set<string>(INSTRUCTION_LAYER_ORDER);
const EVIDENCE_STATUSES: ReadonlySet<string> = new Set<string>(["verified", "unverified", "inferred", "missing"]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Item ids are the only raw-rendered field in the model-facing text
 * (`[TAG] id: data`). An id containing newlines, markdown headers, or
 * trust-tag prefixes could forge rendered structure. The dispatch boundary
 * requires render-safe ids; unsafe ids are rejected (fail closed), never
 * rewritten.
 */
const RENDER_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

/**
 * Enforce injection defense on a composed instruction. Pure and
 * deterministic: identical input → identical result (same decisions, same
 * flag list, same order). Structural violations fail closed with a
 * structured, metadata-safe error; heuristic matches only add flags.
 */
export function enforceInstructionDefense(composed: ComposedInstruction): InstructionDefenseResult {
  const reject = (code: InstructionDefenseErrorCode, message: string): InstructionDefenseResult =>
    ({ ok: false, error: { code, message, category: "validation", recoverable: false }, flags: [], scannedItems: 0 });

  if (!composed || typeof composed.missionId !== "string" || composed.missionId.length === 0
    || typeof composed.digest !== "string" || !DIGEST_PATTERN.test(composed.digest)
    || !Array.isArray(composed.layers)
    || !composed.outputContract || typeof composed.outputContract.kind !== "string"
    || !composed.failurePolicy || !Array.isArray(composed.failurePolicy.allowedModes)) {
    return reject("instruction.defense_shape_invalid", "composed instruction failed defense shape validation");
  }

  // Digest correspondence: recompute the P8.1 canonical digest over the
  // semantic content. Any post-composition mutation (layers, identity,
  // output contract, failure policy) breaks correspondence — instruction
  // identity is exact or the instruction is rejected.
  const base = {
    missionId: composed.missionId,
    ...(composed.taskId ? { taskId: composed.taskId } : {}),
    layers: composed.layers,
    outputContract: composed.outputContract,
    failurePolicy: composed.failurePolicy,
  };
  const expectedDigest = createHash("sha256").update(canonicalJson(base)).digest("hex");
  if (expectedDigest !== composed.digest) {
    return reject("instruction.defense_digest_mismatch", "composed instruction does not match its digest (post-composition mutation detected)");
  }

  // Per-item structural re-validation (defense in depth against a
  // digest-compliant but contract-violating instruction).
  const seenIds = new Set<string>();
  const flags: InjectionFlag[] = [];
  let scannedItems = 0;
  for (const layer of composed.layers) {
    if (!layer || !VALID_LAYER_NAMES.has(layer.name)) {
      return reject("instruction.defense_shape_invalid", `unknown layer ${String(layer?.name)}`);
    }
    for (const item of layer.items) {
      if (!item || typeof item.id !== "string" || item.id.length === 0) {
        return reject("instruction.defense_shape_invalid", "layer item without an id");
      }
      if (seenIds.has(item.id)) {
        return reject("instruction.duplicate_item_id", `duplicate item id ${item.id}`);
      }
      seenIds.add(item.id);
      if (!RENDER_SAFE_ID.test(item.id)) {
        return reject("instruction.defense_item_id_unsafe", `item id ${item.id} is not render-safe`);
      }
      const provenance = item.provenance;
      const pairing = provenance ? CATEGORY_TRUST_PAIRING[provenance.category as ContextSourceCategory] : undefined;
      if (!provenance || typeof provenance.source !== "string" || provenance.source.length === 0 || !pairing) {
        return reject("instruction.defense_shape_invalid", `item ${item.id} has invalid provenance`);
      }
      if (!pairing.includes(provenance.trust)) {
        return reject("instruction.defense_trust_pairing_violated", `item ${item.id} category ${String(provenance.category)} may not claim trust ${String(provenance.trust)}`);
      }
      if (layer.name === "evidence" && !EVIDENCE_STATUSES.has((item as { status?: unknown }).status as string)) {
        return reject("instruction.defense_evidence_status_invalid", `evidence item ${item.id} has an invalid status`);
      }

      scannedItems += 1;
      const patterns = scanData(item.data);
      if (patterns.length > 0) {
        flags.push({ itemId: item.id, trust: provenance.trust, category: provenance.category, patterns });
      }
    }
  }

  flags.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  return { ok: true, flags, scannedItems };
}

/**
 * Deterministic heuristic scan over item data. Returns matched pattern
 * kinds (fixed vocabulary, deduplicated, original table order) — never
 * the matched content. Detection is informational: it changes nothing
 * about trust, precedence, or the content itself.
 */
function scanData(data: JsonObject | undefined): readonly string[] {
  const kinds: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      for (const { kind, pattern } of INJECTION_PATTERNS) {
        if (pattern.test(value) && !kinds.includes(kind)) kinds.push(kind);
      }
    } else if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
    } else if (value !== null && typeof value === "object") {
      for (const entry of Object.values(value as Record<string, unknown>)) walk(entry);
    }
  };
  walk(data);
  return kinds;
}

// ---------------------------------------------------------------------------
// Defense-checked dispatch metadata
// ---------------------------------------------------------------------------

/** Serializable flag view for request metadata (JsonObject-compatible). */
export function flagsToMetadata(flags: readonly InjectionFlag[]): JsonObject | undefined {
  if (flags.length === 0) return undefined;
  return {
    injectionFlags: flags.map((flag) => ({
      itemId: flag.itemId,
      trust: flag.trust,
      category: flag.category,
      patterns: flag.patterns,
    })),
  };
}

/** Validate a defense result is dispatchable (helper for call sites). */
export function assertDispatchable(defense: InstructionDefenseResult): QuackResult<readonly InjectionFlag[]> {
  if (!defense.ok) return fail(defense.error as QuackError);
  return ok(defense.flags);
}
