import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { createId, now, type JsonObject } from "../core/types.js";
import { type Permission, type PermissionDecision, type PermissionPolicy } from "./permissions.js";

export type CapabilityActionClass = "READ" | "REVERSIBLE_CHANGE" | "IRREVERSIBLE_ACTION";

export type CapabilityResourceKind =
  | "workspace"
  | "filesystem"
  | "terminal"
  | "network"
  | "secrets"
  | "git"
  | "provider"
  | "memory"
  | "plugin"
  | "browser"
  | "mcp"
  | "external"
  | "email"
  | "unknown";

export interface CapabilityScope {
  readonly kind: CapabilityResourceKind;
  readonly id?: string;
  readonly path?: string;
  readonly command?: string;
  readonly host?: string;
  readonly metadata?: JsonObject;
}

export interface CapabilityGrantScopeRestrictions {
  readonly workspacePaths?: readonly string[];
  readonly commands?: readonly string[];
  readonly resources?: readonly CapabilityScope[];
  readonly hosts?: readonly string[];
  readonly toolIds?: readonly string[];
  readonly actions?: readonly CapabilityActionClass[];
}

export interface CapabilityGrantApprovalMetadata {
  readonly approvedBy: string;
  readonly approvalId?: string;
  readonly reason: string;
  readonly approvedAt: string;
}

export interface CapabilityGrant {
  readonly id: string;
  readonly parentGrantId?: string;
  readonly missionId: string;
  readonly agentId?: string;
  readonly skillId?: string;
  readonly capabilities: readonly string[];
  readonly scope?: CapabilityGrantScopeRestrictions;
  readonly issuedAt: string;
  readonly expiresAt?: string;
  readonly approval: CapabilityGrantApprovalMetadata;
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly revokeReason?: string;
}

export interface CapabilityGrantCreateInput {
  readonly parentGrantId?: string;
  readonly missionId: string;
  readonly agentId?: string;
  readonly skillId?: string;
  readonly capabilities: readonly string[];
  readonly scope?: CapabilityGrantScopeRestrictions;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
  readonly approval: CapabilityGrantApprovalMetadata;
}

export interface CapabilityGrantMatch {
  readonly granted: boolean;
  readonly grant?: CapabilityGrant;
  readonly reason: string;
}

export interface CapabilityGrantRegistry {
  createGrant(input: CapabilityGrantCreateInput): CapabilityGrant;
  deriveGrant(parentGrantId: string, input: CapabilityGrantCreateInput): CapabilityGrant;
  ensureGrant(input: CapabilityGrantCreateInput): CapabilityGrant;
  revokeGrant(id: string, metadata?: { readonly revokedBy?: string; readonly reason?: string }): boolean;
  listGrants(): CapabilityGrant[];
  queryActiveGrants(options: { readonly missionId?: string; readonly agentId?: string; readonly skillId?: string; readonly at?: string }): CapabilityGrant[];
  missionHasCapability(request: CapabilityRequest, at?: string): CapabilityGrantMatch;
}

export interface CapabilityDefinition {
  readonly id: string;
  readonly permission: Permission;
  readonly name: string;
  readonly action: CapabilityActionClass;
  readonly resourceKind: CapabilityResourceKind;
}

export interface CapabilityRequest {
  readonly id: string;
  readonly taskId?: string;
  readonly missionId?: string;
  readonly agentId?: string;
  readonly skillId?: string;
  readonly actor: string;
  readonly capabilityId: string;
  readonly permission?: Permission;
  readonly toolId?: string;
  readonly action: CapabilityActionClass;
  readonly resource: CapabilityScope;
  readonly reason: string;
  readonly context?: JsonObject;
}

export interface CapabilityDecision {
  readonly requestId: string;
  readonly capabilityId: string;
  readonly granted: boolean;
  readonly reason: string;
  readonly policyRef?: string;
  readonly grantId?: string;
  readonly permissionDecision?: PermissionDecision;
}

