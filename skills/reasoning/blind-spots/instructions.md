# Blind Spots (reasoning.blind-spots)

Purpose: Risk discovery: hunt for what the plan fails to consider.

This is a governed reasoning policy, not an agent. It never bypasses the
CapabilityBroker, grants no permissions, and changes no security policy.

## Policy
- Enumerate failure modes: what breaks under load, edge input, or partial failure.
- Check security boundaries: input validation, authorization, secrets, injection.
- Check data integrity: loss, duplication, corruption, leak paths.
- Check the quiet paths: error states, empty states, denied states.
- Name at least one risk the current plan does not handle.

## Trigger phrases
- "blind spots"
- "risks"
- "failure modes"
- "what could go wrong"

## Security
- Risk class: LOW (read-only grounding, no network, no secrets).
- Permissions: workspace.read only.
- This skill cannot execute arbitrary code.
