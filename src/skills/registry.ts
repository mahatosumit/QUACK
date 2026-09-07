import {
  type SkillDefinition,
  type SkillExecutionPlan,
  type SkillLifecycleEvent,
  type SkillLoadSource,
  type SkillManifest,
  type SkillRecord,
  type SkillStatus,
} from "./types.js";
import {
  portableSkillDefinition,
  type PersistedSkillDefinition,
  type PersistedSkillVersion,
  type SkillRegistryLoadIssue,
  type SkillRegistrySnapshot,
  type SkillRegistryStore,
  SKILL_REGISTRY_SCHEMA_VERSION,
  skillDefinitionFingerprint,
} from "./persistence.js";

export interface SkillVersionRegistrationOptions {
  readonly parentVersion?: string;
  readonly supersedesVersion?: string;
  readonly evidenceRefs?: readonly string[];
  readonly replacementSkillId?: string;
  readonly replacementVersion?: string;
  readonly setDefault?: boolean;
  readonly portableInstructions?: string;
  readonly portableExecution?: SkillDefinition["portableExecution"];
  readonly compilationProvenance?: SkillDefinition["compilationProvenance"];
  readonly sourceRef?: string;
}

export interface SkillRegistryOptions {
  readonly store?: SkillRegistryStore;
}

export interface SkillRegistryReconciliationResult {
  readonly loadedVersions: readonly string[];
  readonly issues: readonly SkillRegistryLoadIssue[];
}

interface MutableSkillRecord {
  id: string;
  versionKey: string;
  manifest: SkillManifest;
  definition: SkillDefinition;
  portableDefinition?: PersistedSkillDefinition;
  fingerprint: string;
  status: SkillStatus;
  source: SkillLoadSource;
  loadedAt: string;
  lastUsed?: string;
  useCount: number;
  avgDurationMs: number;
  supersededBy?: string;
  supersededByVersion?: string;
  parentVersion?: string;
}

interface LogicalSkillEntry {
  defaultVersion?: string;
  versions: Map<string, MutableSkillRecord>;
}

export class SkillRegistry {
  private skills = new Map<string, LogicalSkillEntry>();
  private lifecycleHistory: SkillLifecycleEvent[] = [];
  private store?: SkillRegistryStore;

  constructor(options: SkillRegistryOptions = {}) {
    this.store = options.store;
  }

  attachStore(store: SkillRegistryStore, options: { readonly persistCurrent?: boolean } = {}): void {
    this.store = store;
    if (options.persistCurrent) this.persist();
  }

  persist(): void {
    this.store?.save(this.snapshot());
  }

  register(
    definition: SkillDefinition,
    source: SkillLoadSource = "builtin",
    status: SkillStatus = "active",
    options: SkillVersionRegistrationOptions = {},
  ): void {
    this.commitMutation(() => this.registerMutable(definition, source, status, options));
  }

  loadSnapshot(snapshot: SkillRegistrySnapshot): SkillRegistryReconciliationResult {
    const issues: SkillRegistryLoadIssue[] = [];
    const loadedVersions: string[] = [];

    this.withPersistenceSuspended(() => {
      for (const logical of snapshot.logicalSkills) {
        for (const persisted of logical.versions) {
          const result = this.reconcileVersion(persisted);
          issues.push(...result.issues);
          if (result.loaded) loadedVersions.push(versionKey(persisted.skillId, persisted.version));
        }
      }

      for (const logical of snapshot.logicalSkills) {
        const entry = this.skills.get(logical.skillId);
        if (!entry || !logical.defaultVersion) continue;
        const defaultRecord = entry.versions.get(logical.defaultVersion);
        if (!defaultRecord) {
          issues.push(issue("invalid_schema", `Default version ${logical.skillId}@${logical.defaultVersion} is missing.`));
          continue;
        }
        if (defaultRecord.status !== "active") {
          issues.push(issue("invalid_schema", `Default version ${logical.skillId}@${logical.defaultVersion} is not active.`));
          continue;
        }
        entry.defaultVersion = logical.defaultVersion;
      }

      const validHistory = snapshot.lifecycleHistory.filter(isLifecycleEvent);
      if (validHistory.length !== snapshot.lifecycleHistory.length) {
        issues.push(issue("invalid_schema", "Ignored malformed skill lifecycle history entries."));
      }
      this.lifecycleHistory = validHistory.map((event) => ({ ...event, evidenceRefs: [...event.evidenceRefs] }));
    });

    return { loadedVersions, issues };
  }

