import { type JsonObject } from "../core/types.js";

// ------------------------------------------------------------------
// File & Project Types
// ------------------------------------------------------------------

export type Language =
  | "typescript" | "javascript" | "python" | "rust" | "go"
  | "java" | "c" | "cpp" | "csharp" | "ruby" | "php" | "swift"
  | "kotlin" | "scala" | "shell" | "markdown" | "json" | "yaml"
  | "html" | "css" | "sql" | "proto" | "unknown";

export interface FileInfo {
  readonly path: string;
  readonly relativePath: string;
  readonly language: Language;
  readonly size: number;
  readonly lines: number;
  readonly modifiedAt: string;
  readonly isDirectory: boolean;
}

export interface DirectoryNode {
  readonly path: string;
  readonly name: string;
  readonly files: readonly FileInfo[];
  readonly directories: readonly DirectoryNode[];
  readonly totalFiles: number;
  readonly totalLines: number;
}

// ------------------------------------------------------------------
// Symbol Types
// ------------------------------------------------------------------

export type SymbolKind =
  | "module" | "namespace" | "class" | "interface" | "enum"
  | "function" | "method" | "property" | "variable" | "constant"
  | "type" | "parameter" | "decorator" | "event" | "component"
  | "directive" | "pipe" | "service" | "injectable"
  | "struct" | "trait" | "unknown";

export interface SymbolInfo {
  readonly id: string;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly language: Language;
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly parentName?: string;
  readonly parentKind?: SymbolKind;
  readonly visibility?: "public" | "protected" | "private";
  readonly isExported: boolean;
  readonly isAsync: boolean;
  readonly documentation?: string;
  readonly modifiers: readonly string[];
  readonly signature?: string;
  readonly metadata: JsonObject;
}

// ------------------------------------------------------------------
// Dependency Types
// ------------------------------------------------------------------

export type DependencyType =
  | "import" | "require" | "dynamic_import" | "re-export"
  | "type_reference" | "implementation" | "inheritance"
  | "interface_implementation" | "composition";

export interface Dependency {
  readonly sourceFile: string;
  readonly targetFile: string;
  readonly sourceSymbol?: string;
  readonly targetSymbol?: string;
  readonly type: DependencyType;
  readonly line: number;
  readonly isExternal: boolean;
  readonly moduleSpecifier: string;
}

// ------------------------------------------------------------------
// Module / Package Types
// ------------------------------------------------------------------

export interface ModuleInfo {
  readonly name: string;
  readonly path: string;
  readonly files: readonly string[];
  readonly entryPoint?: string;
  readonly exports: readonly string[];
  readonly dependencies: readonly ModuleRef[];
  readonly language: Language;
  readonly type: "application" | "library" | "test" | "tooling" | "unknown";
}

export interface ModuleRef {
  readonly name: string;
  readonly path?: string;
  readonly isExternal: boolean;
}

export interface PackageInfo {
  readonly type: "npm" | "pip" | "cargo" | "go" | "maven" | "nuget" | "unknown";
  readonly name: string;
  readonly version: string;
  readonly dependencies: readonly PackageDependency[];
  readonly entryPoints: readonly string[];
  readonly scripts: Readonly<Record<string, string>>;
}
export interface PackageDependency { readonly name: string; readonly version: string; readonly isDev: boolean; }

// ------------------------------------------------------------------
// Build System Types
// ------------------------------------------------------------------

export type BuildSystem =
  | "tsc" | "vite" | "webpack" | "esbuild" | "rollup" | "parcel"
  | "cargo" | "go" | "maven" | "gradle" | "make" | "cmake"
  | "pip" | "poetry" | "npm" | "yarn" | "pnpm" | "bun" | "unknown";

// ------------------------------------------------------------------
// Test Types
// ------------------------------------------------------------------

export type TestFramework =
  | "node:test" | "vitest" | "jest" | "mocha" | "ava" | "tap"
  | "pytest" | "unittest" | "cargo-test" | "go-test" | "junit"
  | "merged" | "unknown";

export interface TestFile {
  readonly path: string;
  readonly framework: TestFramework;
  readonly tests: readonly TestCase[];
  readonly language: Language;
}

