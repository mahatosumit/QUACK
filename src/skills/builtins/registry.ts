import { type SkillDefinition, type SkillManifest, type SkillInput, type SkillResult } from "../types.js";
import { type Permission } from "../../security/permissions.js";

export type BuiltinSkillFactory = () => SkillDefinition;

export function unsupportedSkill(message: string): (input: SkillInput) => Promise<SkillResult> {
  return async () => ({
    ok: false,
    error: `Built-in skill execution is unsupported: ${message.replace(/ executed$/, "")} has no executor.`,
    durationMs: 0,
  });
}

export function namespaceSkillCatalog(namespace: string, catalog: ReadonlyMap<string, BuiltinSkillFactory>): SkillDefinition[] {
  return [...catalog.entries()].map(([id, factory]) => {
    const definition = factory();
    return { ...definition, manifest: { ...definition.manifest, id: `${namespace}.${id}`, entry: `builtin:${namespace}.${id}` } };
  });
}

export function skillManifest(
  overrides: Partial<SkillManifest> & { id: string; name: string; description: string },
): SkillManifest {
  return {
    version: "1.0.0",
    author: "QUACK",
    category: "custom",
    tags: [],
    requiresPermissions: [],
    requiresTools: [],
    entry: `builtin:${overrides.id}`,
    ...overrides,
    description: `Unavailable placeholder: ${overrides.name}. No execution implementation is installed.`,
    examples: [],
  };
}
