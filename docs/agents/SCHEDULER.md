# Agent Scheduler

Company plans contain durable dependency edges and a verifier-last terminal
node. `MissionCompanyScheduler` validates duplicate, missing, self, and cyclic
edges before execution. It enforces the company concurrency limit, dependency
ordering, exclusive named-resource locks, bounded retries, and verifier-last
execution. Cancellation and timeout signal active operations and the scheduler
does not return until they drain. A transition callback allows each task result
to be written to the revisioned company record.

Deterministic tests prove three overlapping independent tasks, a dependent
synthesis task, verification last, resource serialization, retry bounds, cycle
rejection, and cancellation drain. This is a scheduler foundation, not full AGT
conformance: persisted atomic task claims, aging/fairness, concrete
CPU/RAM/GPU/VRAM accounting, lease fencing, crash replay, and worktree ownership
remain release blockers.
