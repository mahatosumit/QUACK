import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fail, ok, type QuackResult } from "../core/types.js";
import { atomicWriteFile, isMissingFile } from "../core/utils.js";
import { isPermission } from "../security/permissions.js";
import { manifestDigest, packageDigest, verifyPackageIntegrity } from "./integrity.js";
import { parseExtensionManifest, type ExtensionManifestV2 } from "./manifest.js";
import { validateLifecycleTransition, type ExtensionLifecycleState } from "./lifecycle.js";

/**
 * P10.4 extension registry — deterministic, metadata-first local catalog
 * (ADR 0044). NOT a remote marketplace: P10 is the foundation; there is no
 * network fetch, no remote index, no execution of package content here.
 *
 * Records are metadata + the canonical manifest. Package content lives in
 * the caller's package store; the registry stores digests, never bytes.
 * Ordering is deterministic (id, then version). Duplicate (id,version)
 * fails closed. Lifecycle transitions validate through the P10.10 table.
 */

export interface RegistryRecord {
  readonly id: string;
  readonly version: string;
  readonly manifest: ExtensionManifestV2;
  readonly manifestDigest: string;
  readonly packageDigest: string;
  readonly lifecycle: ExtensionLifecycleState;
  readonly provenance: { readonly kind: string; readonly sourceId: string };
  readonly signatureState: "UNSIGNED" | "UNVERIFIED";
  readonly installedAt: string;
}

interface RegistryFile {
  readonly version: 1;
  readonly records: readonly unknown[];
}

export type RegistryErrorCode =
  | "extension.registry_duplicate"
  | "extension.registry_not_found"
  | "extension.lifecycle_invalid_transition"
  | "extension.registry_manifest_mismatch"
  | "extension.registry_persist_failed";

/** Deterministic record ordering: id, then version. */
export function orderRecords(records: readonly RegistryRecord[]): readonly RegistryRecord[] {
  return [...records].sort((a, b) => a.id === b.id
    ? (a.version < b.version ? -1 : a.version > b.version ? 1 : 0)
    : a.id < b.id ? -1 : 1);
}

/** Fail-closed per-record parse on load: tampered records are excluded, never coerced. */
export function parseRegistryRecord(value: unknown): QuackResult<RegistryRecord> {
  if (typeof value !== "object" || value === null) {
    return fail({ code: "extension.registry_persist_failed", message: "Registry record must be an object.", category: "runtime", recoverable: false });
  }
  const raw = value as Record<string, unknown>;
  const manifest = parseExtensionManifest(raw.manifest);
  if (!manifest.ok) return manifest as QuackResult<RegistryRecord>;
  const m = manifest.data.manifest;
  if (raw.id !== m.id || raw.version !== m.version) {
    return fail({ code: "extension.registry_manifest_mismatch", message: "Registry record identity differs from its manifest.", category: "runtime", recoverable: false });
  }
  if (typeof raw.manifestDigest !== "string" || manifestDigest(m) !== raw.manifestDigest) {
    return fail({ code: "extension.registry_manifest_mismatch", message: "Manifest digest mismatch — record excluded.", category: "runtime", recoverable: false });
  }
  if (typeof raw.packageDigest !== "string" || !/^[0-9a-f]{64}$/.test(raw.packageDigest)) {
    return fail({ code: "extension.registry_manifest_mismatch", message: "Invalid package digest — record excluded.", category: "runtime", recoverable: false });
  }
  // Envelope/manifest correspondence: the stored package digest must equal
  // the digest the manifest itself declares. Tampering either side alone
  // breaks correspondence and the record is excluded fail-closed.
  if (raw.packageDigest !== m.integrity.digest) {
    return fail({ code: "extension.registry_manifest_mismatch", message: "Package digest differs from the manifest integrity declaration — record excluded.", category: "runtime", recoverable: false });
  }
  if (typeof raw.installedAt !== "string" || !raw.installedAt) {
    return fail({ code: "extension.registry_manifest_mismatch", message: "Invalid install timestamp — record excluded.", category: "runtime", recoverable: false });
  }
  const provenance = raw.provenance;
  if (typeof provenance !== "object" || provenance === null || typeof (provenance as Record<string, unknown>).kind !== "string" || typeof (provenance as Record<string, unknown>).sourceId !== "string") {
    return fail({ code: "extension.registry_manifest_mismatch", message: "Invalid provenance — record excluded.", category: "runtime", recoverable: false });
  }
  const sig = raw.signatureState;
  if (sig !== "UNSIGNED" && sig !== "UNVERIFIED") {
    return fail({ code: "extension.registry_manifest_mismatch", message: "Invalid signature state — record excluded.", category: "runtime", recoverable: false });
  }
  const lifecycle = raw.lifecycle;
  if (typeof lifecycle !== "string" || !(["DISCOVERED", "VALIDATED", "ADMITTED", "INSTALLED", "ENABLED", "DISABLED", "QUARANTINED", "REMOVED"] as readonly string[]).includes(lifecycle)) {
    return fail({ code: "extension.registry_manifest_mismatch", message: "Invalid lifecycle state — record excluded.", category: "runtime", recoverable: false });
  }
  return ok({
    id: m.id,
    version: m.version,
    manifest: m,
    manifestDigest: manifestDigest(m),
    packageDigest: raw.packageDigest,
    lifecycle: lifecycle as ExtensionLifecycleState,
    provenance: { kind: (provenance as Record<string, unknown>).kind as string, sourceId: (provenance as Record<string, unknown>).sourceId as string },
    signatureState: sig,
    installedAt: raw.installedAt,
  });
}

