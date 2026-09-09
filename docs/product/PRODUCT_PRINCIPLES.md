# QUACK OS — Product Principles

Non-negotiable invariants for all QUACK product development. Architectural
review of any product PR must check these. Machine-checkable summary lives in
the invariants table below; each principle cites its current implementation.

## Principle 1 — One Runtime

All surfaces use the single composition root and execution path:

```
createQuackSystem
  → QuackRuntime
  → SessionRuntime
  → DefaultLoopDriver
  → WorkflowEngine / ExecutionScheduler
  → CapabilityBroker
  → Policy / Identity / Admission
  → Sandbox / Worker
  → Tools / Skills / MCP
  → Evidence → Verification → Receipt
```

**Implementation today:** verified — CLI (`src/cli.ts`), Studio SPA
(`src/dashboard/web/studio.ts` via `POST /missions`), HTTP API
(`src/server/index.ts` → `QuackApi.submitMission`), and SDK (`sdk/`) all reach
`QuackRuntime.submitGoal` through `createQuackSystem`
(`src/distributions/swe-system.ts`). No second execution path exists.

**No second runtime, scheduler, recovery system, or mission state machine may
be created by any surface.**

## Principle 2 — One Governance Boundary

Every meaningful capability passes through `CapabilityBroker` + policy +
identity + admission + network governance (`NetworkPolicyEngine`) + secret
management (`SecretProvider`) + sandbox controls. No UI, Console, Harness,
Agent, Skill, or SDK feature may bypass any of these. Broker grants are
pre-approved with provenance; the broker never self-approves.

## Principle 3 — One Event Bus

The existing `EventBus` (`src/events/event-bus.ts`) is the sole source of
runtime events. Client-facing streams (SSE `/events`) are **projections of
real events**, not parallel feeds. No second event bus, no second SSE
implementation, no UI-fabricated events. The client-facing subset is
documented in [../contracts/CLIENT_EVENTS.md](../contracts/CLIENT_EVENTS.md).

## Principle 4 — Evidence Before Claims

The product never displays fake activity: no fake progress, fake benchmark
numbers, fake model execution, fake agent status, or fake success. Every UI
badge/status must identify its runtime/store source (event type or store
read). Known violations to remove: the hard-coded `/api/benchmarks` and
`/api/evaluation` values in `src/desktop/server.ts` (retirement approved).

## Principle 5 — Recoverable Work

Missions are durable. The product must let a user determine: what happened,
where it stopped, why it stopped, what can resume, what was verified, and
what evidence exists. Recovery flows through `QuackRuntime.resumeMission`
and fenced ownership — never a parallel resume mechanism.

## Principle 6 — Model Neutrality

Models are reasoning engines behind one gate. All model execution goes through
`GovernedModelRuntime` (broker-gated per call). The product never couples
identity to one provider and never lets a client call a provider directly.

## Principle 7 — CLI / GUI / SDK Parity

```
             QUACK CORE
                  │
       ┌──────────┼──────────┐
       │          │          │
      CLI       Studio      SDK
                 │
        Console / Mission UI
       (same runtime, same semantics)
```

A mission created from one surface must be inspectable, resumable, and
replayable from every other surface. Feature additions land at the
kernel/contract layer first, then in surfaces.

## Architectural invariants

