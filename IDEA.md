# QUACK Completion Harness

## Finish the Entire Project with the Same Model Without Context Collapse

You are the **lead engineer responsible for completing QUACK OS to production-readiness using the current model and the existing repository**.

You are continuing an active implementation.

Do **not** restart the project.

Do **not** repeat completed architecture work.

Do **not** reread the entire repository on every phase.

Do **not** attempt to solve all remaining phases in one model response.

Your primary operational constraint is:

> **Finish QUACK using bounded engineering iterations that survive model context limits.**

The previous attempt failed because too much repository state, historical reasoning, test output, and future planning accumulated in one context.

From now on, treat **the repository itself as persistent memory**.

---

# 0. CURRENT VERIFIED STATE

The implementation has reached approximately:

```text
Phase 1     COMPLETE
Canonical mission state machine

Phase 2     COMPLETE
Canonical Action/Result contract

Phase 3-A   COMPLETE
Canonical Executive Loop contract

Phase 3-B   IN PROGRESS
Migrate legacy AgentLoop to canonical Executive Loop
```

Recent verified facts:

```text
TypeScript typecheck:
PASS

latestLegacyIterations reset-on-start bug:
FIXED

build:
PASS

AgentLoop regression tests:
5 total
4 pass
1 fail
```

Current failing regression:

```text
actual events:

[
  "loop.started",
  "loop.action_selected",
  "loop.iteration"
]

expected:

[
  "loop.started",
  "loop.action_selected",
  "loop.iteration",
  "loop.failed"
]
```

Therefore:

> **Resume from this failure. Do not restart Phase 3-B from scratch.**

---

# 1. PRIME DIRECTIVE

Work in this loop:

```text
READ SMALL
   ↓
UNDERSTAND
   ↓
CHANGE SMALL
   ↓
TYPECHECK
   ↓
RUN FOCUSED TEST
   ↓
RUN REGRESSION
   ↓
CHECKPOINT
   ↓
COMPACT CONTEXT
   ↓
NEXT TASK
```

Never use:

```text
READ EVERYTHING
   ↓
CHANGE EVERYTHING
   ↓
RUN EVERYTHING
   ↓
32,000-token report
```

---

# 2. REPOSITORY IS THE MEMORY

Do not depend on conversation context to remember project state.

Maintain these files as authoritative project memory:

```text
.quack-dev/
├── CURRENT.md
├── TODO.md
├── DECISIONS.md
├── RISKS.md
├── TEST_STATUS.md
├── CONTRACTS.md
└── HANDOFF.md
```

Create the directory if it does not exist.

These files are mandatory.

---

# 3. CURRENT.md

`CURRENT.md` must contain only the active work.

Maximum target size:

```text
~100 lines
```

Example:

```markdown
# Current Work

Phase: 3-B

Goal:
Complete AgentLoop migration onto canonical executive-loop contract.

Current failing test:
AgentLoop failure path does not emit loop.failed.

Relevant files:
- src/agent-loop/index.ts
- src/agent-loop/agent-loop.test.ts
- src/executive-loop/...
- src/mission/...

Last verified:
- tsc PASS
- build PASS
- AgentLoop tests: 4/5 PASS

Next action:
Trace failure path after loop.iteration and restore canonical loop.failed emission.
```

Update this after every meaningful milestone.

---

# 4. TODO.md

Maintain a strict todo list.

Use:

```text
[✓] completed
[•] active
[ ] pending
[!] blocked
```

Only one major task may be `[•]` at once.

Example:

```text
[✓] Phase 1
[✓] Phase 2
[✓] Phase 3-A
[•] Phase 3-B — fix failure-event regression
[ ] Phase 3-B — concurrency/state-isolation test
[ ] Phase 3-B — docs/checkpoint
[ ] Phase 4 — Harness/provider contract
...
```

Do not work on future phases while an active phase has unresolved correctness failures.

---

# 5. HANDOFF.md

This is the most important file for context control.

At the end of every bounded work unit, rewrite:

`.quack-dev/HANDOFF.md`

It should contain:

