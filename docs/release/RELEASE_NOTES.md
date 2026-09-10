# QUACK OS Release Notes — v1.0.0 (first public release candidate)

**Date:** 2026-09-10
**Lineage:** `main @ 298b6c3` + P0–P7 (`b1d7911` … `d7b9ae2`)
**Gate evidence (local, this run):** 1,496 ordinary + 17 serial tests, 0
failures, 0 skipped; typecheck, SDK typecheck, lint, build, static
guards, Control Room browser E2E all PASS; fresh-tarball install →
doctor → init → governed mission → trace verified.

QUACK OS is a local-first, mission-centric AI execution runtime with
capability-governed execution. This release is the first coherent
product: one runtime, one governance boundary, one HTTP surface, one
GUI, real evidence everywhere.

## Available now

### Mission-centric execution
Missions are the unit of work: a goal becomes a planned, governed,
verified execution with a durable receipt. Interrupted missions
recover through ownership-fenced durable recovery (`quack resume`;
stale owners cannot write terminal state). Cancellation and resume are
first-class (`POST /missions/{id}/cancel|resume`).

### Governance, capabilities, approvals
Every capability request resolves through one `CapabilityBroker` with
a permission policy, risk-aware approvals, and deny-by-default. The
Approval Center (Studio + CLI parity) surfaces queue-backed human
decisions with deny-on-expiry and fail-closed behavior — the UI can
never grant authority by itself.

### QUACK Studio (the one GUI, `quack serve`)
- **Mission Control** — live lanes, submission with dry-run, cancel/resume
- **Mission Detail** — capabilities, verification, evidence, event timeline
- **Console** — conversational composer + live mission state over SSE;
  governed model streaming ("Ask model") that fails closed without
  provider authority
- **Agent Workspace** — registry, trust, capabilities, assignment
  state, evaluation-dimension summaries (registry state — never a
  live-execution claim)
- **Approval Center** — queue decisions, action approvals, improvements
- **Trace Center** — execution timelines from the durable repository,
  deterministic filters, real events only
- **Artifacts** — evidence-backed tool outputs (no second store)
- **Audit** — the governance record, redacted at the boundary
- **Operations/System** — provider health, actions, MCP, bounded settings

### Governed model streaming (P4)
`POST /models/stream` resolves `provider.invoke` through the broker
per call; denial fails closed before any provider is contacted; chunk
text is redacted at the wire and on the shared event bus.

### Harness and evaluation (P5)
Scenario pack v2: 15 scenarios across 7 families, including
prompt-injection, secret-redaction, network-denial, malformed-tool,
and forged-identity adversarial scenarios that pass only when the
runtime fails closed. MissionEvaluator scores missions and four
agent-evaluation dimensions (capability discipline, recovery,
planning, evidence quality) from the durable trace only.

### Observability (P7)
Trace Center (repository timelines), Audit Center (governance record
via `GET /audit`, auth-enforced, redacted), Artifact View
(evidence-backed). Trace and Audit are deliberately distinct records
linked by identifiers.

### Surface consolidation (P7)
One HTTP surface (`QuackHttpServer`, loopback, session auth, CSRF,
strict CSP, default-deny network) and one GUI. The duplicate
DesktopServer, the second `gui/` SPA, `desktop-app.ts`, and the legacy
dashboard HTML were removed — along with the fake
`/api/benchmarks` + `/api/evaluation` hard-coded numbers they served.

### Security hardening (accumulated)
SSE + audit payload redaction at wire boundaries; SecretProvider as
the sole credential boundary; fail-closed surfaces for forged
identifiers, traversal, replayed decisions, unauthorized access
(all adversarially tested); fresh-install verified end to end.

## Experimental

- **Governed streaming UX** — real streaming requires a configured
  provider (NVIDIA NIM / Ollama / OpenAI-compatible); without one, the
  Console honestly reports denial/unavailability.
- **Improvement loop** — improvement evaluation and proposals are
  bounded; decisions never mutate source or merge code; hard approval
  gates cannot be disabled.
- **Personas** — style-only routing metadata; cannot grant permissions,
  tools, or trust.

## Deferred (roadmap, NOT in this release)

- P8 Automation (trigger→mission pipelines) — high risk, needs design review
- P9 Semantic memory / embeddings (through GovernedModelRuntime only)
- P10 Ecosystem / marketplace UX
- Model-vs-model comparison — requires live providers; not fabricated
- Container/microVM isolation — not implemented, not claimed

## Compatibility

- Node.js >= 22.5 (node:sqlite); CI covers Node 22/24 on
  Windows/Linux/macOS (x64) + focused arm64 gates.
- Package: `@quack/os@1.0.0` (npm), `quack` CLI; installers:
  `installers/install.sh` (Linux/macOS), `installers/install.ps1`
  (Windows) — npm-primary, fail-closed.

## Honesty statement

No benchmark, performance, or quality numbers are claimed except the
test-gate counts above, produced by this release run. Known limits
are documented in README "Limitations" and
`docs/product/PRODUCT_PRINCIPLES.md`.