| ID | Invariant | Enforced by (today) |
|---|---|---|
| I-001 | ONE_RUNTIME | single `createQuackSystem`; all surfaces route to `submitGoal`/`executeTool` |
| I-002 | ONE_GOVERNANCE_BOUNDARY | `CapabilityBroker`, policy, admission, `NetworkPolicyEngine`, `SecretProvider` |
| I-003 | ONE_MODEL_GATE | `GovernedModelRuntime` wraps every model call |
| I-004 | ONE_EVENT_BUS | `EventBus`; SSE is a projection; audit log subscribes via `onAny` |
| I-005 | ONE_APPROVAL_PATH | `RiskAwareApprovalPolicy` + `ApprovalCallback`; broker grants require provenance |
| I-006 | ONE_HARNESS | `QuackNativeHarness` + `harness/evaluator.ts`; no second runner |
| I-007 | EVIDENCE_REQUIRED_FOR_VERIFIED_COMPLETION | verification minted only from durable evidence; receipts are digest-bound |
| I-008 | FAIL_CLOSED | no approver ⇒ deny; no allow rule ⇒ network denied; unknown skill ⇒ quarantined |
| I-009 | NO_FAKE_ACTIVITY | every UI state maps to an event type or store read (see Principle 4) |
| I-010 | NO_PROVIDER_BYPASS | providers only reachable via `provider.invoke` through the broker |
| I-011 | NO_SECRET_LEAKAGE | `redactSecrets` at audit/SSE/doctor boundaries; `SecretProvider` sole credential layer |
| I-012 | NO_CROSS_SESSION_ACCESS | session-scoped stores; no cross-session reads without explicit authorization |
| I-013 | RECOVERY_MUST_PRESERVE_OWNERSHIP_FENCING | `resumeMission` + fenced leases; stale writers rejected |
| I-014 | CLIENTS_MUST_NOT_EXECUTE_TOOLS_DIRECTLY | surfaces call Mission API only |
| I-015 | STUDIO_IS_A_CLIENT_NOT_THE_RUNTIME | SPA has no server-side execution; all actions via authenticated API |

These invariants are review criteria: a PR that violates any of them cannot
merge, regardless of feature value.

## Product quality bar

A feature is **not** complete merely because code compiles, a UI renders, an
endpoint returns 200, or a model returns text. A feature is complete when all
of the following hold:

```
Architecture (invariants intact, no parallel systems)
+ Security (boundary tests, redaction, fail-closed paths)
+ Runtime integration (real kernel path, no shortcut)
+ Evidence (states map to real events/stores)
+ Verification (completion claims verified where applicable)
+ Tests (unit + adversarial, no weakened suites)
+ UX (real states only; loading/empty/denied/failure states designed)
+ Documentation (contract docs updated in the same PR)
```

A PR missing any element is incomplete and cannot merge. "It works on my
machine" is not a category in this list.

## Duplication decisions (approved)

**KEEP:** canonical Studio SPA · `QuackHttpServer` · `QuackApi` · `EventBus`
· `GovernedModelRuntime` · `QuackNativeHarness` + evaluator · existing memory
stack · skills · MCP · CLI · SDK.

**RETIRE (in product evolution, P7 — verify zero external consumers before
deleting; never delete blindly):** `src/desktop/server.ts` (78 read-only
routes; injects a QuackSystem but never submits missions; contains the two
hard-coded fake endpoints below) · legacy `dashboard/web/index.ts`
`dashboardHtml()` (superseded by Studio SPA) · the fake
`/api/benchmarks` + `/api/evaluation` hard-coded values (violate Principle 4
and disappear with the desktop-server retirement; anything Studio genuinely
needs from those surfaces merges into `QuackHttpServer` first).

## Security honesty boundary (product claims policy)

QUACK claims exactly what is implemented:

- Worker/process governance is **process-level** (capability admission, path
  policy, argv-only execution). It is **not** container, microVM, or remote
  sandbox isolation, and must never be marketed as such (see
  `docs/security/THREAT_MODEL.md`, ADR 0039).
- No arbitrary remote execution or unrestricted autonomous operation is
  claimed — governance and approval gates are the product.
- Streaming is claimed only when a real consumer exists (today: none for
  model chunks; P4 wires it).
- Semantic memory is not claimed while retrieval is text-based (P9).
- Automation is not claimed (P8).
- The API is loopback-only; remote/networked use is explicitly unsupported
  until a real authentication design ships.

Product documentation, website, and README must not exceed these claims.
