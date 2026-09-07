import type { AiProviderInfo, ProviderStatus, HealthStatus, AiCapability } from "./types.js";

export class ProviderRegistry {
  private providers: Map<string, AiProviderInfo> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  register(provider: AiProviderInfo): void {
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  get(id: string): AiProviderInfo | undefined {
    return this.providers.get(id);
  }

  getAll(): AiProviderInfo[] {
    return Array.from(this.providers.values());
  }

  getActive(): AiProviderInfo[] {
    return this.getAll().filter((p) => p.status === "active");
  }

  getByType(type: string): AiProviderInfo[] {
    return this.getAll().filter((p) => p.type === type);
  }

  findByCapability(capability: AiCapability): AiProviderInfo[] {
    return this.getAll().filter((p) => p.capabilities.includes(capability));
  }

  updateStatus(id: string, status: ProviderStatus): boolean {
    const p = this.providers.get(id);
    if (!p) return false;
    p.status = status;
    return true;
  }

  updateHealth(id: string, health: HealthStatus): boolean {
    const p = this.providers.get(id);
    if (!p) return false;
    p.health = health;
    return true;
  }

  getStats(): { total: number; active: number; errored: number } {
    const all = this.getAll();
    return { total: all.length, active: all.filter((p) => p.status === "active").length, errored: all.filter((p) => p.status === "error").length };
  }
}
