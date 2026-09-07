import { now } from "../core/types.js";
import type { RuntimeProfile, ProfileType, AiCapability, RuntimeType, SecurityLevel } from "./types.js";

export class ProfileManager {
  private profiles: Map<string, RuntimeProfile> = new Map();
  private defaultProfileId = "general";

  register(profile: RuntimeProfile): void {
    this.profiles.set(profile.id, profile);
    if (profile.isDefault) this.defaultProfileId = profile.id;
  }

  unregister(id: string): boolean {
    return this.profiles.delete(id);
  }

  get(id: string): RuntimeProfile | undefined {
    return this.profiles.get(id);
  }

  getAll(): RuntimeProfile[] {
    return Array.from(this.profiles.values());
  }

  getByType(type: ProfileType): RuntimeProfile[] {
    return this.getAll().filter((p) => p.type === type);
  }

  getDefault(): RuntimeProfile {
    return this.profiles.get(this.defaultProfileId) ?? this.getAll()[0]!;
  }

  setDefault(id: string): boolean {
    if (!this.profiles.has(id)) return false;
    for (const p of this.profiles.values()) p.isDefault = false;
    this.profiles.get(id)!.isDefault = true;
    this.defaultProfileId = id;
    return true;
  }

  getPreferredCapabilities(profileId: string): { capability: AiCapability; minScore: number }[] {
    const profile = this.profiles.get(profileId);
    return profile?.preferredCapabilities ?? [];
  }

  getFallbackCapabilities(profileId: string): AiCapability[] {
    return this.profiles.get(profileId)?.fallbackCapabilities ?? [];
  }

  getPreferredRuntimes(profileId: string): RuntimeType[] {
    return this.profiles.get(profileId)?.preferredRuntimes ?? [];
  }

  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const p of this.getAll()) {
      byType[p.type] = (byType[p.type] ?? 0) + 1;
    }
    return { total: this.profiles.size, byType };
  }

  createDefaults(): void {
    const profiles: RuntimeProfile[] = [
      { id: "general", name: "General Purpose", type: "general", description: "Balanced profile for everyday tasks",
        preferredCapabilities: [{ capability: "reasoning", minScore: 50 }], fallbackCapabilities: ["chat"],
        preferredRuntimes: ["ollama", "openai-compatible"], executionPolicy: { maxRetries: 2, timeoutMs: 30000, streamingAllowed: true, parallelAllowed: false, fallbackAllowed: true, requireVerification: false, requireHumanApproval: false },
        costLimits: { maxPerRequest: 0.01, maxPerSession: 0.1, maxPerDay: 1, currency: "USD" },
        latencyTargets: { p50Ms: 500, p95Ms: 2000, p99Ms: 5000 }, securityRequirements: "basic", isDefault: true,
        createdAt: now(), updatedAt: now() },
      { id: "coding", name: "Software Engineering", type: "coding", description: "Optimized for code generation and analysis",
        preferredCapabilities: [{ capability: "coding", minScore: 70 }, { capability: "reasoning", minScore: 60 }, { capability: "tool-calling", minScore: 50 }],
        fallbackCapabilities: ["chat", "json-generation"],
        preferredRuntimes: ["ollama", "openai-compatible"], executionPolicy: { maxRetries: 3, timeoutMs: 60000, streamingAllowed: true, parallelAllowed: true, fallbackAllowed: true, requireVerification: true, requireHumanApproval: false },
        costLimits: { maxPerRequest: 0.05, maxPerSession: 0.5, maxPerDay: 5, currency: "USD" },
        latencyTargets: { p50Ms: 300, p95Ms: 1500, p99Ms: 4000 }, securityRequirements: "basic", isDefault: false,
        createdAt: now(), updatedAt: now() },
      { id: "research", name: "Deep Research", type: "research", description: "Extended reasoning for research tasks",
        preferredCapabilities: [{ capability: "reasoning", minScore: 80 }, { capability: "scientific", minScore: 70 }, { capability: "long-context", minScore: 60 }],
        fallbackCapabilities: ["coding", "mathematics"],
        preferredRuntimes: ["openai-compatible", "vllm"], executionPolicy: { maxRetries: 3, timeoutMs: 120000, streamingAllowed: true, parallelAllowed: false, fallbackAllowed: true, requireVerification: false, requireHumanApproval: false },
        costLimits: { maxPerRequest: 0.1, maxPerSession: 1, maxPerDay: 10, currency: "USD" },
        latencyTargets: { p50Ms: 1000, p95Ms: 5000, p99Ms: 10000 }, securityRequirements: "basic", isDefault: false,
        createdAt: now(), updatedAt: now() },
      { id: "offline", name: "Offline Mode", type: "offline", description: "Works without internet, local models only",
        preferredCapabilities: [{ capability: "chat", minScore: 50 }], fallbackCapabilities: ["reasoning", "coding"],
        preferredRuntimes: ["ollama", "llamacpp"], executionPolicy: { maxRetries: 2, timeoutMs: 60000, streamingAllowed: true, parallelAllowed: false, fallbackAllowed: false, requireVerification: false, requireHumanApproval: false },
        costLimits: { maxPerRequest: 0, maxPerSession: 0, maxPerDay: 0, currency: "USD" },
        latencyTargets: { p50Ms: 1000, p95Ms: 5000, p99Ms: 10000 }, securityRequirements: "elevated", isDefault: false,
        createdAt: now(), updatedAt: now() },
    ];
    for (const p of profiles) this.register(p);
  }
}
