import { isMissingFile, atomicWriteFile } from "../core/utils.js";
import { createId, now, type IsoTimestamp, type JsonObject } from "../core/types.js";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export type MemoryScope = "session" | "task" | "agent" | "workspace" | "project" | "global";

export interface MemoryRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly content: string;
  readonly metadata: JsonObject;
  readonly createdAt: IsoTimestamp;
}

export interface MemoryBindingIdentity {
  readonly providerId: string;
  readonly providerVersion: string;
  readonly namespace: string;
}

export interface MemoryOperationContext {
  readonly missionId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly sessionId: string;
  readonly actor: string;
  readonly agentId?: string;
  readonly skillId?: string;
  readonly namespace?: string;
  readonly operationId?: string;
  readonly signal?: AbortSignal;
  readonly deadline?: IsoTimestamp;
}

export interface MemoryStore {
  readonly binding?: MemoryBindingIdentity;
  write(record: Omit<MemoryRecord, "id" | "createdAt">, context?: MemoryOperationContext): Promise<MemoryRecord>;
  search(query: { readonly scope?: MemoryScope; readonly text?: string; readonly limit?: number }, context?: MemoryOperationContext): Promise<MemoryRecord[]>;
  /**
   * Deterministically bound and de-duplicate stored memory without losing
   * protected knowledge. Optional: callers that cannot honor host compaction
   * semantics (for example a remote provider) leave it unimplemented.
   */
  compact?(options?: MemoryCompactOptions): Promise<MemoryCompactResult>;
}

export interface MemoryCompactOptions {
  /** Per-scope retention bound. Records beyond this (by timestamp) are eligible for removal. */
  readonly maxItemsPerScope?: number;
  /** Drop records older than this ISO timestamp. */
  readonly olderThan?: IsoTimestamp;
  /** When true, records carrying an explicit protection marker are never removed. Default true. */
  readonly protect?: boolean;
}

export interface MemoryCompactResult {
  readonly removed: number;
  readonly kept: number;
}

/**
 * True when a record carries a host protection marker and must never be
 * removed by compaction: validated knowledge, or an explicit `protected` /
 * `protect` metadata flag.
 */
export function isProtectedMemoryRecord(record: MemoryRecord): boolean {
  return record.metadata["memoryClass"] === "validated-knowledge"
    || record.metadata["protected"] === true
    || record.metadata["protect"] === true;
}

export class MemoryBindingError extends Error {
  readonly category = "provider" as const;
  readonly recoverable = false;

  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MemoryBindingError";
  }
}

export class InMemoryMemoryStore implements MemoryStore {
  private readonly records: MemoryRecord[] = [];

  async write(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord> {
    const stored: MemoryRecord = {
      ...record,
      id: createId("memory"),
      createdAt: now(),
    };
    this.records.push(stored);
    return stored;
  }

  async search(query: { readonly scope?: MemoryScope; readonly text?: string; readonly limit?: number }): Promise<MemoryRecord[]> {
    const normalized = query.text?.toLowerCase();
    const matches = this.records.filter((record) => {
      const scopeMatches = query.scope ? record.scope === query.scope : true;
      const textMatches = normalized ? record.content.toLowerCase().includes(normalized) : true;
      return scopeMatches && textMatches;
    });

    return matches.slice(0, query.limit ?? 20);
  }

  async compact(options: MemoryCompactOptions = {}): Promise<MemoryCompactResult> {
    const result = compactRecords(this.records, options);
    if (result.removed > 0) {
      this.records.length = 0;
      this.records.push(...result.records);
    }
    return { removed: result.removed, kept: result.records.length };
  }
}

/**
 * Durable memory store that persists records as a JSON file on disk.
 * Uses atomic write semantics: reads on init, appends in memory, flushes on write.
 */
export class JsonFileMemoryStore implements MemoryStore {
  private loaded = false;
  private readonly records: MemoryRecord[] = [];

  constructor(private readonly filePath: string) {}

