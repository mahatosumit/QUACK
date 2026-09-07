import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createId, fail, now, ok, type JsonObject, type QuackError, type QuackResult } from "../../core/types.js";
import { type EventBus } from "../../events/event-bus.js";
import {
  classifyPermissionAction,
  resourceKindForPermission,
  type CapabilityBroker,
} from "../../security/capability-broker.js";
import { type Permission } from "../../security/permissions.js";
import { type ToolRegistry } from "../../tools/tool.js";
import { type SkillRegistry } from "../registry.js";
import { type PortableSkillStep, type SkillRecord, type SkillTrustLevel } from "../types.js";
import { type SkillRuntime, type SkillRuntimeManifest, type SkillRuntimeValidation } from "../runtime/index.js";

export interface SkillPackageManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly trustLevel: SkillTrustLevel;
  readonly requiredCapabilities: readonly string[];
  readonly allowedTools: readonly string[];
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly executionLimits: {
    readonly timeoutMs: number;
    readonly maxIterations: number;
    readonly maxToolCalls: number;
    readonly maxRetriesPerStep: number;
  };
  readonly category?: SkillRuntimeManifest["category"];
  readonly tags?: readonly string[];
}

export interface SkillPackageWorkflow {
  readonly steps: readonly PortableSkillStep[];
}

export interface SkillPackageDefinition {
  readonly root: string;
  readonly manifest: SkillPackageManifest;
  readonly workflow: SkillPackageWorkflow;
  readonly readme?: string;
  readonly testFiles: readonly string[];
}

export interface SkillPackageValidationResult extends SkillRuntimeValidation {
  readonly packageId: string;
  readonly version: string;
}

export interface InstalledSkillPackage {
  readonly id: string;
  readonly version: string;
  readonly packageRoot: string;
  readonly manifest: SkillPackageManifest;
  readonly workflow: SkillPackageWorkflow;
  readonly enabled: boolean;
  readonly validation: SkillPackageValidationResult;
  readonly installedAt: string;
  readonly updatedAt: string;
}

export interface SkillPackageStore {
  load(): readonly InstalledSkillPackage[];
  save(packages: readonly InstalledSkillPackage[]): void;
}

export interface SkillPackageManagerDependencies {
  readonly runtime: SkillRuntime;
  readonly registry: SkillRegistry;
  readonly tools: ToolRegistry;
  readonly capabilityBroker: CapabilityBroker;
  readonly eventBus: EventBus;
  readonly store: SkillPackageStore;
}

export class SkillPackageManager {
  private readonly installed = new Map<string, InstalledSkillPackage>();

  constructor(private readonly deps: SkillPackageManagerDependencies) {
    for (const entry of deps.store.load()) {
      const stored = clone(entry);
      this.installed.set(packageKey(stored.id, stored.version), stored);
      if (stored.workflow && !this.deps.registry.getRecord(stored.id, stored.version)) {
        void this.deps.runtime.loadSkillManifest(toRuntimeManifest(stored));
      }
      if (stored.enabled) this.deps.runtime.enableSkill(stored.id, stored.version);
    }
  }

  async importSkillPackage(packageRoot: string): Promise<QuackResult<SkillPackageDefinition>> {
    const loaded = await loadSkillPackage(packageRoot);
    if (!loaded.ok) {
      await this.emitRejected("unknown", undefined, loaded.error.message);
      return loaded;
    }
    await this.deps.eventBus.emit("skill.package.imported", {
      packageId: loaded.data.manifest.id,
      version: loaded.data.manifest.version,
      packageRoot: loaded.data.root,
      tests: loaded.data.testFiles.length,
    }, { actor: "skill-package-manager" });
    return loaded;
  }

