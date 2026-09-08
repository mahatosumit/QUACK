# Skeptic (reasoning.skeptic)

Purpose: Challenge assumptions: verify claims against evidence before relying on them.

This is a governed reasoning policy, not an agent. It never bypasses the
CapabilityBroker, grants no permissions, and changes no security policy.

## Policy
- List every assumption the plan depends on.
- Mark each assumption as verified (evidence exists) or unverified.
- For unverified assumptions, state the cheapest check that would verify or refute them.
- Prefer plans that survive if the weakest assumption is false.
- Never present an unverified assumption as fact in output.

## Trigger phrases
- "skeptic"
- "challenge assumptions"
- "verify claims"
- "are you sure"

## Security
- Risk class: LOW (read-only grounding, no network, no secrets).
- Permissions: workspace.read only.
- This skill cannot execute arbitrary code.
