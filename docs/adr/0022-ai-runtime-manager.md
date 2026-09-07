# ADR-0022: AI Runtime Manager & Intelligence Orchestration Platform

**Status:** Accepted design; integration incomplete
**Date:** 2026-07-04
**Phase:** 9
**Components:** AI Runtime Manager, Intelligence Router, Capability Registry, Runtime Registry, Model Registry, Embedding Registry, Vision Registry, Speech Registry, Reranker Registry, Provider Registry, Benchmark Engine, Runtime Monitor, Runtime Loader, Runtime Scheduler, Prompt Cache, Model Cache, GPU Scheduler, Memory Manager, Quantization Manager, Download Manager, Marketplace Client, Profile Manager, Pipeline Manager, Evaluation Engine, Dashboard

> Current implementation note: this ADR describes intended consolidation. Production model calls still take multiple paths. Automatic model discovery/loading, pipeline execution, and synthetic benchmark or telemetry results are not evidence of implemented providers; unsupported surfaces fail explicitly until an executor is configured.

## Context

QUACK has grown across eight phases — from a foundation runtime to a distributed native platform. AI workloads are currently scattered across multiple subsystems:

- ExecutiveBrain calls providers directly via ProviderRegistry.
- Computer Use has its own runtime selection.
- Skills use ModelRouter independently.
- Agents dispatch tasks without central intelligence coordination.
- Each subsystem independently selects models, runtimes, and providers.

This creates several problems:

1. **No unified intelligence gateway** — Every subsystem reimplements model selection.
2. **No capability-based routing** — Selection is provider-name-based, not capability-based.
3. **No hardware awareness** — GPU/VRAM/RAM are never considered in routing decisions.
4. **No execution history** — There is no feedback loop to learn from successes and failures.
5. **No benchmark system** — Model quality is assumed, never measured.
6. **No offline awareness** — The system doesn't know which models work without internet.

## Decision

We build the **AI Runtime Manager (AIRM)** — a single, unified intelligence execution layer that every QUACK subsystem must use for all AI workloads.

### Architecture

```
ExecutiveBrain / COS / Skills / Agents / UCP
                    │
                    ▼
         Intelligence Router
                    │
                    ▼
          AI Runtime Manager
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
   Capability    Runtime    Model
    Registry    Registry   Registry
          │         │         │
          └─────────┼─────────┘
                    ▼
           Execution Pipelines
                    │
                    ▼
         Providers / Runtimes
                    │
                    ▼
                Response
```

### Module Architecture (24 modules)

The AIRM consists of 24 modules organized in layers:

**Core Layer:**
- AiRuntimeManager — Orchestrator that wires all modules together.
- CapabilityRegistry — Manages AI capability definitions (reasoning, coding, vision, etc.).
- RuntimeRegistry — Manages runtime info (Ollama, llama.cpp, vLLM, LM Studio, etc.).
- ModelRegistry — Manages model metadata, supports auto-discovery and search.
- ProviderRegistry — Manages cloud/local/hybrid provider info.

**Specialized Registries:**
- EmbeddingRegistry — Embedding models with dimension/similarity tracking.
- VisionRegistry — Vision models with image format/OCR support.
- SpeechRegistry — Speech models with language/realtime support.
- RerankerRegistry — Reranker models with doc limits.

**Intelligence Layer:**
- IntelligenceRouter — Capability-based routing with weighted scoring (capability, latency, cost, reliability, hardware, preferences, history).
- ProfileManager — Runtime profiles (coding, research, offline, general) with preferred capabilities, cost limits, latency targets.
- PipelineManager — Composable multi-step AI pipelines (e.g., plan → reason → review → verify).

**Execution Layer:**
- BenchmarkEngine — Runs benchmarks, collects metrics, enables model comparison.
- EvaluationEngine — Records execution history, computes success rates, ranks models.
- RuntimeMonitor — Health monitoring, snapshot collection, error tracking.
- RuntimeScheduler — Priority-based task scheduling with lifecycle management.
- RuntimeLoader — Model/runtime loading/unloading with auto-load scheduling.

**Resource Layer:**
- PromptCache — LRU/LFU/FIFO/TTL eviction cache for prompts and intermediate results.
- ModelCache — Tracks loaded models, memory usage, LRU eviction.
- GpuScheduler — GPU-aware model allocation, VRAM tracking.
- MemoryManager — RAM/VRAM allocation, optimization recommendations.
- QuantizationManager — Quantization format support, quality/speed scoring, hardware-aware recommendations.

**Infrastructure Layer:**
- DownloadManager — Queue-based downloads with pause/resume/cancel.
- MarketplaceClient — Model/embedding/pipeline/profile marketplace with search, ratings, downloads.
- Dashboard — Real-time data aggregation for GUI consumption.

### Routing Decision Weights

