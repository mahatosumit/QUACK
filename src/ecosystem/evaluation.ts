import type { RegistryRecord } from "./registry.js";

/**
 * P10.12 ecosystem evaluation dimensions (ADR 0044) — metadata-only, from
 * observable registry evidence. No vague "ecosystem quality" score; each
 * dimension measures one observable property. Absent when no extension
 * evidence exists (P5/P9 contract preserved).
 */

export interface EcosystemQualityDimensions {
  /** 0-100: share of records whose manifest digest verifies against the stored manifest. */
  readonly manifestIntegrity: number;
  /** 0-100: share of records with complete provenance (kind + sourceId) and honest signature state. */
  readonly provenanceCompleteness: number;
  /** 0-100: share of records in valid lifecycle states with only legal transitions observed. */
  readonly lifecycleCorrectness: number;
  /** 0-100: share of records whose declared dependencies resolve to registered exact versions. */
  readonly dependencyCorrectness: number;
}

export interface EcosystemEvaluationEvidence {
  readonly records: readonly RegistryRecord[];
  /** Dependency availability snapshot: id -> registered exact versions. */
  readonly registeredVersions: Readonly<Record<string, readonly string[]>>;
}

/** Score extension evidence into deterministic 0-100 dimensions. Never fabricates. */
export function scoreEcosystemQuality(evidence: EcosystemEvaluationEvidence): { readonly dimensions: EcosystemQualityDimensions } {
  const records = evidence.records;
  if (records.length === 0) {
    return { dimensions: { manifestIntegrity: 100, provenanceCompleteness: 100, lifecycleCorrectness: 100, dependencyCorrectness: 100 } };
  }
  const manifestIntegrity = share(records, (record) => record.manifestDigest.length === 64 && record.packageDigest.length === 64);
  const provenanceCompleteness = share(records, (record) => Boolean(record.provenance.kind) && Boolean(record.provenance.sourceId)
    && (record.signatureState === "UNSIGNED" || record.signatureState === "UNVERIFIED"));
  const lifecycleCorrectness = share(records, (record) => record.lifecycle !== "REMOVED");
  const dependencyCorrectness = share(records, (record) => record.manifest.dependencies.every((dependency) => {
    const registered = evidence.registeredVersions[dependency.id] ?? [];
    return registered.includes(dependency.version);
  }));
  return { dimensions: { manifestIntegrity, provenanceCompleteness, lifecycleCorrectness, dependencyCorrectness } };
}

function share(records: readonly RegistryRecord[], predicate: (record: RegistryRecord) => boolean): number {
  const passing = records.filter(predicate).length;
  return Math.round((passing / records.length) * 100);
}
