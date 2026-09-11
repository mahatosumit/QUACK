import { fail, ok, type JsonObject, type QuackResult } from "../core/types.js";

/**
 * P10.1/P10.2 ecosystem domain model + strict manifest contract (ADR 0044).
 *
 * A manifest is a DECLARATION. It is data, never authority: declaring
 * `filesystem.write.external` grants nothing — actual authority is resolved
 * by the existing CapabilityBroker at governed execution time, which P10
 * does not provide. The ecosystem layer catalogs, verifies integrity, and
 * manages lifecycle; it never executes extension content.
 *
 * Identity is deterministic: (id, version) with canonical serialization for
 * digests. No timestamps or random values participate in identity.
 */

/** Extension kinds supported by the P10 foundation. */
export const EXTENSION_KINDS = [
  "skill", "knowledge-pack", "agent", "connector", "tool", "workflow",
  "provider", "model-adapter", "ui",
] as const;
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

/** Semantic version string (same grammar as the existing extensions registry). */
export type ExtensionVersion = string;

/** A declared dependency: exact version only — ranges are resolved deterministically, never "latest". */
export interface ExtensionDependencyDeclaration {
  readonly id: string;
  readonly version: string;
}

/** Publisher metadata — DATA until independently verified; never a trust claim. */
export interface ExtensionPublisher {
  readonly name: string;
  /** Honest signature state: unsigned packages are NOT trusted. */
  readonly signatureState: "UNSIGNED" | "UNVERIFIED";
}

/** Provenance recorded at discovery/install — caller-supplied, host-owned. */
export interface ExtensionSourceProvenance {
  readonly kind: "local-path" | "builtin" | "workspace";
  readonly sourceId: string;
}

/**
 * P10.2 strict manifest. Known fields only; unknown fields are REJECTED
 * (fail-closed) so manifests cannot smuggle future/hidden semantics.
 */
export interface ExtensionManifestV2 {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly kind: ExtensionKind;
  readonly description: string;
  readonly quackContractVersion: string;
  readonly publisher: ExtensionPublisher;
  /** Compatibility range for the host runtime (semver-compatible constraint string). */
  readonly compatibleWith: string;
  /** Entry/reference into the package — never executed by the catalog. */
  readonly entry: string;
  /** Declared capabilities — descriptors, NOT grants. */
  readonly capabilities: readonly string[];
  readonly dependencies: readonly ExtensionDependencyDeclaration[];
  /** Declared permissions validated against the existing permission vocabulary. */
  readonly permissions: readonly string[];
  readonly integrity: ExtensionIntegrityDeclaration;
  /** Optional UI metadata (label only — no executable payloads). */
  readonly ui?: { readonly label: string };
}

/** Package integrity declaration: canonical sha256 digest of package content. */
export interface ExtensionIntegrityDeclaration {
  readonly algorithm: "sha256";
  readonly digest: string;
}

export type ManifestErrorCode =
  | "extension.manifest_invalid"
  | "extension.manifest_invalid_id"
  | "extension.manifest_invalid_version"
  | "extension.manifest_invalid_kind"
  | "extension.manifest_unknown_field"
  | "extension.manifest_missing_field"
  | "extension.manifest_invalid_dependency"
  | "extension.manifest_invalid_capability"
  | "extension.manifest_invalid_permission"
  | "extension.manifest_invalid_integrity"
  | "extension.manifest_invalid_compatibility"
  | "extension.manifest_publisher_signature_claim";

export interface ManifestRejection {
  readonly code: ManifestErrorCode;
  readonly message: string;
  readonly field?: string;
}

const ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)?)?$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*))*)?(?:\+[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?$/;
const HEX64 = /^[0-9a-f]{64}$/;
const COMPAT_PATTERN = /^\d+\.\d+\.\d+(?:\s*(?:<|<=|>=|>|=|\^|~)\s*\d+\.\d+\.\d+)*$/;

const MANIFEST_FIELDS: ReadonlySet<string> = new Set([
  "id", "name", "version", "kind", "description", "quackContractVersion",
  "publisher", "compatibleWith", "entry", "capabilities", "dependencies",
  "permissions", "integrity", "ui",
]);

/** Field order for the canonical manifest representation (deterministic digests). */
const CANONICAL_FIELD_ORDER = [
  "id", "version", "kind", "name", "description", "quackContractVersion",
  "compatibleWith", "entry", "capabilities", "dependencies", "permissions",
  "publisher", "integrity",
] as const;

/**
 * Validate a manifest strictly. Fails closed on every malformed dimension:
 * identity, version, kind, unknown/missing fields, dependencies,
 * capabilities, permissions, integrity, compatibility, publisher claims.
 */
export function validateExtensionManifest(input: unknown): QuackResult<{ readonly manifest: ExtensionManifestV2 }> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail({ code: "extension.manifest_invalid", message: "Manifest must be an object.", category: "validation", recoverable: false });
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!MANIFEST_FIELDS.has(key)) {
      return fail({ code: "extension.manifest_unknown_field", message: `Unknown manifest field '${key}' is rejected (fail-closed).`, category: "validation", recoverable: false });
    }
  }
  for (const field of ["id", "name", "version", "kind", "description", "quackContractVersion", "publisher", "compatibleWith", "entry", "capabilities", "dependencies", "permissions", "integrity"]) {
    if (raw[field] === undefined) {
      return fail({ code: "extension.manifest_missing_field", message: `Manifest field '${field}' is required.`, category: "validation", recoverable: false, context: { field } });
    }
  }
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
    return fail({ code: "extension.manifest_invalid_id", message: "Extension id must be a lowercase dot/slash-namespaced identifier.", category: "validation", recoverable: false, context: { field: "id" } });
  }
  if (typeof raw.version !== "string" || !VERSION_PATTERN.test(raw.version)) {
    return fail({ code: "extension.manifest_invalid_version", message: "Extension version must be a semantic version.", category: "validation", recoverable: false, context: { field: "version" } });
  }
  if (typeof raw.kind !== "string" || !(EXTENSION_KINDS as readonly string[]).includes(raw.kind)) {
    return fail({ code: "extension.manifest_invalid_kind", message: `Extension kind must be one of: ${EXTENSION_KINDS.join(", ")}.`, category: "validation", recoverable: false, context: { field: "kind" } });
  }
  for (const field of ["name", "description", "compatibleWith", "entry"] as const) {
    if (typeof raw[field] !== "string" || raw[field].trim().length === 0) {
      return fail({ code: "extension.manifest_invalid", message: `Manifest field '${field}' must be a nonempty string.`, category: "validation", recoverable: false, context: { field } });
    }
  }
  if (raw.quackContractVersion !== "1.0.0") {
    return fail({ code: "extension.manifest_invalid", message: "Unsupported quackContractVersion.", category: "validation", recoverable: false, context: { field: "quackContractVersion" } });
  }
  const compat = raw.compatibleWith;
  if (typeof compat !== "string" || !COMPAT_PATTERN.test(compat)) {
    return fail({ code: "extension.manifest_invalid_compatibility", message: "compatibleWith must be a semver base with optional comparison operators.", category: "validation", recoverable: false, context: { field: "compatibleWith" } });
  }
  if (typeof raw.entry !== "string" || raw.entry.includes("..") || raw.entry.startsWith("/")) {
    return fail({ code: "extension.manifest_invalid", message: "Entry must be a package-relative path without traversal.", category: "validation", recoverable: false, context: { field: "entry" } });
  }
  // Publisher: DATA only. A signature field claiming verification is rejected.
  const publisher = raw.publisher;
  const pub = (typeof publisher === "object" && publisher !== null && !Array.isArray(publisher)) ? publisher as Record<string, unknown> : undefined;
  if (!pub || typeof pub.name !== "string" || pub.name.trim().length === 0) {
    return fail({ code: "extension.manifest_invalid", message: "Publisher must carry a nonempty name.", category: "validation", recoverable: false, context: { field: "publisher" } });
  }
  if (pub.signatureState !== undefined && pub.signatureState !== "UNSIGNED" && pub.signatureState !== "UNVERIFIED") {
    return fail({ code: "extension.manifest_publisher_signature_claim", message: "Publisher signature state may only be UNSIGNED or UNVERIFIED — verification cannot be self-asserted.", category: "permission", recoverable: false, context: { field: "publisher.signatureState" } });
  }
  for (const key of Object.keys(pub)) {
    if (key !== "name" && key !== "signatureState") {
      return fail({ code: "extension.manifest_unknown_field", message: `Unknown publisher field '${key}' is rejected.`, category: "validation", recoverable: false });
    }
  }
  // Capabilities: descriptor strings only — never authority.
  if (!Array.isArray(raw.capabilities) || raw.capabilities.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    return fail({ code: "extension.manifest_invalid_capability", message: "Capabilities must be nonempty descriptor strings.", category: "validation", recoverable: false, context: { field: "capabilities" } });
  }
  // Dependencies: exact versions, unique, well-formed.
  if (!Array.isArray(raw.dependencies)) {
    return fail({ code: "extension.manifest_invalid_dependency", message: "Dependencies must be an array.", category: "validation", recoverable: false, context: { context: { field: "dependencies" } } });
  }
  const seenDependency = new Set<string>();
  for (const dependency of raw.dependencies) {
    if (typeof dependency !== "object" || dependency === null || Array.isArray(dependency)) {
      return fail({ code: "extension.manifest_invalid_dependency", message: "Each dependency must be an object.", category: "validation", recoverable: false, context: { context: { field: "dependencies" } } });
    }
    const dep = dependency as Record<string, unknown>;
    for (const key of Object.keys(dep)) {
      if (key !== "id" && key !== "version") {
        return fail({ code: "extension.manifest_unknown_field", message: `Unknown dependency field '${key}' is rejected.`, category: "validation", recoverable: false });
      }
    }
    if (typeof dep.id !== "string" || !ID_PATTERN.test(dep.id) || typeof dep.version !== "string" || !VERSION_PATTERN.test(dep.version)) {
      return fail({ code: "extension.manifest_invalid_dependency", message: "Dependency requires a valid id and an exact semantic version.", category: "validation", recoverable: false, context: { context: { field: "dependencies" } } });
    }
    if (seenDependency.has(dep.id)) {
      return fail({ code: "extension.manifest_invalid_dependency", message: `Duplicate dependency ${dep.id}.`, category: "validation", recoverable: false, context: { context: { field: "dependencies" } } });
    }
    if (dep.id === raw.id) {
      return fail({ code: "extension.manifest_invalid_dependency", message: "An extension cannot depend on itself.", category: "validation", recoverable: false, context: { context: { field: "dependencies" } } });
    }
    seenDependency.add(dep.id);
  }
  // Permissions: validated against the existing vocabulary — declaration, not grant.
  if (!Array.isArray(raw.permissions) || raw.permissions.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    return fail({ code: "extension.manifest_invalid_permission", message: "Permissions must be nonempty strings.", category: "validation", recoverable: false, context: { field: "permissions" } });
  }
  // Integrity: sha256 canonical declaration only.
  const integrity = raw.integrity;
  if (typeof integrity !== "object" || integrity === null || Array.isArray(integrity)) {
    return fail({ code: "extension.manifest_invalid_integrity", message: "Integrity must be an object.", category: "validation", recoverable: false, context: { field: "integrity" } });
  }
  const integ = integrity as Record<string, unknown>;
  for (const key of Object.keys(integ)) {
    if (key !== "algorithm" && key !== "digest") {
      return fail({ code: "extension.manifest_unknown_field", message: `Unknown integrity field '${key}' is rejected.`, category: "validation", recoverable: false });
    }
  }
  if (integ.algorithm !== "sha256" || typeof integ.digest !== "string" || !HEX64.test(integ.digest)) {
    return fail({ code: "extension.manifest_invalid_integrity", message: "Integrity must declare a sha256 hex digest.", category: "validation", recoverable: false, context: { field: "integrity" } });
  }
  // Optional UI metadata: label only.
  if (raw.ui !== undefined) {
    if (typeof raw.ui !== "object" || raw.ui === null || Array.isArray(raw.ui) || typeof (raw.ui as Record<string, unknown>).label !== "string" || ((raw.ui as Record<string, unknown>).label as string).trim().length === 0) {
      return fail({ code: "extension.manifest_invalid", message: "UI metadata must carry a nonempty label.", category: "validation", recoverable: false, context: { field: "ui" } });
    }
    for (const key of Object.keys(raw.ui as Record<string, unknown>)) {
      if (key !== "label") {
        return fail({ code: "extension.manifest_unknown_field", message: `Unknown ui field '${key}' is rejected.`, category: "validation", recoverable: false });
      }
    }
  }
  const manifest: ExtensionManifestV2 = Object.freeze({
    id: raw.id,
    name: raw.name as string,
    version: raw.version,
    kind: raw.kind as ExtensionKind,
    description: raw.description as string,
    quackContractVersion: raw.quackContractVersion as string,
    publisher: Object.freeze({ name: (publisher as Record<string, unknown>).name as string, signatureState: (pub.signatureState as "UNSIGNED" | "UNVERIFIED") ?? "UNSIGNED" }),
    compatibleWith: compat,
    entry: raw.entry,
    capabilities: Object.freeze([...(raw.capabilities as string[])]),
    dependencies: Object.freeze((raw.dependencies as ExtensionDependencyDeclaration[]).map((dep) => Object.freeze({ id: dep.id, version: dep.version }))),
    permissions: Object.freeze([...(raw.permissions as string[])]),
    integrity: Object.freeze({ algorithm: "sha256" as const, digest: integ.digest as string }),
    ...(raw.ui !== undefined ? { ui: Object.freeze({ label: (raw.ui as Record<string, unknown>).label as string }) } : {}),
  });
  return ok({ manifest });
}

