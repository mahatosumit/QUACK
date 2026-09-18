# QUACK OS — Differentiation

Category-level comparison. Claims are marked **existing / partial / planned /
aspirational** — nothing is claimed beyond its verified implementation.

QUACK does not claim to be "the first" at anything. It combines a set of
properties that today usually live in *different* products, into one governed
operating environment with surface parity.

| Differentiator | Category it contrasts | Status | Evidence |
|---|---|---|---|
| **Mission-centric AI** — durable work units (plan/capabilities/evidence/receipt) instead of ephemeral chats | chat assistants | **existing** | `TaskStore`, receipts, `resumeMission`, sqlite trace/eval history |
| **Governed execution** — every capability explicit; broker + policy + admission; fail-closed | tool-calling frameworks | **existing** | `CapabilityBroker`, adversarial suites, network governance tests |
| **Evidence-first AI** — execution produces inspectable evidence chains | agent frameworks | **existing** | evidence records bound to verification + receipts (contract v1) |
| **Verified completion** — completion requires real verification over evidence, not just model output | coding agents | **existing** | `verifyExecution` + digest-bound `CompletionReceiptV1` |
| **Recoverable AI work** — missions survive process crashes; fenced ownership; journal replay | agent frameworks | **existing** | `resumeMission`, multi-process recovery tests (real forked processes) |
| **Model/provider neutrality** — interchangeable reasoning engines behind one governance gate | provider-locked products | **existing** (gate) / **planned** (streaming consumer, P4) | `GovernedModelRuntime`, OpenAI-compat/NVIDIA/Ollama/vLLM adapters |
| **Built-in evaluation** — the environment evaluates its models, agents, skills, and execution | assistants; coding agents | **partial** — `MissionEvaluator`, `QuackNativeHarness`, PCT provider suite exist; model-vs-model + security scenario packs are P5 | sqlite evaluation history, `providers/conformance.ts` |
| **Multi-surface parity** — CLI + Studio + (planned) Console + SDK over one runtime | AI IDEs; dashboards | **partial** — CLI/Studio/SDK parity is real; Console is P3; cancel/approval surfaces are P1–P2 | all surfaces verified to route through `submitGoal` |
| **AI as an operating environment** — missions, capabilities, approvals, evidence, traces, receipts as system processes | conversational products | **partial** — kernel complete; experience layer is P2–P7 | certified runtime + this roadmap |
| **Reproducible/replayable execution** — traces + replay engine + durable events | observability tools | **partial** — `TraceRecorder`, `replay-engine.ts` exist; replay UX is P7 | sqlite traces |
| **Honest security boundary** — process-level governance, explicitly not claimed as container/microVM isolation | sandboxed-execution products | **existing** (the honesty itself) | THREAT_MODEL.md, ADR 0039, fail-closed unsupported isolation |

## What QUACK deliberately does not compete on

- Raw model quality or chat UX polish (models are engines, not the product).
- Number of integrations (governance precedes breadth).
- Autonomous "do anything" operation — governance and approval gates are the
  product, not friction to remove.

## The one-sentence differentiation

> Other products give you a conversation with an AI; QUACK gives the work
> itself an operating system: missions that are planned under explicit
> capability control, executed with evidence, verified before completion,
> recoverable after failure, and closed with a durable receipt — the same
> from CLI, Studio, Console, or SDK.
