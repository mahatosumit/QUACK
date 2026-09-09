# QUACK OS — Product Definition

> QUACK OS is a governed execution environment for AI work.

QUACK turns objectives into **missions**: durable, inspectable, recoverable units
of work that are planned, capability-checked, executed, evidenced, verified, and
closed with a receipt. The unit of progress is not a message — it is a mission.

```
Intent
  ↓
Mission
  ↓
Plan
  ↓
Capabilities
  ↓
Execution
  ↓
Evidence
  ↓
Verification
  ↓
Outcome
  ↓
Receipt
```

## What QUACK is not

- **Not primarily a chat application.** Conversation exists (QUACK Console,
  planned) strictly as a *control interface* over the mission system. The
  Console must never become an independent execution engine.
- **Not an agent wrapper around a single model.** Models are interchangeable
  reasoning engines behind one governance gate (`GovernedModelRuntime`).
- **Not a dashboard bolted onto an LLM.** Every state QUACK shows originates
  from runtime events or durable stores — see
  [PRODUCT_PRINCIPLES.md](PRODUCT_PRINCIPLES.md) (Principle 4).

## Layers

| Layer | Contents | Status |
|---|---|---|
| **QUACK CORE** | Runtime kernel: `QuackRuntime`, `SessionRuntime`, loop driver, workflow engine, scheduler, capability broker, policy/identity/admission, sandbox, workers, tools/skills/MCP, evidence, verification, receipts, recovery | Certified (`main @ 298b6c3`) |
| **QUACK EXPERIENCE** | Studio (Control Room), Mission Control, Mission Detail, QUACK Console (planned), Agent Workspace, Approval Center, Trace Center, Artifact affordances, System Health, Settings | Studio SPA exists; views expand per [ROADMAP.md](ROADMAP.md) |
| **QUACK INTELLIGENCE** | Governed model runtime, model routing/registry, memory/context, reasoning skills | Governed runtime exists; streaming consumer is planned (P4) |
| **QUACK HARNESS** | Scenario execution, evaluation, replay, model comparison, security/regression evaluation | Foundation exists (`QuackNativeHarness`, `MissionEvaluator`); expansion is P5 |
| **QUACK ECOSYSTEM** | Skills, MCP, agents, providers, packages | Skills/MCP certified; ecosystem UX is P10 |
| **QUACK OPERATIONS** | Configuration, diagnostics, backups, observability, updates; automation later | Certified except automation (P8) |

## One runtime, many clients

Every surface — CLI, Studio, Console (planned), SDK, future integrations —
reaches the same kernel through the same composition root:

```
createQuackSystem → QuackRuntime → SessionRuntime → LoopDriver →
WorkflowEngine / ExecutionScheduler → CapabilityBroker →
Policy / Identity / Admission → Sandbox / Worker → Tools / Skills / MCP →
Evidence → Verification → Receipt
```

Surfaces are clients. They submit missions, observe events, and read state.
They do not execute tools, grant capabilities, or call providers directly.

## Related documents

- [PRODUCT_PRINCIPLES.md](PRODUCT_PRINCIPLES.md) — non-negotiable principles
- [MISSION_MODEL.md](MISSION_MODEL.md) — the mission abstraction
- [PRODUCT_SURFACES.md](PRODUCT_SURFACES.md) — surface inventory
- [../contracts/CLIENT_EVENTS.md](../contracts/CLIENT_EVENTS.md) — event contract
- [../contracts/MISSION_API.md](../contracts/MISSION_API.md) — mission API contract
- [DIFFERENTIATION.md](DIFFERENTIATION.md) — product differentiation
- [ORIGINALITY.md](ORIGINALITY.md) — originality policy
- [ROADMAP.md](ROADMAP.md) — phased product roadmap
