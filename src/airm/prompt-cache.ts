import { now, type IsoTimestamp } from "../core/types.js";
import type { CacheEntry, CacheConfig } from "./types.js";

export class PromptCache {
  private cache: Map<string, CacheEntry> = new Map();
  private config: CacheConfig;

  constructor(config?: Partial<CacheConfig>) {
    this.config = {
      maxEntries: config?.maxEntries ?? 1000,
      maxSizeMB: config?.maxSizeMB ?? 100,
      defaultTTLMs: config?.defaultTTLMs ?? 5 * 60 * 1000,
      evictionPolicy: config?.evictionPolicy ?? "lru",
    };
  }

  get<T = unknown>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    entry.hits++;
    entry.lastAccessed = now();
    this.updateLRU(key);
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs?: number, metadata?: Record<string, unknown>): void {
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.config.maxEntries) this.evict();
    const entry: CacheEntry = {
      key, value, hits: 0,
      createdAt: now(), expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : this.config.defaultTTLMs ? new Date(Date.now() + this.config.defaultTTLMs).toISOString() : undefined,
      lastAccessed: now(), metadata: metadata ?? {},
    };
    this.cache.set(key, entry);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (entry.expiresAt && now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  getStats(): { size: number; maxEntries: number; hits: number; evictionPolicy: string } {
    let totalHits = 0;
    for (const entry of this.cache.values()) totalHits += entry.hits;
    return { size: this.cache.size, maxEntries: this.config.maxEntries, hits: totalHits, evictionPolicy: this.config.evictionPolicy };
  }

  private lruOrder: string[] = [];

  private updateLRU(key: string): void {
    this.lruOrder = this.lruOrder.filter((k) => k !== key);
    this.lruOrder.push(key);
  }

  private evict(): void {
    if (this.cache.size === 0) return;
    if (this.config.evictionPolicy === "lru") {
      const oldest = this.lruOrder[0];
      if (oldest) {
        this.cache.delete(oldest);
        this.lruOrder.shift();
      }
    } else if (this.config.evictionPolicy === "lfu") {
      let minHits = Infinity;
      let minKey: string | undefined;
      for (const [key, entry] of this.cache) {
        if (entry.hits < minHits) { minHits = entry.hits; minKey = key; }
      }
      if (minKey) this.cache.delete(minKey);
    } else if (this.config.evictionPolicy === "fifo") {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    } else if (this.config.evictionPolicy === "ttl") {
      for (const [key, entry] of this.cache) {
        if (entry.expiresAt && now() > entry.expiresAt) this.cache.delete(key);
      }
    }
  }
}
