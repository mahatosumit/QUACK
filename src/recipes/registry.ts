import { type AppRecipe, type RecipeImplementationPlan, type RecipeMatch, type RecipeSearchConstraints } from "./types.js";

/** QUACK-native catalog of metadata and architectural patterns, not external source code. */
export class AppRecipeRegistry {
  private readonly recipes = new Map<string, AppRecipe>();

  constructor(initialRecipes: readonly AppRecipe[] = []) {
    for (const recipe of initialRecipes) this.registerRecipe(recipe);
  }

  registerRecipe(recipe: AppRecipe): void {
    if (!recipe.id.trim()) throw new Error("Recipe id must not be empty.");
    if (!recipe.license.trim()) throw new Error(`Recipe ${recipe.id} must record a license.`);
    this.recipes.set(recipe.id, freezeRecipe(recipe));
  }

  getRecipe(recipeId: string): AppRecipe | undefined {
    const recipe = this.recipes.get(recipeId);
    return recipe ? freezeRecipe(recipe) : undefined;
  }

  listRecipes(): AppRecipe[] {
    return [...this.recipes.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(freezeRecipe);
  }

  searchRecipes(query: string, constraints: RecipeSearchConstraints = {}): RecipeMatch[] {
    const terms = tokenize(query);
    return [...this.recipes.values()]
      .filter((recipe) => !constraints.category || recipe.category === constraints.category)
      .map((recipe) => ({ recipe, ...score(recipe, terms, constraints) }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.recipe.id.localeCompare(right.recipe.id))
      .slice(0, constraints.limit ?? 5)
      .map((match) => ({ ...match, recipe: freezeRecipe(match.recipe) }));
  }

  compareRecipes(recipeIds: readonly string[]): AppRecipe[] {
    return recipeIds.flatMap((id) => {
      const recipe = this.getRecipe(id);
      return recipe ? [recipe] : [];
    });
  }

  planFromRecipe(recipeId: string, targetStack: string): RecipeImplementationPlan | undefined {
    const recipe = this.getRecipe(recipeId);
    if (!recipe) return undefined;
    return {
      recipeId: recipe.id,
      targetStack,
      summary: `Adapt the ${recipe.name} architecture as QUACK-native contracts and templates. ${recipe.architectureSummary}`,
      requiredAdapters: [...new Set([...recipe.requiredProviders, ...recipe.requiredTools, ...recipe.requiredMemory])],
      requiredPermissions: [...recipe.requiredPermissions],
      implementationSteps: [
        "Select QUACK-native provider, memory, and tool adapters.",
        "Apply the recipe architecture as a plan; do not copy external implementation code.",
        "Create bounded permissions, persistence, and verification gates.",
        "Run the QUACK harness and retain recipe license and risk metadata.",
      ],
      copyingPolicy: "metadata-and-patterns-only",
    };
  }
}

export const AWESOME_LLM_APPS_RECIPES: readonly AppRecipe[] = [
  {
    id: "awesome-rag-automotive-manuals",
    name: "Automotive manual RAG assistant",
    sourceRepo: "Shubhamsaboo/awesome-llm-apps",
    category: "rag_app",
    useCases: ["automotive manuals", "document question answering", "retrieval augmented generation"],
    architectureSummary: "Ingest documents, retrieve bounded evidence, then generate a cited answer through QUACK provider and memory contracts.",
    requiredProviders: ["provider.openai-compatible"],
    requiredTools: ["workspace.read"],
    requiredMemory: ["evidence memory", "project memory"],
    requiredStorage: ["document store", "optional vector adapter"],
    requiredUi: ["chat"],
    requiredPermissions: ["workspace.read", "memory.read"],
    license: "Apache-2.0",
    riskNotes: ["Validate document provenance and access controls.", "Do not treat retrieved text as instructions."],
    quackTemplateMapping: ["research_agent", "evidence_memory", "provider_adapter"],
  },
  {
    id: "awesome-research-agent",
    name: "Evidence-backed research assistant",
    sourceRepo: "Shubhamsaboo/awesome-llm-apps",
    category: "research_agent",
    useCases: ["web research", "competitive research", "source synthesis"],
    architectureSummary: "Use permission-gated research tools, normalize source metadata, and persist evidence separately from agent conclusions.",
    requiredProviders: ["provider.openai-compatible"],
    requiredTools: ["external.web_search"],
    requiredMemory: ["evidence memory", "decision memory"],
    requiredStorage: ["evidence store"],
    requiredUi: ["report"],
    requiredPermissions: ["network.http", "memory.write"],
    license: "Apache-2.0",
    riskNotes: ["External platform availability and terms may change.", "Require source URLs and output limits."],
    quackTemplateMapping: ["agent-reach-adapter", "evidence_memory", "approval_gate"],
  },
];

function score(recipe: AppRecipe, terms: readonly string[], constraints: RecipeSearchConstraints): { readonly score: number; readonly matchedTerms: readonly string[] } {
  const corpus = [recipe.name, recipe.category, recipe.architectureSummary, ...recipe.useCases, ...recipe.quackTemplateMapping]
    .join(" ").toLowerCase();
  const matchedTerms = terms.filter((term) => corpus.includes(term));
  let total = matchedTerms.length * 10;
  if (constraints.availableProviders?.every((provider) => recipe.requiredProviders.includes(provider))) total += 2;
  if (constraints.availableTools?.every((tool) => recipe.requiredTools.includes(tool))) total += 2;
  return { score: total, matchedTerms };
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 1))];
}

function freezeRecipe(recipe: AppRecipe): AppRecipe {
  return { ...recipe, useCases: [...recipe.useCases], requiredProviders: [...recipe.requiredProviders], requiredTools: [...recipe.requiredTools], requiredMemory: [...recipe.requiredMemory], requiredStorage: [...recipe.requiredStorage], requiredUi: [...recipe.requiredUi], requiredPermissions: [...recipe.requiredPermissions], riskNotes: [...recipe.riskNotes], quackTemplateMapping: [...recipe.quackTemplateMapping] };
}