export interface CapabilityBroker {
  resolve(request: CapabilityRequest): Promise<CapabilityDecision>;
  /** Rechecks current grant authority synchronously after resolve; never grants permission approval. */
  revalidateAuthority?(request: CapabilityRequest): CapabilityDecision;
}

export class PermissionBackedCapabilityBroker implements CapabilityBroker {
  constructor(
    private readonly permissions: PermissionPolicy,
    private readonly grants?: CapabilityGrantRegistry,
  ) {}

  async resolve(request: CapabilityRequest): Promise<CapabilityDecision> {
    const authority = this.revalidateAuthority(request);
    if (!authority.granted) return authority;

    const permissionDecision = await this.permissions.decide({
      id: request.id,
      taskId: request.taskId,
      actor: request.actor,
      permission: request.permission!,
      reason: request.reason,
      context: request.context,
    });
    const currentAuthority = this.revalidateAuthority(request);
    if (permissionDecision.granted && !currentAuthority.granted) return { ...currentAuthority, permissionDecision };
    return {
      requestId: request.id,
      capabilityId: request.capabilityId,
      granted: permissionDecision.granted,
      reason: permissionDecision.reason,
      policyRef: "permission-backed",
      grantId: currentAuthority.grantId,
      permissionDecision,
    };
  }

  revalidateAuthority(request: CapabilityRequest): CapabilityDecision {
    if (!request.permission) {
      return {
        requestId: request.id,
        capabilityId: request.capabilityId,
        granted: false,
        reason: `Capability ${request.capabilityId} is not mapped to a permission.`,
        policyRef: "permission-backed",
      };
    }

    const requestMismatch = validatePermissionBackedRequest(request);
    if (requestMismatch) {
      return {
        requestId: request.id,
        capabilityId: request.capabilityId,
        granted: false,
        reason: requestMismatch,
        policyRef: "capability-contract",
      };
    }

    const grantMatch = this.validateMissionGrant(request);
    if (!grantMatch.granted) {
      return {
        requestId: request.id,
        capabilityId: request.capabilityId,
        granted: false,
        reason: grantMatch.reason,
        policyRef: "mission-grant",
      };
    }

    return {
      requestId: request.id,
      capabilityId: request.capabilityId,
      granted: true,
      reason: grantMatch.reason,
      policyRef: "mission-grant",
      grantId: grantMatch.grant?.id,
    };
  }

  private validateMissionGrant(request: CapabilityRequest): CapabilityGrantMatch {
    if (!request.missionId) return { granted: true, reason: "No mission context supplied; using permission policy only." };
    if (!this.grants) {
      return { granted: false, reason: `Mission ${request.missionId} has no capability grant registry configured.` };
    }
    return this.grants.missionHasCapability(request);
  }
}

export class InMemoryCapabilityGrantRegistry implements CapabilityGrantRegistry {
  protected readonly grants = new Map<string, CapabilityGrant>();

  constructor(grants: readonly CapabilityGrant[] = []) {
    for (const grant of grants) {
      this.grants.set(grant.id, cloneGrant(grant));
    }
  }

  createGrant(input: CapabilityGrantCreateInput): CapabilityGrant {
    validateGrantInput(input);
    if (input.parentGrantId) {
      const parent = this.grants.get(input.parentGrantId);
      if (!parent || !this.lineageActive(parent, now())) throw new Error("Parent capability grant is missing, inactive or expired.");
      if (parent.missionId !== input.missionId) throw new Error("A child grant cannot change mission.");
      if (parent.skillId && parent.skillId !== input.skillId) throw new Error("A child grant cannot widen its skill scope.");
      if (input.capabilities.some((capability) => !parent.capabilities.includes(capability))) throw new Error("Child capabilities exceed parent authority.");
      if (parent.expiresAt && (!input.expiresAt || Date.parse(input.expiresAt) > Date.parse(parent.expiresAt))) throw new Error("Child expiration exceeds parent authority.");
      if (!scopeIsSubset(input.scope, parent.scope)) throw new Error("Child scope exceeds parent authority.");
    }
    const grant: CapabilityGrant = {
      id: createId("grant"),
      parentGrantId: input.parentGrantId,
      missionId: input.missionId,
      agentId: input.agentId,
      skillId: input.skillId,
      capabilities: [...new Set(input.capabilities)],
      scope: cloneScope(input.scope),
      issuedAt: input.issuedAt ?? now(),
      expiresAt: input.expiresAt,
      approval: { ...input.approval },
    };
    this.grants.set(grant.id, grant);
    return cloneGrant(grant);
  }

