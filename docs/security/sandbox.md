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

## Governed mission execution (P12, ADR 0046)

The P11/P12 governed mission loop executes REGISTERED HOST FUNCTIONS
(action providers, core tools) inside the host process. That is a
POLICY boundary, not process or OS isolation, and it is never labeled a
sandbox:

| IsolationState (governed path) | Meaning | Enforced by |
| --- | --- | --- |
| `POLICY_RESTRICTED` (default) | Broker-policy enforcement of registered host functions | CapabilityBroker chain (validate → authorize → revalidate → execute) |
| `PROCESS_ISOLATED` | Worker-process isolation of the execution | Requires a real IsolationBackend — none is wired into the governed path |
| `OS_ISOLATED` | Container/VM isolation | No backend exists; cannot be granted |
| `FAILED_CLOSED` | A trusted configuration required isolation that is unavailable | Durable DENIAL — never a silent downgrade |

Fail-closed rule: if deployer configuration demands an isolation level no
backend provides, the execution is DENIED with a durable `execution.denied`
event. There is no "execute anyway" path and no downgrade to a weaker mode.

What P12 actually enforces on the governed path: wall-clock timeout
(AbortController, policy-owned ceiling), output-byte containment at the
harness boundary (oversized output DROPPED, never previewed), at-most-once
dispatch per (mission, step, capability) through the durable
StepAttemptJournal, in-process concurrency bound, and honest execution-state
classification from runtime evidence only. Memory limits are ADVISORY
(serialized null; the runtime cannot enforce them) and any policy claiming
an enforced memory limit fails validation.

Worker isolation (ADR 0039) remains available for skill MODULE workloads
only; it is not wired into the governed loop because registered host
functions cannot be moved into a worker without an adapter contract, and
the worker backend is not a security boundary. See ADR 0046 for the
P13/P14 requirements for real process/OS isolation of governed actions.