  snapshot(): SkillRegistrySnapshot {
    return {
      schemaVersion: SKILL_REGISTRY_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      logicalSkills: [...this.skills.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([skillId, entry]) => ({
          skillId,
          defaultVersion: entry.defaultVersion,
          versions: [...entry.versions.values()].sort(compareVersionsAscending).map((record) => this.toPersistedVersion(record)),
        })),
      lifecycleHistory: this.getLifecycleHistory(),
    };
  }

  private registerMutable(
    definition: SkillDefinition,
    source: SkillLoadSource,
    status: SkillStatus,
    options: SkillVersionRegistrationOptions,
    persisted?: Pick<PersistedSkillVersion, "loadedAt" | "lastUsed" | "useCount" | "avgDurationMs" | "fingerprint" | "definition">,
  ): void {
    const skillId = definition.manifest.id;
    const version = definition.manifest.version;
    const entry = this.skills.get(skillId) ?? { versions: new Map<string, MutableSkillRecord>() };

    if (entry.versions.has(version)) {
      throw new Error(`Skill '${skillId}' version '${version}' is already registered.`);
    }
    if (options.setDefault && status !== "active") {
      throw new Error(`Skill '${skillId}' version '${version}' must be active before it can become the default version.`);
    }

    if (options.parentVersion) {
      if (options.parentVersion === version) {
        throw new Error(`Skill '${skillId}' version '${version}' cannot parent itself.`);
      }
      const parent = entry.versions.get(options.parentVersion);
      if (!parent) {
        throw new Error(`Skill '${skillId}' parent version '${options.parentVersion}' is not registered.`);
      }
      assertNoLineageCycle(entry, version, options.parentVersion);
    } else if (entry.versions.size > 0 && (source === "generated" || source === "imported" || source === "plugin")) {
      throw new Error(`Skill '${skillId}' already exists; new generated/imported/plugin versions require an explicit parent version.`);
    }

    const portableDefinition = portableDefinitionFor(source, definition, options, persisted?.definition);
    const record: MutableSkillRecord = {
      id: skillId,
      versionKey: versionKey(skillId, version),
      manifest: cloneManifest(definition.manifest),
      definition: cloneDefinition(definition),
      portableDefinition,
      fingerprint: persisted?.fingerprint ?? skillDefinitionFingerprint(definition, portableDefinition),
      status,
      source,
      loadedAt: persisted?.loadedAt ?? new Date().toISOString(),
      lastUsed: persisted?.lastUsed,
      useCount: persisted?.useCount ?? 0,
      avgDurationMs: persisted?.avgDurationMs ?? 0,
      parentVersion: options.parentVersion,
      supersededBy: options.replacementSkillId,
      supersededByVersion: options.replacementVersion,
    };

    if (options.supersedesVersion) {
      const superseded = entry.versions.get(options.supersedesVersion);
      if (!superseded) {
        throw new Error(`Skill '${skillId}' superseded version '${options.supersedesVersion}' is not registered.`);
      }
      superseded.supersededByVersion = version;
    }

    entry.versions.set(version, record);
    if (options.setDefault || (!entry.defaultVersion && status === "active")) {
      entry.defaultVersion = version;
    }
    this.skills.set(skillId, entry);
  }