  async validateSkillPackage(input: string | SkillPackageDefinition): Promise<SkillPackageValidationResult> {
    const pkgResult = typeof input === "string" ? await this.importSkillPackage(input) : ok(input);
    if (!pkgResult.ok) {
      return {
        packageId: "unknown",
        version: "unknown",
        valid: false,
        errors: [pkgResult.error.message],
        warnings: [],
        requiredPermissions: [],
        resolvedCapabilities: [],
      };
    }
    const pkg = pkgResult.data;
    const runtimeManifest = toRuntimeManifest(pkg);
    const runtimeValidation = this.deps.runtime.validateManifest(runtimeManifest);
    const errors = [...runtimeValidation.errors];
    const warnings = [...runtimeValidation.warnings];

    if (pkg.manifest.trustLevel === "builtin") {
      errors.push("Imported skill packages cannot claim builtin trust.");
    }

    for (const capability of pkg.manifest.requiredCapabilities) {
      const permission = permissionFromCapability(capability);
      if (!permission) {
        errors.push(`Capability ${capability} is not permission-backed.`);
        continue;
      }
      const decision = await this.deps.capabilityBroker.resolve({
        id: createId("skillpkg"),
        actor: "skill-package-manager",
        capabilityId: capability,
        permission,
        action: classifyPermissionAction(permission),
        resource: { kind: resourceKindForPermission(permission) },
        reason: `Skill package ${pkg.manifest.id}@${pkg.manifest.version} requires ${permission}.`,
        context: {
          packageId: pkg.manifest.id,
          version: pkg.manifest.version,
        },
      });
      if (!decision.granted) {
        errors.push(`Capability ${capability} rejected: ${decision.reason}`);
      }
    }

    const validation: SkillPackageValidationResult = {
      packageId: pkg.manifest.id,
      version: pkg.manifest.version,
      valid: errors.length === 0,
      errors,
      warnings,
      requiredPermissions: runtimeValidation.requiredPermissions,
      resolvedCapabilities: runtimeValidation.resolvedCapabilities,
    };
    await this.deps.eventBus.emit("skill.package.validated", validationToJson(validation), { actor: "skill-package-manager" });
    if (!validation.valid) await this.emitRejected(pkg.manifest.id, pkg.manifest.version, validation.errors.join("; "));
    return validation;
  }

  async registerSkillPackage(input: string | SkillPackageDefinition): Promise<QuackResult<InstalledSkillPackage>> {
    const pkgResult = typeof input === "string" ? await this.importSkillPackage(input) : ok(input);
    if (!pkgResult.ok) return fail(pkgResult.error);
    const pkg = pkgResult.data;
    const validation = await this.validateSkillPackage(pkg);
    if (!validation.valid) {
      return fail(packageError("skill_package.invalid", validation.errors.join("; "), "validation"));
    }

    const loaded = await this.deps.runtime.loadSkillManifest(toRuntimeManifest(pkg));
    if (!loaded.ok) return fail(loaded.error);

    const installed: InstalledSkillPackage = {
      id: pkg.manifest.id,
      version: pkg.manifest.version,
      packageRoot: pkg.root,
      manifest: clone(pkg.manifest),
      workflow: clone(pkg.workflow),
      enabled: false,
      validation,
      installedAt: now(),
      updatedAt: now(),
    };
    this.installed.set(packageKey(installed.id, installed.version), installed);
    this.persist();
    return ok(clone(installed));
  }

  enableSkill(id: string, version?: string): QuackResult<SkillRecord> {
    const installed = this.findInstalled(id, version);
    if (!installed) return fail(packageError("skill_package.not_found", `Skill package ${id} was not installed.`, "runtime"));
    const result = this.deps.runtime.enableSkill(id, installed.version);
    if (!result.ok) return result;
    this.installed.set(packageKey(installed.id, installed.version), {
      ...installed,
      enabled: true,
      updatedAt: now(),
    });
    this.persist();
    void this.deps.eventBus.emit("skill.package.enabled", {
      packageId: installed.id,
      version: installed.version,
    }, { actor: "skill-package-manager" });
    return result;
  }

  disableSkill(id: string, version?: string): QuackResult<SkillRecord> {
    const installed = this.findInstalled(id, version);
    if (!installed) return fail(packageError("skill_package.not_found", `Skill package ${id} was not installed.`, "runtime"));
    const result = this.deps.runtime.disableSkill(id, installed.version);
    if (!result.ok) return result;
    this.installed.set(packageKey(installed.id, installed.version), {
      ...installed,
      enabled: false,
      updatedAt: now(),
    });
    this.persist();
    void this.deps.eventBus.emit("skill.package.disabled", {
      packageId: installed.id,
      version: installed.version,
    }, { actor: "skill-package-manager" });
    return result;
  }

  removeSkill(id: string, version?: string): QuackResult<void> {
    const installed = this.findInstalled(id, version);
    if (!installed) return fail(packageError("skill_package.not_found", `Skill package ${id} was not installed.`, "runtime"));
    this.deps.runtime.disableSkill(id, installed.version);
    this.deps.registry.remove(id, installed.version);
    this.installed.delete(packageKey(installed.id, installed.version));
    this.persist();
    return ok(undefined);
  }

