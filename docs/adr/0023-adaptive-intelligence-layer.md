# ADR 0023: Adaptive Intelligence Layer

**Status:** Accepted design; implementation incomplete  
**Date:** 2026-07-04  
**Phase:** 12  
**Deciders:** Executive Brain, System Architect

---

> Current implementation note: adaptive experiment execution, knowledge distillation, and automatic/random improvement generation are explicitly unsupported without configured executors. The component descriptions and historical test counts below record design intent, not proof that these learning operations execute.

## Context

QUACK needs autonomous self-improvement capability — the ability to experiment with different strategies, learn from failures, evolve prompts/skills/workflows over time, and proactively optimize its own behavior. Prior phases built the execution substrate (Phases 1–9) and production hardening (Phases 10–11), but the system lacks an adaptive feedback loop.

## Decision

Introduce **Phase 12: Adaptive Intelligence Layer** — 15 interconnected subsystems that form a continuous improvement platform:

### 1. Experiment Manager (`experiment-manager.ts`)
- A/B testing and multi-model/prompt/pipeline/agent/skill/workflow comparison
- Weighted variant distribution, metric collection, automated winner determination
- Configurable confidence thresholds and iteration counts

### 2. Prompt Registry (`prompt-registry.ts`)
- Versioned prompt management with content-addressed hashing
- Version scoring against benchmarks, rollback to any prior version
- Parent-chain tracking for provenance

### 3. Skill Evolution Engine (`skill-evolution.ts`)
- Versioned skill definitions with benchmark tracking
- Deprecation management and upgrade recommendation based on pass-rate regression

### 4. Workflow Evolution Engine (`workflow-evolution.ts`)
- Step-level observation (latency, failures, retries, tool calls, routing decisions)
- Automatic recommendation generation (batching, parallelism, caching, dedicated routers)
- Score-based optimization ranking

### 5. Debate Engine (`debate-engine.ts`)
- Structured multi-agent reasoning with for/against/neutral positions
- Vote-based consensus with minority report capture
- Resolution tracking with timestamped decision record

### 6. Scientific Workflow Engine (`scientific-workflow.ts`)
- End-to-end research pipeline: question → literature review → hypothesis → experiment → analysis → validation → report → publication
- Full provenance tracking per phase

### 7. Failure Analysis Engine (`failure-analysis.ts`)
- Auto-classification of failures into 9 categories (reasoning, tool, environment, model, provider, network, user, workspace, unknown)
- Contextual recovery recommendations per category
- Sliding-window failure-rate computation

### 8. Continuous Learning (`continuous-learning.ts`)
- Typed knowledge entries (pattern, lesson, template, workflow, decision, guidance, validation)
- Full-text search with tag filtering
- Usage-based scoring and top-entry retrieval

### 9. Autonomous Improvement Scheduler (`improvement-scheduler.ts`)
- 6 improvement types: prompt, skill, workflow, routing, model, agent
- Full proposal lifecycle: draft → proposed → approved → rejected → applied
- Automated cycle generation with scoring

### 10. Quality Prediction Engine (`quality-prediction.ts`)
- Multi-factor success probability estimation (complexity, model capability, history, input length)
- Risk classification (low/medium/high)
- Self-correcting via outcome-based model updates

### 11. Knowledge Distillation Engine (`knowledge-distillation.ts`)
- Transfer learning between models, agents, skills, workflows, pipelines
- 8 built-in distillation strategies
- Full provenance chain from source to derived artifact

### 12. Decision Replay Engine (`decision-replay.ts`)
- Record every decision with alternatives, rationale, evidence, confidence
- Session-based replay for full decision audit trails

### 13. Experience Mining Engine (`experience-miner.ts`)
- Pattern deduplication and frequency merging
- Context-aware pattern retrieval
- Success-rate tracking per pattern

### 14. Reasoning Archive (`reasoning-archive.ts`)
- Structured reasoning traces with typed steps (observation, inference, hypothesis, verification, conclusion)
- Full-text search across goals, steps, and conclusions

### 15. Model Evaluation Framework (`evaluation-framework.ts`)
- 5-dimensional scoring (coding, planning, reasoning, vision, tool-use)
- Multi-model comparison with automatic ranking
- Persistent leaderboard per evaluation suite

### Integration
- All subsystems accessible through `createAdaptiveLayer()` factory (following existing pattern)
- Wired into `QuackSystem` as `system.adaptive` (Phase 12 in `create-system.ts`)
- 14 new API endpoints on Desktop Server (`/api/adaptive/*`)
- Comprehensive test suite: 44 tests across all subsystems + integration test

### Governance
- Every autonomous optimization requires **user approval** before production rollout
- Full audit trail via Decision Replay Engine
- All experiment/evolution/learning data is auditable, reproducible, and reversible
- Prompts never overwritten without explicit approval

## Consequences

### Positive
- The design targets evidence-backed improvement proposals; autonomous learning and promotion are not established.
- All optimizations are reversible and auditable
- 15 new subsystems follow established factory patterns
- The historical test count does not certify current adaptive correctness or execution support.

### Negative
- Adds complexity — 15 subsystems require ongoing maintenance
- Autonomous improvement cycles consume compute resources
- Governance adds approval overhead for automated proposals

### Neutral
- Adaptive layer is additive; all prior phases operate unchanged
- Existing 742 tests continue to pass alongside 44 new tests
- Desktop server gains 14 new API endpoints

## Compliance
- [x] Every autonomous optimization auditable, reproducible, reversible, versioned
- [x] User approval required before production rollout
- [x] Prompts never overwritten without approval
- [x] Factory pattern (`create*()`) followed for all subsystems
- [x] All prior phases (1–11) remain stable
- [x] 786 total tests passing (742 original + 44 new)