  get(id: string, version?: string): SkillDefinition | undefined {
    const record = this.resolveRecord(id, version);
    return record ? cloneDefinition(record.definition) : undefined;
  }

  getRecord(id: string, version?: string): SkillRecord | undefined {
    const record = this.resolveRecord(id, version);
    return record ? this.toRecord(record) : undefined;
  }

  getLatestRecord(id: string): SkillRecord | undefined {
    const entry = this.skills.get(id);
    if (!entry) return undefined;
    const latest = [...entry.versions.values()].sort(compareVersionsDescending)[0];
    return latest ? this.toRecord(latest) : undefined;
  }

  getVersions(id: string): SkillRecord[] {
    const entry = this.skills.get(id);
    if (!entry) return [];
    return [...entry.versions.values()].sort(compareVersionsAscending).map((record) => this.toRecord(record));
  }

  getActiveVersions(id: string): SkillRecord[] {
    return this.getVersions(id).filter((record) => record.status === "active");
  }

  getDefaultVersion(id: string): string | undefined {
    return this.skills.get(id)?.defaultVersion;
  }

  setDefaultVersion(id: string, version: string, reason = "Default skill version updated."): void {
    this.commitMutation(() => {
      const record = this.getMutableRecord(id, version);
      if (!record) throw new Error(`Skill '${id}' version '${version}' was not found.`);
      this.setDefaultVersionMutable(id, record, reason);
    });
  }

  getAll(): SkillRecord[] {
    return [...this.skills.values()]
      .flatMap((entry) => [...entry.versions.values()])
      .sort((a, b) => a.id.localeCompare(b.id) || compareVersionsAscending(a, b))
      .map((record) => this.toRecord(record));
  }

  findByCategory(category: string): SkillRecord[] {
    return this.getAll().filter((s) => s.manifest.category === category);
  }

  search(query: string): SkillRecord[] {
    const lower = query.toLowerCase();
    return this.getAll().filter((s) =>
      s.manifest.name.toLowerCase().includes(lower) ||
      s.manifest.description.toLowerCase().includes(lower) ||
      s.manifest.tags.some((t) => t.toLowerCase().includes(lower)),
    );
  }

  planForGoal(goal: string, availableSkills: SkillDefinition[]): SkillExecutionPlan {
    const lower = goal.toLowerCase();
    const scored = availableSkills
      .map((s) => {
        const tagHits = s.manifest.tags.filter((t) => lower.includes(t.toLowerCase())).length;
        const descHits = lower.split(" ").filter((w) => s.manifest.description.toLowerCase().includes(w)).length;
        const nameHit = lower.includes(s.manifest.name.toLowerCase()) ? 2 : 0;
        const weight = tagHits * 3 + descHits * 2 + nameHit;
        return {
          skillId: s.manifest.id,
          version: s.manifest.version,
          weight,
          reason: this.buildReason(s.manifest.name, tagHits, descHits),
        };
      })
      .filter((s) => s.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.skillId.localeCompare(b.skillId) || (a.version ?? "").localeCompare(b.version ?? ""))
      .slice(0, 5);

    return {
      skills: scored,
      composed: scored.length > 1,
      estimatedDurationMs: scored.reduce((sum) => sum + 5000, 0),
    };
  }

  updateStatus(id: string, status: SkillStatus, version?: string): void {
    this.commitMutation(() => {
      const record = this.resolveRecord(id, version);
      if (record && record.status !== status) {
        this.transitionMutable(id, status, `Status updated to ${status}.`, { version: record.manifest.version });
      }
    });
  }

  transition(
    id: string,
    status: SkillStatus,
    reason: string,
    options: SkillVersionRegistrationOptions & { readonly version?: string } = {},
  ): void {
    this.commitMutation(() => this.transitionMutable(id, status, reason, options));
  }

  retire(
    id: string,
    reason: string,
    options: SkillVersionRegistrationOptions & { readonly version?: string } = {},
  ): void {
    this.transition(id, "retired", reason, options);
  }

