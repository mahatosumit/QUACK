import { type JsonObject } from "../engine/types.js";
import { type FileInfo, type SymbolInfo, type Patch, type TestRunResult, type Language } from "../intelligence/types.js";

// ------------------------------------------------------------------
// Understanding Types
// ------------------------------------------------------------------

export interface RepositorySummary {
  readonly root: string;
  readonly name: string;
  readonly languages: readonly string[];
  readonly fileCount: number;
  readonly lineCount: number;
  readonly packages: readonly string[];
  readonly buildSystems: readonly string[];
  readonly testFrameworks: readonly string[];
  readonly entryPoints: readonly string[];
  readonly architectureLayers: readonly ArchitectureLayer[];
  readonly modules: readonly string[];
}

export interface ArchitectureLayer {
  readonly name: string;
  readonly path: string;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly files: readonly string[];
  readonly layer: "presentation" | "application" | "domain" | "infrastructure" | "unknown";
}

export interface WorkspaceHealth {
  readonly score: number;
  readonly totalFiles: number;
  readonly totalSymbols: number;
  readonly indexed: boolean;
  readonly staleIndex: boolean;
  readonly buildErrors: readonly string[];
  readonly lintErrors: readonly string[];
  readonly testFailures: number;
  readonly uncoveredFiles: readonly string[];
  readonly recommendations: readonly string[];
}

// ------------------------------------------------------------------
// Navigation Types
// ------------------------------------------------------------------

export interface DefinitionResult {
  readonly symbol: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly context: string;
}

export interface ReferenceResult {
  readonly symbol: string;
  readonly references: readonly { file: string; line: number; column: number; context: string }[];
  readonly totalCount: number;
}

export interface CallHierarchy {
  readonly symbol: string;
  readonly callers: readonly CallHierarchyEntry[];
  readonly callees: readonly CallHierarchyEntry[];
}

export interface CallHierarchyEntry {
  readonly symbol: string;
  readonly file: string;
  readonly line: number;
  readonly kind: string;
}

export interface CrossFileImpact {
  readonly symbol: string;
  readonly file: string;
  readonly directDependents: readonly string[];
  readonly transitiveDependents: readonly string[];
  readonly totalImpact: number;
  readonly riskLevel: "low" | "medium" | "high" | "critical";
}

// ------------------------------------------------------------------
// Editing Types
// ------------------------------------------------------------------

export interface EditOperation {
  readonly path: string;
  readonly originalContent: string;
  readonly newContent: string;
  readonly description: string;
}

export interface EditingPlan {
  readonly goal: string;
  readonly operations: readonly EditOperation[];
  readonly affectedFiles: readonly string[];
  readonly riskAssessment: "low" | "medium" | "high" | "critical";
  readonly requiresReview: boolean;
  readonly requiredPermissions: readonly string[];
}

export interface EditingResult {
  readonly patch: Patch;
  readonly validationResults: readonly ValidationOutcome[];
  readonly applied: boolean;
  readonly rollbackAvailable: boolean;
  readonly summary: string;
}

export interface ValidationOutcome {
  readonly type: "typecheck" | "lint" | "test" | "security" | "architecture";
  readonly passed: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly durationMs: number;
}

// ------------------------------------------------------------------
// Review Types
// ------------------------------------------------------------------

export type ReviewSeverity = "critical" | "high" | "medium" | "low" | "info";

export type ReviewCategory =
  | "architecture"
  | "security"
  | "performance"
  | "correctness"
  | "style"
  | "testing"
  | "documentation"
  | "maintainability"
  | "naming"
  | "complexity"
  | "readability";

export interface ReviewFinding {
  readonly id: string;
  readonly category: ReviewCategory;
  readonly severity: ReviewSeverity;
  readonly file: string;
  readonly line?: number;
  readonly message: string;
  readonly explanation: string;
  readonly suggestion?: string;
  readonly code?: string;
}

export interface ReviewReport {
  readonly target: string;
  readonly findings: readonly ReviewFinding[];
  readonly summary: {
    readonly total: number;
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly info: number;
  };
  readonly score: number;
  readonly passed: boolean;
  readonly recommendations: readonly string[];
}

// ------------------------------------------------------------------
// Test Intelligence Types
// ------------------------------------------------------------------

export interface TestSelection {
  readonly allTests: readonly string[];
  readonly affectedTests: readonly string[];
  readonly selectedForRun: readonly string[];
  readonly selectionStrategy: "all" | "affected" | "smart";
  readonly estimatedRunTimeMs: number;
}

export interface TestFailureAnalysis {
  readonly testFile: string;
  readonly testName: string;
  readonly error: string;
  readonly stackTrace?: string;
  readonly likelyCause: string;
  readonly suggestedFix?: string;
  readonly confidence: number;
  readonly relatedFiles?: readonly string[];
}

// ------------------------------------------------------------------
// Reporting Types
// ------------------------------------------------------------------

export type ReportType =
  | "architecture"
  | "dependencies"
  | "workspace-health"
  | "technical-debt"
  | "performance"
  | "security"
  | "test"
  | "build"
  | "refactoring";

export interface EngineeringReport {
  readonly type: ReportType;
  readonly title: string;
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly sections: readonly ReportSection[];
  readonly summary: string;
  readonly recommendations: readonly string[];
}

export interface ReportSection {
  readonly title: string;
  readonly content: string;
  readonly severity?: "info" | "warning" | "error";
  readonly metrics?: Record<string, number>;
}

// ------------------------------------------------------------------
// SEA Memory Types
// ------------------------------------------------------------------

export interface SeaMemoryEntry {
  readonly key: string;
  readonly type: SeaMemoryType;
  readonly data: JsonObject;
  readonly timestamp: string;
  readonly ttlMs: number;
}

export type SeaMemoryType =
  | "repository-summary"
  | "architecture-summary"
  | "common-fix"
  | "frequently-edited-file"
  | "failure-history"
  | "successful-repair"
  | "developer-preference"
  | "workspace-pattern";

export interface LearningRecord {
  readonly pattern: string;
  readonly context: string;
  readonly fix: string;
  readonly occurrences: number;
  readonly lastApplied: string;
  readonly successRate: number;
}

// ------------------------------------------------------------------
// SEA Config
// ------------------------------------------------------------------

export interface SeaConfig {
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly maxParallelNodes: number;
  readonly defaultTimeoutMs: number;
  readonly maxRetries: number;
  readonly reviewThreshold: number;
  readonly autoTest: boolean;
  readonly autoReview: boolean;
  readonly autoDocument: boolean;
  readonly maxIndexFiles: number;
}

// ------------------------------------------------------------------
// SEA Event Types
// ------------------------------------------------------------------

export type SeaEventType =
  | "sea.started"
  | "sea.completed"
  | "sea.failed"
  | "sea.understanding"
  | "sea.editing"
  | "sea.reviewing"
  | "sea.testing"
  | "sea.reporting";