export interface TestCase {
  readonly name: string;
  readonly line: number;
  readonly isAsync: boolean;
  readonly tags: readonly string[];
}

export interface TestRunResult {
  readonly framework: TestFramework;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs: number;
  readonly failures: readonly TestFailure[];
}

export interface TestFailure {
  readonly test: string;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

// ------------------------------------------------------------------
// LSP Types
// ------------------------------------------------------------------

export interface LspCapabilities {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly supportsDefinition: boolean;
  readonly supportsReferences: boolean;
  readonly supportsCompletion: boolean;
  readonly supportsHover: boolean;
  readonly supportsDiagnostics: boolean;
  readonly supportsRename: boolean;
  readonly supportsCodeActions: boolean;
  readonly supportsFormatting: boolean;
  readonly supportsSemanticTokens: boolean;
  readonly supportsCallHierarchy: boolean;
  readonly supportsTypeHierarchy: boolean;
  readonly supportsWorkspaceSymbols: boolean;
  readonly supportsDocumentSymbols: boolean;
  readonly supportsSignatureHelp: boolean;
}

export interface LspLocation {
  readonly uri: string;
  readonly line: number;
  readonly column: number;
}

export interface LspDefinition {
  readonly uri: string;
  readonly line: number;
  readonly column: number;
  readonly range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}

export interface LspReference {
  readonly uri: string;
  readonly line: number;
  readonly column: number;
  readonly context?: string;
}

export interface LspHoverResult {
  readonly contents: string;
  readonly range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}

export interface LspCompletionItem {
  readonly label: string;
  readonly kind: string;
  readonly detail?: string;
  readonly documentation?: string;
}

export interface LspDiagnostic {
  readonly uri: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly severity: "error" | "warning" | "information" | "hint";
  readonly code?: string;
  readonly source?: string;
}

// ------------------------------------------------------------------
// Patch Types
// ------------------------------------------------------------------

export interface Patch {
  readonly id: string;
  readonly description: string;
  readonly files: readonly PatchFile[];
  readonly timestamp: string;
  readonly status: "pending" | "validating" | "valid" | "applied" | "rolled_back" | "failed";
}

export interface PatchFile {
  readonly path: string;
  readonly originalContent: string;
  readonly patchedContent: string;
  readonly hunks: readonly PatchHunk[];
}

export interface PatchHunk {
  readonly startLine: number;
  readonly originalLines: readonly string[];
  readonly patchedLines: readonly string[];
}

export interface PatchValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly compileErrors: readonly string[];
  readonly lintErrors: readonly string[];
  readonly typeErrors: readonly string[];
  readonly testFailures: readonly TestFailure[];
  readonly durationMs: number;
}

// ------------------------------------------------------------------
// Search Types
// ------------------------------------------------------------------

export type SearchMode = "text" | "regex" | "symbol" | "semantic" | "file" | "reference" | "import" | "hybrid";

export interface SearchQuery {
  readonly query: string;
  readonly mode: SearchMode;
  readonly language?: Language;
  readonly path?: string;
  readonly maxResults?: number;
  readonly caseSensitive?: boolean;
}

export interface SearchResult {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly language?: Language;
  readonly context: { before: readonly string[]; after: readonly string[] };
  readonly score: number;
  readonly matchType: "exact" | "fuzzy" | "symbol" | "semantic" | "reference";
}

// ------------------------------------------------------------------
// Workspace Metadata
// ------------------------------------------------------------------

export interface WorkspaceMetadata {
  readonly root: string;
  readonly name: string;
  readonly languages: readonly Language[];
  readonly buildSystems: readonly BuildSystem[];
  readonly testFrameworks: readonly TestFramework[];
  readonly fileCount: number;
  readonly totalLines: number;
  readonly directoryCount: number;
  readonly packageJson?: PackageInfo;
  readonly hasGit: boolean;
  readonly gitBranch?: string;
  readonly lastIndexed: string;
  readonly indexedFileCount: number;
  readonly totalSymbols: number;
  readonly totalDependencies: number;
}
