import { type SkillDefinition } from "./types.js";
import { type BuiltinSkillFactory } from "./builtins/registry.js";

export class SkillLoader {
  private readonly catalog: ReadonlyMap<string, BuiltinSkillFactory>;

  constructor(catalog: ReadonlyMap<string, BuiltinSkillFactory> = new Map()) {
    this.catalog = new Map(catalog);
  }

  loadBuiltins(): SkillDefinition[] {
    const loaded: SkillDefinition[] = [];
    for (const id of this.catalog.keys()) {
      const definition = this.loadSingle(id);
      if (definition) loaded.push(definition);
    }
    return loaded;
  }

  loadSingle(id: string): SkillDefinition | undefined {
    const definition = this.catalog.get(id)?.();
    if (definition && definition.manifest.id !== id) throw new Error(`Skill factory identity does not match catalog entry ${id}.`);
    return definition;
  }
}