  deriveGrant(parentGrantId: string, input: CapabilityGrantCreateInput): CapabilityGrant {
    const parent = this.grants.get(parentGrantId);
    if (!parent) throw new Error("Parent capability grant is missing.");
    return this.createGrant({
      ...input,
      parentGrantId,
      skillId: input.skillId ?? parent.skillId,
      scope: input.scope ?? parent.scope,
      expiresAt: input.expiresAt ?? parent.expiresAt,
    });
  }

  ensureGrant(input: CapabilityGrantCreateInput): CapabilityGrant {
    const existing = [...this.grants.values()]
      .find((grant) => !grant.revokedAt && grantsAreEquivalent(grant, input));
    if (existing) return cloneGrant(existing);
    return this.createGrant(input);
  }

  revokeGrant(id: string, metadata: { readonly revokedBy?: string; readonly reason?: string } = {}): boolean {
    const grant = this.grants.get(id);
    if (!grant || grant.revokedAt) return false;
    this.grants.set(id, {
      ...grant,
      revokedAt: now(),
      revokedBy: metadata.revokedBy,
      revokeReason: metadata.reason,
    });
    return true;
  }

  listGrants(): CapabilityGrant[] {
    return [...this.grants.values()].map(cloneGrant);
  }

  queryActiveGrants(options: { readonly missionId?: string; readonly agentId?: string; readonly skillId?: string; readonly at?: string } = {}): CapabilityGrant[] {
    const at = options.at ?? now();
    return [...this.grants.values()]
      .filter((grant) => this.lineageActive(grant, at))
      .filter((grant) => options.missionId ? grant.missionId === options.missionId : true)
      .filter((grant) => options.agentId ? grant.agentId === undefined || grant.agentId === options.agentId : true)
      .filter((grant) => options.skillId ? grant.skillId === undefined || grant.skillId === options.skillId : true)
      .map(cloneGrant);
  }

  missionHasCapability(request: CapabilityRequest, at = now()): CapabilityGrantMatch {
    if (!request.missionId) return { granted: false, reason: "Capability request does not include missionId." };
    const missionGrants = [...this.grants.values()].filter((grant) => grant.missionId === request.missionId);
    if (missionGrants.length === 0) {
      return { granted: false, reason: `Mission ${request.missionId} has no capability grants.` };
    }

    const delegatedAgent = request.agentId && missionGrants.some((grant) => grant.agentId === request.agentId && grant.parentGrantId);
    for (const grant of missionGrants) {
      if (delegatedAgent && grant.agentId !== request.agentId) continue;
      const mismatch = firstGrantMismatch(grant, request, at);
      if (!mismatch && this.lineageAllows(grant, request, at)) {
        return { granted: true, grant: cloneGrant(grant), reason: `Capability ${request.capabilityId} granted by ${grant.id}.` };
      }
    }

    return { granted: false, reason: `No active grant permits ${request.capabilityId} for mission ${request.missionId}.` };
  }

  private lineageActive(grant: CapabilityGrant, at: string, visited = new Set<string>()): boolean {
    if (visited.has(grant.id) || !isActiveGrant(grant, at)) return false;
    visited.add(grant.id);
    if (!grant.parentGrantId) return true;
    const parent = this.grants.get(grant.parentGrantId);
    return Boolean(parent && parent.missionId === grant.missionId && this.lineageActive(parent, at, visited));
  }