```markdown
# QUACK Engineering Handoff

## Current phase

Phase 3-B

## Completed in latest unit

- reset latestLegacyIterations on start
- removed unused import
- build passes

## Current failure

AgentLoop test 5 expects loop.failed but event is not emitted.

## Likely location

src/agent-loop/index.ts failure/termination path.

## Files required next

- src/agent-loop/index.ts
- src/agent-loop/agent-loop.test.ts
- canonical executive-loop stop/failure helpers

## Do not reread

- Phase 1 implementation
- Phase 2 implementation
- unrelated APIs
- dashboards
- skills
- documentation already marked complete

## Next exact action

Trace how legacy failure previously emitted loop.failed and compare it with the new terminateRun/state-machine path.

## Verification commands

tsc -p tsconfig.json --noEmit
npm run build
node --test dist/agent-loop/agent-loop.test.js
```

A future session should be able to continue using only:

```text
HANDOFF.md
CURRENT.md
TODO.md
relevant source files
```

instead of the full historical conversation.

---

# 6. CONTEXT BUDGET RULES

These rules are mandatory.

## Never load the entire repository

Search first.

Read only files required for the active question.

---

## Prefer narrow reads

Use:

```text
grep/search
small source ranges
specific symbols
specific tests
```

instead of reading 1,000-line files from beginning to end.

---

## Never dump entire test logs

On success capture:

```text
tests
pass
fail
duration
```

On failure capture only:

```text
failing test name
error
expected
actual
relevant stack
```

Do not retain hundreds of passing test lines.

---

## Never paste entire generated documentation back into context

Write documentation directly to files.

Then report only:

```text
created/updated file
important decision
remaining issue
```

---

## Maximum working set

Try to keep each implementation unit limited to:

```text
1 primary task

1-4 source files

1-3 tests

1 architectural contract
```

If more becomes necessary, checkpoint first.

---

# 7. RESPONSE BUDGET

Do not generate giant explanations during implementation.

Normal engineering updates should contain only:

```text
What I found
What I changed
Verification
Next task
```

Target:

```text
<800 words
```

unless a final phase report is explicitly required.

Do not request enormous output-token budgets.

The goal is code, tests, and repository artifacts — not long conversational output.

---

# 8. PHASE EXECUTION RULE

Each phase is divided into **micro-gates**.

Do not attempt an entire phase as one uninterrupted task.

Use:

```text
Phase
 ├── A
 ├── B
 ├── C
 └── Gate
```

Example Phase 4:

```text
4-A Capability descriptor
4-B Provider interface
4-C Provider registry
4-D Failure normalization
4-E Health model
4-F Circuit breaker
4-G Harness integration
4-H Focused tests
4-I Regression
4-J Documentation
```

Complete one micro-gate at a time.

---

# 9. IMMEDIATE TASK — FINISH PHASE 3-B

Start here.

## 3-B.1 Diagnose failing event test

Current failure:

```text
expected:
loop.failed

missing from actual event sequence
```

Determine:

1. what condition causes the tested mission to fail;
2. how the legacy implementation emitted `loop.failed`;
3. how the new canonical termination path behaves;
4. whether the regression is:

   * missing event emission,
   * wrong state mapping,
   * wrong stop reason,
   * swallowed exception,
   * early return,
   * test expectation that should legitimately change.

Do **not** blindly add:

```typescript
emit("loop.failed")
```

until semantics are verified.

---

# 10. FAILURE SEMANTICS

Establish one rule:

```text
canonical mission state
        +
canonical StopReason
        ↓
legacy compatibility event
```

For example:

```text
FAILED
   ↓
loop.failed

SUCCEEDED
   ↓
loop.completed

CANCELLED
   ↓
loop.stopped or canonical equivalent
```

Legacy events may remain temporarily for compatibility.

But there must be one canonical source of truth.

Do not create two independent failure state machines.

---

# 11. PHASE 3-B GATES

Phase 3-B is complete only when:

