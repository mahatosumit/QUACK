# ADR 0019: Cognitive Operating System

Status: Accepted

## Context

QUACK has evolved through 5 phases — Runtime, Brain, SEA, Desktop/Skills/Models, and Agent Organization — into a production-grade multi-agent platform. It can execute tasks, manage agents, and produce results on demand.

However, it remains fundamentally **reactive**. It waits for instructions. It has no persistent memory of goals, no strategic planning, no continuous self-improvement, no decision intelligence, and no organizational learning.

Phase 6 transforms QUACK from an intelligent engineering platform into a persistent **Cognitive Operating System** — a strategic layer that sits above all subsystems, owns goals, strategy, priorities, learning, and continuous improvement.

## Decision

### Architecture

The Cognitive Operating System (COS) is a new top-level subsystem at `src/cos/`. It integrates with the existing ExecutiveBrain, Agent Organization, and Runtime but does not replace them.

```
Desktop / API Layer
     ↓
Cognitive Operating System
  ├── Goal Manager        (persistent goal lifecycle)
  ├── Time Manager        (deadlines, budgets, reminders)
  ├── Resource Manager    (capacity, allocation)
  ├── Priority Manager    (queuing, scoring)
  ├── Decision Engine     (decision records, search)
  ├── Council Engine      (dynamic council assembly, voting)
  ├── Mission Manager     (mission → goals mapping)
  ├── Strategy Engine     (execution plans, risk analysis)
  ├── Experience Engine   (reusable patterns, recommendations)
  ├── Learning Engine     (pattern extraction, confidence tracking)
  ├── Governance Engine   (policies, enforcement)
  ├── Organizational Intelligence (snapshots, health)
  ├── Metrics Engine      (aggregated metrics, trends)
  ├── Progress Tracker    (goal progress, at-risk detection)
  ├── Context Manager     (attention, context frames)
  ├── Capability Manager  (agent capability inventory)
  └── Skill Evolution Engine (versions, self-evaluation)
     ↓
Organization Layer (AgentRegistry, CommBus, LifecycleManager)
     ↓
Runtime / Brain / Skills / Models / Workspace
```

### Subsystem Details

#### Goal Manager
- Persistent goal lifecycle: draft → active → paused → completed/failed/cancelled
- Milestones with completion tracking
- Agent assignment and workflow/skill linking
- Overdue detection and progress recalculation
- Stats: total, active, completed, failed, overdue

#### Time Manager
- Timeline entries per goal
- Recurring review scheduling (daily/weekly/monthly/quarterly)
- Time budgets with allocation tracking
- Reminders with due-date triggering
- Due review detection

#### Resource Manager
- Agent capacity tracking per role
- Allocation recording with estimated duration
- Capacity plans across all roles
- `canAllocate()` pre-checks

#### Priority Manager
- Priority queue with scoring (critical=100, high=60, medium=30, low=10)
- Deadline bonus: <24h = +40, <7d = +20
- Reorder and peek operations

#### Decision Engine
- Full decision lifecycle: pending → made → implemented → reviewed → superseded
- Structured alternatives with pros/cons
- Evidence, tradeoffs, risks tracking
- Free-text search across problem, decision, and tags

#### Council Engine
- Topic-based template matching (architecture, security, strategy, performance, release)
- Automatic participant selection by role
- Evidence collection, alternative generation
- Vote tallying with tie detection (→ deadlocked)

#### Mission Manager
- Mission lifecycle: draft → active → completed/failed
- Goal-to-mission mapping

#### Strategy Engine
- Execution strategy creation from goals (auto-generate task graph)
- Lifecycle: draft → approved → active → completed/superseded
- Risk analysis with mitigation
- Review scheduling

#### Experience Engine
- Categorized experiences (bugfix, refactoring, architecture, optimization, testing, deployment, recovery, pattern)
- Context-aware recommendation scoring (2× per match + relevance + usage bonus)
- Usage tracking and relevance boosting