  quarantine(id: string, reason: string, evidenceRefs: readonly string[] = [], options: { readonly version?: string } = {}): void {
    this.transition(id, "quarantined", reason, { version: options.version, evidenceRefs });
  }

  rollback(
    id: string,
    version: string,
    reason: string,
    options: { readonly evidenceRefs?: readonly string[]; readonly previousVersion?: string } = {},
  ): void {
    this.commitMutation(() => {
      const target = this.getMutableRecord(id, version);
      if (!target) throw new Error(`Skill '${id}' version '${version}' was not found.`);
      if (target.status !== "active") {
        this.transitionMutable(id, "active", reason, { version, evidenceRefs: options.evidenceRefs });
      }
      const previous = options.previousVersion ?? this.getDefaultVersion(id);
      if (previous && previous !== version) {
        const previousRecord = this.getMutableRecord(id, previous);
        if (previousRecord?.status === "active") {
          this.transitionMutable(id, "review", `Rollback from ${previous} to ${version}: ${reason}`, {
            version: previous,
            evidenceRefs: options.evidenceRefs,
          });
        }
      }
      this.setDefaultVersionMutable(id, target, reason);
    });
  }

  getLifecycleHistory(id?: string, version?: string): SkillLifecycleEvent[] {
    return this.lifecycleHistory
      .filter((event) => id ? event.skillId === id : true)
      .filter((event) => version ? event.version === version : true)
      .map((event) => ({ ...event, evidenceRefs: [...event.evidenceRefs] }));
  }

  getSupersededBy(id: string, version?: string): string | undefined {
    return this.resolveRecord(id, version)?.supersededBy;
  }

  getVersionSupersededBy(id: string, version: string): string | undefined {
    return this.getMutableRecord(id, version)?.supersededByVersion;
  }

  recordUsage(id: string, durationMs: number, version?: string): void {
    this.commitMutation(() => {
      const record = this.resolveRecord(id, version);
      if (record) {
        record.useCount++;
        record.lastUsed = new Date().toISOString();
        record.avgDurationMs = record.useCount === 1
          ? durationMs
          : (record.avgDurationMs * (record.useCount - 1) + durationMs) / record.useCount;
      }
    });
  }

  remove(id: string, version?: string): boolean {
    return this.commitMutation(() => {
      if (version === undefined) return this.skills.delete(id);
      const entry = this.skills.get(id);
      if (!entry) return false;
      const removed = entry.versions.delete(version);
      if (entry.defaultVersion === version) {
        entry.defaultVersion = [...entry.versions.values()].find((record) => record.status === "active")?.manifest.version;
      }
      if (entry.versions.size === 0) this.skills.delete(id);
      return removed;
    });
  }

  clear(): void {
    this.commitMutation(() => {
      this.skills.clear();
      this.lifecycleHistory = [];
    });
  }

  count(): number {
    return this.getAll().length;
  }

  private resolveRecord(id: string, version?: string): MutableSkillRecord | undefined {
    if (version) return this.getMutableRecord(id, version);
    const entry = this.skills.get(id);
    if (!entry) return undefined;
    const defaultRecord = entry.defaultVersion ? entry.versions.get(entry.defaultVersion) : undefined;
    if (defaultRecord && defaultRecord.status === "active") return defaultRecord;
    return [...entry.versions.values()].find((record) => record.status === "active") ??
      defaultRecord ??
      [...entry.versions.values()].sort(compareVersionsDescending)[0];
  }

  private getMutableRecord(id: string, version: string): MutableSkillRecord | undefined {
    return this.skills.get(id)?.versions.get(version);
  }

