# Delegation

Default mission limits are four concurrent agents, three children per parent,
depth two, and twelve total agents. The planner rejects unknown parents,
recursive ancestry, excessive depth, and excess fan-out. The verifier is a
separate role and cannot own production tasks in the generated DAG.

The scheduler enforces named-resource exclusion for the validated initial plan.
Dynamic runtime delegation, atomic child-budget reservation, concrete compute
capacity accounting, and workspace availability checks are not implemented.
Until those controls exist, only the validated initial plan may create workers.
