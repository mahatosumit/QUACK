# App recipe registry

`AppRecipeRegistry` stores metadata and architecture patterns, not source code. Every recipe retains source repository, license, permissions, risk notes, and QUACK template mappings.

The initial `AWESOME_LLM_APPS_RECIPES` catalog contains automotive-manual RAG and evidence-backed research recipes. `searchRecipes` ranks candidates deterministically; `planFromRecipe` produces QUACK-native implementation steps with the policy `metadata-and-patterns-only`.