  private lineageAllows(grant: CapabilityGrant, request: CapabilityRequest, at: string): boolean {
    if (!this.lineageActive(grant, at)) return false;
    let current = grant;
    while (current.parentGrantId) {
      const parent = this.grants.get(current.parentGrantId)!;
      if (!parent.capabilities.includes(request.capabilityId)
        || (parent.skillId && parent.skillId !== request.skillId)
        || !scopeAllows(parent.scope, request.resource, request)) return false;
      current = parent;
    }
    return true;
  }
}

export class JsonFileCapabilityGrantRegistry extends InMemoryCapabilityGrantRegistry {
  constructor(private readonly filePath: string) {
    super(readPersistedGrants(filePath));
  }

  override createGrant(input: CapabilityGrantCreateInput): CapabilityGrant {
    const grant = super.createGrant(input);
    this.persist();
    return grant;
  }

  override ensureGrant(input: CapabilityGrantCreateInput): CapabilityGrant {
    const before = this.listGrants().length;
    const grant = super.ensureGrant(input);
    if (this.listGrants().length !== before) this.persist();
    return grant;
  }

  override revokeGrant(id: string, metadata: { readonly revokedBy?: string; readonly reason?: string } = {}): boolean {
    const revoked = super.revokeGrant(id, metadata);
    if (revoked) this.persist();
    return revoked;
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    writeFileSync(tmpPath, `${JSON.stringify({ version: 1, grants: this.listGrants() }, null, 2)}\n`, "utf8");
    renameWithTransientRetry(tmpPath, this.filePath);
  }
}

function renameWithTransientRetry(source: string, destination: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * (attempt + 1));
    }
  }
}

export function capabilityIdForPermission(permission: Permission): string {
  return `permission.${permission}`;
}

export function defineCapabilityForPermission(permission: Permission): CapabilityDefinition {
  return {
    id: capabilityIdForPermission(permission),
    permission,
    name: permission,
    action: classifyPermissionAction(permission),
    resourceKind: resourceKindForPermission(permission),
  };
}

export function buildToolCapabilityRequest(options: {
  readonly taskId?: string;
  readonly missionId?: string;
  readonly agentId?: string;
  readonly skillId?: string;
  readonly actor: string;
  readonly toolId: string;
  readonly permission: Permission;
  readonly input: JsonObject;
  readonly reason?: string;
}): CapabilityRequest {
  const definition = defineCapabilityForPermission(options.permission);
  return {
    id: createId("capability"),
    taskId: options.taskId,
    missionId: options.missionId,
    agentId: options.agentId,
    skillId: options.skillId,
    actor: options.actor,
    capabilityId: definition.id,
    permission: options.permission,
    toolId: options.toolId,
    action: definition.action,
    resource: scopeForPermission(options.permission, options.input),
    reason: options.reason ?? `Tool ${options.toolId} requested ${options.permission}.`,
    context: {
      toolId: options.toolId,
      input: options.input,
    },
  };
}

export function classifyPermissionAction(permission: Permission): CapabilityActionClass {
  switch (permission) {
    case "workspace.read":
    case "filesystem.read.external":
    case "git.read":
    case "memory.read":
      return "READ";
    case "workspace.write":
    case "memory.write":
      return "REVERSIBLE_CHANGE";
    case "filesystem.write.external":
    case "terminal.execute":
    case "network.http":
    case "network.websocket":
    case "secrets.read":
    case "secrets.write":
    case "git.write":
    case "provider.invoke":
    case "plugin.install":
    case "browser.control":
    case "mcp.connect":
    case "mcp.execute":
    case "external.write":
    case "email.send":
      return "IRREVERSIBLE_ACTION";
    default:
      return "IRREVERSIBLE_ACTION";
  }
}

