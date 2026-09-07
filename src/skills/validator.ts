import { type SkillDefinition, type SkillInput, type SkillValidation } from "./types.js";

export class SkillValidator {
  async validate(definition: SkillDefinition): Promise<SkillValidation> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!definition.manifest.id.trim()) errors.push("Skill id is required.");
    if (!definition.manifest.name.trim()) errors.push("Skill name is required.");
    if (!definition.manifest.description.trim()) errors.push("Skill description is required.");
    if (!definition.manifest.version.trim()) errors.push("Skill version is required.");
    if (definition.manifest.tags.length === 0) warnings.push("Skill has no tags — may be hard to discover.");
    if (definition.manifest.requiresPermissions.length === 0) warnings.push("Skill requires no permissions — verify intent.");

    if (definition.validate) {
      const result = await definition.validate({ goal: "", parameters: {}, context: { workspaceRoot: "", dataDir: "", sessionId: "" } });
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async validateInput(definition: SkillDefinition, input: SkillInput): Promise<SkillValidation> {
    if (!definition.validate) return { valid: true, errors: [], warnings: [] };
    return definition.validate(input);
  }
}
