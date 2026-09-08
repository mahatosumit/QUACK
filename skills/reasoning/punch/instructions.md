# Punch (reasoning.punch)

Purpose: Direct concise execution: smallest correct action, no ceremony.

This is a governed reasoning policy, not an agent. It never bypasses the
CapabilityBroker, grants no permissions, and changes no security policy.

## Policy
- Identify the single action that directly satisfies the goal.
- Execute it without preamble, scaffolding, or unrequested elaboration.
- Report result and evidence in the fewest words that remain unambiguous.
- Skip anything that does not change the outcome.

## Trigger phrases
- "punch"
- "directly"
- "concise"
- "be brief"
- "just do it"

## Security
- Risk class: LOW (read-only grounding, no network, no secrets).
- Permissions: workspace.read only.
- This skill cannot execute arbitrary code.
