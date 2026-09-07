import { resolve } from "node:path";
import type { Permission } from "../security/permissions.js";
import type { ApprovalCallback } from "../security/approval-controller.js";
import type { CapabilityGrantCreateInput } from "../security/capability-broker.js";
import type { ExtensionDefinition } from "../extensions/types.js";

/** Neutral runtime configuration. Domain catalogs and ambient credentials are never discovered. */
export interface QuackConfig {
  readonly workspaceRoot: string;
  readonly dataDir?: string;
  readonly permissions: readonly Permission[];
  readonly missionId?: string;
  readonly capabilityGrants?: readonly CapabilityGrantCreateInput[];
  readonly approver?: ApprovalCallback;
  readonly extensions: readonly ExtensionDefinition[];
  readonly plannerId?: string;
  readonly validationProviderId?: string;
  readonly memoryProviderId?: string;
  readonly memoryProviderTimeoutMs: number;
  readonly memoryProviderMaxItems: number;
  readonly memoryProviderMaxBytes: number;
  readonly memoryNamespace: string;
  readonly contextProviderIds: readonly string[];
  readonly contextNamespaces: readonly string[];
  /** Maximum governed delegation depth. 0 (default) disables delegation. */
  readonly delegationMaxDepth: number;
  /**
   * Grant id used as the parent grant for delegated children. Required when
   * `delegationMaxDepth > 0`; children derive attenuated grants from it.
   */
  readonly delegationParentGrantId?: string;
}

export function createDefaultConfig(options: Partial<QuackConfig> = {}): QuackConfig {
  return {
    workspaceRoot: resolve(options.workspaceRoot ?? process.cwd()),
    dataDir: options.dataDir === undefined ? undefined : resolve(options.dataDir),
    permissions: [...(options.permissions ?? [])],
    missionId: options.missionId,
    capabilityGrants: options.capabilityGrants,
    approver: options.approver,
    extensions: [...(options.extensions ?? [])],
    plannerId: options.plannerId,
    validationProviderId: options.validationProviderId,
    memoryProviderId: options.memoryProviderId,
    memoryProviderTimeoutMs: positiveInteger(options.memoryProviderTimeoutMs ?? 5000, "Memory provider timeout"),
    memoryProviderMaxItems: positiveInteger(options.memoryProviderMaxItems ?? 5, "Memory provider item limit"),
    memoryProviderMaxBytes: positiveInteger(options.memoryProviderMaxBytes ?? 32 * 1024, "Memory provider byte limit"),
    memoryNamespace: nonempty(options.memoryNamespace ?? "memory.mission", "Memory namespace"),
    contextProviderIds: [...(options.contextProviderIds ?? [])],
    contextNamespaces: [...(options.contextNamespaces ?? [])],
    delegationMaxDepth: nonNegativeInteger(options.delegationMaxDepth ?? 0, "Delegation depth"),
    delegationParentGrantId: options.delegationParentGrantId,
  };
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nonempty(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must be nonempty.`);
  return value;
}
