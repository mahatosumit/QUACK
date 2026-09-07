import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createId, now, type IsoTimestamp, type JsonObject } from "../core/types.js";
import { isMissingFile } from "../core/utils.js";
import { type MemoryStore, type MemoryScope, type MemoryRecord } from "./memory.js";

/** Extended memory scopes per quackos.md §5: adds `identity` and `decision`. */
export type ExtendedMemoryScope = MemoryScope | "identity" | "decision";

export interface IdentityRecord {
  readonly id: string;
  scope: "identity";
  content: string;
  metadata: JsonObject;
  readonly createdAt: IsoTimestamp;
}

export interface DecisionRecord {
  readonly id: string;
  scope: "decision";
  content: string;
  metadata: {
    chosen: string;
    reason: string;
    impact: string;
    date: IsoTimestamp;
  };
  readonly createdAt: IsoTimestamp;
}

/**
 * IdentityMemoryStore — an additive store for user identity, long-term goals,
 * preferences, working style, communication style, and technical preferences.
 *
 * Per quackos.md Rule 4: memory remains user-controlled (view/edit/delete/export).
 * This layer is a separate store so it never modifies the existing MemoryStore.
 */
export class IdentityMemoryStore {
  private records: IdentityRecord[] = [];
  private loaded = false;
  private readonly filePath?: string;

  constructor(dataDir?: string) {
    this.filePath = dataDir ? join(dataDir, "identity-memory.json") : undefined;
  }

  async write(content: string, metadata: JsonObject): Promise<IdentityRecord> {
    await this.ensureLoaded();
    const record: IdentityRecord = {
      id: createId("identity"),
      scope: "identity",
      content,
      metadata: { ...metadata },
      createdAt: now(),
    };
    this.records.push(record);
    await this.flush();
    return record;
  }

  async search(text?: string, limit?: number): Promise<IdentityRecord[]> {
    await this.ensureLoaded();
    const norm = text?.toLowerCase();
    return this.records
      .filter((r) => (norm ? r.content.toLowerCase().includes(norm) || JSON.stringify(r.metadata).toLowerCase().includes(norm) : true))
      .slice(0, limit ?? 20);
  }

  getAll(): readonly IdentityRecord[] {
    return this.records;
  }

  /** User control: delete a record by id. Returns whether a record was removed. */
  async delete(id: string): Promise<boolean> {
    const idx = this.records.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    this.records.splice(idx, 1);
    await this.flush();
    return true;
  }

  /** User control: export all records as a plain object. */
  export(): { records: readonly IdentityRecord[] } {
    return { records: this.records };
  }

  async clear(): Promise<void> {
    this.records = [];
    await this.flush();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.filePath) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { readonly records?: readonly IdentityRecord[] };
      for (const r of parsed.records ?? []) this.records.push(r);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  private async flush(): Promise<void> {
    if (!this.filePath) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ records: this.records }, null, 2), "utf8");
  }
}

/** Helper: persist an identity-scoped record into an existing MemoryStore too. */
export async function persistIdentityToStore(
  store: MemoryStore,
  content: string,
  metadata: JsonObject,
): Promise<MemoryRecord> {
  return store.write({ scope: "global", content, metadata });
}
