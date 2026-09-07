# Agent Runtime

Agent role definitions are reusable templates. Agent instances are temporary,
mission-scoped execution leases. `MissionCompanyPlanner` selects roles from the
objective; `MissionCompanyRuntime` assembles and retires them through the
existing organization lifecycle. No fixed roster is spawned at system boot.

Supported persisted states include created, ready, running, waiting variants,
paused, verifying, completed/failed/cancelled, and dormant. The current slice
persists company snapshots and terminal dormancy; full task-by-task transition
and heartbeat leases remain a release blocker.
