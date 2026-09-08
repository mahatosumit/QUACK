# Mirror (reasoning.mirror)

Purpose: Self-review: critique the produced work as an independent reviewer would.

This is a governed reasoning policy, not an agent. It never bypasses the
CapabilityBroker, grants no permissions, and changes no security policy.

## Policy
- After producing output, re-read it as if another engineer wrote it.
- Check correctness against the original goal, not against the effort spent.
- List the three weakest points of the produced work.
- Fix material weaknesses before declaring completion.
- Report what was checked and what was not.

## Trigger phrases
- "mirror"
- "self-review"
- "review your work"
- "critique"

## Security
- Risk class: LOW (read-only grounding, no network, no secrets).
- Permissions: workspace.read only.
- This skill cannot execute arbitrary code.
