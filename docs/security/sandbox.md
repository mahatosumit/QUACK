# Sandbox (Execution Isolation)

Status: WORKER_PROCESS backend SUPPORTED as an isolation *contract* with
honest per-guarantee levels; it is **NOT itself a security sandbox**.

ADR: [0039](../adr/0039-execution-isolation-contract.md)
Source: `src/isolation/contract.ts`, `src/isolation/worker-backend.ts`
Skill binding: `src/skills/execution-profile.ts` (ADR 0041)

## Isolation levels

| Level | Status |
| --- | --- |
| `IN_PROCESS` | SUPPORTED (same-thread execution) |
| `WORKER_PROCESS` | SUPPORTED (`node:worker_threads` backend) |
| `CONTAINER_ISOLATED` | UNSUPPORTED — no container backend exists; requests fail closed |
| `FUTURE_STRONG_ISOLATION` | UNSUPPORTED — reserved contract level |

## Worker-backend guarantees (per ADR 0039)

| Guarantee | Level |
| --- | --- |
| Wall-clock timeout / cancellation | ENFORCED |
| Environment materialization (explicit env, not inherited) | ENFORCED |
| Filesystem containment at the IO boundary | BEST_EFFORT |
| Crash containment (worker dies, host lives) | BEST_EFFORT |
| Network sealing | UNSUPPORTED — network policy DENY fails closed, but there is no network-level enforcement |
| Secret sealing | UNSUPPORTED — explicit-secrets without materialization fails closed |
| Security-sandbox equivalence (container/VM) | UNSUPPORTED — **the worker backend is NOT a sandbox equivalent to a container or VM and must not be documented as one** |

`worker_threads` share the process address space with the host: a
malicious workload can crash the host process (BEST_EFFORT crash
containment refers to error propagation, not memory isolation).

## Default-deny policy

The isolation profile is default-deny: filesystem (workspace-only),
network (DENY, or empty ALLOWLIST requiring authorization), environment
(materialized), secrets (DENY, or EXPLICIT requiring materialized grants).

## Skill binding (ADR 0041)

`deriveSkillExecutionProfile` maps universal skill fields → isolation
profile with least-privilege defaults and two non-overridable rules:

- **Risk never lowers isolation**: a HIGH-risk skill claiming
  `IN_PROCESS` is held at `WORKER_PROCESS`.
- **EXPLICIT secrets without materialized secrets fail closed** (no
  execution).

`toIsolationRequest` builds the governed request; only `IsolatedIo`
(workspace root, materialized env, signal) crosses the worker boundary —
never host registries, brokers, or runtime APIs.

## Adversarial coverage

13 worker-backend security tests: traversal/absolute-path escape at the
IO boundary, spin loops, crashes, cancellation, cleanup, output bounds.
Plus execution-profile tests (3) and adversarial cross-suite cases.
