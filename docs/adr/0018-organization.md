# ADR 0018: Autonomous Engineering Organization

Status: Accepted

## Context

QUACK has completed 5 phases of development: Runtime, ExecutiveBrain, Semantic Intelligence, SEA, Desktop/Skills/Models/Workspace. To evolve from a single intelligent application into a collaborative multi-agent system, an **Agent Organization** layer is required.

The ExecutiveBrain becomes the executive leadership. Specialized agents become autonomous contributors with independent reasoning, planning, memory, tools, and execution history — all collaborating through structured protocols.

## Decision

### Architecture

```
ExecutiveBrain (executive leadership)
  └── AgentLifecycleManager (orchestrator)
        ├── AgentRegistry (catalog of all agents)
        ├── AgentCommunicationBus (messaging, voting, negotiation)
        ├── OrganizationalMemory (shared knowledge)
        ├── AgentMetricsCollector (telemetry)
        └── 18 Specialized Agents
              ├── Project Manager
              ├── Architect
              ├── Planner
              ├── Software Engineer
              ├── Debugger
              ├── Reviewer
              ├── Tester
              ├── Documentation Engineer
              ├── Research Engineer
              ├── Security Engineer
              ├── Performance Engineer
              ├── DevOps Engineer
              ├── Release Engineer
              ├── UI/UX Engineer
              ├── Plugin Engineer
              ├── Memory Curator
              ├── Knowledge Engineer
              └── (Executive Brain - organizational role)
```

### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| `AgentRegistry` | `registry.ts` | Register, find, update agents by role/status |
| `AgentCommunicationBus` | `communication.ts` | Messages, voting, negotiation, subscriptions |
| `OrganizationalMemory` | `memory.ts` | Tagged entries with relevance scoring |
| `AgentMetricsCollector` | `metrics.ts` | Snapshots, throughput, error rate tracking |
| `AgentLifecycleManager` | `lifecycle.ts` | Spawn, assign, reassign, health, workflows |
| `AgentProfile` (16+2) | `profiles.ts` | Role definitions with capabilities |

### Communication Protocol

All agent communication is event-driven through `AgentCommunicationBus`:

| Type | Method | Purpose |
|------|--------|---------|
| Direct message | `send()` | Point-to-point message |
| Request/Reply | `request()` / `reply()` | Structured Q&A |
| Delegation | `delegate()` | Task handoff |
| Broadcast | `broadcast()` | Pub/sub to all |
| Subscribe | `subscribe()` | Receive messages for an agent |
| Voting | `createVote()` / `castVote()` / `tallyVote()` | Consensus on decisions |
| Negotiation | `createNegotiation()` / `propose()` / `agree()` | Multi-agent agreement |

### Agent Lifecycle

```
spawn → register → idle → assignTask → busy → completeTask → idle
                                                   → failTask → idle/reassign
shutdown → remove
```

### Task Management

- Tasks are assigned to the best-fit available agent
- Failed tasks can be reassigned to another agent of the same role
- Workflows define ordered steps with dependencies
- Priorities (critical/high/medium/low) control scheduling

### Organizational Memory

- Tagged memory entries with automatic relevance scoring
- Types: success, failure, pattern, decision, lesson, architecture
- Automatic pruning at 5000 entries (oldest/lowest-relevance first)
- Searchable by content, tag, and type

### Integration

The organization is wired into `create-system.ts` as `QuackSystem.organization` containing:
- `registry` - AgentRegistry
- `comms` - AgentCommunicationBus
- `memory` - OrganizationalMemory
- `metrics` - AgentMetricsCollector
- `manager` - AgentLifecycleManager

On startup, all 18 agents are spawned automatically (status: idle).

### Profiles

Each agent role has a complete `AgentProfile` with:
- Capabilities (3-4 per agent)
- Max concurrent tasks
- Default priority
- Supported task types
- Required memory, tools, and skills
- Approval and delegation preferences

## Consequences

**Positive:**
- Multi-agent collaboration with clear role boundaries.
- Structured communication prevents ad-hoc coupling.
- Organizational memory persists learnings across sessions.
- Voting and negotiation enable democratic decision-making.
- All agents are auto-spawned on startup with no configuration.
- Reassignment and recovery provide resilience.

**Negative:**
- No agent isolation (all run in-process) — future work.
- No persistent agent state across restarts (in-memory only).
- No dynamic agent creation at runtime (spawned at startup).
- Agent implementations are passive (react to assignments, no proactive behavior yet).

## Completion vs Spec

| Requirement | Status | Notes |
|-------------|--------|-------|
| Agent Registry | ✓ | `AgentRegistry` with role/status indexing |
| Agent Discovery | ✓ | `findByRole()`, `findAvailable()`, `findBestFit()` |
| Agent Lifecycle | ✓ | spawn, assign, complete, fail, reassign, shutdown |
| Agent Scheduling | ✓ | Priority-based, findAvailable |
| Agent Health | ✓ | `checkHealth()`, `recoverAgent()`, heartbeat tracking |
| Agent Communication | ✓ | Messages, request/reply, delegation, broadcast |
| Voting | ✓ | Create, cast, tally with tie detection |
| Negotiation | ✓ | Create, propose, agree, deadlock |
| Project Manager | ✓ | Workflow creation, task assignment, progress tracking |
| 16 Specialized Agents | ✓ | All defined with profiles in `profiles.ts` |
| Organizational Memory | ✓ | Tagged entries, relevance scoring, search, pruning |
| Agent Metrics | ✓ | Snapshots, throughput, error rate, comparison |
| Wiring | ✓ | In `create-system.ts` as `QuackSystem.organization` |
| Tests | ✓ | 32 tests for all 5 components |
| ADR | ✓ | This document |

## Phase 6 Recommendations

1. **Agent Implementation Layer** — Give each agent an `execute()` method and wire them to actual skills/tools.
2. **Persistent Organization State** — Save/load agents, workflows, and memory to disk.
3. **Proactive Agents** — Let agents volunteer for tasks based on capability matching.
4. **Agent Isolation** — Run each agent in a separate Worker or process.
5. **Dynamic Agent Creation** — Allow runtime agent spawning via the API/UI.
6. **Desktop UI** — Agent dashboard, organization chart, execution timeline, collaboration feed.
7. **APIs** — Expose agent, organization, workflow, task, skill, knowledge, metrics, and session APIs over HTTP.
8. **Learning System** — Track successful/failed workflows, preferred strategies, cross-session learning.

## Status

Accepted. Implemented in `src/organization/`. 32 tests passing.