export class ExtensionRegistryCatalog {
  private records = new Map<string, RegistryRecord>();
  private loaded = false;
  private readonly excludedOnLoad: { count: number } = { count: 0 };

  constructor(private readonly filePath: string) {}

  /** Explicit load; tampered records are excluded fail-closed. */
  async load(): Promise<{ loadedCount: number; excludedCount: number }> {
    if (this.loaded) return { loadedCount: this.records.size, excludedCount: this.excludedOnLoad.count };
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      for (const value of parsed.records ?? []) {
        const record = parseRegistryRecord(value);
        if (record.ok && !this.records.has(`${record.data.id}@${record.data.version}`)) {
          this.records.set(`${record.data.id}@${record.data.version}`, record.data);
        } else if (!record.ok) {
          this.excludedOnLoad.count += 1;
        }
      }
    } catch (error) {
      if (isMissingFile(error)) return { loadedCount: 0, excludedCount: 0 };
      throw error;
    }
    return { loadedCount: this.records.size, excludedCount: this.excludedOnLoad.count };
  }

  async list(): Promise<readonly RegistryRecord[]> {
    await this.load();
    return orderRecords([...this.records.values()].filter((record) => record.lifecycle !== "REMOVED"));
  }

  async get(id: string, version: string): Promise<RegistryRecord | undefined> {
    await this.load();
    return this.records.get(`${id}@${version}`);
  }

  async resolve(id: string): Promise<readonly RegistryRecord[]> {
    await this.load();
    return orderRecords([...this.records.values()].filter((record) => record.id === id && record.lifecycle !== "REMOVED"));
  }

  /** Register one record; duplicate (id,version) fails closed. */
  async register(record: RegistryRecord): Promise<QuackResult<{ record: RegistryRecord }>> {
    await this.load();
    const key = `${record.id}@${record.version}`;
    if (this.records.has(key)) {
      return fail({ code: "extension.registry_duplicate", message: `Extension ${key} is already registered.`, category: "validation", recoverable: false });
    }
    this.records.set(key, record);
    await this.persist();
    return ok({ record });
  }

  /** Explicit lifecycle transition; invalid transitions fail closed. */
  async transition(id: string, version: string, to: ExtensionLifecycleState): Promise<QuackResult<{ record: RegistryRecord }>> {
    await this.load();
    const key = `${id}@${version}`;
    const record = this.records.get(key);
    if (!record || record.lifecycle === "REMOVED") {
      return fail({ code: "extension.registry_not_found", message: `Extension ${key} is not registered.`, category: "validation", recoverable: false });
    }
    const transition = validateLifecycleTransition(record.lifecycle, to);
    if (!transition.ok) {
      return fail({ code: transition.code, message: transition.message, category: "validation", recoverable: false });
    }
    if (to === "REMOVED") {
      this.records.delete(key);
    } else {
      this.records.set(key, { ...record, lifecycle: to });
    }
    await this.persist();
    return ok({ record: to === "REMOVED" ? record : this.records.get(key)! });
  }

  /** Hard remove used only for install rollback (records written in this call). */
  async remove(id: string, version: string): Promise<QuackResult<{ removed: boolean }>> {
    await this.load();
    const key = `${id}@${version}`;
    const existed = this.records.delete(key);
    if (existed) await this.persist();
    return ok({ removed: existed });
  }

  /** Ensure persisted bytes carry the declared integrity (re-verify on write). */
  async verifyRecordIntegrity(record: RegistryRecord, content: string): Promise<QuackResult<{ state: "MATCHED" }>> {
    return verifyPackageIntegrity({ algorithm: "sha256", digest: record.packageDigest }, content);
  }

  private async persist(): Promise<void> {
    const file: RegistryFile = { version: 1, records: orderRecords([...this.records.values()]) };
    await atomicWriteFile(this.filePath, JSON.stringify(file, null, 2));
  }
}

/** Convenience: registry catalog under a data directory. */
export function ecosystemRegistryPath(dataDir: string): string {
  return join(dataDir, "ecosystem", "registry.json");
}

/** Deterministic package digest helper re-export for callers. */
export { packageDigest };