  listInstalled(): InstalledSkillPackage[] {
    return [...this.installed.values()]
      .sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version))
      .map(clone);
  }

  private findInstalled(id: string, version?: string): InstalledSkillPackage | undefined {
    if (version) return this.installed.get(packageKey(id, version));
    return [...this.installed.values()]
      .filter((entry) => entry.id === id)
      .sort((a, b) => b.version.localeCompare(a.version))[0];
  }

  private persist(): void {
    this.deps.store.save(this.listInstalled());
  }

  private async emitRejected(id: string, version: string | undefined, reason: string): Promise<void> {
    await this.deps.eventBus.emit("skill.package.rejected", {
      packageId: id,
      version: version ?? null,
      reason,
    }, { actor: "skill-package-manager" });
  }
}

export class JsonFileSkillPackageStore implements SkillPackageStore {
  constructor(private readonly filePath: string) {}

  load(): readonly InstalledSkillPackage[] {
    if (!existsSync(this.filePath)) return [];
    const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as { readonly packages?: readonly InstalledSkillPackage[] };
    return (parsed.packages ?? []).map(clone);
  }

  save(packages: readonly InstalledSkillPackage[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, `${JSON.stringify({ version: 1, packages }, null, 2)}\n`, "utf8");
    renameSync(tmpPath, this.filePath);
  }
}

export class InMemorySkillPackageStore implements SkillPackageStore {
  private packages: InstalledSkillPackage[] = [];

  load(): readonly InstalledSkillPackage[] {
    return this.packages.map(clone);
  }

  save(packages: readonly InstalledSkillPackage[]): void {
    this.packages = packages.map(clone);
  }
}

async function loadSkillPackage(packageRoot: string): Promise<QuackResult<SkillPackageDefinition>> {
  const root = resolve(packageRoot);
  const manifestPath = join(root, "manifest.json");
  const workflowPath = join(root, "workflow.json");
  if (!existsSync(manifestPath)) return fail(packageError("skill_package.missing_manifest", "Skill package is missing manifest.json.", "validation"));
  if (!existsSync(workflowPath)) return fail(packageError("skill_package.missing_workflow", "Skill package is missing workflow.json.", "validation"));

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SkillPackageManifest;
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as SkillPackageWorkflow;
    const readmePath = join(root, "README.md");
    const testsPath = join(root, "tests");
    const testFiles = existsSync(testsPath)
      ? (await readdir(testsPath, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => join("tests", entry.name))
      : [];
    return ok({
      root,
      manifest,
      workflow,
      readme: existsSync(readmePath) ? await readFile(readmePath, "utf8") : undefined,
      testFiles,
    });
  } catch (error) {
    return fail(packageError("skill_package.malformed", error instanceof Error ? error.message : String(error), "validation"));
  }
}

function toRuntimeManifest(pkg: SkillPackageDefinition | InstalledSkillPackage): SkillRuntimeManifest {
  return {
    ...pkg.manifest,
    workflow: {
      steps: pkg.workflow.steps,
    },
  };
}

function permissionFromCapability(capability: string): Permission | undefined {
  if (!capability.startsWith("permission.")) return undefined;
  const permission = capability.slice("permission.".length);
  return isPermission(permission) ? permission : undefined;
}

function isPermission(value: string): value is Permission {
  return [
    "workspace.read",
    "workspace.write",
    "filesystem.read.external",
    "filesystem.write.external",
    "terminal.execute",
    "network.http",
    "network.websocket",
    "secrets.read",
    "secrets.write",
    "git.read",
    "git.write",
    "provider.invoke",
    "memory.read",
    "memory.write",
    "plugin.install",
  ].includes(value);
}

function validationToJson(validation: SkillPackageValidationResult): JsonObject {
  return {
    packageId: validation.packageId,
    version: validation.version,
    valid: validation.valid,
    errors: [...validation.errors],
    warnings: [...validation.warnings],
    requiredPermissions: [...validation.requiredPermissions],
    resolvedCapabilities: [...validation.resolvedCapabilities],
  };
}

function packageKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function packageError(code: string, message: string, category: QuackError["category"]): QuackError {
  return { code, message, category, recoverable: true };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function removeSkillPackageDirectory(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function skillPackageNameFromPath(path: string): string {
  return basename(resolve(path));
}
