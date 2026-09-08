# No Yap (reasoning.no-yap)

Purpose: Verbosity control: strip filler from reasoning and output.

This is a governed reasoning policy, not an agent. It never bypasses the
CapabilityBroker, grants no permissions, and changes no security policy.

## Policy
- State facts and actions only; omit restatements of the request.
- Delete hedging phrases unless uncertainty is material to the decision.
- Prefer lists over paragraphs when more than two items exist.
- If a sentence does not change a decision or record a fact, cut it.

## Trigger phrases
- "no yap"
- "less verbose"
- "terse"
- "shorter"

## Security
- Risk class: LOW (read-only grounding, no network, no secrets).
- Permissions: workspace.read only.
- This skill cannot execute arbitrary code.
