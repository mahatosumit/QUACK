# QUACK Architecture Book

**Version:** 1.0.0-rc.1
**Date:** 2026-07-04
**Status:** Final

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Overview](#2-system-overview)
3. [Core Layer](#3-core-layer)
4. [Runtime Layer](#4-runtime-layer)
5. [Intelligence Layer](#5-intelligence-layer)
6. [Execution Engine](#6-execution-engine)
7. [Software Engineering Agent](#7-software-engineering-agent)
8. [Multi-Agent Organization](#8-multi-agent-organization)
9. [Cognitive Operating System](#9-cognitive-operating-system)
10. [Universal Computer Use](#10-universal-computer-use)
11. [AI Runtime Manager](#11-ai-runtime-manager)
12. [Distributed Native Platform](#12-distributed-native-platform)
13. [Desktop & API Layer](#13-desktop--api-layer)
14. [Security Model](#14-security-model)
15. [Architecture Decision Records](#15-architecture-decision-records)
16. [Glossary](#16-glossary)

---

## 1. Introduction

QUACK (Quantum Unified Autonomous Cognitive Kernel) is a provider-independent AI Operating System built as a modular TypeScript application. It orchestrates AI workloads across 27 capabilities, manages multi-agent organizations, executes distributed computations, and provides a full desktop platform with CLI, HTTP API, and GUI interfaces.

### Design Philosophy

- **Provider Independence**: Core modules never import provider SDKs directly.
- **Capability-Based Routing**: AI execution selects models by capability scores, not provider names.
- **Factory Pattern**: Every subsystem exposes a `create*()` factory function.
- **Event-Driven**: All state changes flow through a centralized typed event bus.
- **Observability**: Every action is recorded in an append-only audit log.
- **Security by Default**: All sensitive operations go through permission policies.

### Version

Current version: 1.0.0-rc.1 (Release Candidate 1)

### Module Count

- 19+ modules
- 184+ source files
- 742+ passing tests
- 22 Architecture Decision Records

---

## 2. System Overview

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Executive Brain                         │
│                  (Orchestration Layer)                       │
├─────────────────────────────────────────────────────────────┤
│   ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐ │
│   │   COS    │  │   AIRM   │  │      Organization        │ │
│   │Cognitive │  │   AI     │  │    18 Specialized        │ │
│   │    OS    │  │ Runtime  │  │      Agents              │ │
│   └──────────┘  └──────────┘  └──────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│   ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐ │
│   │   SEA    │  │   UCP    │  │         Engine           │ │
│   │ Software │  │ Computer │  │   Workflow Scheduling    │ │
│   │ Engineer │  │   Use    │  │   DAG Execution          │ │
│   └──────────┘  └──────────┘  └──────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│   ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐ │
│   │   DNPL   │  │  Plugins  │  │         Skills          │ │
│   │  Native  │  │    &     │  │    Registry &           │ │
│   │ Platform │  │Marketplace│  │      Execution          │ │
│   └──────────┘  └──────────┘  └──────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│              Workspace / Memory / Knowledge Graph            │
├─────────────────────────────────────────────────────────────┤
│                   Core / Events / Runtime                    │
└─────────────────────────────────────────────────────────────┘
```

### Layered Architecture

QUACK follows a strict layered architecture:

1. **Core Layer** — Types, event bus, config, utilities
2. **Runtime Layer** — Task lifecycle, execution, storage
3. **Intelligence Layer** — Semantic analysis, search, validation
4. **Engine Layer** — DAG planning, scheduling, recovery
5. **Agent Layer** — Multi-agent organization, communication
6. **System Layer** — COS, Executive Brain, orchestration
7. **Platform Layer** — Desktop, distributed runtime, native services
8. **AI Layer** — Model management, routing, caching, GPU
9. **Extension Layer** — Plugins, skills, providers

### Dependency Rule

Modules may only depend on modules in the same or lower layers. Core modules never import from higher layers. This prevents circular dependencies and ensures testability.

---

## 3. Core Layer

### Types (`src/core/types.ts`)

Foundation types used by every module:

- `JsonPrimitive`, `JsonValue`, `JsonObject` — JSON-compatible type hierarchy
- `IsoTimestamp` — ISO-8601 timestamp string brand type
- `QuackError` — Typed error with code, message, details
- `QuackResult<T>` — Discriminated union (`{ success: true, data: T } | { success: false, error: QuackError }`)
- `now(): IsoTimestamp` — Current time as ISO-8601
- `createId(prefix?: string): string` — Unique ID generation
- `ok<T>(data: T): QuackResult<T>` — Success result constructor
- `fail(error: string | QuackError): QuackResult<never>` — Error result constructor

### Event Bus (`src/events/event-bus.ts`)

Central publish-subscribe system:

- `QuackEventType` — Union of all event type strings
- `QuackEvent` — Typed event with type, timestamp, optional taskId/data
- `EventHandler` — Callback type for event handlers
- `EventBus` — Core class with:
  - `on(type, handler)` — Subscribe to specific event type
  - `onAny(handler)` — Subscribe to all events
  - `off(type, handler)` — Unsubscribe
  - `emit(event)` — Publish event
  - `offAny(handler)` — Unsubscribe from all

### Config (`src/config/config.ts`)

- `QuackConfig` — Runtime configuration interface
- `createDefaultConfig(options?)` — Factory with merge behavior
- Defaults: `workspaceRoot` = cwd, `dataDir` = `./.quack`

### Utilities (`src/core/utils.ts`)

- `isMissingFile(error)` — Type guard for ENOENT errors, shared across 3 storage modules

---

## 4. Runtime Layer

### Task (`src/runtime/task.ts`)

- `TaskStatus` — Lifecycle states: pending, running, paused, completed, failed, cancelled
- `Task` — Task entity with id, goal, steps, status, timestamps, results
- `TaskStep` — Individual step within a task

### QuackRuntime (`src/runtime/runtime.ts`)

Core runtime orchestrator:

- `submitGoal(goal, actor)` — Entry point for goal execution
- Uses a Brain to decompose goals into plans
- Routes through permission policies for sensitive actions
- Emits lifecycle events for all state transitions
- Integrates with ToolRegistry for tool execution

### Task Store (`src/storage/task-store.ts`)

- `InMemoryTaskStore` — Volatile in-memory storage
- `JsonFileTaskStore` — Persistent JSON file storage
- Shared `isMissingFile()` utility for ENOENT handling

---

## 5. Intelligence Layer

### Semantic Layer (`src/intelligence/semantic-layer.ts`)

Composite facade for code understanding:

- Workspace indexing (file scanning, language detection)
- Symbol database (definitions, references)
- Dependency graph (import relationships, circular detection)
- Semantic search (text, regex, filename)
- LSP integration (definitions, references, hover, diagnostics)
- Git integration (status, diffs, history)

### Context (`src/intelligence/context/`)

- `ContextRetriever` — Gathers workspace context for a goal
- `WorkspaceMemory` — Key-value store with TTL and persistence

### Repository (`src/intelligence/repository/`)

- `DependencyGraph` — Import dependency analysis with circular detection
- `RepositoryGraph` — File-level repository structure

### Search (`src/intelligence/search/`)

- `SemanticSearch` — Multi-mode search (text, regex, filename, language filter)

### Symbols (`src/intelligence/symbols/`)

- `SymbolDatabase` — Symbol definitions with fuzzy search

### Validation (`src/intelligence/validation/`)

- `ValidationPipeline` — Composite typecheck + lint pipeline
- `TestRunner` — Test discovery and execution

### Patch (`src/intelligence/patch/`)

- `PatchEngine` — Diff generation, application, and rollback

---

## 6. Execution Engine

### Types (`src/engine/types.ts`)

Comprehensive type system for workflow execution:

- `TaskNodeStatus` — 9 states: pending, ready, running, completed, failed, skipped, retrying, paused, cancelled
- `TaskNodePriority` — 4 levels: critical, high, medium, low
- `WorkflowStatus` — 7 states
- `ReflectionVerdict` — 5 verdicts
- `RecoveryAction` — 6 recovery strategies

### Planner (`src/engine/planner.ts`)

Decomposes natural-language goals into DAGs:

- Phase-based decomposition (analyze → context → plan → execute → validate → test → verify)
- Risk estimation based on node count, critical nodes, dependency depth
- Cost estimation for token usage
- Permission requirement identification

### Task Graph (`src/engine/task-graph.ts`)

- `TaskGraphBuilder` — Fluent DAG construction
- `TaskGraphExecutor` — State management for graph execution
- Critical path analysis

### Workflow Engine (`src/engine/workflow-engine.ts`)

DAG execution orchestrator:

- Event loop polling for ready nodes
- Configurable parallel execution
- Checkpointing at intervals
- Timeout detection
- Post-node reflection
- Failure recovery with backoff
- Pause/resume/cancel lifecycle
- Journaling

### Scheduler (`src/engine/scheduler.ts`)

- Priority queue with parallel limit
- Stats tracking (wait times, throughput)

### Reflection Engine (`src/engine/reflection-engine.ts`)

- Success/failure evaluation
- Verdict determination
- Confidence scoring
- Memory update generation

### Recovery Engine (`src/engine/recovery-engine.ts`)

- 4 backoff strategies: fixed, linear, exponential, jitter
- Failure classification: transient, permanent, unknown
- Escalation on max retries exceeded

### Session Runtime (`src/engine/session-runtime.ts`)

- Multi-session management
- Undo/redo via snapshot stack
- Per-session journal and checkpoint stores

---

## 7. Software Engineering Agent

### SEA Architecture

The SEA is a standalone module at `src/sea/` with 15 files and 100% test coverage.

### Editing (`src/sea/editing/`)

- `EditingWorkflow` — Plan → edit → validate → review cycle
- `IncrementalEditor` — Safe incremental edits with diff generation
- `RefactoringEngine` — Symbol rename, method extraction

### Memory (`src/sea/memory/`)

- `SeaMemory` — Agent-specific memory with TTL
- `LearningStore` — Failure recording and repair pattern discovery

### Navigation (`src/sea/navigation/`)

- `CrossFileAnalyzer` — Impact analysis across files
- `DependencyAnalyzer` — Module dependency checking
- `SemanticNavigator` — Symbol definition/reference resolution

### Review (`src/sea/review/`)

- `ReviewSystem` — Multi-reviewer orchestration
- 5 specialized reviewers:
  - ArchitectureReviewer — File size, nesting depth, god objects
  - CorrectnessReviewer — Loose equality, empty catches, async patterns
  - PerformanceReviewer — Chained operations, nested loops, clone patterns
  - SecurityReviewer — eval, innerHTML, shell exec, hardcoded secrets
  - StyleReviewer — Line length, trailing whitespace, EOF newline

### Testing (`src/sea/testing/`)

- `TestAnalyzer` — Failure analysis with likely cause detection
- `TestIntelligence` — Test selection and execution

### Understanding (`src/sea/understanding/`)

- `ArchitectureAnalyzer` — Layer detection from file paths
- `RepositoryUnderstanding` — Language/file/line counts
- `WorkspaceAwareness` — Health scoring for workspace state

---

## 8. Multi-Agent Organization

### Architecture

```
AgentLifecycleManager
  ├── AgentRegistry (catalog, status, health)
  ├── AgentCommunicationBus (messages, voting, negotiation)
  ├── OrganizationalMemory (shared knowledge)
  ├── AgentMetricsCollector (telemetry)
  └── 18 specialized agents
```

### 18 Agent Roles

| Role | Purpose |
|------|---------|
| executive-brain | Organizational leadership, strategy |
| project-manager | Goal decomposition, task graphs |
| architect | System structure, interfaces, patterns |
| planner | Ordered plans, dependency mapping |
| software-engineer | Implementation, refactoring |
| debugger | Root cause analysis |
| reviewer | Code review |
| tester | Test creation, execution |
| documentation-engineer | API docs, guides, ADRs |
| research-engineer | Technology research |
| security-engineer | Permissions, secrets, supply-chain |
| performance-engineer | Benchmarking, profiling |
| devops-engineer | CI/CD, deployment |
| release-engineer | Versioning, changelogs |
| ui-ux-engineer | Interface design |
| plugin-engineer | Plugin development |
| memory-curator | Memory pruning, consolidation |
| knowledge-engineer | Knowledge graph, entity relationships |

### Communication (`src/organization/communication.ts`)

- `send()` — Point-to-point messaging
- `request()` / `reply()` — Structured Q&A
- `delegate()` / `complete()` — Task handoff
- `broadcast()` — Pub/sub messaging
- `createVote()` / `castVote()` / `tallyVote()` — Democratic consensus
- `createNegotiation()` / `propose()` / `agree()` / `deadlock()` — Multi-party agreement

### Lifecycle (`src/organization/lifecycle.ts`)

- Agent spawn/shutdown/reassign
- Workflow creation and execution
- Health monitoring with error tracking
- Organizational state snapshot

---

## 9. Cognitive Operating System

### Architecture

The COS sits above the organization layer and provides strategic intelligence:

- **GoalManager** — Multi-level goal hierarchy with milestones and lifecycle
- **MissionManager** — Long-term mission planning
- **StrategyEngine** — Strategy generation from goals
- **DecisionEngine** — Decision records with search
- **CouncilEngine** — Expert council assembly with voting
- **PriorityManager** — Priority queue with reordering
- **TimeManager** — Timeline tracking, recurring reviews, time budgets
- **ResourceManager** — Capacity planning and allocation
- **ContextManager** — Context frames and attention stack
- **CapabilityManager** — Agent capability inventories
- **GovernanceEngine** — Policy definition and enforcement
- **ExperienceEngine** — Experience recording and recommendation
- **LearningEngine** — Learning from success/failure with confidence tracking
- **MetricsEngine** — Performance metrics with history tracking
- **ProgressTracker** — Overall progress and at-risk goal detection
- **OrganizationalIntelligence** — Snapshot, knowledge gaps, health summary
- **SkillEvolutionEngine** — Skill version tracking and improvement proposals

---

## 10. Universal Computer Use

### Architecture

UCP enables GUI automation and computer interaction:

- **ComputerRuntime** — Action execution engine with safety policy
- **ComputerPlanner** — Screen observation and plan creation
- **ComputerMemory** — Observation/action/plan recording
- **SessionRecorder** — Recording and replay of sessions
- **MacroEngine** — Custom macro definition and execution
- **ActionValidator** — Safety validation with allow/deny lists
- **VisionRuntime** — OCR, element detection, UI tree
- **NoopProvider** — Simulated provider for testing

### Actions

30+ action types including mouse, keyboard, clipboard, window, browser, and application operations. All actions go through safety validation before execution.

---

## 11. AI Runtime Manager

### Architecture (24 modules)

```
Core Layer:
  AiRuntimeManager — Orchestrator
  CapabilityRegistry — 27 capabilities
  RuntimeRegistry — 3 default runtimes
  ModelRegistry — Auto-discovery + scoring
  ProviderRegistry — Cloud/local providers

Specialized Registries:
  EmbeddingRegistry — Embedding models
  VisionRegistry — Vision models
  SpeechRegistry — Speech models
  RerankerRegistry — Reranker models

Intelligence Layer:
  IntelligenceRouter — 7-dimension scoring
  ProfileManager — 4 runtime profiles
  PipelineManager — Composable pipelines

Execution Layer:
  BenchmarkEngine — 13 benchmark types
  EvaluationEngine — Success/failure tracking
  RuntimeMonitor — Health snapshots
  RuntimeScheduler — Priority task scheduling
  RuntimeLoader — Model/runtime loading

Resource Layer:
  PromptCache — LRU/LFU/FIFO/TTL
  ModelCache — Loaded-model tracking
  GpuScheduler — VRAM allocation
  MemoryManager — RAM/VRAM optimization
  QuantizationManager — 14 quantization types

Infrastructure Layer:
  DownloadManager — Queue-based downloads
  MarketplaceClient — Package discovery
  Dashboard — Cross-module aggregation
```

### Intelligence Router Scoring

| Factor | Weight | Description |
|--------|--------|-------------|
| Capability | 40% | Average capability score |
| Latency | 15% | Inverse of runtime latency |
| Cost | 15% | Local=100%, cloud varies |
| Reliability | 10% | Runtime availability |
| Hardware | 5% | GPU/RAM compatibility |
| Preferences | 5% | Preferred runtimes |
| Historical | 5% | Past benchmark data |

---

## 12. Distributed Native Platform

### Platform Layer (13 modules)

- **PlatformRuntime** — OS/hardware detection
- **HardwareMonitor** — CPU/GPU/disk/memory/network
- **NativeServicesManager** — Process/window/clipboard management
- **DistributedRuntime** — Multi-node cluster management
- **CapabilityNegotiator** — Cross-node capability matching
- **RemoteExecution** — SSH-based remote command execution
- **LocalAiRuntime** — Local model provider detection
- **ContainerRuntime** — Container lifecycle management
- **SecretVault** — Encrypted secret storage
- **Sandbox** — Policy-based execution sandbox
- **PackageManager** — Software package management
- **UpdateSystem** — Update lifecycle and rollback
- **Monitoring** — System monitoring with snapshots

---

## 13. Desktop & API Layer

### Desktop Server (`src/desktop/server.ts`)

80+ REST API endpoints:

- `GET /api/health` — System health
- `GET /api/version` — Version info
- `GET /api/workspace` — Workspace info
- `GET /api/agents/*` — Agent management (7 endpoints)
- `GET /api/organization` — Organization state
- `GET /api/workflows/*` — Workflow management
- `GET /api/cos/*` — COS dashboard (16 endpoints)
- `GET /api/computer/*` — UCP state (7 endpoints)
- `GET /api/platform/*` — Platform info (14 endpoints)
- `GET /api/airm/*` — AIRM dashboard (18 endpoints)

### CLI (`src/cli.ts`)

```
quack <command> [options]

Commands:
  start <goal>   Start QUACK with a goal
  serve          Start desktop HTTP server
  help           Show help
  version        Show version

Options:
  --config, -c    Config file path
  --workspace, -w Workspace root
  --data-dir, -d  Data directory
  --port, -p      Server port
  --headless      Run without GUI
```

---

## 14. Security Model

### Permission System

Two policy implementations:

- **DenyByDefaultPermissionPolicy** — Default-deny security
- **AllowListPermissionPolicy** — Explicit grant list

Permission types include: `workspace.read`, `workspace.write`, `terminal.execute`, `git.read`, `memory.read`, `memory.write`.

### Tool Security

Every tool integrates with the permission system:

| Tool | Permission | Protections |
|------|-----------|-------------|
| ListFiles | workspace.read | Path traversal prevention |
| ReadFile | workspace.read | 128KB size cap, path traversal prevention |
| WriteFile | workspace.write | 5MB cap, overwrite guard |
| CodeSearch | workspace.read | Ignored directory filtering |
| Terminal | terminal.execute | Dangerous pattern detection |
| GitStatus | git.read | Graceful non-git fallback |

### Audit

- Append-only JSONL audit log
- All events recorded with timestamps and task IDs
- Permission denials are logged

### Plugin Sandbox

- Restricted filesystem access
- Plugin capability declarations
- Isolated execution contexts

---

## 15. Architecture Decision Records

22 ADRs document every design decision:

| # | Decision |
|---|----------|
| 0001 | TypeScript runtime skeleton with typed events |
| 0002 | Persistent runtime state (JSON/JSONL files) |
| 0003 | Workspace-scoped filesystem tools |
| 0004 | Provider layer and ExecutiveBrain |
| 0005 | Semantic Intelligence Layer (9 submodules) |
| 0006 | Engine Workflow Runtime (DAG, planner, scheduler) |
| 0007 | ExecutiveBrain as pure orchestration layer |
| 0008 | Task Graph DAG data model |
| 0009 | Scheduler and recovery strategy |
| 0010 | Software Engineering Agent architecture |
| 0011 | Programmatic code review system |
| 0012 | SEA editing workflow |
| 0013 | Skill system architecture |
| 0014 | Plugin platform |
| 0015 | Model manager |
| 0016 | Desktop application |
| 0017 | Workspace manager |
| 0018 | Multi-agent organization |
| 0019 | Cognitive Operating System |
| 0020 | Universal Computer Use Platform |
| 0021 | Distributed Runtime & Native Platform Layer |
| 0022 | AI Runtime Manager & Intelligence Orchestration |

---

## 16. Glossary

| Term | Definition |
|------|------------|
| AIRM | AI Runtime Manager — central AI execution orchestrator |
| COS | Cognitive Operating System — strategic intelligence layer |
| DNPL | Distributed Native Platform Layer — OS/hardware/platform abstraction |
| SEA | Software Engineering Agent — code analysis and editing agent |
| UCP | Universal Computer Use Platform — GUI automation |
| ADR | Architecture Decision Record |
| DAG | Directed Acyclic Graph — workflow representation |
| IsoTimestamp | ISO-8601 formatted timestamp string |
| LSP | Language Server Protocol |
| TTL | Time To Live — cache/memory expiration |
| VRAM | Video RAM — GPU memory |
| QAT | Quantization-Aware Training |
| GGUF | GPT-Generated Unified Format — model file format |
| ESM | ECMAScript Modules — JavaScript module system |
| JSONL | Newline-delimited JSON — log file format |
