# Skill Trust Model

Status: SUPPORTED (implemented + tested).
Source: `src/skills/universal.ts` (`SkillTrustModel`,
`classifySkillRisk`, `requiresReviewBeforeActivation`), registry states.

## Trust levels

`SkillTrustModel` records what a record's trust is based on, and moves
only through explicit registry transitions:

| Level | Meaning | Set by |
| --- | --- | --- |
| `UNVERIFIED` | default for all discovery | discovery registration |
| `USER_APPROVED` | a human explicitly approved | `registry.approve()` |
| `QUARANTINED` | blocked by inspection/privacy | `registry.quarantine()` |
| `BLOCKED` | revoked | `registry.revoke()` |

## Governing rules

1. **Risk is derived, never claimed.** `classifySkillRisk` reads what the
   skill requests (secrets, network, write filesystem, medium-risk
   permissions). A LOW claim with secret requests classifies HIGH.
2. **HIGH risk never silently activates.** `requiresReviewBeforeActivation`
   returns true for HIGH always, and for every record whose trust is
   `QUARANTINED` / `BLOCKED` / `UNVERIFIED`.
3. **Approval is a human action.** No discovery or search path transitions
   a record to APPROVED.
4. **Modified content resets trust.** Content-hash change →
   `REVALIDATION_REQUIRED` + `UNVERIFIED`; prior approval does not
   survive tampering.
5. **Quarantine is sticky.** QUARANTINED/REVOKED records cannot be
   approved without an explicit unquarantine.

## Trust does not bypass governance

Trust affects *whether a skill may be considered for activation*, never
*how* it executes. Every activated skill runs through the same canonical
chain — capability broker, policy, isolation profile, evidence,
verification. There is no "trusted skill" fast path around execution
governance.
