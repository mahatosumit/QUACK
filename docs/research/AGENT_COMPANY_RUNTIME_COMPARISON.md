# Agent Company Runtime Comparison

Review date: 2026-08-15. Sources are current primary repositories and official
documentation. QUACK adopts patterns, not upstream runtimes. Its core invariant
is: **knowledge, evidence, decisions, and role templates persist; worker compute,
credentials, and workspace leases do not.**

| Source | Decision | QUACK use |
|---|---|---|
| [Paperclip](https://github.com/paperclipai/paperclip) | ADAPT_PATTERN_ONLY | Goal ancestry, atomic claims, budgets, approvals, audit, and recovery. Its durable hired org chart becomes a per-mission execution graph. MIT. |
| [Agency Agents](https://github.com/msitarzewski/agency-agents) | OPTIONAL_IMPORTER | Import selected role blueprints after schema validation and permission stripping; never preload its large catalog. MIT. |
| [Agent Swarm](https://github.com/desplega-ai/agent-swarm) | ADAPT_PATTERN_ONLY | Lead/worker delegation, durable DAG state, isolated workers, recovery, and [independent litmus verification](https://docs.agent-swarm.dev/docs/playbooks/patterns/litmus-tests). MIT. |
| [Gas Town](https://github.com/gastownhall/gastown) | ADAPT_PATTERN_ONLY | Persistent work with ephemeral sessions, bounded dispatch, worktrees, and orphan recovery. Avoid tmux/role mythology and native-Windows limitations. MIT. |
| [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) | ADAPT_PATTERN_ONLY | Graph, concurrent, handoff, checkpoint, HITL, and telemetry patterns; do not replace QUACK TypeScript contracts. MIT. |
| [Dapr Agents](https://github.com/dapr/dapr-agents) | OPTIONAL_ADAPTER | Durable virtual actors and scale-to-zero are a future distributed adapter, not a Windows desktop dependency. Apache-2.0. |
| [Zeroshot](https://github.com/the-open-engine/zeroshot) | ADAPT_PATTERN_ONLY | Separate executor/verifier contexts and reproducible rejection. Windows is not a supported core target. MIT. |
| [OpenHands](https://github.com/OpenHands/OpenHands) | OPTIONAL_ADAPTER | Optional isolated software-engineering worker. Root is MIT; never import the separately licensed `enterprise/` tree. Windows requires WSL2/Docker. |
| [OpenAkita](https://github.com/openakita/openakita) | REFERENCE_ONLY | Its pool/blackboard/scale-down concepts are useful, but AGPL-3.0 prevents code copying into QUACK Core. |
| [Ruflo](https://github.com/ruflo-app/ruflo) | REJECT_FOR_CORE | Its promoted “100+ agents” model and broad plugin surface conflict with objective-shaped temporary teams. MIT ideas may be independently re-derived. |
| [Karpathy LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) | ADAPT_PATTERN_ONLY | Immutable sources, derived linked knowledge, maintenance rules, ingest/query/lint, and append-only log. No explicit license: copy no text or templates. |

## Adopted boundary

```text
durable goal/mission record
        -> objective-specific team plan
        -> bounded worker/grant/workspace leases
        -> execution contracts and provider/action runtimes
        -> independent verification
        -> seal evidence and promote verified knowledge
        -> revoke grants, release workspaces, terminate workers
        -> dormant historical company record
```

Provider selection remains the Capability Broker -> Policy Engine -> Provider
Router path. Imported prompts never grant permissions. External frameworks may
be optional workers/adapters, but none are mandatory to QUACK Core.