  async write(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord> {
    await this.ensureLoaded();
    const stored: MemoryRecord = {
      ...record,
      id: createId("memory"),
      createdAt: now(),
    };
    this.records.push(stored);
    await this.flush();
    return stored;
  }

  async search(query: { readonly scope?: MemoryScope; readonly text?: string; readonly limit?: number }): Promise<MemoryRecord[]> {
    await this.ensureLoaded();
    const normalized = query.text?.toLowerCase();
    const matches = this.records.filter((record) => {
      const scopeMatches = query.scope ? record.scope === query.scope : true;
      const textMatches = normalized ? record.content.toLowerCase().includes(normalized) : true;
      return scopeMatches && textMatches;
    });

    return matches.slice(0, query.limit ?? 20);
  }

  async compact(options: MemoryCompactOptions = {}): Promise<MemoryCompactResult> {
    await this.ensureLoaded();
    const result = compactRecords(this.records, options);
    if (result.removed > 0) {
      this.records.length = 0;
      this.records.push(...result.records);
      await this.flush();
    }
    return { removed: result.removed, kept: result.records.length };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { readonly records?: readonly MemoryRecord[] };
      for (const record of parsed.records ?? []) {
        this.records.push(record);
      }
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
  }

  private isWriting = false;
  private pendingResolvers: Array<() => void> = [];
  private pendingRejecters: Array<(err: any) => void> = [];

  private flush(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingResolvers.push(resolve);
      this.pendingRejecters.push(reject);
      if (!this.isWriting) {
        this.processFlushQueue();
      }
    });
  }

  private async processFlushQueue(): Promise<void> {
    this.isWriting = true;
    while (this.pendingResolvers.length > 0) {
      const resolvers = this.pendingResolvers;
      const rejecters = this.pendingRejecters;
      this.pendingResolvers = [];
      this.pendingRejecters = [];

      try {
        await mkdir(dirname(this.filePath), { recursive: true });
        const data = JSON.stringify({ records: this.records }, null, 2);
        await atomicWriteFile(this.filePath, data);
        resolvers.forEach((r) => r());
      } catch (err) {
        rejecters.forEach((r) => r(err));
      }
    }
    this.isWriting = false;
  }
}

function compactRecords(records: readonly MemoryRecord[], options: MemoryCompactOptions): { readonly records: MemoryRecord[]; readonly removed: number } {
  const protect = options.protect !== false;
  const olderThan = options.olderThan ? Date.parse(options.olderThan) : undefined;
  const byScope = new Map<MemoryScope, MemoryRecord[]>();
  for (const record of records) {
    const protectedRecord = protect && isProtectedMemoryRecord(record);
    if (olderThan !== undefined && Date.parse(record.createdAt) < olderThan && !protectedRecord) continue;
    const bucket = byScope.get(record.scope);
    if (bucket) bucket.push(record); else byScope.set(record.scope, [record]);
  }

  const survivors: MemoryRecord[] = [];
  for (const [scope, scopeRecords] of byScope) {
    const protectedRecords = new Map<string, MemoryRecord>();
    const deduped = new Map<string, MemoryRecord>();
    const ordered = [...scopeRecords].sort((a, b) => {
      const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt);
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
    });
    for (const record of ordered) {
      if (protect && isProtectedMemoryRecord(record)) {
        if (!protectedRecords.has(record.id)) protectedRecords.set(record.id, record);
        continue;
      }
      const dedupeKey = `${scope}:${record.content}`;
      const seen = deduped.get(dedupeKey);
      if (!seen || Date.parse(record.createdAt) >= Date.parse(seen.createdAt)) {
        deduped.set(dedupeKey, record);
      }
    }
    let ordinary = [...deduped.values()];
    if (options.maxItemsPerScope !== undefined) {
      ordinary = ordinary.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, options.maxItemsPerScope);
    }
    survivors.push(...protectedRecords.values(), ...ordinary);
  }

  return { records: survivors, removed: records.length - survivors.length };
}

export * from "./os.js";
