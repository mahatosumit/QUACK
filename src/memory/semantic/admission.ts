import { fail, ok, type QuackResult } from "../../core/types.js";
import { PrivacyFirewall, type SensitiveDataClass } from "../../skills/discovery/privacy.js";
import {
  SEMANTIC_MEMORY_BOUNDS,
  SEMANTIC_MEMORY_SCOPES,
  chunkSemanticMemory,
  semanticContentHash,
  type SemanticMemoryChunk,
  type SemanticMemoryProvenance,
  type SemanticMemoryRecord,
  type SemanticMemoryScope,
  type SemanticMemorySourceKind,
} from "./records.js";

/**
 * P9.4 memory admission boundary (ADR 0043).
 *
 * The admission boundary validates a prospective memory record BEFORE any
 * persistence, embedding, or indexing. It is the only path from raw content
 * to a canonical record. Rejected memory fails closed — nothing is coerced,
 * nothing is rewritten to be "safe": malicious content is rejected or, when
 * policy explicitly allows it, admitted as inert data whose authority
 * fields remain host-owned.
 *
 * P9.5 CONTENT VS METADATA: content is validated for SHAPE (string, size
 * bounds) and sensitive-content policy only. It is never inspected for
 * authority semantics — a record containing "ignore previous instructions"
 * is admissible as data (subject to the sensitive-content policy) and that
 * text has zero effect on scope, owner, lifecycle, or trust. Authority
 * fields come exclusively from the host-supplied admission request.
 */

/** Caller-supplied request: content (data) + host-owned authority fields. */
export interface SemanticMemoryAdmissionRequest {
  readonly content: string;
  readonly scope: SemanticMemoryScope;
  readonly owner: string;
  readonly provenance: SemanticMemoryProvenance;
  /** Actor requesting persistence — must be authorized for the scope. */
  readonly actor: string;
  /** Existing record ids (duplicate-identity protection at admission). */
  readonly existingIds?: readonly string[];
  /** Existing (scope, contentHash) pairs for duplicate-content rejection. */
  readonly existingContentHashes?: ReadonlySet<string>;
  readonly policyNotes?: string;
  readonly metadata?: SemanticMemoryRecord["metadata"];
  /** P9.3 persistence must be explicit — a model saying "remember this" is not a request. */
  readonly persistence: "explicit";
}

/** Structured rejection — code + message only, never content echo. */
export type AdmissionRejectionCode =
  | "memory.admission_shape_invalid"
  | "memory.admission_scope_invalid"
  | "memory.admission_owner_invalid"
  | "memory.admission_actor_invalid"
  | "memory.admission_provenance_invalid"
  | "memory.admission_content_oversize"
  | "memory.admission_persistence_not_explicit"
  | "memory.admission_duplicate_id"
  | "memory.admission_duplicate_content"
  | "memory.admission_sensitive_content";

export interface SemanticAdmissionRejection {
  readonly code: AdmissionRejectionCode;
  readonly message: string;
}

export type SemanticAdmissionResult = QuackResult<{
  readonly record: SemanticMemoryRecord;
  readonly chunks: readonly SemanticMemoryChunk[];
  readonly rejection?: undefined;
} | {
  readonly record?: undefined;
  readonly chunks?: undefined;
  readonly rejection: SemanticAdmissionRejection;
}>;

const SOURCE_KINDS: ReadonlySet<string> = new Set(["user", "mission", "file", "workspace", "runtime"]);
/** Module-level stateless classifier (ADR 0041) — pure regex, no I/O. */
const classifier = new PrivacyFirewall();

/**
 * Admit one prospective memory record (P9.4). Pure function — no I/O, no
 * clock dependence for identity (createdAt/updatedAt are caller-supplied so
 * tests are deterministic; the store supplies wall-clock on persistence).
 * Fail-closed: every invalid field rejects the whole admission.
 */
