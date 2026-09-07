export type AppRecipeCategory =
  | "rag_app"
  | "agent_app"
  | "multi_agent_app"
  | "voice_agent"
  | "browser_agent"
  | "research_agent"
  | "coding_agent"
  | "data_analysis_agent"
  | "automation_agent"
  | "robotics_agent"
  | "startup_saas_agent";

/** Metadata-only reference to a reusable architecture pattern. Never stores copied source code. */
export interface AppRecipe {
  readonly id: string;
  readonly name: string;
  readonly sourceRepo: string;
  readonly sourcePath?: string;
  readonly sourceUrl?: string;
  readonly license: string;
  readonly category: AppRecipeCategory;
  readonly useCases: readonly string[];
  readonly architectureSummary: string;
  readonly requiredProviders: readonly string[];
  readonly requiredTools: readonly string[];
  readonly requiredMemory: readonly string[];
  readonly requiredStorage: readonly string[];
  readonly requiredUi: readonly string[];
  readonly requiredPermissions: readonly string[];
  readonly riskNotes: readonly string[];
  readonly quackTemplateMapping: readonly string[];
}

export interface RecipeSearchConstraints {
  readonly category?: AppRecipeCategory;
  readonly availableProviders?: readonly string[];
  readonly availableTools?: readonly string[];
  readonly limit?: number;
}

export interface RecipeMatch {
  readonly recipe: AppRecipe;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

export interface RecipeImplementationPlan {
  readonly recipeId: string;
  readonly targetStack: string;
  readonly summary: string;
  readonly requiredAdapters: readonly string[];
  readonly requiredPermissions: readonly string[];
  readonly implementationSteps: readonly string[];
  readonly copyingPolicy: "metadata-and-patterns-only";
}
