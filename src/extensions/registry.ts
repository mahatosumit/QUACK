import { QUACK_CONTRACT_VERSION } from "../contracts/v1/contracts.js";
import type { QuackProviderV1 } from "../contracts/v1/contracts.js";
import { isPermission } from "../security/permissions.js";
import { validatePluginManifest } from "../plugins/manifest.js";
import type { SkillDefinition } from "../skills/types.js";
import type { QuackTool } from "../tools/tool.js";
import type {
  AdmittedExtension, AgentProfile, ContributionKind, ContributionProvenance,
  ExtensionAdmissionOptions, ExtensionComponentIdentity, ExtensionContributions,
  ExtensionDefinition, ExtensionManifest, ExtensionSource, PluginContribution,
} from "./types.js";

export class ExtensionAdmissionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ExtensionAdmissionError";
  }
}

const KINDS = [
  "agentProfiles", "skills", "tools", "plannerStrategies", "contextProviders",
  "memoryProviders", "modelProviders", "validationProviders", "policyProviders", "plugins",
] as const satisfies readonly ContributionKind[];
const ID_PATTERN = /^[a-z][a-z0-9-]*(?:[./][a-z0-9][a-z0-9-]*)+$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*))*)?(?:\+[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?$/;

/**
 * Atomic admission of declarations. Existing subsystem registries own execution.
 * Supplied implementations are trusted host code; this catalog is not a sandbox.
 */
export class ExtensionRegistry {
  private readonly admitted = new Map<string, AdmittedExtension>();
  private admitting = false;

  register(definition: ExtensionDefinition, options: ExtensionAdmissionOptions): AdmittedExtension {
    return this.registerBatch([definition], options)[0]!;
  }

  registerBatch(definitions: readonly ExtensionDefinition[], options: ExtensionAdmissionOptions): readonly AdmittedExtension[] {
    if (this.admitting) reject("extension.reentrant", "Extension admission cannot be reentered.");
    this.admitting = true;
    try {
      if (!Array.isArray(definitions)) reject("extension.invalid", "Extensions must be an array.");
      const source = normalizeSource(options?.source);
      const staged = new Map<string, AdmittedExtension>();
      const occupied = new Map<ContributionKind, Set<string>>(KINDS.map(kind => [kind, new Set<string>()]));
      for (const [kind, ids] of Object.entries(options.occupied ?? {})) {
        if (!KINDS.includes(kind as ContributionKind) || !Array.isArray(ids)) reject("extension.invalid", "Invalid occupied registry declaration.");
        for (const id of ids) {
          if (typeof id !== "string" || !id.trim()) reject("extension.invalid", "Occupied registry IDs must be nonempty strings.");
          occupied.get(kind as ContributionKind)!.add(id);
        }
      }
      for (const extension of this.admitted.values()) {
        for (const contribution of extension.provenance) occupied.get(contribution.kind)!.add(contribution.id);
      }
      for (const definition of definitions) {
        const manifest = normalizeManifest(definition?.manifest);
        if (this.admitted.has(manifest.id) || staged.has(manifest.id)) reject("extension.duplicate", `Extension ${manifest.id} is already registered.`);
        const extension = normalizeExtension(definition, manifest, source);
        for (const contribution of extension.provenance) {
          const ids = occupied.get(contribution.kind)!;
          if (ids.has(contribution.id)) reject("extension.collision", `${contribution.kind} contribution ${contribution.id} collides with an existing registration.`);
          ids.add(contribution.id);
        }
        staged.set(manifest.id, extension);
      }
      const ordered = dependencyOrder(staged, this.admitted);
      // Every potentially failing validation precedes publication of the batch.
      for (const extension of ordered) this.admitted.set(extension.manifest.id, extension);
      return Object.freeze(ordered);
    } finally {
      this.admitting = false;
    }
  }

  get(id: string): AdmittedExtension | undefined { return this.admitted.get(id); }
  list(): readonly AdmittedExtension[] { return Object.freeze([...this.admitted.values()]); }
}

function normalizeExtension(definition: ExtensionDefinition, manifest: ExtensionManifest, source: ExtensionSource): AdmittedExtension {
  const raw = object(definition.contributions, "Extension contributions");
  for (const key of Object.keys(raw)) {
    if (!KINDS.includes(key as ContributionKind)) reject("extension.unsupported_contribution", `Unsupported extension contribution kind ${key}.`);
    if (!Array.isArray(raw[key])) reject("extension.invalid", `Contribution ${key} must be an array.`);
  }
  const contributions: ExtensionContributions = {
    ...(definition.contributions.agentProfiles && { agentProfiles: definition.contributions.agentProfiles.map(normalizeProfile) }),
    ...(definition.contributions.skills && { skills: definition.contributions.skills.map(normalizeSkill) }),
    ...(definition.contributions.tools && { tools: definition.contributions.tools.map(normalizeTool) }),
    ...(definition.contributions.plannerStrategies && { plannerStrategies: definition.contributions.plannerStrategies.map(value => methods(value, ["plan"], ["replan"])) }),
    ...(definition.contributions.contextProviders && { contextProviders: definition.contributions.contextProviders.map(value => methods(value, ["load"])) }),
    ...(definition.contributions.memoryProviders && { memoryProviders: definition.contributions.memoryProviders.map(value => methods(value, ["store", "retrieve"], ["forget", "export"])) }),
    ...(definition.contributions.modelProviders && { modelProviders: definition.contributions.modelProviders.map(normalizeModel) }),
    ...(definition.contributions.validationProviders && { validationProviders: definition.contributions.validationProviders.map(value => methods(value, ["validate"])) }),
    ...(definition.contributions.policyProviders && { policyProviders: definition.contributions.policyProviders.map(value => methods(value, ["restrict"])) }),
    ...(definition.contributions.plugins && { plugins: definition.contributions.plugins.map(normalizePlugin) }),
  };
  const provenance: ContributionProvenance[] = [];
  for (const kind of KINDS) {
    for (const contribution of contributions[kind] ?? []) {
      const identity = componentIdentity(kind, contribution, manifest.version);
      provenance.push(freezeData({ extensionId: manifest.id, extensionVersion: manifest.version, kind, ...identity, source }));
    }
    if (contributions[kind]) Object.freeze(contributions[kind]);
  }
  return Object.freeze({ manifest, contributions: Object.freeze(contributions), provenance: Object.freeze(provenance), source });
}

function normalizeManifest(input: ExtensionManifest): ExtensionManifest {
  const value = object(input, "Extension manifest");
  identifier(value.id);
  version(value.version);
  if (value.contractVersion !== QUACK_CONTRACT_VERSION) reject("extension.contract_version", "Unsupported extension contract version.");
  if (value.dependencies !== undefined && !Array.isArray(value.dependencies)) reject("extension.invalid", "Dependencies must be an array.");
  const seen = new Set<string>();
  for (const dependency of input.dependencies ?? []) {
    object(dependency, "Extension dependency");
    identifier(dependency.id);
    version(dependency.version);
    if (seen.has(dependency.id)) reject("extension.dependency_duplicate", `Duplicate dependency ${dependency.id}.`);
    seen.add(dependency.id);
  }
  return freezeData({ id: input.id, version: input.version, contractVersion: input.contractVersion, dependencies: input.dependencies ?? [] });
}

function normalizeSource(input: ExtensionSource): ExtensionSource {
  const source = object(input, "Extension source");
  if (!["builtin", "application", "plugin"].includes(source.kind as string)) reject("extension.invalid", "Extension source kind is invalid.");
  identifier(source.sourceId);
  if (source.integrity !== undefined && (typeof source.integrity !== "string" || !source.integrity.trim())) reject("extension.invalid", "Source integrity must be a nonempty provenance string.");
  return freezeData({ kind: input.kind, sourceId: input.sourceId, ...(input.integrity && { integrity: input.integrity }) });
}

function normalizeProfile(profile: AgentProfile): AgentProfile {
  object(profile, "Agent profile");
  identifier(profile.id);
  version(profile.version);
  nonempty(profile.name, "Profile name");
  nonempty(profile.description, "Profile description");
  if (profile.contractVersion !== QUACK_CONTRACT_VERSION) reject("extension.contract_version", "Unsupported agent profile contract version.");
  if (profile.mode !== "primary" && profile.mode !== "subagent") reject("extension.invalid", "Agent profile mode is invalid.");
  strings(profile.requiredPermissions, "Profile permissions");
  if (!Array.isArray(profile.requiredCapabilities)) reject("extension.invalid", "Profile model capabilities must be an array.");
  for (const requirement of profile.requiredCapabilities) {
    object(requirement, "Profile model capability");
    nonempty(requirement.capability, "Profile model capability name");
    if (requirement.minimumLevel !== undefined && !["NATIVE", "EMULATED", "DEGRADED"].includes(requirement.minimumLevel)) reject("extension.invalid", "Profile model capability support level is invalid.");
    if (requirement.minimumValue !== undefined && (!Number.isFinite(requirement.minimumValue) || requirement.minimumValue < 0)) reject("extension.invalid", "Profile model capability minimum must be finite and nonnegative.");
    if (requirement.required !== undefined && typeof requirement.required !== "boolean") reject("extension.invalid", "Profile model capability requirement must be boolean.");
  }
  strings(profile.allowedTools, "Profile allowed tools");
  object(profile.capabilityPolicy, "Profile capability policy");
  strings(profile.capabilityPolicy.ceiling, "Profile capability ceiling");
  object(profile.modelPolicy, "Profile model policy");
  if (!["local-only", "private-only", "allow-cloud"].includes(profile.modelPolicy.privacy) || typeof profile.modelPolicy.allowCloudFallback !== "boolean") reject("extension.invalid", "Profile model policy is invalid.");
  for (const key of ["allowedProviderIds", "deniedProviderIds", "preferredProviderIds", "preferredBoundaries"] as const) {
    if (profile.modelPolicy[key] !== undefined) strings(profile.modelPolicy[key], `Profile ${key}`);
  }
  object(profile.contextPolicy, "Profile context policy");
  strings(profile.contextPolicy.namespaces, "Profile context namespaces");
  count(profile.contextPolicy.maxTokens, "Context token budget");
  count(profile.contextPolicy.maxBytes, "Context byte budget");
  if (typeof profile.contextPolicy.inheritParentContext !== "boolean") reject("extension.invalid", "Profile context inheritance must be explicit.");
  object(profile.resourceBudget, "Profile resource budget");
  for (const key of ["maxIterations", "maxToolCalls", "maxModelCalls"] as const) count(profile.resourceBudget[key], key);
  count(profile.resourceBudget.timeoutMs, "Profile timeout", 1);
  count(profile.resourceBudget.maxConcurrency, "Profile concurrency", 1);
  if (profile.resourceBudget.maxTokens !== undefined) count(profile.resourceBudget.maxTokens, "Profile tokens");
  if (profile.resourceBudget.maxCostUsd !== undefined && (!Number.isFinite(profile.resourceBudget.maxCostUsd) || profile.resourceBudget.maxCostUsd < 0)) reject("extension.invalid", "Profile cost budget must be finite and nonnegative.");
  count(profile.delegationDepth, "Profile delegation depth");
  return freezeData(profile);
}

function normalizeTool(tool: QuackTool): QuackTool {
  object(tool, "Tool implementation");
  identifier(tool.id);
  const describe = method(tool, "describe");
  const metadata = describe();
  object(metadata, "Tool metadata");
  if (metadata.id !== tool.id) reject("extension.identity_mismatch", "Tool identity differs from its descriptor.");
  nonempty(metadata.name, "Tool name");
  nonempty(metadata.description, "Tool description");
  strings(metadata.permissions, "Tool permissions");
  if (metadata.permissions.some(permission => !isPermission(permission))) reject("extension.invalid", "Tool declares an unknown permission.");
  const snapshot = freezeData(metadata);
  return Object.freeze({
    id: tool.id,
    describe: () => snapshot,
    execute: method(tool, "execute"),
    ...(tool.validateInput !== undefined && { validateInput: method(tool, "validateInput") }),
  });
}

function normalizeSkill(skill: SkillDefinition): SkillDefinition {
  object(skill, "Skill definition");
  object(skill.manifest, "Skill manifest");
  identifier(skill.manifest.id);
  version(skill.manifest.version);
  for (const key of ["name", "description", "author", "category", "entry"] as const) nonempty(skill.manifest[key], `Skill ${key}`);
  strings(skill.manifest.tags, "Skill tags");
  strings(skill.manifest.requiresPermissions, "Skill permissions");
  if (skill.manifest.requiresPermissions.some(permission => !isPermission(permission))) reject("extension.invalid", "Skill declares an unknown permission.");
  strings(skill.manifest.requiresTools, "Skill tools");
  return Object.freeze({
    manifest: freezeData(skill.manifest), execute: method(skill, "execute"),
    ...(skill.validate !== undefined && { validate: method(skill, "validate") }),
    ...(skill.portableExecution !== undefined && { portableExecution: freezeData(skill.portableExecution) }),
    ...(skill.compilationProvenance !== undefined && { compilationProvenance: freezeData(skill.compilationProvenance) }),
  });
}

function normalizeModel(provider: QuackProviderV1): QuackProviderV1 {
  object(provider, "Model provider");
  const metadata = method(provider, "metadata")();
  object(metadata, "Model provider metadata");
  identifier(metadata.providerId);
  if (metadata.contractVersion !== QUACK_CONTRACT_VERSION) reject("extension.contract_version", "Unsupported model provider contract version.");
  nonempty(metadata.displayName, "Provider display name");
  nonempty(metadata.runtime, "Provider runtime");
  if (!["local", "cloud", "remote-private"].includes(metadata.boundary)) reject("extension.invalid", "Provider execution boundary is invalid.");
  strings(metadata.credentialEnvironmentVariables, "Provider credential references");
  const snapshot = freezeData(metadata);
  return Object.freeze({
    metadata: () => snapshot,
    health: method(provider, "health"), discoverModels: method(provider, "discoverModels"),
    capabilities: method(provider, "capabilities"), generate: method(provider, "generate"),
    ...(provider.stream !== undefined && { stream: method(provider, "stream") }),
    ...(provider.cancel !== undefined && { cancel: method(provider, "cancel") }),
  });
}

function normalizePlugin(plugin: PluginContribution): PluginContribution {
  object(plugin, "Plugin contribution");
  const manifest = object(plugin.manifest, "Plugin manifest");
  identifier(manifest.id);
  version(manifest.version);
  if (manifest.quackApiVersion !== QUACK_CONTRACT_VERSION) reject("extension.contract_version", "Unsupported plugin API version.");
  nonempty(manifest.name, "Plugin name");
  nonempty(manifest.entry, "Plugin entry");
  if (!["tool", "agent", "provider", "memory", "knowledge-graph", "workflow", "prompt-pack", "ui", "importer", "exporter"].includes(manifest.type as string)) reject("extension.invalid", "Plugin type is invalid.");
  strings(manifest.capabilities, "Plugin capabilities");
  strings(manifest.permissions, "Plugin permissions");
  if (manifest.permissions.some(permission => !isPermission(permission))) reject("extension.invalid", "Plugin declares an unknown permission.");
  if (validatePluginManifest(plugin.manifest).length > 0) reject("extension.invalid", "Plugin manifest does not satisfy the existing plugin registry contract.");
  // Hooks are admitted as declarative contributions governed by the
  // GovernedHookExecutor at execution time (ADR 0034); admission validates
  // shape but never executes a handler. Handler functions are frozen
  // per-contribution without structuredClone so executable identity is
  // preserved exactly.
  const hooks = plugin.hooks === undefined ? [] : plugin.hooks;
  if (!Array.isArray(hooks)) reject("extension.invalid", "Plugin hooks must be an array.");
  for (const hook of hooks) {
    object(hook, "Plugin hook");
    if (!["runtime", "mission", "session", "model", "tool", "capability", "evidence", "memory", "evaluation"].includes(hook.kind as string)) reject("extension.invalid", "Plugin hook kind is invalid.");
    if (typeof hook.handler !== "function") reject("extension.invalid", "Plugin hook must provide a function handler.");
  }
  return Object.freeze({ manifest: freezeData(plugin.manifest), hooks: Object.freeze(hooks.map(hook => Object.freeze({ ...hook }))) });
}

function methods<T extends ExtensionComponentIdentity>(value: T, required: readonly string[], optional: readonly string[] = []): T {
  object(value, "Extension component");
  identifier(value.id);
  version(value.version);
  const result: Record<string, unknown> = { id: value.id, version: value.version };
  for (const name of [...required, ...optional]) {
    if (required.includes(name) || name in value) result[name] = method(value, name as keyof T);
  }
  return Object.freeze(result) as unknown as T;
}

function componentIdentity(kind: ContributionKind, value: unknown, extensionVersion: string): ExtensionComponentIdentity {
  if (kind === "skills") return { id: (value as SkillDefinition).manifest.id, version: (value as SkillDefinition).manifest.version };
  if (kind === "plugins") return { id: (value as PluginContribution).manifest.id, version: (value as PluginContribution).manifest.version };
  if (kind === "modelProviders") return { id: (value as QuackProviderV1).metadata().providerId, version: extensionVersion };
  if (kind === "tools") return { id: (value as QuackTool).id, version: extensionVersion };
  const identity = value as ExtensionComponentIdentity;
  return { id: identity.id, version: identity.version };
}

function dependencyOrder(staged: ReadonlyMap<string, AdmittedExtension>, existing: ReadonlyMap<string, AdmittedExtension>): AdmittedExtension[] {
  const ordered: AdmittedExtension[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (extension: AdmittedExtension): void => {
    if (visited.has(extension.manifest.id)) return;
    if (visiting.has(extension.manifest.id)) reject("extension.dependency_cycle", `Dependency cycle contains ${extension.manifest.id}.`);
    visiting.add(extension.manifest.id);
    for (const dependency of [...(extension.manifest.dependencies ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
      const target = staged.get(dependency.id) ?? existing.get(dependency.id);
      if (!target) reject("extension.dependency_missing", `Missing extension dependency ${dependency.id}.`);
      if (target.manifest.version !== dependency.version) reject("extension.dependency_version", `Extension dependency ${dependency.id} requires an exact matching version.`);
      if (staged.has(dependency.id)) visit(target);
    }
    visiting.delete(extension.manifest.id);
    visited.add(extension.manifest.id);
    ordered.push(extension);
  };
  for (const extension of [...staged.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))) visit(extension);
  return ordered;
}

function method<T extends object, K extends keyof T>(value: T, key: K): T[K] {
  const candidate = value[key];
  if (typeof candidate !== "function") reject("extension.invalid", `Extension component requires method ${String(key)}.`);
  return candidate.bind(value) as T[K];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) reject("extension.invalid", `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) reject("extension.invalid_id", "Extension and component IDs must use a lowercase namespace separated by a dot or slash.");
}

function version(value: unknown): asserts value is string {
  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) reject("extension.invalid_version", "Extension and component versions must be semantic versions.");
}

function strings(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) reject("extension.invalid", `${label} must contain nonempty strings.`);
}

function count(value: unknown, label: string, minimum = 0): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) reject("extension.invalid", `${label} must be an integer of at least ${minimum}.`);
}

function nonempty(value: unknown, label: string): void {
  if (typeof value !== "string" || !value.trim()) reject("extension.invalid", `${label} must be a nonempty string.`);
}

function freezeData<T>(value: T): T {
  let copy: T;
  try { copy = structuredClone(value); } catch { reject("extension.invalid", "Extension declaration metadata must be cloneable data."); }
  const ancestors = new Set<object>();
  const freeze = (item: unknown): void => {
    if (item === null || item === undefined || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)) reject("extension.invalid", "Extension metadata must contain only plain serializable data.");
    if (ancestors.has(item)) reject("extension.invalid", "Extension metadata cannot contain cycles.");
    if (Object.isFrozen(item)) return;
    ancestors.add(item);
    for (const nested of Object.values(item)) freeze(nested);
    ancestors.delete(item);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

function reject(code: string, message: string): never { throw new ExtensionAdmissionError(code, message); }
