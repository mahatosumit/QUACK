# ADR 0005: Semantic Intelligence Layer

Status: Accepted

## Context

Phase 2 established the provider layer, ExecutiveBrain, and runtime lifecycle. The Brain could plan, execute, and reflect, but it had no structured understanding of the workspace — no knowledge of file structure, symbols, imports, dependencies, tests, or git history. Planning was based on the task goal alone, without awareness of what code existed, how it was organized, or what tools were available.

Without semantic understanding, the Brain cannot:
- Find relevant files or symbols for a given task.
- Understand module structure and dependencies.
- Generate safe, targeted code patches.
- Validate changes before applying them.
- Incrementally update its understanding of the workspace.
- Provide rich context for provider-backed planning.

## Decision

Introduce a **Semantic Intelligence Layer** — a facade (`SemanticLayer`) that composes nine submodules providing workspace understanding, search, patching, validation, and context retrieval. The ExecutiveBrain receives an optional reference to this facade and uses it to enrich planning context.

### Architecture

```
SemanticLayer (facade)
├── WorkspaceIndexer        — Full and incremental file indexing
├── SymbolDatabase          — Symbol storage with fuzzy search
├── DependencyGraph         — Import/dependency graph analysis
├── SemanticSearch          — Text, regex, symbol, file, reference, hybrid search
├── PatchEngine             — Code patch generation, application, rollback
├── ValidationPipeline      — TypeScript type checking and linting
├── TestRunner              — Test discovery and execution (multi-framework)
├── GitIntegration          — Status, diff, log, blame, stage, commit
├── ContextRetriever        — Brain context gathering for planning
├── WorkspaceMemory         — Persistent key-value cache with TTL
└── LspManager              — Language server protocol integration (CLI fallback)
```

### Key Decisions

1. **Regex-based symbol extraction** (not AST parsing). The MVP uses language-specific regex patterns for `typescript`, `javascript`, `python`, `rust`, and `go`. Full parser-based extraction is deferred to Phase 3.

2. **Incremental indexing**. `WorkspaceIndexer.incrementalIndex()` re-indexes only changed files using timestamp staleness checks. Full rescan is available via `fullIndex()`.

3. **Patch engine as the sole write path**. ExecutiveBrain must route all file modifications through `PatchEngine` → `ValidationPipeline` → apply. Patches are backed up in `.quack/patches/` for rollback.

4. **No embedding provider for semantic search**. Current `semanticSearch()` uses word-overlap scoring. Full vector embedding requires an embedding provider.

5. **No stdio LSP protocol**. `LspManager` uses CLI-based synchronous commands and regex-based fallbacks. Full WebSocket/stdio LSP is deferred to Phase 3.

6. **TestRunner detects frameworks from file names/content** (not config). Supports `node:test`, `vitest`, `jest`, `pytest`, `cargo-test`, `go-test`.

7. **WorkspaceMemory persists to `.quack/` JSON files**. Workspace metadata, symbol index, error history, task history, and index state survive restarts.

### Wiring

- `SemanticLayer` is created in `create-system.ts` alongside the other core components.
- It is added to the `QuackSystem` interface and injected into `ExecutiveBrain` via its constructor dependencies.
- `ExecutiveBrain.plan()` uses `SemanticLayer.retrieveContext()` to enrich provider prompts with workspace context (files, symbols, metadata).
- The runtime's existing tools (workspace filesystem, code search, git status) continue to work independently; the Semantic Layer provides a higher-level API for the Brain.

## Consequences

- ExecutiveBrain planning now has workspace context: file count, languages, relevant files, and symbol information.
- All code modifications go through the patch engine, enabling validation, rollback, and audit.
- 62 new tests (80 total) cover all submodules.
- The architecture is modular: each submodule can be replaced independently (e.g., LSP manager for full protocol support, or regex extraction for AST parsers).
- The facade pattern keeps the ExecutiveBrain interface clean — it depends on one facade, not nine submodules.

## Next Steps

- Add embedding provider for vector-based semantic search.
- Implement full stdio LSP protocol in LspManager.
- Add AST-based symbol extraction (TypeScript compiler API, tree-sitter).
- Explore persistent KnowledgeGraphStore (JSON file or SQLite backend).
- Add support for more languages and build systems.