```text
[ ] all 5 existing AgentLoop tests pass

[ ] latestLegacyIterations resets per start

[ ] every start() owns an independent LoopRun

[ ] canonical IterationRecord is produced

[ ] budget enforcement happens in driver

[ ] stall detection happens in driver

[ ] terminal StopReason maps correctly

[ ] Phase 1 mission state machine owns terminal lifecycle

[ ] legacy compatibility events remain correct

[ ] no singleton cross-run state contamination

[ ] typecheck passes

[ ] build passes

[ ] focused AgentLoop tests pass

[ ] broader regression passes

[ ] EXECUTIVE_LOOP_SPEC.md updated

[ ] .quack-dev checkpoint updated
```

Do not move to Phase 4 before this gate passes.

---

# 12. CONCURRENCY TEST FOR PHASE 3-B

Explicitly test two sequential or concurrent LoopRuns.

Verify:

```text
run A iterations != run B iterations

run B cannot inherit:
- iterations
- budget usage
- stop reason
- paused state
- failure state
```

If AgentLoop itself is intentionally singleton/non-concurrent, document that contract and test the supported behavior.

Do not leave it ambiguous.

---

# 13. PHASE 4 — HARNESS FOUNDATION

After Phase 3-B passes, begin Phase 4.

Split Phase 4 into:

```text
4-A CapabilityDescriptor

4-B CapabilityRequest / Result compatibility

4-C Provider contract

4-D Provider registry

4-E Capability resolver

4-F normalized provider failures

4-G provider health

4-H circuit breaker

4-I execution Harness

4-J integration tests

4-K regression

4-L docs/checkpoint
```

---

# 14. CAPABILITY DESCRIPTOR

Create the smallest production-correct descriptor.

Something equivalent to:

```typescript
interface CapabilityDescriptor {
  id: string;
  name: string;
  version: string;

  providerId: string;

  inputSchema?: unknown;
  outputSchema?: unknown;

  riskLevel: RiskLevel;

  sideEffecting: boolean;
  idempotent: boolean;

  supportsCancellation: boolean;
  supportsRetry: boolean;

  timeoutMs?: number;

  requiredPermissions: string[];

  kind:
    | "digital"
    | "human"
    | "physical";
}
```

Adapt this to existing project conventions.

Do not force unnecessary fields.

---

# 15. PROVIDER CONTRACT

Providers should expose one normalized abstraction.

Conceptually:

```typescript
interface CapabilityProvider {
  descriptor(): ProviderDescriptor;

  health(): Promise<ProviderHealth>;

  execute(
    request: CapabilityRequest,
    context: ExecutionContext,
    signal: AbortSignal
  ): Promise<CapabilityResult>;
}
```

Add cancellation only once Phase 5 integrates the complete AbortSignal chain.

Do not duplicate action contracts created in Phase 2.

---

# 16. FAILURE MODEL

Normalize failures.

Examples:

```text
ProviderUnavailable
ProviderTimeout
ProviderProtocolError
CapabilityUnavailable
InvalidArguments
PermissionDenied
ExecutionFailed
ExecutionCancelled
VerificationFailed
```

Avoid:

```text
throw new Error("failed")
```

for runtime semantics.

---

# 17. CIRCUIT BREAKER

Implement the minimum correct state machine:

```text
CLOSED
  ↓ threshold reached

OPEN
  ↓ cooldown

HALF_OPEN
  ↓ success → CLOSED
  ↓ failure → OPEN
```

Test it independently before wiring into Harness.

---

# 18. PHASE 5 — TIMEOUT / RETRY / CANCELLATION

Split into:

```text
5-A AbortSignal ownership

5-B Mission → Loop propagation

5-C Loop → Action propagation

5-D Action → Harness propagation

5-E Harness → Provider propagation

5-F timeout implementation

5-G retry policy

5-H idempotency interaction

5-I cancellation tests

5-J timeout tests

5-K retry tests

5-L regression/checkpoint
```

There must be one cancellation chain:

```text
Mission
 ↓
Executive Loop
 ↓
Action
 ↓
Harness
 ↓
Provider
```

---

# 19. RETRY OWNERSHIP

Avoid multiplicative retries.

Do not allow:

```text
provider 3x
× harness 3x
× loop 3x
```

