# Model Runtime v1.1

The Model Runtime is the production model integration layer for QUACK OS v1.1. It extends the existing `src/models` registry/routing package without replacing the older provider abstractions.

## Components

- `ModelProvider`: common interface for model backends.
- `OllamaModelProvider`: calls Ollama `/api/generate` and `/api/tags`.
- `OpenAICompatibleModelProvider`: calls OpenAI-compatible `/chat/completions` and `/models`.
- `ModelRuntimeRouter`: selects registered models by capability, provider, model, and routing policy.
- `ModelRuntime`: executes generation, tracks latency/token usage, records provider failures, and falls back to another provider when configured.
- `loadModelRuntimeConfig`: loads `config/models.json`.

## Configuration

Default file:

```json
{
  "provider": "ollama",
  "model": "qwen3.6:27b"
}
```

The repository includes `config/models.json` with an Ollama default. Network calls only happen when generation or model discovery is invoked.

## Integration

- Planner metadata records the selected model for a goal.
- Agent Router can attach a model hint to specialist selection.
- Reflection Engine can select a reasoning model for reflection context.
- `createQuackSystem()` exposes `system.modelRuntime`.

## Metrics

Every successful generation returns:

- provider id
- model id
- text
- input/output/total token usage
- latency in milliseconds
- fallback status
- finish reason when available

Provider failures are retained in `ModelRuntime.getFailures()`.
