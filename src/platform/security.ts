import { now } from "../core/types.js";
import type { SecretVaultEntry, SecretVaultMetadata, SandboxPolicy } from "./types.js";

/** Ephemeral plaintext storage for trusted host code; metadata APIs never return values. */
export class SecretVault {
  private secrets: Map<string, SecretVaultEntry> = new Map();
  private accessLog: { secretId: string; accessedAt: number; action: string }[] = [];
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.secrets.clear();
    this.accessLog = [];
  }

  store(id: string, key: string, value: string, scope: "local" | "node" | "cluster" = "local", encrypted = false, ttlMs?: number): SecretVaultMetadata {
    if (encrypted) throw new Error("Encrypted secret storage is unavailable in the in-memory vault.");
    const entry: SecretVaultEntry = {
      id, key, value, scope, encrypted,
      createdAt: now(), accessCount: 0,
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : undefined,
    };
    this.secrets.set(id, entry);
    return secretMetadata(entry);
  }

  retrieve(id: string): string | null {
    const entry = this.secrets.get(id);
    if (!entry) return null;
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) return null;
    entry.accessCount++;
    entry.lastAccessed = now();
    this.accessLog.push({ secretId: id, accessedAt: Date.now(), action: "read" });
    return entry.value;
  }

  delete(id: string): boolean {
    return this.secrets.delete(id);
  }

  getEntry(id: string): SecretVaultMetadata | undefined {
    const entry = this.secrets.get(id);
    return entry ? secretMetadata(entry) : undefined;
  }

  listSecrets(scope?: "local" | "node" | "cluster"): SecretVaultMetadata[] {
    const entries = Array.from(this.secrets.values());
    return (scope ? entries.filter((e) => e.scope === scope) : entries).map(secretMetadata);
  }

  clearExpired(): number {
    const nowMs = Date.now();
    let count = 0;
    for (const [id, entry] of this.secrets) {
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= nowMs) {
        this.secrets.delete(id);
        count++;
      }
    }
    return count;
  }

  revokeByScope(scope: "local" | "node" | "cluster"): number {
    let count = 0;
    for (const [id, entry] of this.secrets) {
      if (entry.scope === scope) {
        this.secrets.delete(id);
        count++;
      }
    }
    return count;
  }

  getAccessLog(limit = 100): { secretId: string; accessedAt: number; action: string }[] {
    return this.accessLog.slice(-limit);
  }

  getStats(): { total: number; active: number; expired: number; totalAccesses: number } {
    const all = Array.from(this.secrets.values());
    const nowMs = Date.now();
    return {
      total: all.length,
      active: all.filter((e) => !e.expiresAt || new Date(e.expiresAt).getTime() > nowMs).length,
      expired: all.filter((e) => e.expiresAt && new Date(e.expiresAt).getTime() <= nowMs).length,
      totalAccesses: this.accessLog.length,
    };
  }
}

function secretMetadata(entry: SecretVaultEntry): SecretVaultMetadata {
  const { value: _value, ...metadata } = entry;
  return metadata;
}

export class Sandbox {
  private policies: Map<string, SandboxPolicy> = new Map();

  createPolicy(id: string, options?: Partial<SandboxPolicy>): SandboxPolicy {
    const policy: SandboxPolicy = {
      enabled: true,
      allowNetwork: false,
      allowFileSystem: false,
      allowProcessSpawn: false,
      allowHardwareAccess: false,
      allowElevation: false,
      resourceLimits: {
        maxMemoryMB: 512,
        maxCpuPercent: 50,
        maxDiskMB: 1024,
        maxNetworkKbps: 1024,
      },
      allowedPaths: [],
      deniedPaths: [],
      allowedDomains: [],
      allowedExecutables: [],
      auditEnabled: true,
      ...options,
    };
    this.policies.set(id, policy);
    return policy;
  }

  getPolicy(id: string): SandboxPolicy | undefined {
    return this.policies.get(id);
  }

  deletePolicy(id: string): boolean {
    return this.policies.delete(id);
  }

  async executeInSandbox<T>(policyId: string, fn: () => Promise<T>): Promise<T> {
    const policy = this.policies.get(policyId);
    if (!policy || !policy.enabled) throw new Error(`Sandbox policy "${policyId}" not found or disabled`);
    throw new Error("Sandbox execution is unavailable: declarative policies do not provide process isolation.");
  }

  checkPathAllowed(policyId: string, filePath: string): boolean {
    const policy = this.policies.get(policyId);
    if (!policy || !policy.enabled) return false;
    if (!policy.allowFileSystem) return false;
    if (policy.deniedPaths?.some((p) => filePath.startsWith(p))) return false;
    if (policy.allowedPaths && policy.allowedPaths.length > 0) {
      return policy.allowedPaths.some((p) => filePath.startsWith(p));
    }
    return true;
  }

  checkDomainAllowed(policyId: string, domain: string): boolean {
    const policy = this.policies.get(policyId);
    if (!policy || !policy.enabled) return false;
    if (!policy.allowNetwork) return false;
    if (policy.allowedDomains && policy.allowedDomains.length > 0) {
      return policy.allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`) || d === "*");
    }
    return true;
  }

  checkExecutableAllowed(policyId: string, executable: string): boolean {
    const policy = this.policies.get(policyId);
    if (!policy || !policy.enabled) return false;
    if (!policy.allowProcessSpawn) return false;
    if (policy.allowedExecutables && policy.allowedExecutables.length > 0) {
      return policy.allowedExecutables.some((e) => executable.endsWith(e));
    }
    return true;
  }

  getAllPolicies(): SandboxPolicy[] {
    return Array.from(this.policies.values());
  }

  getEnabledPolicies(): SandboxPolicy[] {
    return this.getAllPolicies().filter((p) => p.enabled);
  }
}