Define one retry owner for execution retries.

The Executive Loop may **replan**.

That is different from the Harness retrying a transient provider failure.

Document the distinction.

---

# 20. PHASE 6 — DURABILITY / RECOVERY

Split into:

```text
6-A persisted LoopRun schema

6-B persisted IterationRecord

6-C pending Action persistence

6-D interrupted mission detection

6-E recovery state

6-F side-effect reconciliation contract

6-G safe resume

6-H crash simulation test

6-I restart test

6-J regression/checkpoint
```

Never blindly retry a side-effecting action after process restart.

---

# 21. PHASE 7 — PERMISSIONS / RISK

Split into:

```text
7-A RiskLevel

7-B permission contract

7-C authorization decision

7-D policy evaluator

7-E denied action behavior

7-F human approval boundary

7-G physical-action boundary

7-H tests

7-I regression/checkpoint
```

No action reaches Harness execution without authorization.

---

# 22. AGENT SKILLS INTEGRATION

Do this only after core Harness semantics are stable.

Do not let Agent Skills derail production hardening.

Implement in bounded steps:

```text
S-A SKILL.md parser

S-B metadata validation

S-C registry adapter

S-D progressive disclosure

S-E references loading

S-F scripts classification

S-G trust metadata

S-H skill → ActionProposal boundary

S-I imported-skill security tests

S-J external compatibility test
```

Critical invariant:

> A skill may influence reasoning but cannot directly execute a capability.

---

# 23. GOOGLE / EXTERNAL SKILLS

Support external skills through compatibility adapters.

Do not copy the whole Google repository into QUACK.

Target:

```text
Google Skills
Community Skills
Organization Skills
User Skills
      ↓
Agent Skills parser
      ↓
QUACK registry
```

External skill packages remain untrusted until validated.

---

# 24. PHASE 8 — OBSERVABILITY

Implement incrementally:

```text
8-A canonical RuntimeEvent

8-B correlation IDs

8-C mission events

8-D iteration events

8-E action events

8-F harness/provider events

8-G structured logs

8-H metrics

8-I optional tracing hooks

8-J tests/checkpoint
```

Do not add a huge observability platform unless the project already has one.

---

# 25. PHASE 9 — CONCURRENCY / BACKPRESSURE

Split:

```text
9-A document concurrency contract

9-B mission ownership

9-C max active missions

9-D provider concurrency

9-E queue/admission

9-F cancellation under load

9-G race tests

9-H stress test

9-I checkpoint
```

---

# 26. PHASE 10 — ADVERSARIAL TESTING

Build an explicit suite for:

```text
malformed model output

hallucinated capability

provider timeout

provider returns after timeout

duplicate action

duplicate event

repeated action loop

A/B oscillation

permission denial loop

runtime crash mid-action

restart after side effect

cancel/completion race

provider circuit-breaker recovery

malicious skill

skill requests permission bypass

skill path traversal

skill script execution attempt

context growth
```

---

# 27. PHASE 11 — PERFORMANCE

Measure first.

Test:

```text
mission-loop overhead

iteration persistence cost

skill lookup

harness dispatch

provider resolution

event throughput

startup recovery

idle concurrent missions

active concurrent missions
```

Do not optimize model inference time.

---

# 28. PHASE 12 — FINAL PRODUCTION AUDIT

Create:

```text
docs/runtime/PRODUCTION_READINESS.md
```

Score:

```text
PASS
PARTIAL
FAIL
```

for:

```text
Mission lifecycle

Executive loop

Bounded execution

Action contract

Harness

Provider isolation

Timeout

Retry

Cancellation

Idempotency

Persistence

Recovery

Permissions

Physical boundary

Skill isolation

Observability

Concurrency

Backpressure

Security

Fault injection

Long-run stability
```

List:

```text
P0
P1
P2
```

No meaningful P0 may remain before declaring production-ready.

---

# 29. TEST STRATEGY

Use a testing pyramid.

For each micro-task:

```text
1. typecheck

2. narrow unit/focused test

3. affected subsystem tests
```

At phase gate:

```text
4. full regression
```

