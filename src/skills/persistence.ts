import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { isMissingFile } from "../core/utils.js";
import {
  type SkillDefinition,
  type SkillCompilationProvenance,
  type SkillLifecycleEvent,
  type SkillLoadSource,
  type SkillManifest,
  type PortableSkillExecutionDefinition,
  type SkillStatus,
} from "./types.js";

export const SKILL_REGISTRY_SCHEMA_VERSION = 1;

export interface PersistedSkillDefinition {
  readonly kind: "portable";
  readonly instructions?: string;
  readonly sourceRef?: string;
  readonly execution?: PortableSkillExecutionDefinition;
  readonly compilation?: SkillCompilationProvenance;
}

export interface PersistedSkillVersion {
  readonly skillId: string;
  readonly version: string;
  readonly manifest: SkillManifest;
  readonly status: SkillStatus;
  readonly source: SkillLoadSource;
  readonly loadedAt: string;
  readonly lastUsed?: string;
  readonly useCount: number;
  readonly avgDurationMs: number;
  readonly parentVersion?: string;
  readonly supersededBy?: string;
  readonly supersededByVersion?: string;
  readonly fingerprint: string;
  readonly definition?: PersistedSkillDefinition;
}

export interface PersistedLogicalSkill {
  readonly skillId: string;
  readonly defaultVersion?: string;
  readonly versions: readonly PersistedSkillVersion[];
}

export interface SkillRegistrySnapshot {
  readonly schemaVersion: typeof SKILL_REGISTRY_SCHEMA_VERSION;
  readonly savedAt: string;
  readonly logicalSkills: readonly PersistedLogicalSkill[];
  readonly lifecycleHistory: readonly SkillLifecycleEvent[];
}

export type SkillRegistryLoadIssueCode =
  | "missing"
  | "malformed_json"
  | "invalid_schema"
  | "migrated_legacy";

export interface SkillRegistryLoadIssue {
  readonly code: SkillRegistryLoadIssueCode;
  readonly message: string;
  readonly path?: string;
  readonly quarantinedPath?: string;
}

export interface SkillRegistryLoadResult {
  readonly snapshot?: SkillRegistrySnapshot;
  readonly issues: readonly SkillRegistryLoadIssue[];
}

export interface SkillRegistryStore {
  load(): SkillRegistryLoadResult;
  save(snapshot: SkillRegistrySnapshot): void;
}

export class InMemorySkillRegistryStore implements SkillRegistryStore {
  private snapshot?: SkillRegistrySnapshot;

  load(): SkillRegistryLoadResult {
    return { snapshot: this.snapshot ? clone(this.snapshot) : undefined, issues: [] };
  }

  save(snapshot: SkillRegistrySnapshot): void {
    this.snapshot = clone(snapshot);
  }
}

export class JsonFileSkillRegistryStore implements SkillRegistryStore {
  constructor(private readonly filePath: string) {}

  load(): SkillRegistryLoadResult {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return migrateSnapshot(parsed, this.filePath);
    } catch (error) {
      if (isMissingFile(error)) return { issues: [{ code: "missing", message: "Skill registry store is empty.", path: this.filePath }] };
      if (error instanceof SyntaxError) {
        const quarantinedPath = this.quarantineCorruptFile();
        return {
          issues: [{
            code: "malformed_json",
            message: `Skill registry store contains malformed JSON: ${error.message}`,
            path: this.filePath,
            quarantinedPath,
          }],
        };
      }
      throw error;
    }
  }

  save(snapshot: SkillRegistrySnapshot): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), "utf8");
    try {
      renameWithTransientRetry(tmpPath, this.filePath);
    } catch (error) {
      rmSync(tmpPath, { force: true });
      throw error;
    }
  }

  private quarantineCorruptFile(): string | undefined {
    if (!existsSync(this.filePath)) return undefined;
    const quarantinedPath = `${this.filePath}.corrupt-${Date.now()}`;
    renameSync(this.filePath, quarantinedPath);
    return quarantinedPath;
  }
}

