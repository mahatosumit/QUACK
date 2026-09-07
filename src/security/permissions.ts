import { type JsonObject } from "../core/types.js";

export type Permission =
  | "workspace.read"
  | "workspace.write"
  | "filesystem.read.external"
  | "filesystem.write.external"
  | "terminal.execute"
  | "network.http"
  | "network.websocket"
  | "secrets.read"
  | "secrets.write"
  | "git.read"
  | "git.write"
  | "provider.invoke"
  | "memory.read"
  | "memory.write"
  | "plugin.install"
  | "browser.control"
  | "mcp.connect"
  | "mcp.execute"
  | "external.write"
  | "email.send"
  | `secrets.read:${string}`
  | `${string}.${string}`;

const EXACT_PERMISSIONS: ReadonlySet<string> = new Set([
  "workspace.read", "workspace.write", "filesystem.read.external", "filesystem.write.external",
  "terminal.execute", "network.http", "network.websocket", "secrets.read", "secrets.write",
  "git.read", "git.write", "provider.invoke", "memory.read", "memory.write", "plugin.install",
  "browser.control", "mcp.connect", "mcp.execute", "external.write", "email.send",
]);

export function isPermission(value: string): value is Permission {
  return EXACT_PERMISSIONS.has(value) || /^secrets\.read:[A-Za-z0-9._-]+$/.test(value)
    || /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(value);
}

export interface PermissionRequest {
  readonly id: string;
  readonly taskId?: string;
  readonly actor: string;
  readonly permission: Permission;
  readonly reason: string;
  readonly context?: JsonObject;
}

export interface PermissionDecision {
  readonly granted: boolean;
  readonly reason: string;
}

export interface PermissionPolicy {
  decide(request: PermissionRequest): Promise<PermissionDecision>;
}

export class DenyByDefaultPermissionPolicy implements PermissionPolicy {
  async decide(request: PermissionRequest): Promise<PermissionDecision> {
    return {
      granted: false,
      reason: `Permission ${request.permission} is denied by default.`,
    };
  }
}

export class AllowListPermissionPolicy implements PermissionPolicy {
  private readonly allowed: ReadonlySet<Permission>;

  constructor(permissions: readonly Permission[]) {
    this.allowed = new Set(permissions);
  }

  async decide(request: PermissionRequest): Promise<PermissionDecision> {
    if (this.allowed.has(request.permission)) {
      return {
        granted: true,
        reason: `Permission ${request.permission} is allowed by policy.`,
      };
    }

    return {
      granted: false,
      reason: `Permission ${request.permission} is not in the allow list.`,
    };
  }
}

