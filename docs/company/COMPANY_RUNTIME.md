# QUACK Company Runtime Contract v1

QUACK does not boot a simulated permanent organization. It retains a catalog of
role blueprints and creates the smallest useful temporary company for a mission.
The implementation lives in `src/company` and is exposed as
`QuackSystem.companyRuntime`.

## Contract

`quack.company/v1` records goal ancestry, objective-shaped agent plans, a task
DAG, budgets, transitions, evidence, verification, knowledge references, and
dormant agent snapshots. Current deterministic company types are research,
software, and company operations.

Live agents are mission leases. System boot has zero organization instances.
Assembly creates only declared workers and agent-scoped capability grants.
Successful completion is accepted only from `VERIFYING` after a verdict from
the designated independent verifier with a durable evidence reference. Finalize
revokes grants, snapshots metrics, removes live instances, and persists a
`DORMANT` record. Interrupted records fail closed during startup reconciliation.

SQLite writes carry monotonic revisions and use an immediate transaction to
reject stale updates. Per-agent tokens, cost estimate, runtime, model/tool calls,
and retries have hard limits; an overrun fails the company and releases compute.
Company-scoped tool and action calls use opaque, runtime-issued execution
principals bound to one mission, agent instance, grant, and expiring lease.

The Company scheduler validates the persisted task graph, rejects cycles and
missing edges, enforces bounded concurrency and exclusive resource locks, caps
retries, runs dependencies in order, and keeps verification terminal. Timeout
and cancellation signal active tasks and do not return until those operations
have drained. Task transitions can be persisted back to the revisioned company
record.

## Honest limitations

The v1 slice does not yet bind Company principals through every model/provider
and terminal egress path, force an arbitrary external operation to honor abort,
provision company worktrees, dynamically delegate new workers, or resume an
interrupted company. Recovery currently fails closed. Those gaps keep Company
Runtime `NOT_READY`.
