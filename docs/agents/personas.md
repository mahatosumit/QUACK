# Agent Personas

Phase 7E persona framework: seven style-only agent personas.

## The contract

A persona modifies **only**:

- reasoning style
- communication style
- planning preference

A persona must **not**:

- bypass the CapabilityBroker
- grant permissions or tools
- change security policy or trust level
- widen any capability beyond its base agent

`applyPersona` enforces this by construction: it only touches description and specialization (routing metadata). Skills, capabilities, trust level, and model capability are carried over verbatim from the base agent. Tests in `src/agents/personas/personas.test.ts` assert every one of these invariants.

## The seven personas

| Persona | Focus | Reasoning style | Planning preference |
|---|---|---|---|
| `architect` | system design and structural trade-offs | decompose-into-boundaries, evaluate-trade-offs | smallest-reversible-change, boundary-stability |
| `researcher` | evidence gathering and source-backed conclusions | claim-then-evidence, contradiction-hunting | breadth-first, cheapest-verification-first |
| `debugger` | root-cause analysis | observe-before-hypothesize, one-variable-at-a-time | minimal-repro-first |
| `security-reviewer` | trust boundaries and adversary behavior | threat-model-first, trust-no-input, fail-closed-checks | boundary-audit-first, least-authority |
| `product-manager` | user value and scope discipline | user-impact-first, scope-stripping | vertical-slice, defer-unvalidated-work |
| `engineer` | implementation correctness and maintainability | conventions-before-cleverness, failure-path-design | smallest-complete-diff, tests-with-behavior |
| `critic` | finding what is wrong before it ships | adversarial-review, weakest-point-first | blocker-first-triage |

## Usage

List personas:

```bash
quack personas
```

Persona-decorated agents are available through `system.personaWorkforce`, built from the same base specialist agents as `system.workforce`. Goals containing persona trigger words ("security vulnerabilities", "architecture trade-offs", "critique this") route to the matching persona through the standard `AgentRouter` scoring — no special dispatch path.

## Selection mechanics

Personas add their style/trigger terms to the base agent's `specialization`. The existing `scoreAgent` metadata matcher scores specialization hits against the goal text. Nothing about routing changes — a persona is more routing metadata plus prompt-level guidance, not a new authority class.

## Security notes

- Persona agents execute through `SpecialistAgent → SkillRuntime.executeSkill` exactly like base agents: broker preflight, sandbox, evidence.
- The persona type has no capability field at all; a persona cannot smuggle authority.
- Tampering test: a hand-forged definition with added capabilities is detectable by comparing against the base (tests demonstrate the invariant check).
