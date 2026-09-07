# QUACK Design Decisions

This document catalogs significant design decisions that shaped QUACK's architecture. For detailed rationale, see the individual Architecture Decision Records (ADRs) in `docs/adr/`.

## Index

| Decision | ADR | Date | Summary |
|----------|-----|------|---------|
| Runtime Skeleton | 0001 | Phase 1 | Core runtime architecture |
| Persistent State | 0002 | Phase 1 | JSON file-based state persistence |
| Workspace Tools | 0003 | Phase 2 | Filesystem tools for code editing |
| Provider Layer | 0004 | Phase 3 | Abstract provider interface with echo fallback |
| Semantic Layer | 0005 | Phase 3 | Knowledge graph for context |
| Engine/Workflow | 0006 | Phase 4 | DAG-based workflow execution |
| Executive Brain | 0007 | Phase 5 | Central orchestration brain |
| Task Graph DAG | 0008 | Phase 5 | Directed acyclic task graphs |
| Scheduler/Recovery | 0009 | Phase 5 | Retry and recovery strategies |
| SEA Architecture | 0010 | Phase 6 | Software Engineering Agent |
| SEA Review | 0011 | Phase 6 | Autonomous code review |
| SEA Editing | 0012 | Phase 6 | Structured code editing |
| Skill System | 0013 | Phase 7 | Pluggable skill architecture |
| Plugin Platform | 0014 | Phase 7 | Extension plugin system |
| Model Manager | 0015 | Phase 7 | AI model registry and routing |
| Desktop App | 0016 | Phase 8 | Electron desktop shell |
| Workspace Manager | 0017 | Phase 8 | Multi-workspace support |
| Organization | 0018 | Phase 9 | Multi-agent organization |
| COS | 0019 | Phase 9 | Cognitive Operating System |
| UCP | 0020 | Phase 10 | Universal Computer Use |
| DNPL | 0021 | Phase 11 | Distributed Native Platform Layer |
| AIRM | 0022 | Phase 11 | AI Runtime Manager |
| Adaptive Layer | 0023 | Phase 12 | Self-improvement platform |
| Architecture Governance Framework | 0024 | Phase 12 | Continuous Architecture Governance & Quality Pipeline |
| Production Acceptance Framework | 0025 | Phase 12 | Production Acceptance & Continuous Benchmarking Framework |

## Design Principles

1. **Modular architecture:** Each subsystem is independently replaceable
2. **Factory pattern:** `create*()` factories for consistent initialization
3. **Event-driven:** Communication via EventBus, not direct calls
4. **In-memory by default:** No external dependencies required
5. **Progressive enhancement:** Simple defaults, configurable complexity
6. **Testability:** All modules testable with no external services
7. **Backward compatibility:** Public API stability within major versions
8. **Security by design:** Permission checks at every boundary
