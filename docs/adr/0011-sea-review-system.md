# ADR 0011: SEA Review System Design

Status: Accepted

## Context

The Software Engineering Agent needs a **code review system** that can evaluate code changes for correctness, security, performance, architecture, and style. The review must be programmatic (no ML model dependency), fast, and deterministic.

The review system must:
- Analyze both existing files and pending patches.
- Produce structured findings with severity, file, line, message, and suggestion.
- Aggregate scores and pass/fail verdicts.
- Support easy addition of new review rules.

## Decision

### Multi-Reviewer Architecture

The review system uses 5 independent reviewers, each responsible for one dimension:

| Reviewer | Patterns Detected |
|----------|-------------------|
| **ArchitectureReviewer** | Files >500 lines, deep nesting >6 levels, god objects (>15 methods) |
| **SecurityReviewer** | `eval()`, `innerHTML`, `child_process.exec`, hardcoded secrets, SQL injection templates, `Function()`, prototype pollution, `execSync` |
| **PerformanceReviewer** | Chained `filter().forEach()`, nested loops >3 levels, `JSON.parse(JSON.stringify())`, nested `await`, large array literal (>100), regex in hot path, `new Function` |
| **StyleReviewer** | Lines >120 chars, trailing whitespace, missing EOF newline, functions >50 lines |
| **CorrectnessReviewer** | Loose null check `==`, empty catch blocks, async forEach, parseInt without radix, floating point compare, debugger left in, assignment in condition, implicit coercion, NaN compare |

### Review Finding Structure

```typescript
interface ReviewFinding {
  readonly id: string;             // e.g. "rev-xxx"
  readonly category: ReviewCategory;  // "security", "performance", etc.
  readonly severity: ReviewSeverity;  // "critical" | "high" | "medium" | "low" | "info"
  readonly file: string;
  readonly line?: number;
  readonly message: string;
  readonly explanation: string;
  readonly suggestion?: string;
  readonly code?: string;          // The offending code snippet
}
```

### Aggregation and Scoring

The `ReviewSystem` runs all 5 reviewers and aggregates their findings into a `ReviewReport`:

```typescript
interface ReviewReport {
  target: string;
  findings: ReviewFinding[];
  summary: { total, critical, high, medium, low, info };
  score: number;          // 0-10, starts at 10, penalized by findings
  passed: boolean;        // true if zero critical and ≤2 high findings
  recommendations: string[];  // top 5 critical/high findings
}
```

**Scoring formula**: `score = max(0, 10 - (critical * 3 + high * 1.5 + medium * 0.5))`

**Pass threshold**: `critical == 0 && high <= 2`

### File vs Patch Review

- `review(target: string)` - Reads the file from disk, runs all reviewers, returns report.
- `reviewPatch(patchId: string)` - Retrieves the patched content from PatchEngine, runs all reviewers on each patched file, returns aggregated report.

Both return the same `ReviewReport` type.

### Extensibility

New reviewers implement a common interface:
```typescript
interface Reviewer {
  review(content: string, file: string, language: string): Promise<ReviewFinding[]>;
}
```

Adding a reviewer requires:
1. Create a new file in `review/reviewers/`.
2. Add it to the `reviewers` array in `ReviewSystem`.

No changes needed to any other subsystem.

## Consequences

**Positive:**
- Fully deterministic — no ML dependency, no false positive variance.
- All 5 reviewers run in parallel (via `Promise.all` within `review()`).
- Easy to add new review rules (regex-based pattern matching).
- Pass/fail verdict enables CI gate integration.
- Patch review catches issues introduced by edits before they are applied.

**Negative:**
- Regex-based pattern matching is language-agnostic but may produce false positives (e.g., `eval` in a string literal).
- No context-aware analysis — cannot detect logic bugs or algorithmic issues.
- No cross-file review — each file is reviewed independently.
- Score formula is a heuristic; may not reflect actual risk distribution.

## Status

Accepted. Implemented in `src/sea/review/`.
