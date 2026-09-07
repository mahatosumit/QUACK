# ADR 0012: SEA Editing Workflow and Patch Validation

Status: Accepted

## Context

The Software Engineering Agent must edit source code safely. It needs a structured workflow that:
- Plans edits with conflict detection and risk assessment.
- Applies changes through the existing Patch Engine (never direct file writes).
- Validates changes through type checking, linting, and testing.
- Supports refactoring operations (rename symbol, extract method).
- Supports rollback when validation fails.

## Decision

### Three-Phase Editing Workflow

All edits go through a three-phase workflow:

```
Phase 1: Plan
  → IncrementalEditor.plan(goal, operations)
  → Conflict detection (symbolDb overlap check)
  → Diff generation
  → Risk assessment (file count + change size heuristics)
  → Returns EditingPlan with review recommendation

Phase 2: Validate
  → EditingWorkflow.execute(plan)
  → PatchEngine.createFullPatch()
  → PatchEngine.validatePatch()
  → ValidationPipeline.typeCheck() (if .ts/.tsx files affected)
  → ValidationPipeline.lint()
  → If validation fails → return result with applied=false

Phase 3: Apply
  → PatchEngine.applyPatch()
  → Emit event
  → Record in SeaMemory
  → Return EditingResult with applied=true
```

### Editing Plan

```typescript
interface EditingPlan {
  goal: string;
  operations: EditOperation[];       // path, originalContent, newContent
  affectedFiles: string[];
  riskAssessment: "low" | "medium" | "high" | "critical";
  requiresReview: boolean;
  requiredPermissions: string[];     // ["workspace.read", "workspace.write"]
}
```

**Risk heuristics**:
- Low: 1-2 files, <100 chars change per file
- Medium: 3-5 files or >100 chars change
- High: >5 files or >300 chars change
- Critical: >10 files

Review is required for high and critical risk.

### Incremental Editor

`IncrementalEditor.plan()` handles:
- **Conflict detection**: Checks if edits overlap (same symbol or same file + nearby line range) via `symbolDb`.
- **Diff generation**: Standard unified diff format (like `git diff`) with `@@` hunk headers.
- **Permission identification**: Always includes `workspace.read` and `workspace.write`.

### Editing Workflow

`EditingWorkflow.execute()` handles the full pipeline:

1. Creates a patch via `PatchEngine.createFullPatch()`
2. Validates the patch via `PatchEngine.validatePatch()`
3. Runs `ValidationPipeline.typeCheck()` if the goal involves TypeScript files
4. Runs `ValidationPipeline.lint()` unconditionally
5. If any validation fails → returns `applied: false` with full validation results
6. If all pass → applies patch via `PatchEngine.applyPatch()` and returns `applied: true`
7. Records the edit in `SeaMemory.recordEdit()` for future learning

### Validation Result

```typescript
interface EditingResult {
  patch: Patch;                              // The applied or failed patch
  validationResults: ValidationOutcome[];    // per-validator results
  applied: boolean;                          // Was the patch applied?
  rollbackAvailable: boolean;                // Can the patch be rolled back?
  summary: string;                           // Human-readable summary
}

interface ValidationOutcome {
  type: "typecheck" | "lint" | "test" | "security" | "architecture";
  passed: boolean;
  errors: string[];
  warnings: string[];
  durationMs: number;
}
```

### Refactoring Engine

`RefactoringEngine` provides high-level refactoring operations on top of the editing workflow:

- **renameSymbol(oldName, newName, scope?)**: Searches the symbol database for all occurrences of `oldName`, creates replace operations for each, plans and executes through the editing workflow.
- **extractMethod(sourceFile, methodName, newFile)**: Identifies the method in the source file, creates a new file with the extracted method, replaces the original with an import, plans and executes through the editing workflow.

Both return `EditingResult` — the same type as any other edit. This ensures all edits follow the same validation and rollback path.

### Why Not Direct File Writes

All edits go through `PatchEngine` (not `fs.writeFile`) because:
1. PatchEngine supports rollback via content snapshots.
2. Patch validation (type checking, linting) runs before apply.
3. The patch lifecycle (pending → validating → valid → applied) provides observability.
4. The Patch Engine is shared with the Workflow Engine — editing through patches ensures consistency.

## Consequences

**Positive:**
- Every edit is planned, validated, applied, and recorded — no silent partial edits.
- Type checking and linting catch regressions before code is written to disk.
- Patch rollback is available for all failed edits.
- Refactoring operations reuse the same safe pipeline.

**Negative:**
- Three-phase workflow adds latency (~200-500ms per edit for small changes).
- `IncrementalEditor` conflict detection is conservative (symbol overlap only) — may miss semantic conflicts.
- `ExtractMethod` uses regex-based method detection; may fail on methods with unusual syntax or decorators.
- Type check and lint run on the entire project, not just affected files; slow for large codebases.

## Status

Accepted. Implemented in `src/sea/editing/`.