export function resourceKindForPermission(permission: Permission): CapabilityResourceKind {
  if (permission.startsWith("workspace.")) return "workspace";
  if (permission.startsWith("filesystem.")) return "filesystem";
  if (permission.startsWith("terminal.")) return "terminal";
  if (permission.startsWith("network.")) return "network";
  if (permission.startsWith("secrets.")) return "secrets";
  if (permission.startsWith("git.")) return "git";
  if (permission.startsWith("provider.")) return "provider";
  if (permission.startsWith("memory.")) return "memory";
  if (permission.startsWith("plugin.")) return "plugin";
  if (permission.startsWith("browser.")) return "browser";
  if (permission.startsWith("mcp.")) return "mcp";
  if (permission.startsWith("external.")) return "external";
  if (permission.startsWith("email.")) return "email";
  return "unknown";
}

export function scopeForPermission(permission: Permission, input: JsonObject = {}): CapabilityScope {
  const path = typeof input["path"] === "string" ? input["path"] : undefined;
  const command = typeof input["command"] === "string" ? input["command"] : undefined;
  const url = typeof input["url"] === "string" ? input["url"] : undefined;
  const host = url !== undefined ? hostFromUrl(url) : typeof input["host"] === "string" ? input["host"] : undefined;
  return {
    kind: resourceKindForPermission(permission),
    ...(path ? { path } : {}),
    ...(command ? { command } : {}),
    ...(host ? { host } : {}),
  };
}

function validatePermissionBackedRequest(request: CapabilityRequest): string | undefined {
  if (!request.permission) return undefined;
  const expectedCapability = capabilityIdForPermission(request.permission);
  if (request.capabilityId !== expectedCapability) {
    return `Capability ${request.capabilityId} does not match required capability ${expectedCapability}.`;
  }

  const expectedAction = classifyPermissionAction(request.permission);
  if (request.action !== expectedAction) {
    return `Capability action ${request.action} does not match required action ${expectedAction}.`;
  }

  const expectedKind = resourceKindForPermission(request.permission);
  if (request.resource.kind !== expectedKind) {
    return `Capability resource kind ${request.resource.kind} does not match required resource kind ${expectedKind}.`;
  }

  return undefined;
}

function firstGrantMismatch(grant: CapabilityGrant, request: CapabilityRequest, at: string): string | undefined {
  if (!isActiveGrant(grant, at)) return "Grant is inactive or expired.";
  if (grant.agentId && grant.agentId !== request.agentId) return "Grant agent scope does not match request.";
  if (grant.skillId && grant.skillId !== request.skillId) return "Grant skill scope does not match request.";
  if (!grant.capabilities.includes(request.capabilityId)) return "Grant does not include requested capability.";
  if (!scopeAllows(grant.scope, request.resource, request)) return "Grant scope does not permit requested resource.";
  return undefined;
}

function isActiveGrant(grant: CapabilityGrant, at: string): boolean {
  if (grant.revokedAt) return false;
  if (!Number.isFinite(Date.parse(grant.issuedAt)) || !Number.isFinite(Date.parse(at))) return false;
  if (Date.parse(grant.issuedAt) > Date.parse(at)) return false;
  return !grant.expiresAt || Date.parse(grant.expiresAt) > Date.parse(at);
}

export function scopeAllows(scope: CapabilityGrantScopeRestrictions | undefined, resource: CapabilityScope, request: CapabilityRequest): boolean {
  if (!scope) return true;
  if (scope.actions && !scope.actions.includes(request.action)) return false;
  if (scope.toolIds && (!request.toolId || !scope.toolIds.includes(request.toolId))) return false;
  if (scope.hosts && (!resource.host || !scope.hosts.some((host) => normalizeHost(host) === normalizeHost(resource.host!)))) return false;
  if (scope.workspacePaths && resource.kind === "workspace") {
    if (!resource.path) return false;
    if (!scope.workspacePaths.some((allowedPath) => pathWithin(resource.path!, allowedPath))) return false;
  }
  if (scope.commands && resource.kind === "terminal") {
    const command = resource.command;
    if (!command) return false;
    if (!scope.commands.includes(command)) return false;
  }
  if (scope.resources) {
    if (!scope.resources.some((allowed) => resourceMatches(allowed, resource))) return false;
  }
  return true;
}

