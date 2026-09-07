# QUACK Implementation Roadmap

## Milestone 1: Core Runtime

Status: Complete.

Delivered:
- Runtime task lifecycle.
- Event bus.
- Brain interface.
- Tool registry.
- Provider registry.
- Permission policy interface.
- In-memory memory store.
- JSON-file task persistence.
- JSONL audit logging.
- Runtime configuration.
- Workspace file list/read tools.
- CLI smoke path.
- Runtime tests.
- Cancellation support (planned).
- Durable memory storage.

## Milestone 2: Provider Layer + ExecutiveBrain

Status: Complete.

Delivered:
- OpenAI-compatible provider adapter (native fetch, no SDK dep).
- ExecutiveBrain wired as production Brain with provider-backed plan/reason/reflect.
- All orphaned tools registered: code search, workspace write, terminal, git status.
- Durable JsonFileMemoryStore.
- 18 passing tests covering knowledge graph, memory persistence, SimpleBrain, runtime.
- ADR 0004 documenting the provider layer architecture.

Remaining:
- Provider capability matrix (currently hardcoded in discover()).
- Provider health checks wired into the runtime.
- Routing policy for multi-provider orchestration.
- Structured generation contract (currently JSON-over-text).

## Milestone 2.5: Semantic Intelligence Layer

Status: Complete.

Delivered:
- SemanticLayer facade composing 9 submodules.
- Workspace indexer (full and incremental).
- Symbol database with fuzzy search.
- Dependency graph with circular detection, BFS path finding.
- Multi-mode search (text, regex, symbol, file, reference, hybrid).
- Patch engine with backup, rollback, and validator support.
- Validation pipeline (typecheck + lint).
- Test runner with auto-discovery (multi-framework).
- Git integration (status, diff, log, blame, stage, commit).
- Context retriever for ExecutiveBrain planning enrichment.
- Persistent workspace memory (JSON cache with TTL).
- LSP manager with CLI fallbacks.
- 62 new tests (80 total).
- ADR 0005 documenting the architecture.
- Wired into create-system.ts and ExecutiveBrain.

## Milestone 2.8: Engine Workflow Runtime

Status: Complete.

Delivered:
- Task Graph DAG (TaskGraphBuilder + TaskGraphExecutor with state machine).
- Planner (goal decomposition into 7-phase pipeline DAG, risk/cost estimation).
- Workflow Engine (start/pause/resume/cancel, node-level timeout enforcement, automatic checkpointing).
- Scheduler (priority queue, parallel execution limit, throughput tracking).
- Reflection Engine (post-execution analysis, retry/escalation decisions, confidence scoring).
- Recovery Engine (backoff strategies, failure classification, recovery plans).
- Checkpoint System (save/load/list/delete/prune, periodic checkpointing).
- Execution Journal (append-only event store, query/replay/stats).
- Cost & Provider Optimizer (capability profiles, 5 routing policies).
- Session Runtime (session lifecycle, snapshot/undo/redo).
- Engine facade (index.ts with re-exports).
- EventBus extended with 27 new event types (workflow.*, node.*, reflect.*, recovery.*, checkpoint.*, session.*).
- ExecutiveBrain rewritten as orchestration layer (delegates to engine subsystems).
- 46 new tests (126 total, 100% green).
- ADRs 0006-0009 documenting architecture decisions.

Remaining:
- Embedding provider for vector-based semantic search.
- Full stdio LSP protocol.
- AST-based symbol extraction.
- Persistent KnowledgeGraphStore backend.

## Milestone 3: Coding Agent

Goal: implement the first intelligent application — an autonomous software engineering agent.

Deliverables:
- Plan-edit-test-review loop (the agent's core workflow, now powered by the Semantic Layer).
- Session history with step-level traceability.
- Diff review and summary generation.
- Regression test generation.

## Milestone 4: Desktop And CLI Integration

Goal: provide shared-backend user interfaces.

Deliverables:
- CLI connected to the runtime.
- Desktop shell connected to the same backend.
- Integrated chat.
- Terminal panel.
- Workspace explorer.
- Git panel.
- Logs view.
- Settings.
- Provider manager.
- Model manager.

## Milestone 5: Plugin System

Goal: make tools, agents, providers, prompts, and UI extensions installable without core changes.

Deliverables:
- Plugin manifest schema and loader.
- Plugin registry with compatibility checks.
- Permission declaration and approval.
- Tool, agent, and provider plugin registration.
- Version compatibility checks and audit logs.

## Milestone 6: Memory And Knowledge Graph

Goal: add durable, inspectable intelligence context.

Deliverables:
- Conversation memory.
- Working memory.
- Long-term memory.
- Workspace memory.
- Project memory.
- Vector search.
- Semantic search.
- Knowledge graph ingestion.
- Memory import and export.
- Memory editing.
- Compression and summarization.

## Milestone 7: Advanced Agents And Automation

Goal: support multiple cooperating agents and background work.

Deliverables:
- Agent manager.
- Agent-to-agent communication through Event Bus.
- Background task queue.
- Scheduled tasks.
- Research agent.
- Reviewer agent.
- Tester agent.
- DevOps agent.
- Prompt library.
- Workflow templates.

## Milestone 8: Packaging, Distribution, And Updates

Goal: make QUACK installable and maintainable for real users.

Deliverables:
- Windows installer and portable executable.
- Linux AppImage, deb, and rpm packages.
- Automatic updates.
- Crash reporting.
- Migration system.
- Release checklist.

## Continuous Workstreams

Run across all phases:
- Security hardening.
- Performance benchmarking.
- Accessibility.
- Documentation.
- Reference ecosystem review.
- Test coverage.
- Developer experience.
- ADR maintenance.
- Changelog maintenance.