function renameWithTransientRetry(source: string, destination: string): void {
  const delays = [0, 10, 25, 50, 100];
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]! > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt === delays.length - 1 || !["EPERM", "EBUSY", "EACCES"].includes(code ?? "")) throw error;
    }
  }
}

export function skillDefinitionFingerprint(
  definition: SkillDefinition,
  portableDefinition?: PersistedSkillDefinition,
): string {
  const artifact = portableDefinition?.execution || definition.portableExecution
    ? { manifest: definition.manifest, portableExecution: portableDefinition?.execution ?? definition.portableExecution }
    : portableDefinition
      ? { manifest: definition.manifest, portableDefinition }
    : { manifest: definition.manifest, executeSource: definition.execute.toString() };
  return createHash("sha256").update(stableStringify(artifact)).digest("hex");
}

export function portableSkillDefinition(
  manifest: SkillManifest,
  definition: PersistedSkillDefinition,
): SkillDefinition {
  return {
    manifest: clone(manifest),
    portableExecution: definition.execution ? clone(definition.execution) : undefined,
    compilationProvenance: definition.compilation ? clone(definition.compilation) : undefined,
    execute: async () => ({
      ok: true,
      data: {
        instructions: definition.instructions,
        sourceRef: definition.sourceRef,
        executable: Boolean(definition.execution),
        compiled: Boolean(definition.compilation),
        restoredFromRegistry: true,
      },
      durationMs: 0,
    }),
  };
}

function migrateSnapshot(value: unknown, path: string): SkillRegistryLoadResult {
  if (isCurrentSnapshot(value)) return { snapshot: clone(value), issues: [] };

  const maybeLegacy = value as {
    readonly skills?: readonly {
      readonly id?: string;
      readonly manifest?: SkillManifest;
      readonly status?: SkillStatus;
      readonly source?: SkillLoadSource;
      readonly loadedAt?: string;
      readonly lastUsed?: string;
      readonly useCount?: number;
      readonly avgDurationMs?: number;
    }[];
  };
  if (Array.isArray(maybeLegacy.skills)) {
    const logical = new Map<string, PersistedSkillVersion[]>();
    for (const record of maybeLegacy.skills) {
      if (!record.manifest?.id || !record.manifest.version) continue;
      const definition = { manifest: record.manifest, execute: async () => ({ ok: true, durationMs: 0 }) };
      const version: PersistedSkillVersion = {
        skillId: record.manifest.id,
        version: record.manifest.version,
        manifest: clone(record.manifest),
        status: record.status ?? "active",
        source: record.source ?? "builtin",
        loadedAt: record.loadedAt ?? new Date().toISOString(),
        lastUsed: record.lastUsed,
        useCount: record.useCount ?? 0,
        avgDurationMs: record.avgDurationMs ?? 0,
        fingerprint: skillDefinitionFingerprint(definition),
      };
      logical.set(version.skillId, [...(logical.get(version.skillId) ?? []), version]);
    }
    const snapshot: SkillRegistrySnapshot = {
      schemaVersion: SKILL_REGISTRY_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      logicalSkills: [...logical.entries()].map(([skillId, versions]) => ({
        skillId,
        defaultVersion: versions.find((version) => version.status === "active")?.version ?? versions[0]?.version,
        versions,
      })),
      lifecycleHistory: [],
    };
    return {
      snapshot,
      issues: [{ code: "migrated_legacy", message: "Migrated legacy single-version skill registry state.", path }],
    };
  }

  return {
    issues: [{ code: "invalid_schema", message: "Skill registry store has an unsupported schema version.", path }],
  };
}

function isCurrentSnapshot(value: unknown): value is SkillRegistrySnapshot {
  const snapshot = value as Partial<SkillRegistrySnapshot>;
  return snapshot?.schemaVersion === SKILL_REGISTRY_SCHEMA_VERSION &&
    Array.isArray(snapshot.logicalSkills) &&
    Array.isArray(snapshot.lifecycleHistory);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, sortKeys(object[key])]));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
