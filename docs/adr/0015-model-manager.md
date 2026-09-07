# ADR 0015: Model Manager Architecture

Status: Accepted

## Context

QUACK needs a **Model Manager** that tracks available LLM models across providers, their capabilities, latency, cost, and health status. The manager must support routing policies so users can switch models without changing code.

## Decision

### Model Registry

Every model is a `ModelInfo` record:

```typescript
interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: ModelCapability[];  // "reasoning" | "coding" | "fast" | etc.
  contextWindow: number;
  supportsTools: boolean;
  latencyMs: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  status: "available" | "unavailable" | "error";
}
```

The `ModelRegistry` class manages the catalog with methods for:
- `register(info)` — add a new model
- `get(id)` — retrieve by ID
- `getAll()` — list all models
- `findByCapability(cap)` — filter by capability
- `findByProvider(provider)` — filter by provider
- `updateStatus(id, status)` — health monitoring

### Model Router

The `ModelRouter` selects the best model for a given goal based on routing policy:

| Policy | Strategy |
|--------|----------|
| `cost-first` | Sum of input+output cost, pick cheapest |
| `fastest-first` | Lowest latencyMs |
| `capability-first` | Most capabilities |
| `local-first` | Prefer local provider, fallback to first available |
| `balanced` | Composite score: capabilities + availability - latency penalty - cost penalty |

### Cost Estimation

```typescript
estimateCost(model, inputTokens, outputTokens): CostEstimate
```

Computes `(inputTokens/1000) * costPer1kInput + (outputTokens/1000) * costPer1kOutput`.

### Model Comparison

The `compare()` method produces a `ModelComparison` with fastest, cheapest, and most capable models for quick A/B decisions.

## Consequences

**Positive:**
- Model selection is policy-driven and decoupled from code.
- Users can switch models by changing policy, not code.
- Cost estimation enables budget-aware skill orchestration.
- Health tracking enables automatic failover.

**Negative:**
- Provider auto-discovery is not implemented — models must be registered manually.
- No automatic latency/cost baselines — values are static.
- No model capability probing — capabilities are declared statically.

## Status

Accepted. Implemented in `src/models/`.
