import { createGeneralSkillCatalog } from "../../extensions/packs/general.js";
import { createSweSkillCatalog } from "../../extensions/packs/swe.js";
import type { BuiltinSkillFactory } from "./registry.js";

/** Opt-in compatibility catalog. Importing this module registers nothing. */
export function createBuiltinSkillCatalog(): ReadonlyMap<string, BuiltinSkillFactory> {
  return new Map([...createSweSkillCatalog(), ...createGeneralSkillCatalog()]);
}