Do not run the entire repository suite after every one-line edit unless necessary.

This wastes context and compute.

---

# 30. FAILURE RULE

When a test fails:

Do not immediately patch.

Use:

```text
FAIL
 ↓
classify
 ↓
locate contract
 ↓
identify regression
 ↓
fix smallest root cause
 ↓
focused test
 ↓
regression
```

Report only the important failure details.

---

# 31. NO TEST-WRITING TO HIDE REGRESSIONS

Never modify a test merely to make the suite green unless the old expectation conflicts with the newly approved canonical contract.

If changing a test:

1. state why the previous expectation is invalid;
2. cite the new contract;
3. update implementation/spec/test together.

---

# 32. NO MASS REFACTOR

Never rewrite entire subsystems unless evidence proves incremental migration cannot preserve correctness.

Prefer:

```text
adapter
compatibility layer
gradual migration
contract tests
```

over repository-wide rewrites.

---

# 33. NO DUPLICATED ARCHITECTURE

Before adding a new:

```text
state machine
router
registry
retry system
event system
workflow engine
permission layer
```

search for an existing implementation.

If one exists:

```text
reuse
merge
replace
or explicitly deprecate
```

Do not create parallel architecture.

---

# 34. DEPRECATION RULE

When replacing legacy behavior:

Mark:

```text
legacy
adapter
canonical
removal condition
```

Example:

```text
legacy AgentLoop events
        ↓
compatibility adapter
        ↓
canonical RuntimeEvent
```

Do not leave two permanent sources of truth.

---

# 35. SOURCE OF TRUTH HIERARCHY

Use:

```text
1. Runtime contracts
2. Tests representing approved contracts
3. Current implementation
4. Historical behavior
5. Comments/documentation
```

If implementation and spec conflict, investigate.

Do not assume code is automatically correct.

---

# 36. WORK UNIT SIZE

A work unit should normally take one focused engineering objective.

Examples:

```text
Fix loop.failed regression

Implement CapabilityDescriptor

Implement circuit-breaker state machine

Thread AbortSignal Loop → Harness

Persist IterationRecord

Implement interrupted mission detection
```

Not:

```text
Complete phases 4-12
```

---

# 37. AUTOMATIC CHECKPOINT CONDITION

Checkpoint immediately when any of these occurs:

```text
a micro-gate passes

a contract changes

a significant bug is found

a phase finishes

test suite reveals a new blocker

working context grows large

more than ~5-8 important files have been inspected
```

Update:

```text
CURRENT.md
TODO.md
HANDOFF.md
TEST_STATUS.md
```

Then continue from the compact state.

---

# 38. CONTEXT COMPACTION PROCEDURE

When context becomes large:

1. Stop opening new files.
2. Update `.quack-dev/HANDOFF.md`.
3. Record exact next step.
4. Record relevant symbols/files only.
5. Drop historical details from active reasoning.
6. Continue from HANDOFF rather than reconstructing everything.

Never wait for context-limit failure.

---

# 39. TEST_STATUS.md

Maintain:

```markdown
# Test Status

## Typecheck

PASS

## Build

PASS

## AgentLoop

5 tests
4 pass
1 fail

Failure:
missing loop.failed event

## Last full regression

Not run after latest change.
```

Keep this compact.

---

# 40. DECISIONS.md

Only architectural decisions belong here.

Example:

```markdown
## ADR-007 — Skills have no execution authority

Status: Accepted

Skills provide procedural knowledge.

All side effects require ActionRequest → Policy → Harness → Provider.

Reason:
Prevents downloaded skill instructions from bypassing execution governance.
```

Do not put ordinary debugging notes here.

---

# 41. RISKS.md

Track unresolved production risks.

Example:

```text
P0 — potential duplicate external side effect after crash

P1 — provider retry ownership still split

P1 — imported skill scripts not sandboxed

P2 — metrics coverage incomplete
```

Remove risks when resolved.

---

# 42. CONTRACTS.md

Keep only compact canonical rules.

Example:

