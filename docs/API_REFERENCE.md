# QUACK API Reference

**Version:** 1.0.0
**Date:** 2026-07-04

## REST API

Base URL: `http://localhost:3157/api`

### Health

`GET /api/health` — System health check
`GET /api/version` — Version information
`GET /api/workspace` — Workspace configuration

### Agents

`GET /api/agents` — List all agents
`GET /api/agents/:id` — Agent details
`GET /api/agents/health` — Agent health summary
`GET /api/agents/bottlenecks` — Bottleneck analysis
`GET /api/organization` — Full organization state
`GET /api/workflows` — All workflows
`GET /api/workflows/:id` — Workflow details

### COS (Cognitive Operating System)

`GET /api/cos/goals` — All goals
`GET /api/cos/goals/active` — Active goals
`GET /api/cos/decisions` — Decision records
`GET /api/cos/councils` — Council sessions
`GET /api/cos/experiences` — Experience records
`GET /api/cos/learning` — Learning records
`GET /api/cos/metrics` — Metrics snapshot
`GET /api/cos/organization` — Org intelligence
`GET /api/cos/policies` — Governance policies
`GET /api/cos/progress` — Progress tracker
`GET /api/cos/proposals` — Skill evolution proposals
`GET /api/cos/missions` — All missions
`GET /api/cos/strategies` — All strategies
`GET /api/cos/capabilities` — Capability inventories
`GET /api/cos/evaluation` — Self-evaluation report
`GET /api/cos/timeline` — Goal timelines
`GET /api/cos/products` — Resource capacity plan

### Platform

`GET /api/platform/info` — Platform detection
`GET /api/platform/hardware` — Hardware info
`GET /api/platform/cluster` — Cluster nodes
`GET /api/platform/tasks` — Distributed tasks
`GET /api/platform/containers` — Containers
`GET /api/platform/ai` — Local AI runtimes
`GET /api/platform/monitoring` — Monitoring
`GET /api/platform/services` — Native services
`GET /api/platform/notifications` — Notifications
`GET /api/platform/secrets` — Secret vault
`GET /api/platform/sandbox` — Sandbox policies
`GET /api/platform/packages` — Packages
`GET /api/platform/capabilities` — Capabilities

### AIRM (AI Runtime Manager)

`GET /api/airm/dashboard` — Full dashboard
`GET /api/airm/models` — Model registry
`GET /api/airm/runtimes` — Runtime registry
`GET /api/airm/capabilities` — Capability registry
`GET /api/airm/pipelines` — Pipeline manager
`GET /api/airm/profiles` — Profile manager
`GET /api/airm/benchmarks` — Benchmark results
`GET /api/airm/evaluations` — Evaluation results
`GET /api/airm/downloads` — Active downloads
`GET /api/airm/marketplace` — Marketplace packages
`GET /api/airm/monitor` — Runtime monitor
`GET /api/airm/embeddings` — Embedding models
`GET /api/airm/vision` — Vision models
`GET /api/airm/speech` — Speech models
`GET /api/airm/rerankers` — Reranker models
`GET /api/airm/gpu` — GPU scheduler
`GET /api/airm/memory` — Memory manager
`GET /api/airm/cache` — Cache stats

### UCP (Universal Computer Use)

`GET /api/computer/state` — Displays/safety/permissions
`GET /api/computer/plan` — Plan history
`GET /api/computer/recordings` — Session recordings
`GET /api/computer/macros` — Registered macros
`GET /api/computer/audit` — Audit log
`GET /api/computer/memory` — Computer memory

## TypeScript API

### Core

```typescript
import { createQuackSystem } from "@quack/os";
import { QuackClient } from "@quack/sdk";

const system = createQuackSystem({ configOverrides: { workspaceRoot: "./my-project" } });
const result = await system.runtime.submitGoal("analyze codebase");
```

### Key Classes

| Class | Module | Description |
|-------|--------|-------------|
| QuackSystem | @quack/os | System composition root |
| QuackRuntime | @quack/os | Goal execution runtime |
| EventBus | @quack/os | Pub/sub event system |
| ExecutiveBrain | @quack/os | Strategic orchestration |
| AiRuntimeManager | @quack/os | AI execution orchestrator |
| AgentLifecycleManager | @quack/os | Multi-agent lifecycle |
| CognitiveOperatingSystem | @quack/os | Strategic intelligence |
| DesktopServer | @quack/os | HTTP API server |
| QuackClient | @quack/sdk | Client SDK |
