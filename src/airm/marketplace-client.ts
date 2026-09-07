import { now } from "../core/types.js";
import type { MarketplacePackage, MarketplacePackageType, HardwareRequirements, ModelLicense } from "./types.js";

export class MarketplaceClient {
  private packages: Map<string, MarketplacePackage> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  register(pkg: MarketplacePackage): void {
    this.packages.set(pkg.id, pkg);
  }

  get(id: string): MarketplacePackage | undefined {
    return this.packages.get(id);
  }

  search(query: string, type?: MarketplacePackageType): MarketplacePackage[] {
    const q = query.toLowerCase();
    return Array.from(this.packages.values()).filter((p) => {
      if (type && p.type !== type) return false;
      return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q));
    });
  }

  getByType(type: MarketplacePackageType): MarketplacePackage[] {
    return Array.from(this.packages.values()).filter((p) => p.type === type);
  }

  getTopRated(limit = 10): MarketplacePackage[] {
    return Array.from(this.packages.values()).sort((a, b) => b.ratings - a.ratings).slice(0, limit);
  }

  getMostDownloaded(limit = 10): MarketplacePackage[] {
    return Array.from(this.packages.values()).sort((a, b) => b.downloads - a.downloads).slice(0, limit);
  }

  createDefaultPackages(): void {
    // No verified package catalog is bundled.
  }

  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const p of this.packages.values()) {
      byType[p.type] = (byType[p.type] ?? 0) + 1;
    }
    return { total: this.packages.size, byType };
  }
}
