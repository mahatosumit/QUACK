/**
 * Provider validation service (Phase 7A). Thin, read-only diagnostics over
 * the registered ProviderAdapters. The CLI consumes this; it never touches
 * credentials — presence comes from the SecretProvider allowlist, values are
 * never read here, and every outgoing message is secret-redacted.
 */
import { redactSecrets } from "../security/secret-provider.js";
import type { ProviderAdapter, ProviderRegistry } from "./provider.js";
import type { ProviderHealthRecord, ProviderHealthStore } from "./health.js";

export interface ProviderValidationEntry {
  readonly providerId: string;
  readonly credentialEnv: readonly string[];
  readonly configured: boolean;
}

export interface ProviderValidationReport {
  readonly providerId: string;
  readonly healthy: boolean;
  readonly message: string;
  /** Credential env var names that are declared but NOT set. */
  readonly missingCredentials: readonly string[];
  readonly checkedAt: string;
  readonly history?: readonly ProviderHealthRecord[];
}

export interface ProviderValidationDeps {
  readonly registry: ProviderRegistry;
  readonly healthStore?: ProviderHealthStore;
  /** providerId -> credential env var names (from bridge config). */
  readonly credentialEnvFor?: (providerId: string) => readonly string[];
  readonly now?: () => string;
}

export class ProviderValidationService {
  constructor(private readonly deps: ProviderValidationDeps) {}

  /** Static listing: what is registered and which credentials it declares. */
  list(): readonly ProviderValidationEntry[] {
    return this.deps.registry.list().map(providerId => {
      const credentialEnv = this.deps.credentialEnvFor?.(providerId) ?? [];
      return {
        providerId,
        credentialEnv,
        configured: credentialEnv.length === 0 || credentialEnv.some(name => Boolean(process.env[name])),
      };
    });
  }

  /** Single live health check with a persisted, redacted record. */
  async test(providerId: string): Promise<ProviderValidationReport> {
    const entry = this.deps.registry.get(providerId);
    if (!entry.ok) {
      return {
        providerId,
        healthy: false,
        message: redactSecrets(entry.error.message),
        missingCredentials: [],
        checkedAt: this.now(),
      };
    }
    const credentialEnv = this.deps.credentialEnvFor?.(providerId) ?? [];
    const missingCredentials = credentialEnv.filter(name => !process.env[name]);
    try {
      const health = await entry.data.healthCheck();
      const message = redactSecrets(health.message);
      const record: ProviderHealthRecord = {
        providerId, checkedAt: this.now(), healthy: health.healthy, message, source: "live",
      };
      this.deps.healthStore?.append(record);
      return { providerId, healthy: health.healthy, message, missingCredentials, checkedAt: record.checkedAt };
    } catch (error) {
      // healthCheck should not throw, but adapters are third-party — fail closed.
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      const record: ProviderHealthRecord = {
        providerId, checkedAt: this.now(), healthy: false, message, source: "live",
      };
      this.deps.healthStore?.append(record);
      return { providerId, healthy: false, message, missingCredentials, checkedAt: record.checkedAt };
    }
  }

  /** Health check every registered provider. */
  async doctor(): Promise<readonly ProviderValidationReport[]> {
    const reports: ProviderValidationReport[] = [];
    for (const entry of this.list()) {
      reports.push(await this.test(entry.providerId));
    }
    return reports;
  }

  /** Last persisted record per provider (no network calls). */
  cached(): readonly ProviderHealthRecord[] {
    return this.deps.healthStore?.latest() ?? [];
  }

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }
}

/** Convenience for tests and callers building a service from a registry. */
export function credentialEnvMapFrom(adapters: readonly ProviderAdapter[], envFor: (id: string) => readonly string[]): Map<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const adapter of adapters) map.set(adapter.id, envFor(adapter.id));
  return map;
}