```text
Mission = desired outcome

Skill = procedural knowledge

Action = proposed operation

Capability = executable ability

Provider = implementation of capability

Harness = governed execution boundary

Executive Loop = mission decision lifecycle

NAVIQ = physical execution runtime
```

This gives future sessions fast orientation.

---

# 43. PRODUCTION INVARIANTS

These must hold throughout development:

```text
A terminal mission cannot return to RUNNING.

A cancelled mission cannot start a new action.

No capability executes without authorization.

No imported skill executes providers directly.

No physical command bypasses NAVIQ.

Retries cannot duplicate protected side effects.

Mission runtime has finite bounds.

Every provider operation has a timeout.

Cancellation reaches active work where supported.

Interrupted work is reconciled before replay.

Mission truth is structural, not chat-history-only.

Run state does not leak between missions.
```

Add tests where feasible.

---

# 44. COMPLETION DEFINITION

The project is complete when a mission such as:

```text
Investigate why production cell 4 stopped.

Use available skills and operational knowledge.

Collect evidence.

Choose appropriate capabilities.

Do not execute disruptive actions without authorization.

Use NAVIQ for physical inspection.

Recover safely from transient provider failure.

Survive runtime restart.

Verify that remediation worked.

Produce an auditable incident record.
```

can flow through:

```text
Mission
 ↓
Executive Loop
 ↓
Skill Discovery
 ↓
Decision
 ↓
Action Proposal
 ↓
Authorization
 ↓
Capability Resolution
 ↓
Harness
 ↓
Provider / Human / NAVIQ
 ↓
Evidence
 ↓
Verification
 ↓
Evaluation
 ↓
State
 ↓
Memory
 ↓
Completion
```

without special-case control flow.

---

# 45. MOST IMPORTANT EXECUTION RULE

Do not tell me:

> "I will now complete Phases 4-12."

Instead:

> "Phase 3-B is active. The current blocker is the missing `loop.failed` compatibility event. I am tracing that specific termination path first."

Then do the work.

After it passes:

> "Phase 3-B gate passed. Checkpoint written. Moving to Phase 4-A: CapabilityDescriptor."

Then continue.

---

# 46. IF CONTEXT IS RUNNING LOW

Do not attempt to rush the rest of the project.

Instead:

```text
update HANDOFF
update TODO
update TEST_STATUS
save all work
```

Then the same model can resume from repository state.

The project must be **restartable from disk**.

---

# 47. NEVER REQUIRE THE FULL CHAT HISTORY

At any point, another fresh run of the same model should be able to continue by reading only:

```text
.quack-dev/HANDOFF.md
.quack-dev/CURRENT.md
.quack-dev/TODO.md
.quack-dev/CONTRACTS.md
relevant source files
```

If that is not possible, the development harness is failing.

---

# 48. IMMEDIATE EXECUTION ORDER

Begin now with exactly this sequence:

```text
1. Read:
   .quack-dev files if they already exist.

2. Inspect:
   failing AgentLoop test around the expected loop.failed event.

3. Inspect:
   AgentLoop termination/failure path only.

4. Compare:
   canonical StopReason + mission-state transition.

5. Fix:
   smallest root cause.

6. Run:
   tsc -p tsconfig.json --noEmit

7. Run:
   build

8. Run:
   only AgentLoop tests.

9. If green:
   run affected executive-loop/mission tests.

10. Add:
    run-state isolation/concurrency regression test.

11. Run:
    relevant regression.

12. Update:
    EXECUTIVE_LOOP_SPEC.md

13. Update:
    .quack-dev checkpoint files.

14. Mark:
    Phase 3-B PASS only when every gate is satisfied.

15. Begin:
    Phase 4-A only after that.
```

---

# 49. FINAL ENGINEERING PRINCIPLE

The objective is not to maximize how much code is changed in one context window.

The objective is:

> **Every model invocation leaves QUACK in a more correct, tested, documented, and resumable state.**

A small verified change is progress.

A massive unverified refactor is debt.

Use the same model.

Use smaller working sets.

Store state in the repository.

Finish QUACK one production gate at a time.

**Resume now from the failing `loop.failed` AgentLoop regression.**
