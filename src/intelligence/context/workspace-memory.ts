import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { type Language } from "../types.js";
import { type JsonObject } from "../../core/types.js";
import { type WorkspaceMetadata } from "../types.js";

export interface WorkspaceCacheEntry {
  readonly key: string;
  readonly data: JsonObject;
  readonly timestamp: string;
  readonly ttlMs: number;
}

/**
 * WorkspaceMemory persists indexed data, cache entries, and workspace
 * metadata so that it survives restarts. Designed for incremental operation.
 */
export class WorkspaceMemory {
  private readonly basePath: string;
  private cache: Map<string, WorkspaceCacheEntry> = new Map();

  constructor(basePath: string) {
    this.basePath = resolve(basePath);
    mkdirSync(this.basePath, { recursive: true });
    this.loadCache();
  }

  // ------------------------------------------------------------------
  // Generic key-value cache
  // ------------------------------------------------------------------

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - new Date(entry.timestamp).getTime() > entry.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  async set<T>(key: string, data: T, ttlMs = 300_000): Promise<void> {
    this.cache.set(key, {
      key,
      data: data as unknown as JsonObject,
      timestamp: new Date().toISOString(),
      ttlMs,
    });
    this.saveCache();
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    this.saveCache();
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.saveCache();
  }

  // ------------------------------------------------------------------
  // Persistent workspace data
  // ------------------------------------------------------------------

  async saveWorkspaceMetadata(metadata: WorkspaceMetadata): Promise<void> {
    const filePath = resolve(this.basePath, "workspace.json");
    writeFileSync(filePath, JSON.stringify(metadata, null, 2), "utf-8");
  }

  async loadWorkspaceMetadata(): Promise<WorkspaceMetadata | undefined> {
    const filePath = resolve(this.basePath, "workspace.json");
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as WorkspaceMetadata;
    } catch {
      return undefined;
    }
  }

  // ------------------------------------------------------------------
  // Symbol cache
  // ------------------------------------------------------------------

  async saveSymbolIndex(fileSymbolMap: Record<string, number>): Promise<void> {
    const filePath = resolve(this.basePath, "symbol-index.json");
    writeFileSync(filePath, JSON.stringify(fileSymbolMap, null, 2), "utf-8");
  }

  async loadSymbolIndex(): Promise<Record<string, number> | undefined> {
    const filePath = resolve(this.basePath, "symbol-index.json");
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, number>;
    } catch {
      return undefined;
    }
  }

  // ------------------------------------------------------------------
  // Error history
  // ------------------------------------------------------------------

  private errorHistory: Array<{ task: string; error: string; timestamp: string }> = [];

  recordError(taskId: string, error: string): void {
    this.errorHistory.push({ task: taskId, error, timestamp: new Date().toISOString() });
    if (this.errorHistory.length > 100) this.errorHistory.shift();
    const filePath = resolve(this.basePath, "errors.json");
    writeFileSync(filePath, JSON.stringify(this.errorHistory, null, 2), "utf-8");
  }

  getErrorHistory(): ReadonlyArray<{ task: string; error: string; timestamp: string }> {
    return this.errorHistory;
  }

  // ------------------------------------------------------------------
  // Task history
  // ------------------------------------------------------------------

  private taskHistory: Array<{ goal: string; result: string; timestamp: string }> = [];

  recordTask(goal: string, result: string): void {
    this.taskHistory.push({ goal, result, timestamp: new Date().toISOString() });
    if (this.taskHistory.length > 200) this.taskHistory.shift();
    const filePath = resolve(this.basePath, "tasks.json");
    writeFileSync(filePath, JSON.stringify(this.taskHistory, null, 2), "utf-8");
  }

  getTaskHistory(): ReadonlyArray<{ goal: string; result: string; timestamp: string }> {
    return this.taskHistory;
  }

  // ------------------------------------------------------------------
  // Index state (for incremental indexing)
  // ------------------------------------------------------------------

  async saveIndexState(state: { lastIndexed: string; fileCount: number; totalLines: number }): Promise<void> {
    const filePath = resolve(this.basePath, "index-state.json");
    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
  }

  async loadIndexState(): Promise<{ lastIndexed: string; fileCount: number; totalLines: number } | undefined> {
    const filePath = resolve(this.basePath, "index-state.json");
    try {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return undefined;
    }
  }

  // ------------------------------------------------------------------
  // Private
  // ------------------------------------------------------------------

  private loadCache(): void {
    const filePath = resolve(this.basePath, "cache.json");
    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8")) as WorkspaceCacheEntry[];
      for (const entry of data) {
        this.cache.set(entry.key, entry);
      }
    } catch { /* no cache yet */ }
  }

  private saveCache(): void {
    const filePath = resolve(this.basePath, "cache.json");
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify([...this.cache.values()], null, 2), "utf-8");
  }
}
