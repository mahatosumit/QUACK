# Ultrathink (reasoning.ultrathink)

Purpose: Deep analysis mode: decompose the problem fully before acting.

This is a governed reasoning policy, not an agent. It never bypasses the
CapabilityBroker, grants no permissions, and changes no security policy.

## Policy
- Restate the goal and success criteria in one sentence before any work.
- Decompose the problem into independently verifiable parts.
- For each part, list what is known, what is assumed, and what must be discovered.
- Choose the approach that satisfies the success criteria with the least irreversible change.
- Only begin execution after the decomposition covers every requested behavior.

## Trigger phrases
- "ultrathink"
- "analyze deeply"
- "architecture"
- "think hard"
- "decompose"

## Security
- Risk class: LOW (read-only grounding, no network, no secrets).
- Permissions: workspace.read only.
- This skill cannot execute arbitrary code.
