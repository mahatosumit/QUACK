# QUACK OS — Trace & Operations Model

P7 reference for the observability and operations layer. Every claim
here is backed by implementation and tests.

## Trace vs Audit — two different records

| | Trace | Audit |
|---|---|---|
| Question | What did the execution do? | Who decided, and was it authorized? |
| Store | `TraceRepository` (sqlite, `MissionTrace`) | `AuditLog` (jsonl, `QuackEvent`s) |
| Surface | Studio Trace Center (`#traces`, `#trace/{id}`), `GET /traces/{id}` | Studio Audit (`#audit`), `GET /audit` |
| Content | plans, iterations, tool calls, capability checks, verification, outcome, events | the full security/governance event stream |

The stores are NEVER merged. Identifiers (missionId, taskId,
executionId) link them. A trace explains an execution; an audit record
proves authorization for it.

## Event vs Evidence vs Verification vs Receipt

- **Event** — something that happened (an entry on the bus; recorded in
  trace events and the audit log).
- **Evidence** — a durable output supporting a claim (tool outputs
  captured in trace iterations/evidence records).
- **Verification** — the system's determination about
  correctness/completion (`MissionTraceVerification`, per iteration).
- **Receipt** — the final durable mission result (task result; the
  mission record's terminal state + receipt field).

The Trace Center UI labels these explicitly; they are never blurred.

## Artifact = view, not store

There is no artifact database. An artifact shown in the Artifact View
(`#artifacts`) is a real successful tool output inside a stored trace,
presented with its source mission and producing tool. Fabricated
artifact records are prohibited (guarded by tests).

## Timeline truthfulness

Trace Center timelines render ONLY events that exist in the stored
`MissionTrace.events` — nothing synthesized, no inferred entries. The
old DesktopServer's `/api/benchmarks` and `/api/evaluation`
hard-coded numbers (e.g. `workflowCompletionRatePercent: 100`) were
removed with that surface in P7; they violated evidence-first.

## Operations

The Operations surface is the existing Studio System view over
`/system/status`, `/providers`, `/mcp`, `/actions`, plus the P7 Audit
view. Health states are only ever: HEALTHY / DEGRADED / UNAVAILABLE /
NEEDS_SETUP / UNKNOWN — derived from real checks (provider health,
registry presence), never "probably working" green.

## Security boundaries

- Every QuackHttpServer route (traces, audit, missions, approvals)
  requires the per-instance session; there is no anonymous path.
- Audit + trace payloads pass structural redaction (`redactSecrets` +
  secret-shaped key scrubbing) at the HTTP boundary.
- Forged/traversal identifiers fail closed with explicit not-found
  errors (tested: `..%2F..%2F`, `%00`, forged ids).
- The browser never calls providers directly; provider inspection is
  server-side, keys are never returned.