function pathWithin(path: string, allowedPath: string): boolean {
  const normalized = normalizeRelativePath(path);
  const allowed = normalizeRelativePath(allowedPath);
  if (normalized === ".." || normalized.startsWith("../")) return false;
  if (allowed === ".") return !normalized.startsWith("/") && !/^[A-Za-z]:/.test(normalized);
  return normalized === allowed || normalized.startsWith(allowed.endsWith("/") ? allowed : `${allowed}/`);
}

function normalizeRelativePath(path: string): string {
  return posix.normalize(path.replace(/\\/g, "/")).replace(/(.+)\/$/, "$1");
}

function resourceMatches(allowed: CapabilityScope, actual: CapabilityScope): boolean {
  if (allowed.kind !== actual.kind) return false;
  if (allowed.id && allowed.id !== actual.id) return false;
  if (allowed.path && (!actual.path || !pathWithin(actual.path, allowed.path))) return false;
  if (allowed.command && allowed.command !== actual.command) return false;
  if (allowed.host && (!actual.host || normalizeHost(allowed.host) !== normalizeHost(actual.host))) return false;
  return true;
}

function scopeIsSubset(child: CapabilityGrantScopeRestrictions | undefined, parent: CapabilityGrantScopeRestrictions | undefined): boolean {
  if (!parent) return true;
  if (!child) return false;
  const subset = <T>(values: readonly T[] | undefined, ceiling: readonly T[] | undefined, matches: (allowed: T, actual: T) => boolean): boolean =>
    ceiling === undefined || (values !== undefined && values.every((value) => ceiling.some((allowed) => matches(allowed, value))));
  return subset(child.workspacePaths, parent.workspacePaths, (allowed, actual) => pathWithin(actual, allowed))
    && subset(child.commands, parent.commands, (allowed, actual) => allowed === actual)
    && subset(child.resources, parent.resources, resourceMatches)
    && subset(child.hosts, parent.hosts, (allowed, actual) => normalizeHost(allowed) === normalizeHost(actual))
    && subset(child.toolIds, parent.toolIds, (allowed, actual) => allowed === actual)
    && subset(child.actions, parent.actions, (allowed, actual) => allowed === actual);
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

function hostFromUrl(value: string): string | undefined {
  try { return new URL(value).hostname; } catch { return undefined; }
}

function validateGrantInput(input: CapabilityGrantCreateInput): void {
  if (!input.missionId?.trim() || !Array.isArray(input.capabilities) || !input.capabilities.every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error("Capability grant requires a mission and valid capabilities.");
  }
  const issuedAt = Date.parse(input.issuedAt ?? now());
  if (!Number.isFinite(issuedAt) || (input.expiresAt !== undefined && (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= issuedAt))) {
    throw new Error("Capability grant has invalid lifetime.");
  }
  if (!input.approval || typeof input.approval.approvedBy !== "string" || !input.approval.approvedBy.trim()) throw new Error("Capability grant requires approval provenance.");
  if (input.scope) {
    for (const values of [input.scope.workspacePaths, input.scope.commands, input.scope.hosts, input.scope.toolIds, input.scope.actions]) {
      if (values !== undefined && (!Array.isArray(values) || !values.every((value) => typeof value === "string" && value.length > 0))) throw new Error("Capability grant scope must contain string lists.");
    }
    if (input.scope.resources !== undefined && (!Array.isArray(input.scope.resources) || !input.scope.resources.every((resource) =>
      isRecord(resource) && typeof resource.kind === "string" && [resource.path, resource.command, resource.id, resource.host].every((value) => value === undefined || typeof value === "string")))) {
      throw new Error("Capability grant contains invalid resource scopes.");
    }
  }
}

function cloneGrant(grant: CapabilityGrant): CapabilityGrant {
  return {
    ...grant,
    capabilities: [...grant.capabilities],
    scope: cloneScope(grant.scope),
    approval: { ...grant.approval },
  };
}

function cloneScope(scope: CapabilityGrantScopeRestrictions | undefined): CapabilityGrantScopeRestrictions | undefined {
  if (!scope) return undefined;
  return {
    workspacePaths: scope.workspacePaths ? [...scope.workspacePaths] : undefined,
    commands: scope.commands ? [...scope.commands] : undefined,
    resources: scope.resources ? scope.resources.map((resource) => ({ ...resource, metadata: resource.metadata ? { ...resource.metadata } : undefined })) : undefined,
    hosts: scope.hosts ? [...scope.hosts] : undefined,
    toolIds: scope.toolIds ? [...scope.toolIds] : undefined,
    actions: scope.actions ? [...scope.actions] : undefined,
  };
}

function grantsAreEquivalent(grant: CapabilityGrant, input: CapabilityGrantCreateInput): boolean {
  return grant.missionId === input.missionId
    && grant.parentGrantId === input.parentGrantId
    && grant.agentId === input.agentId
    && grant.skillId === input.skillId
    && grant.expiresAt === input.expiresAt
    && sameStringSet(grant.capabilities, input.capabilities)
    && canonicalScope(grant.scope) === canonicalScope(input.scope);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const l = [...new Set(left)].sort();
  const r = [...new Set(right)].sort();
  return l.length === r.length && l.every((value, index) => value === r[index]);
}

function canonicalScope(scope: CapabilityGrantScopeRestrictions | undefined): string {
  if (!scope) return "";
  return JSON.stringify({
    workspacePaths: scope.workspacePaths ? [...scope.workspacePaths].sort() : undefined,
    commands: scope.commands ? [...scope.commands].sort() : undefined,
    resources: scope.resources ? scope.resources.map(canonicalResource).sort((a, b) => a.localeCompare(b)) : undefined,
    hosts: scope.hosts ? [...scope.hosts].sort() : undefined,
    toolIds: scope.toolIds ? [...scope.toolIds].sort() : undefined,
    actions: scope.actions ? [...scope.actions].sort() : undefined,
  });
}

function canonicalResource(resource: CapabilityScope): string {
  return JSON.stringify({
    kind: resource.kind,
    id: resource.id,
    path: resource.path,
    command: resource.command,
    host: resource.host,
    metadata: resource.metadata,
  });
}

function readPersistedGrants(filePath: string): CapabilityGrant[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isGrantSnapshot(raw)) return [];
    return raw.grants.map(cloneGrant);
  } catch {
    return [];
  }
}

function isGrantSnapshot(value: unknown): value is { readonly grants: readonly CapabilityGrant[] } {
  if (!isRecord(value)) return false;
  const grants = value["grants"];
  return Array.isArray(grants) && grants.every(isCapabilityGrant);
}

function isCapabilityGrant(value: unknown): value is CapabilityGrant {
  if (!isRecord(value)) return false;
  try { validateGrantInput(value as unknown as CapabilityGrantCreateInput); } catch { return false; }
  return typeof value["id"] === "string"
    && (value["parentGrantId"] === undefined || typeof value["parentGrantId"] === "string")
    && typeof value["missionId"] === "string"
    && Array.isArray(value["capabilities"])
    && value["capabilities"].every((capability) => typeof capability === "string")
    && typeof value["issuedAt"] === "string"
    && isRecord(value["approval"])
    && typeof value["approval"]["approvedBy"] === "string"
    && typeof value["approval"]["reason"] === "string"
    && typeof value["approval"]["approvedAt"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
