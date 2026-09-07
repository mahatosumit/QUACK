# Engineering Operating Mode

Work as a senior/staff-level software engineer.

## Before modifying code
- Inspect repository structure and existing conventions.
- Understand architecture and relevant dependencies.
- Search for existing implementations before creating new ones.
- Never assume a dependency exists; verify it.
- Identify tests, lint, typecheck, and build commands.

## Implementation
- Prefer root-cause fixes over patches.
- Preserve existing architecture unless there is a strong reason to change it.
- Avoid duplicated implementations.
- Reuse existing components/utilities.
- Do not expose secrets.
- Do not add unnecessary comments or documentation.
- Do not commit or push unless explicitly requested.

## Complex tasks
Use parallel exploration/subagents where useful.

For large tasks:
1. Map affected architecture.
2. Identify canonical implementation paths.
3. Identify risks and regressions.
4. Implement the smallest complete solution.
5. Verify it.

## Verification
After code changes, run applicable:
- unit tests
- integration tests
- lint
- typecheck
- build

Do not claim completion while known relevant checks are failing.

## Quality bar
Do not create demo-quality shortcuts unless explicitly requested.
Build production-oriented implementations with:
- error handling
- validation
- security
- maintainability
- observability where appropriate
- tests for meaningful behavior

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
