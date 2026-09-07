# ADR 0013: Skill System Architecture

Status: Accepted

## Context

QUACK needs a first-class **Skill Framework** that allows agents to discover, rank, compose, and execute reusable capabilities. Skills must be declarative, discoverable, versioned, and independently executable.

Skills are the fundamental unit of agent work — they replace ad-hoc tool routing with structured capability execution.

## Decision

### Skill Definition

Every Skill is a `SkillDefinition` containing a `SkillManifest` (metadata) and an `execute` function:

```typescript
interface SkillDefinition {
  manifest: SkillManifest;     // Declarative metadata
  execute: (input: SkillInput) => Promise<SkillResult>;
  validate?: (input: SkillInput) => Promise<SkillValidation>;
}
```

The manifest includes:

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier |
| `name` | Human-readable name |
| `version` | Semver |
| `description` | What the skill does |
| `author` | Creator |
| `category` | One of 18 categories (e.g. "source-control", "testing", "security") |
| `tags` | Search keywords |
| `requiresPermissions` | Permission gates |
| `requiresTools` | Dependent tool IDs |
| `requiresProviders` | Optional provider requirements |
| `requiresModels` | Optional model requirements |
| `dependencies` | Optional skill dependencies |
| `examples` | Input/output examples |

### Skill Pipeline

```
SkillRegistry (catalog)
  → SkillLoader (loads from disk/builtins)
    → SkillValidator (validates manifest + optional input validation)
      → SkillExecutor (executes + records metrics)
        → SkillRecord (persisted usage data)
```

### Skill Registry

The `SkillRegistry` is the central catalog. It supports:
- `register(definition)` — register a skill (rejects duplicates)
- `get(id)` — retrieve by ID
- `search(query)` — search by name, description, tags
- `findByCategory(category)` — filter by category
- `planForGoal(goal, availableSkills)` — score and rank skills for a goal

### Built-in Skills

10 built-in skills are registered on startup:

| ID | Category | Description |
|----|----------|-------------|
| `git` | source-control | Execute git commands |
| `terminal` | terminal | Execute terminal commands |
| `file-manager` | file | Read/write files |
| `testing` | testing | Run tests, analyze failures |
| `documentation` | documentation | Generate docs |
| `security-review` | security | Security vulnerability scanning |
| `architecture-review` | architecture | Code architecture analysis |
| `workspace-index` | indexing | Workspace indexing |
| `markdown` | documentation | Markdown content generation |
| `dependency-analysis` | analysis | Dependency graph analysis |

All execute functions are stubs returning `{ ok: true, data: { message: "..." } }` — they demonstrate the Skill API and will be fully implemented in Phase 5.

### Skill Orchestrator

The `SkillOrchestrator` bridges skills with the ExecutiveBrain. It:
- `discoverRelevant(goal)` — queries the registry for relevant skills
- `rankCandidates(plan)` — sorts by match score
- `estimateCost(goal, plan)` — estimates execution cost via ModelRouter
- `composeWorkflow(plan)` — orders skills into a workflow
- `recordExecution(skillId, durationMs)` — feeds usage data back to the registry

## Consequences

**Positive:**
- Clean separation between skill metadata and execution logic.
- Skills are automatically discoverable by agents.
- Usage metrics enable learning preferred skills over time.
- Built-in skills serve as reference implementations.

**Negative:**
- No skill dependency resolution yet (Phase 5).
- No skill marketplace or packaging (Phase 5).
- Built-in skills are stubs — real implementations require tool integration.

## Status

Accepted. Implemented in `src/skills/`.