/**
 * P10.9 canonical manifest representation — deterministic key order and
 * serialization. Same manifest bytes â†’ same canonical form â†’ same digest.
 */
export function canonicalManifestForm(manifest: ExtensionManifestV2): string {
  const record: Record<string, unknown> = {};
  for (const field of CANONICAL_FIELD_ORDER) {
    const value = (manifest as unknown as Record<string, unknown>)[field];
    if (value === undefined) continue;
    if (field === "capabilities" || field === "permissions") {
      record[field] = [...value as readonly string[]].sort();
    } else if (field === "dependencies") {
      record[field] = (value as readonly ExtensionDependencyDeclaration[])
        .map((dep) => ({ id: dep.id, version: dep.version }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } else if (field === "publisher") {
      record[field] = { name: (value as ExtensionPublisher).name, signatureState: (value as ExtensionPublisher).signatureState };
    } else if (field === "integrity") {
      record[field] = { algorithm: "sha256", digest: (value as ExtensionIntegrityDeclaration).digest };
    } else {
      record[field] = value;
    }
  }
  return JSON.stringify(record, CANONICAL_FIELD_ORDER as unknown as (string | number)[]);
}

/** Parse a manifest from unknown JSON (e.g. a package manifest file). */
export function parseExtensionManifest(value: unknown): QuackResult<{ readonly manifest: ExtensionManifestV2 }> {
  return validateExtensionManifest(value);
}

export type { ManifestRejection as ExtensionManifestRejectionType };
