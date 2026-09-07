import assert from "node:assert/strict";
import test from "node:test";
import { AppRecipeRegistry, AWESOME_LLM_APPS_RECIPES } from "./registry.js";

test("recipe registry selects an automotive RAG pattern and plans without copied code", () => {
  const registry = new AppRecipeRegistry(AWESOME_LLM_APPS_RECIPES);
  const matches = registry.searchRecipes("build a RAG app for automotive manuals");
  assert.equal(matches[0]?.recipe.id, "awesome-rag-automotive-manuals");
  const plan = registry.planFromRecipe(matches[0]!.recipe.id, "TypeScript");
  assert.equal(plan?.copyingPolicy, "metadata-and-patterns-only");
  assert.ok(plan?.implementationSteps.some((step) => step.includes("do not copy")));
});
