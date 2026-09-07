import { now } from "../core/types.js";
import type { CacheConfig } from "./types.js";

export interface CachedModel {
  modelId: string;
  loaded: boolean;
  memoryMB: number;
  lastUsed: string;
  loadCount: number;
}

export class ModelCache {
  private cache: Map<string, CachedModel> = new Map();
  private config: CacheConfig;

  constructor(config?: Partial<CacheConfig>) {
    this.config = {
      maxEntries: config?.maxEntries ?? 50,
      defaultTTLMs: config?.defaultTTLMs ?? 30 * 60 * 1000,
      evictionPolicy: config?.evictionPolicy ?? "lru",
      maxSizeMB: config?.maxSizeMB ?? 32768,
    };
  }

  markLoaded(modelId: string, memoryMB: number): void {
    this.cache.set(modelId, { modelId, loaded: true, memoryMB, lastUsed: now(), loadCount: (this.cache.get(modelId)?.loadCount ?? 0) + 1 });
  }

  markUnloaded(modelId: string): void {
    const entry = this.cache.get(modelId);
    if (entry) entry.loaded = false;
  }

  isLoaded(modelId: string): boolean {
    return this.cache.get(modelId)?.loaded ?? false;
  }

  get(modelId: string): CachedModel | undefined {
    const entry = this.cache.get(modelId);
    if (entry) entry.lastUsed = now();
    return entry;
  }

  getAll(): CachedModel[] {
    return Array.from(this.cache.values());
  }

  getLoadedModels(): CachedModel[] {
    return this.getAll().filter((m) => m.loaded);
  }

  getTotalMemoryMB(): number {
    return this.getLoadedModels().reduce((sum, m) => sum + m.memoryMB, 0);
  }

  evict(modelId: string): boolean {
    return this.cache.delete(modelId);
  }

  evictLRU(count = 1): string[] {
    const sorted = Array.from(this.cache.values()).filter((m) => m.loaded).sort((a, b) => new Date(a.lastUsed).getTime() - new Date(b.lastUsed).getTime());
    const evicted: string[] = [];
    for (let i = 0; i < Math.min(count, sorted.length); i++) {
      this.cache.delete(sorted[i]!.modelId);
      evicted.push(sorted[i]!.modelId);
    }
    return evicted;
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { total: number; loaded: number; totalMemoryMB: number; maxEntries: number } {
    return {
      total: this.cache.size,
      loaded: this.getLoadedModels().length,
      totalMemoryMB: this.getTotalMemoryMB(),
      maxEntries: this.config.maxEntries,
    };
  }
}