  private toRecord(record: MutableSkillRecord): SkillRecord {
    return {
      id: record.id,
      versionKey: record.versionKey,
      manifest: cloneManifest(record.manifest),
      status: record.status,
      source: record.source,
      fingerprint: record.fingerprint,
      supersededBy: record.supersededBy,
      supersededByVersion: record.supersededByVersion,
      parentVersion: record.parentVersion,
      isDefault: this.skills.get(record.id)?.defaultVersion === record.manifest.version,
      loadedAt: record.loadedAt,
      lastUsed: record.lastUsed,
      useCount: record.useCount,
      avgDurationMs: record.avgDurationMs,
    };
  }

  private reconcileVersion(persisted: PersistedSkillVersion): { readonly loaded: boolean; readonly issues: readonly SkillRegistryLoadIssue[] } {
    const issues: SkillRegistryLoadIssue[] = [];
    if (persisted.skillId !== persisted.manifest.id || persisted.version !== persisted.manifest.version) {
      return { loaded: false, issues: [issue("invalid_schema", `Persisted version identity does not match manifest for ${persisted.skillId}@${persisted.version}.`)] };
    }
    const manifestIssue = validatePersistedManifest(persisted);
    if (manifestIssue) return { loaded: false, issues: [manifestIssue] };
    if (!isSkillStatus(persisted.status) || !isSkillLoadSource(persisted.source)) {
      return { loaded: false, issues: [issue("invalid_schema", `Persisted skill ${persisted.skillId}@${persisted.version} has invalid lifecycle or source.`)] };
    }

    const existing = this.getMutableRecord(persisted.skillId, persisted.version);
    if (existing) {
      const currentFingerprint = skillDefinitionFingerprint(existing.definition, existing.portableDefinition);
      if (persisted.fingerprint && persisted.fingerprint !== currentFingerprint) {
        return {
          loaded: false,
          issues: [issue("invalid_schema", `Artifact fingerprint conflict for ${persisted.skillId}@${persisted.version}.`)],
        };
      }
      existing.status = persisted.status;
      existing.source = persisted.source;
      existing.loadedAt = persisted.loadedAt;
      existing.lastUsed = persisted.lastUsed;
      existing.useCount = persisted.useCount;
      existing.avgDurationMs = persisted.avgDurationMs;
      existing.parentVersion = persisted.parentVersion;
      existing.supersededBy = persisted.supersededBy;
      existing.supersededByVersion = persisted.supersededByVersion;
      existing.fingerprint = persisted.fingerprint || currentFingerprint;
      return { loaded: true, issues };
    }

    if (!persisted.definition) {
      return {
        loaded: false,
        issues: [issue("invalid_schema", `No source definition is available for ${persisted.skillId}@${persisted.version}.`)],
      };
    }

    const definition = portableSkillDefinition(persisted.manifest, persisted.definition);
    const fingerprint = skillDefinitionFingerprint(definition, persisted.definition);
    if (persisted.fingerprint && persisted.fingerprint !== fingerprint) {
      return {
        loaded: false,
        issues: [issue("invalid_schema", `Portable definition fingerprint conflict for ${persisted.skillId}@${persisted.version}.`)],
      };
    }
    try {
      this.registerMutable(definition, persisted.source, persisted.status, {
        parentVersion: persisted.parentVersion,
        replacementSkillId: persisted.supersededBy,
        replacementVersion: persisted.supersededByVersion,
        portableInstructions: persisted.definition.instructions,
        portableExecution: persisted.definition.execution,
        compilationProvenance: persisted.definition.compilation,
        sourceRef: persisted.definition.sourceRef,
      }, persisted);
      return { loaded: true, issues };
    } catch (error) {
      return {
        loaded: false,
        issues: [issue("invalid_schema", error instanceof Error ? error.message : String(error))],
      };
    }
  }

