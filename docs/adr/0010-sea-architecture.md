# ADR 0010: Software Engineering Agent Architecture

Status: Accepted

## Context

The QUACK system needs a **Software Engineering Agent (SEA)** that can autonomously understand codebases, navigate them semantically, plan and apply edits, run reviews, manage tests, and generate engineering reports — all within the existing Engine Runtime framework.

The SEA must operate as a top-level orchestrator, not as a Brain extension. It delegates all execution to the existing Engine Runtime (Planner, Task Graph, Scheduler, Patch Engine, Reflection, Recovery) and the Semantic Intelligence Layer.

## Decision

### Architecture

The SEA is a standalone module at `src/sea/` with 10 subdirectories:

```
src/sea/
  types.ts                      # All SEA-specific interfaces
  index.ts                      # Public facade exports
  sea.ts                        # Main orchestrator class
  understanding/                # Repository understanding & architecture analysis
  navigation/                   # Semantic navigation & cross-file analysis
  editing/                      # Incremental editing, workflow, refactoring
  review/reviewers/             # Code review system & 5 reviewers
  testing/                      # Test intelligence & failure analysis
  reporting/                    # Engineering reports
  memory/                       # SEA-specific memory & learning store
```

### Orchestrator Design

The `Sea` class is the sole entry point. It constructs all subsystems in its constructor and exposes them as readonly public fields. Top-level orchestration methods (e.g., `understandRepository`, `analyzeCrossFileImpact`, `executeEdit`) handle cross-cutting concerns (indexing, event emission, memory recording) before delegating to the appropriate subsystem.

```
Sea.understandRepository()
  → ensureIndexed()
  → emit("sea.understanding")
  → RepositoryUnderstanding.summarize()

Sea.executeEdit(plan)
  → emit("sea.editing")
  → EditingWorkflow.execute(plan)
  → SeaMemory.recordEdit(plan, result)
```

### Integration with QUACK

The SEA is wired into the system at `create-system.ts` as a first-class member of `QuackSystem`:

```typescript
interface QuackSystem {
  // ... existing slots ...
  readonly sea: Sea;
}
```

It receives the existing `EventBus`, `Brain`, `SemanticLayer`, `ToolRegistry`, and `MemoryStore` — all already constructed by `createQuackSystem`. It does not create its own copies.

### Subsystem Separation

Each subsystem (understanding, navigation, editing, review, testing, reporting, memory) is an independent class with a single responsibility. They communicate through the `Sea` orchestrator, not directly. Subsystems share data through types defined in `types.ts`.

### Dependencies

- **Understanding**: Uses `SemanticLayer.getFiles()`, `getMetadata()`, `symbolDb`, `depGraph`, `search`
- **Navigation**: Uses `SemanticLayer.symbolDb`, `search`, `depGraph`, `lsp`, `getFiles()`
- **Editing**: Uses `Brain.requestPermission()`, `SemanticLayer.patches` (PatchEngine), `SemanticLayer.validator` (ValidationPipeline), `EventBus`
- **Review**: Creates its own 5 reviewers (architecture, security, performance, style, correctness); reads file content through disk
- **Testing**: Uses `SemanticLayer.testRunner`, `getFiles()`
- **Reporting**: Uses `SemanticLayer.getFiles()`, `getMetadata()`, `depGraph`, `symbolDb`, `testRunner`, `isIndexed()`
- **Memory**: Self-contained in-memory stores with TTL

### Configuration

```typescript
interface SeaConfig {
  workspaceRoot: string;
  dataDir: string;
  maxParallelNodes: number;
  defaultTimeoutMs: number;
  maxRetries: number;
  reviewThreshold: number;
  autoTest: boolean;
  autoReview: boolean;
  autoDocument: boolean;
  maxIndexFiles: number;
}
```

Default values are set in `create-system.ts` and can be overridden per-instance.

## Consequences

**Positive:**
- Clean separation of concerns — 10 independent subsystems with no circular dependencies.
- Delegates execution to proven Engine Runtime primitives (Patch Engine, ValidationPipeline, Event Bus).
- All 166 existing tests continue to pass; no existing code was modified.
- The SEA can be instantiated standalone for testing without the full QuackRuntime.

**Negative:**
- The `Sea` class has 15 readonly fields + 14 orchestrator methods — it is a large facade. This is acceptable because it delegates quickly.
- No lazy construction — all 15 subsystems are created on instantiation even if unused.
- `SeaConfig` duplicates some fields from `QuackConfig` (workspaceRoot, dataDir); drift is possible.

## Status

Accepted. Implemented in `src/sea/`.
