/**
 * Provider health records (Phase 7A): persistent, auditable health history
 * for every registered provider. Records store outcomes and diagnostics —
 * never credentials, never auth headers, never response bodies.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ProviderHealthRecord {
  readonly providerId: string;
  /** ISO timestamp of the check. */
  readonly checkedAt: string;
  readonly healthy: boolean;
  /** Provider's own health message, secret-redacted by the caller. */
  readonly message: string;
  /** Where the record came from: live check or restored history. */
  readonly source: "live" | "restored";
}

export interface ProviderHealthStore {
  /** Append a record and retain at most `maxPerProvider` per provider. */
  append(record: ProviderHealthRecord): void;
  /** Most recent record per provider. */
  latest(): readonly ProviderHealthRecord[];
  /** Full retained history, oldest first. */
  history(providerId?: string): readonly ProviderHealthRecord[];
}

/** In-memory health history (tests, ephemeral runs). */
export class InMemoryProviderHealthStore implements ProviderHealthStore {
  private readonly records: ProviderHealthRecord[] = [];
  constructor(private readonly maxPerProvider = 20) {}

  append(record: ProviderHealthRecord): void {
    this.records.push(record);
    const forProvider = this.records.filter(entry => entry.providerId === record.providerId);
    if (forProvider.length > this.maxPerProvider) {
      const cutoff = forProvider[forProvider.length - this.maxPerProvider];
      const index = this.records.indexOf(cutoff);
      this.records.splice(0, index + 1);
    }
  }

  latest(): readonly ProviderHealthRecord[] {
    const seen = new Map<string, ProviderHealthRecord>();
    for (const record of this.records) seen.set(record.providerId, record);
    return [...seen.values()];
  }

  history(providerId?: string): readonly ProviderHealthRecord[] {
    return this.records.filter(record => !providerId || record.providerId === providerId);
  }
}

/** Atomic JSON-file health history (production default). */
export class JsonFileProviderHealthStore implements ProviderHealthStore {
  private readonly records: ProviderHealthRecord[] = [];
  private readonly maxPerProvider: number;

  constructor(private readonly path: string, maxPerProvider = 20) {
    this.maxPerProvider = maxPerProvider;
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as { records?: ProviderHealthRecord[] };
        if (Array.isArray(parsed.records)) this.records.push(...parsed.records);
      } catch {
        // Corrupt history is discarded, never fatal.
      }
    }
  }

  append(record: ProviderHealthRecord): void {
    this.records.push(record);
    const forProvider = this.records.filter(entry => entry.providerId === record.providerId);
    if (forProvider.length > this.maxPerProvider) {
      const cutoff = forProvider[forProvider.length - this.maxPerProvider];
      const index = this.records.indexOf(cutoff);
      this.records.splice(0, index + 1);
    }
    this.persist();
  }

  latest(): readonly ProviderHealthRecord[] {
    const seen = new Map<string, ProviderHealthRecord>();
    for (const record of this.records) seen.set(record.providerId, record);
    return [...seen.values()];
  }

  history(providerId?: string): readonly ProviderHealthRecord[] {
    return this.records.filter(record => !providerId || record.providerId === providerId);
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, records: this.records }, null, 2));
    try {
      renameSync(tmp, this.path);
    } catch {
      // Windows rename can race a concurrent reader; the tmp file will be
      // superseded by the next append. History is diagnostic, not durable
      // state — losing an append is acceptable.
      try { writeFileSync(this.path, JSON.stringify({ version: 1, records: this.records }, null, 2)); } catch { /* ignore */ }
    }
  }
}
