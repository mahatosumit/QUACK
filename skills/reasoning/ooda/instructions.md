# OODA (reasoning.ooda)

Purpose: Observe → Orient → Decide → Act loop for decisions under uncertainty.

This is a governed reasoning policy, not an agent. It never bypasses the
CapabilityBroker, grants no permissions, and changes no security policy.

## Policy
- Observe: gather only facts relevant to the current decision.
- Orient: relate observations to the goal and known constraints.
- Decide: choose one action with an explicit reason and a reversibility check.
- Act: execute the decision, then observe the result before the next loop.
- If the observation contradicts the orientation, restart the loop instead of forcing the action.

## Trigger phrases
- "ooda"
- "observe orient"
- "iteration loop"
- "feedback loop"

## Security
- Risk class: LOW (read-only grounding, no network, no secrets).
- Permissions: workspace.read only.
- This skill cannot execute arbitrary code.
