import { createId, now, type JsonObject } from "../core/types.js";
import { type JournalEntry, type JournalEntryType, type JournalStore } from "./types.js";
import { isMissingFile, atomicWriteFile } from "../core/utils.js";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export class InMemoryJournalStore implements JournalStore {
  private entries: JournalEntry[] = [];

  async append(entry: JournalEntry): Promise<void> {
    this.entries.push(entry);
  }

  async query(options: {
    workflowId?: string;
    sessionId?: string;
    type?: JournalEntryType;
    limit?: number;
    offset?: number;
  }): Promise<JournalEntry[]> {
    let results = [...this.entries];
    if (options.workflowId) results = results.filter((e) => e.workflowId === options.workflowId);
    if (options.sessionId) results = results.filter((e) => e.sessionId === options.sessionId);
    if (options.type) results = results.filter((e) => e.type === options.type);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  async replay(workflowId: string): Promise<JournalEntry[]> {
    return this.entries
      .filter((e) => e.workflowId === workflowId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async stats(workflowId: string): Promise<{ total: number; byType: Record<string, number>; duration: number; errorCount: number }> {
    const relevant = this.entries.filter((e) => e.workflowId === workflowId);
    const byType: Record<string, number> = {};
    let errorCount = 0;
    let firstTime: string | undefined;
    let lastTime: string | undefined;

    for (const entry of relevant) {
      byType[entry.type] = (byType[entry.type] ?? 0) + 1;
      if (entry.error) errorCount++;
      if (!firstTime || entry.timestamp < firstTime) firstTime = entry.timestamp;
      if (!lastTime || entry.timestamp > lastTime) lastTime = entry.timestamp;
    }

    const duration = firstTime && lastTime ? Date.parse(lastTime) - Date.parse(firstTime) : 0;
    return { total: relevant.length, byType, duration, errorCount };
  }

  async clear(): Promise<void> {
    this.entries = [];
  }

  getAll(): readonly JournalEntry[] {
    return this.entries;
  }
}

export class JsonFileJournalStore implements JournalStore {
  private loaded = false;
  private entries: JournalEntry[] = [];

  constructor(private readonly filePath: string) {}

  async append(entry: JournalEntry): Promise<void> {
    await this.ensureLoaded();
    this.entries.push(entry);
    await this.flush();
  }

  async query(options: {
    workflowId?: string;
    sessionId?: string;
    type?: JournalEntryType;
    limit?: number;
    offset?: number;
  }): Promise<JournalEntry[]> {
    await this.ensureLoaded();
    let results = [...this.entries];
    if (options.workflowId) results = results.filter((e) => e.workflowId === options.workflowId);
    if (options.sessionId) results = results.filter((e) => e.sessionId === options.sessionId);
    if (options.type) results = results.filter((e) => e.type === options.type);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  async replay(workflowId: string): Promise<JournalEntry[]> {
    await this.ensureLoaded();
    return this.entries
      .filter((e) => e.workflowId === workflowId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async stats(workflowId: string): Promise<{ total: number; byType: Record<string, number>; duration: number; errorCount: number }> {
    await this.ensureLoaded();
    const relevant = this.entries.filter((e) => e.workflowId === workflowId);
    const byType: Record<string, number> = {};
    let errorCount = 0;
    let firstTime: string | undefined;
    let lastTime: string | undefined;

    for (const entry of relevant) {
      byType[entry.type] = (byType[entry.type] ?? 0) + 1;
      if (entry.error) errorCount++;
      if (!firstTime || entry.timestamp < firstTime) firstTime = entry.timestamp;
      if (!lastTime || entry.timestamp > lastTime) lastTime = entry.timestamp;
    }

    const duration = firstTime && lastTime ? Date.parse(lastTime) - Date.parse(firstTime) : 0;
    return { total: relevant.length, byType, duration, errorCount };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { readonly entries?: readonly JournalEntry[] };
      this.entries = [...(parsed.entries ?? [])];
    } catch (e) {
      if (!isMissingFile(e)) throw e;
    }
  }

  private async flush(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const data = { entries: this.entries };
    await atomicWriteFile(this.filePath, JSON.stringify(data, null, 2));
  }
}

export class JournalWriter {
  constructor(
    private readonly store: JournalStore,
    private readonly workflowId: string,
    private readonly sessionId: string,
  ) {}

  async write(
    type: JournalEntryType,
    data: JsonObject,
    nodeId?: string,
    durationMs?: number,
    error?: string,
  ): Promise<JournalEntry> {
    const entry: JournalEntry = {
      id: createId("journal"),
      workflowId: this.workflowId,
      sessionId: this.sessionId,
      type,
      timestamp: now(),
      nodeId,
      data,
      durationMs,
      error,
    };
    await this.store.append(entry);
    return entry;
  }
}