#### Learning Engine
- Pattern extraction with confidence scoring
- Automatic recording to Organizational Memory
- Confidence boosting on re-application (+0.1 per use, max 1.0)
- High-confidence filtering

#### Governance Engine
- Policies with field-level rules (eq, neq, gt, gte, lt, lte, in, nin, exists, type)
- Scope-based filtering (global, goal, agent, workflow, skill)
- Automatic/manual/audit enforcement modes

#### Organizational Intelligence
- Real-time snapshots of agent utilization, task completion rate, error rate, bottlenecks
- Knowledge gap detection
- Health summary computation (0-100 score with weighted deductions)

#### Metrics Engine
- Full COS metrics snapshot (goals, decisions, experiences, learning, agents, workflows, policies)
- History with 1000-entry circular buffer
- Trend extraction by dimension

#### Progress Tracker
- Overall completion rate
- Per-goal progress with milestone breakdown
- Estimated completion time (extrapolated from progress rate)
- On-track and at-risk classification

#### Context Manager
- Context frame construction (active goals, recent decisions, workload, attention)
- Attention stack management (max 10)

#### Capability Manager
- Per-agent capability inventory building
- Gap analysis (capabilities with low coverage)

#### Skill Evolution Engine
- Version tracking with benchmark and quality scores
- Improvement proposal lifecycle: draft → approved → implemented/rejected
- Self-evaluation report generation (health + proposals)

### Integration

The COS is created via `createCos(deps)` factory and wired into `QuackSystem` as `system.cognitiveSystem`. The Desktop server optionally accepts it for dashboard API endpoints.

```typescript
interface QuackSystem {
  // ...existing subsystems...
  readonly cognitiveSystem: CognitiveOperatingSystem;
}
```

### Persistence

Currently all COS subsystems are in-memory. Future work will add `save()` and `load()` for Goal Manager, Decision Engine, Experience Engine, Learning Engine, and Governance Engine to support restart survival.

## Consequences

**Positive:**
- QUACK now manages persistent goals, not just one-shot tasks.
- Strategic planning produces task graphs, risk analyses, and validation plans automatically.
- Council Engine enables structured multi-agent decision making.
- Experience Engine surfaces relevant prior work during new tasks.
- Learning Engine captures and improves patterns over time.
- Governance Engine enforces policies across goals, agents, and workflows.
- All decisions, experiences, and lessons are recorded and searchable.
- Metrics Engine provides observability into the entire system.
- Self-evaluation proposes improvements without changing production behavior.
- Desktop dashboard provides real-time visibility.

**Negative:**
- No file persistence yet (in-memory only) — goals and decisions will not survive a restart.
- No proactive agent behavior — the COS still requires external triggers.
- Council Engine has only 5 built-in topic templates.
- Governor Engine supports basic condition evaluation but no complex rule chains (AND/OR/NOT).
- Skill Evolution Engine records versions but doesn't automatically run benchmarks.

## Phase 7 Recommendations

1. **File-backed persistence** — `save()`/`load()` for all COS managers using JSON or SQLite.
2. **Proactive COS loop** — Background tick that evaluates goals, schedules reviews, runs self-evaluation, and triggers agent tasks automatically.
3. **Agent isolation** — Run specialized agents in separate workers or processes.
4. **Extended council templates** — User-configurable templates with custom role selection.
5. **Advanced governance** — Rule chains with AND/OR/NOT operators.
6. **Automated skill benchmarking** — CI-integrated benchmark runs with regression detection.
7. **Desktop GUI** — Full COS dashboard with goal timeline, council view, decision explorer, and organization visualization.
8. **Predictive analytics** — Estimate completion dates, detect risks before deadlines.

## Status

Accepted. Implemented in `src/cos/`. 48 tests passing alongside 388 existing tests (436 total, 0 failures). Build is green.
