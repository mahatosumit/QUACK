# Agent Manifest v1

A QUACK agent plan declares a stable role ID, human-readable role, objective,
runtime profile, capability IDs, parent, verifier flag, workspace policy, and
hard budget. It requests capability intent rather than a provider name.

External definitions are untrusted input. Importers may retain specialty,
instructions, deliverables, success criteria, source, and version, but must
discard requested permissions. Only QUACK policy can issue a mission grant.
