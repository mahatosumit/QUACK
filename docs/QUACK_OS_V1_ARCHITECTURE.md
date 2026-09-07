# QUACK OS v1 Architecture

```text
Mission
  -> Agent Router
  -> Specialist Agent
  -> Skill Runtime
  -> Capability Broker
  -> Runtime Executor
  -> Tool System
  -> Verification
  -> Memory OS
  -> Harness Evaluation

Event Bus, Audit, Dashboard, and API observe the full path.
```

## v1 Layers

- Capability Broker: mission-scoped capability grants and active tool enforcement.
- Agent Loop: Observe -> Plan -> Act -> Verify -> Reflect -> Update State.
- Harness: traces, metrics, deterministic replay signatures, and evaluation.
- Skill Runtime: declarative skill manifests, lifecycle gating, sandbox limits, and runtime-only tool access.
- Memory OS: policy-aware persistent memory for mission, knowledge, skill execution, and user preference records.
- Multi Agent Workforce: specialist agent registry and mission router.
- Planning Engine: goal decomposition, task graph generation, dependencies, and execution ordering.
- Production Interfaces: CLI commands and programmatic API.
- Developer Dashboard: mission, agent, skill, capability, trace, failure, and evaluation snapshot.

## Security Model

Skills and agents do not receive direct tool access. Tool execution flows through the runtime executor, which enforces capability decisions and workspace boundaries. Memory access is policy-gated by mission, actor, and capability context.

## Observability

The event bus carries lifecycle events for loops, skills, capabilities, traces, and evaluations. Harness and dashboard components observe these events without controlling execution.