export function admitSemanticMemory(
  request: SemanticMemoryAdmissionRequest,
  nowIso: string,
  memoryId: string,
): SemanticAdmissionResult {
  const reject = (code: AdmissionRejectionCode, message: string): SemanticAdmissionResult =>
    ok({ rejection: { code, message } });

  // Shape.
  if (typeof request.content !== "string" || request.content.trim().length === 0) {
    return reject("memory.admission_shape_invalid", "content must be a non-empty string");
  }
  if (typeof request.persistence !== "string" || request.persistence !== "explicit") {
    return reject("memory.admission_persistence_not_explicit", "persistence must be explicitly requested by an authorized actor");
  }
  // Scope (P9.2).
  if (typeof request.scope !== "string" || !SEMANTIC_MEMORY_SCOPES.includes(request.scope as SemanticMemoryScope)) {
    return reject("memory.admission_scope_invalid", `unknown scope ${String(request.scope)}`);
  }
  if (typeof request.owner !== "string" || request.owner.trim().length === 0) {
    return reject("memory.admission_owner_invalid", "owner must be a non-empty string");
  }
  if (typeof request.actor !== "string" || request.actor.trim().length === 0) {
    return reject("memory.admission_actor_invalid", "actor must be a non-empty string");
  }
  // Provenance (P9.16).
  const provenance = request.provenance;
  if (!provenance || typeof provenance !== "object"
    || typeof provenance.sourceKind !== "string" || !SOURCE_KINDS.has(provenance.sourceKind)
    || typeof provenance.sourceId !== "string" || provenance.sourceId.trim().length === 0
    || (provenance.sourceRef !== undefined && (typeof provenance.sourceRef !== "string" || provenance.sourceRef.length === 0))) {
    return reject("memory.admission_provenance_invalid", "provenance requires a known sourceKind and a non-empty sourceId");
  }
  // Content bounds (P9.28).
  if (request.content.length > SEMANTIC_MEMORY_BOUNDS.maxContentChars) {
    return reject("memory.admission_content_oversize", `content exceeds the maximum of ${String(SEMANTIC_MEMORY_BOUNDS.maxContentChars)} characters`);
  }
  // Duplicate identity.
  if (request.existingIds?.includes(memoryId)) {
    return reject("memory.admission_duplicate_id", `memoryId ${memoryId} already exists`);
  }
  const contentHash = semanticContentHash(request.content);
  if (request.existingContentHashes?.has(`${request.scope}:${contentHash}`)) {
    return reject("memory.admission_duplicate_content", "identical content already exists in this scope");
  }
  // Sensitive-content policy (P9.4): reject with class names only, never
  // rewrite content and never echo it. Same semantics as the P8.3 firewall.
  const sensitiveClasses = classifySensitive(request.content);
  if (sensitiveClasses.length > 0) {
    return reject("memory.admission_sensitive_content", `content contains sensitive data (${sensitiveClasses.join(", ")}); redact and resubmit`);
  }

  const record: SemanticMemoryRecord = {
    memoryId,
    scope: request.scope,
    owner: request.owner,
    content: request.content,
    contentHash,
    provenance: { sourceKind: provenance.sourceKind, sourceId: provenance.sourceId,
      ...(provenance.sourceRef !== undefined ? { sourceRef: provenance.sourceRef } : {}) },
    lifecycle: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
    admission: { actor: request.actor, policyNotes: request.policyNotes ?? "admitted by host policy", persistence: "explicit" },
    ...(request.metadata !== undefined ? { metadata: request.metadata } : {}),
  };
  return ok({ record, chunks: chunkSemanticMemory(memoryId, request.content) });
}

/** Deterministic sensitive-class scan (class names only). */
function classifySensitive(content: string): readonly SensitiveDataClass[] {
  const classes: SensitiveDataClass[] = [];
  for (const match of classifier.classify(content, "content")) {
    if (!classes.includes(match.dataClass)) classes.push(match.dataClass);
  }
  return classes;
}