  private transitionMutable(
    id: string,
    status: SkillStatus,
    reason: string,
    options: SkillVersionRegistrationOptions & { readonly version?: string } = {},
  ): void {
    const record = this.resolveRecord(id, options.version);
    if (!record) return;
    const previous = record.status;
    record.status = status;
    if (options.replacementSkillId) record.supersededBy = options.replacementSkillId;
    if (options.replacementVersion) record.supersededByVersion = options.replacementVersion;
    this.lifecycleHistory.push({
      skillId: id,
      version: record.manifest.version,
      from: previous,
      to: status,
      reason,
      evidenceRefs: options.evidenceRefs ?? [],
      replacementSkillId: options.replacementSkillId,
      replacementVersion: options.replacementVersion,
      createdAt: new Date().toISOString(),
    });
  }

  private setDefaultVersionMutable(id: string, record: MutableSkillRecord, reason: string): void {
    if (record.status !== "active") throw new Error(`Skill '${id}' version '${record.manifest.version}' is not active.`);
    this.skills.get(id)!.defaultVersion = record.manifest.version;
    this.lifecycleHistory.push({
      skillId: id,
      version: record.manifest.version,
      from: record.status,
      to: record.status,
      reason,
      evidenceRefs: [],
      createdAt: new Date().toISOString(),
    });
  }

  private toPersistedVersion(record: MutableSkillRecord): PersistedSkillVersion {
    return {
      skillId: record.id,
      version: record.manifest.version,
      manifest: cloneManifest(record.manifest),
      status: record.status,
      source: record.source,
      loadedAt: record.loadedAt,
      lastUsed: record.lastUsed,
      useCount: record.useCount,
      avgDurationMs: record.avgDurationMs,
      parentVersion: record.parentVersion,
      supersededBy: record.supersededBy,
      supersededByVersion: record.supersededByVersion,
      fingerprint: record.fingerprint,
      definition: record.portableDefinition ? { ...record.portableDefinition } : undefined,
    };
  }

  private commitMutation<T>(mutation: () => T): T {
    const before = this.store ? this.cloneState() : undefined;
    const result = mutation();
    if (!this.store) return result;
    try {
      this.persist();
      return result;
    } catch (error) {
      if (before) this.restoreState(before);
      throw error;
    }
  }

  private withPersistenceSuspended(action: () => void): void {
    const store = this.store;
    this.store = undefined;
    try {
      action();
    } finally {
      this.store = store;
    }
  }

  private cloneState(): { readonly skills: Map<string, LogicalSkillEntry>; readonly lifecycleHistory: SkillLifecycleEvent[] } {
    const skills = new Map<string, LogicalSkillEntry>();
    for (const [id, entry] of this.skills.entries()) {
      const versions = new Map<string, MutableSkillRecord>();
      for (const [version, record] of entry.versions.entries()) {
        versions.set(version, {
          ...record,
          manifest: cloneManifest(record.manifest),
          definition: cloneDefinition(record.definition),
          portableDefinition: record.portableDefinition ? { ...record.portableDefinition } : undefined,
        });
      }
      skills.set(id, { defaultVersion: entry.defaultVersion, versions });
    }
    return {
      skills,
      lifecycleHistory: this.getLifecycleHistory(),
    };
  }

  private restoreState(state: { readonly skills: Map<string, LogicalSkillEntry>; readonly lifecycleHistory: SkillLifecycleEvent[] }): void {
    this.skills = state.skills;
    this.lifecycleHistory = state.lifecycleHistory.map((event) => ({ ...event, evidenceRefs: [...event.evidenceRefs] }));
  }

  private buildReason(name: string, tagHits: number, descHits: number): string {
    const parts: string[] = [];
    if (tagHits > 0) parts.push(`${tagHits} tag(s) matched`);
    if (descHits > 0) parts.push(`${descHits} description keyword(s) matched`);
    if (parts.length === 0) parts.push("partial name match");
    return `${name}: ${parts.join(", ")}`;
  }
}

function assertNoLineageCycle(entry: LogicalSkillEntry, version: string, parentVersion: string): void {
  const seen = new Set<string>([version]);
  let current: string | undefined = parentVersion;
  while (current) {
    if (seen.has(current)) throw new Error(`Skill version lineage cycle detected at '${current}'.`);
    seen.add(current);
    current = entry.versions.get(current)?.parentVersion;
  }
}