The IntelligenceRouter scores each candidate model using:

| Factor | Weight | Description |
|--------|--------|-------------|
| Capability | 40% | Average score across required capabilities |
| Latency | 15% | Inverse of runtime latency vs max constraint |
| Cost | 15% | Local models score 100%, cloud varies |
| Reliability | 10% | Runtime availability percentage |
| Hardware | 5% | GPU/RAM compatibility score |
| Preferences | 5% | Preferred runtimes/formats/quantizations |
| Historical | 5% | Past reliability from benchmarks |

### Key Design Properties

1. **Single gateway (design goal)** — Not all current AI execution flows through the IntelligenceRouter.
2. **Capability-based** — Routing decisions use capability scores, not provider names.
3. **No hardcoded providers** — Runtime and model registries are fully dynamic.
4. **Hardware-aware** — GPU scheduler, memory manager, and quantization manager inform routing.
5. **Evaluation (design goal)** — Runtime-wide execution recording and measured quality improvement require real executors and evidence; synthetic results are not supported.
6. **Offline-first** — Local models are automatically preferred when offline constraints are set.
7. **Marketplace** — Models, embeddings, pipelines, and profiles can be installed from the marketplace.
8. **Profile-driven** — Runtime profiles encode preferred capabilities, cost limits, and security requirements.

## Consequences

### Positive
- A single unified path remains an integration goal, not an implemented guarantee.
- Routing is based on capability scores, not hardcoded provider names.
- Hardware awareness enables intelligent GPU/VRAM allocation.
- Routing improvement requires actual benchmark/evaluation evidence; no automatic improvement is certified.
- All 24 modules are independently testable and reusable.
- 104 new tests cover all major flows.

### Negative
- No actual model inference — the AIRM manages metadata and routing but doesn't run models.
- Auto-discovery detects mock models — real detection requires platform-specific runtime connectors.
- Dashboard is a data layer — the actual GUI requires a separate frontend implementation.
- Pipeline execution routes steps through the Intelligencerouter but doesn't execute real model calls.

### Neutral
- 104 new tests added (711 total across the project).
- Follows the same factory pattern as COS/UCP/DNPL (`createAIRM()`).
- 18 new Desktop API endpoints for AIRM monitoring.
- All modules use `IsoTimestamp` from `core/types.js` for consistency.

## Files Changed

- `src/airm/types.ts` — All AIRM type definitions (150+ interfaces/types).
- `src/airm/capability-registry.ts` — New
- `src/airm/runtime-registry.ts` — New
- `src/airm/model-registry.ts` — New
- `src/airm/embedding-registry.ts` — New
- `src/airm/vision-registry.ts` — New
- `src/airm/speech-registry.ts` — New
- `src/airm/reranker-registry.ts` — New
- `src/airm/provider-registry.ts` — New
- `src/airm/intelligence-router.ts` — New
- `src/airm/profile-manager.ts` — New
- `src/airm/pipeline-manager.ts` — New
- `src/airm/benchmark-engine.ts` — New
- `src/airm/evaluation-engine.ts` — New
- `src/airm/runtime-monitor.ts` — New
- `src/airm/runtime-scheduler.ts` — New
- `src/airm/runtime-loader.ts` — New
- `src/airm/prompt-cache.ts` — New
- `src/airm/model-cache.ts` — New
- `src/airm/gpu-scheduler.ts` — New
- `src/airm/memory-manager.ts` — New
- `src/airm/quantization-manager.ts` — New
- `src/airm/download-manager.ts` — New
- `src/airm/marketplace-client.ts` — New
- `src/airm/dashboard.ts` — New
- `src/airm/runtime-manager.ts` — New (core orchestrator)
- `src/airm/airm.ts` — New (factory)
- `src/airm/index.ts` — New (barrel exports)
- `src/airm/airm.test.ts` — New (104 tests)
- `src/system/create-system.ts` — Added `airm` to QuackSystem
- `src/desktop/server.ts` — Added 18 AIRM API endpoints
- `src/index.ts` — Added selective AIRM exports

## Test Results

```
711 tests, 0 failures
```

## Phase 10 Recommendations

1. **Real runtime connectors** — Replace mock implementations with actual HTTP/gRPC connections to Ollama, OpenAI, etc.
2. **Dashboard GUI** — Build the AI Runtime Dashboard frontend using the existing Desktop platform.
3. **Provider integration** — Wire existing ProviderRegistry into AIRM's ProviderRegistry for unified credential management.
4. **ExecutiveBrain integration** — Route all ExecutiveBrain model calls through the IntelligenceRouter.
5. **Skill system integration** — Have SkillExecutor use AIRM for model access instead of direct provider calls.
6. **Cross-node model distribution** — Use DNPL's DistributedRuntime to distribute model workloads across cluster nodes.