function compareVersionsAscending(a: MutableSkillRecord, b: MutableSkillRecord): number {
  return compareVersionStrings(a.manifest.version, b.manifest.version);
}

function compareVersionsDescending(a: MutableSkillRecord, b: MutableSkillRecord): number {
  return compareVersionStrings(b.manifest.version, a.manifest.version);
}

function compareVersionStrings(a: string, b: string): number {
  const left = a.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const right = b.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (Number.isFinite(l) && Number.isFinite(r) && l !== r) return l - r;
  }
  return a.localeCompare(b);
}

function versionKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function cloneManifest(manifest: SkillManifest): SkillManifest {
  return JSON.parse(JSON.stringify(manifest)) as SkillManifest;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneDefinition(definition: SkillDefinition): SkillDefinition {
  return {
    manifest: cloneManifest(definition.manifest),
    portableExecution: definition.portableExecution ? clone(definition.portableExecution) : undefined,
    compilationProvenance: definition.compilationProvenance ? clone(definition.compilationProvenance) : undefined,
    execute: definition.execute,
  };
}

function portableDefinitionFor(
  source: SkillLoadSource,
  definition: SkillDefinition,
  options: SkillVersionRegistrationOptions,
  persisted?: PersistedSkillDefinition,
): PersistedSkillDefinition | undefined {
  if (persisted) return { ...persisted };
  if (!["generated", "imported", "plugin", "file"].includes(source)) return undefined;
  return {
    kind: "portable",
    instructions: options.portableInstructions,
    execution: options.portableExecution ?? definition.portableExecution,
    compilation: options.compilationProvenance ?? definition.compilationProvenance,
    sourceRef: options.sourceRef,
  };
}

function issue(code: SkillRegistryLoadIssue["code"], message: string): SkillRegistryLoadIssue {
  return { code, message };
}

function isLifecycleEvent(event: SkillLifecycleEvent): boolean {
  return Boolean(event.skillId) &&
    (!event.version || typeof event.version === "string") &&
    isSkillStatus(event.from) &&
    isSkillStatus(event.to) &&
    typeof event.reason === "string" &&
    Array.isArray(event.evidenceRefs) &&
    typeof event.createdAt === "string";
}

function isSkillStatus(status: string): status is SkillStatus {
  return ["active", "inactive", "error", "loading", "candidate", "review", "retired", "quarantined"].includes(status);
}

function isSkillLoadSource(source: string): source is SkillLoadSource {
  return ["builtin", "file", "package", "marketplace", "generated", "imported", "plugin"].includes(source);
}

function validatePersistedManifest(persisted: PersistedSkillVersion): SkillRegistryLoadIssue | undefined {
  const manifest = persisted.manifest;
  if (!manifest.id.trim() || !manifest.name.trim() || !manifest.description.trim() || !manifest.version.trim()) {
    return issue("invalid_schema", `Persisted skill ${persisted.skillId}@${persisted.version} has an invalid manifest.`);
  }
  if (!Array.isArray(manifest.tags) || !Array.isArray(manifest.requiresPermissions) || !Array.isArray(manifest.requiresTools)) {
    return issue("invalid_schema", `Persisted skill ${persisted.skillId}@${persisted.version} has malformed manifest arrays.`);
  }
  if (persisted.status === "active" && persisted.source !== "builtin") {
    const prohibited = manifest.requiresPermissions.find((permission) =>
      permission === "filesystem.write.external" ||
      permission === "secrets.read" ||
      permission === "secrets.write" ||
      permission === "plugin.install" ||
      permission === "everything"
    );
    if (prohibited) {
      return issue("invalid_schema", `Persisted skill ${persisted.skillId}@${persisted.version} cannot be restored active with prohibited permission ${prohibited}.`);
    }
  }
  return undefined;
}
