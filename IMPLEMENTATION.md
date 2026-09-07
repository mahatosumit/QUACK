# IMPLEMENTATION.md
## QUACK Implementation Plan and Model Execution Contract

> **Purpose:** Tell any coding model or agent exactly how to decide what work is needed, what order to implement it in, what it must not redo, how to validate changes, and when a task is complete.

---

# 1. Operating rule

A model working on QUACK must **not** begin by rewriting or rescanning the entire repository.

It must first determine:

1. What is already implemented?
2. What is verified?
3. What is incomplete?
4. What is duplicated or legacy?
5. What is the smallest next implementation unit?
6. What files are actually required?
7. How will the change be validated?

Only then should it edit code.

---

# 2. Source of truth order

When deciding what to do, use this precedence:

```text
1. Current repository code
2. Current test results
3. Verification reports / CURRENT_STATE.md
4. ADRs / architecture docs
5. IMPLEMENTATION.md
6. QUACK.md
7. Historical notes / old plans
8. Model assumptions
```

Code and tests beat old documentation.

If documentation conflicts with the current repository, report the conflict and update the documentation after verification.

---

# 3. Known baseline

The most recent known baseline from the Phase 1 verification work is:

- Phase 1 trustworthy-baseline repairs were completed.
- Build passed.
- Root typecheck passed.
- SDK typecheck passed.
- A Windows candidate was built.
- The repository had substantial cleanup and baseline repair work.
- A consolidation direction was established around one canonical production agent loop.
- Legacy/duplicate runtime paths were identified for migration/removal.
- Mission storage, HTTP API, dashboard, skill package interfaces, experience/learning components, scheduler work, and capability hardening have existed in some form across prior development.

**Important:** A model must verify these facts against the current repository before relying on them. Do not reimplement something merely because this file names it.

---

# 4. Required files for project state

The repository should maintain:

```text
QUACK.md
IMPLEMENTATION.md
CURRENT_STATE.md
ARCHITECTURE.md
ROADMAP.md
DECISIONS.md or docs/adr/*
```

If some do not exist, create them only when useful and without duplicating existing documentation.

---

# 5. Model start protocol

Every implementation session must start with:

```text
STEP 1 — Read
- AGENTS.md
- QUACK.md
- IMPLEMENTATION.md
- CURRENT_STATE.md if present
- relevant ADRs

STEP 2 — Query repository intelligence
- use Graphify first when available
- identify relevant modules
- identify dependency/impact radius

STEP 3 — Inspect only relevant code
- open smallest necessary set of files
- inspect targeted tests

STEP 4 — State plan
- current state
- gap
- affected files
- implementation plan
- validation plan

STEP 5 — Implement

STEP 6 — Validate

STEP 7 — Update state docs
```

---

# 6. Graphify-first repository navigation

When Graphify is available:

```text
query graph
→ identify modules
→ inspect files
→ modify
```

Do not start with:

```text
recursive tree
recursive grep
read entire repo
full repo summary
```

unless Graphify is unavailable or insufficient.

Graphify is an optimization, not a source of truth. Code remains authoritative.

---

# 7. How to decide the next task

The model must classify candidate work into:

```text
P0 — blocks canonical runtime or correctness
P1 — required for production readiness
P2 — important capability
P3 — optimization / developer experience
P4 — optional / experimental
```

Then apply:

```text
broken correctness
    before
new features

canonicalization
    before
additional orchestration

security boundaries
    before
powerful autonomous actions

provider abstraction
    before
provider-specific features

evaluation/recovery
    before
more autonomy

state persistence
    before
long-running agents

bounded execution
    before
multi-agent scaling
```

---

# 8. Mandatory P0 architecture

The following capabilities define the minimum architecture QUACK must converge toward.

A model must first check whether each is:

```text
DONE
PARTIAL
MISSING
LEGACY
DUPLICATED
UNVERIFIED
```

## P0.1 Canonical runtime

Goal:

- exactly one production mission/agent execution loop
- no hidden alternate production path

Acceptance criteria:

- public entry points resolve to canonical runtime
- legacy runtime references are removed or isolated
- tests cover canonical path
- architecture docs identify it clearly

---

## P0.2 Durable mission state

Goal:

- mission state survives restarts

Acceptance criteria:

- mission create/read/update works
- lifecycle state persisted
- restart/resume test exists
- migrations/storage versioning handled

---

## P0.3 Provider abstraction

Goal:

- models are interchangeable

Acceptance criteria:

- canonical provider interface
- provider health/status
- model descriptors/capabilities
- no provider-specific branching in core runtime
- at least one local/OpenAI-compatible adapter verified

---

## P0.4 Model capability registry and router

Goal:

- choose models by capability/policy/cost

Acceptance criteria:

- task requirements represented structurally
- providers advertise capabilities
- deterministic routing logic
- routing reason observable
- fallback behavior defined

---

## P0.5 Typed tool registry

Goal:

- every agent action uses registered tools

Acceptance criteria:

- schemas defined
- tool execution standardized
- timeout/errors standardized
- side-effect level stored
- tool provenance/event emitted

---

## P0.6 Capability/permission enforcement

Goal:

- workers cannot perform arbitrary actions

Acceptance criteria:

- task/worker permissions
- tool capability requirements
- denied action tested
- sensitive/destructive actions gated

---

## P0.7 Evaluator

Goal:

- “model says done” is not completion

Acceptance criteria:

- success criteria model
- evaluator interface
- evidence captured
- pass/fail decision
- retry/escalation path

---

## P0.8 Bounded retry and escalation

Goal:

- no runaway agent loops

Acceptance criteria:

- max attempts
- failure reason classes
- escalation state
- budget exhaustion state
- retry events

---

## P0.9 Checkpoints / compaction

Goal:

- long missions continue without giant context

Acceptance criteria:

- checkpoint format
- checkpoint persistence
- resume from checkpoint
- preserve unresolved risks/criteria
- compact old tool chatter

---

## P0.10 Context compiler

Goal:

- feed models minimal useful context

Acceptance criteria:

- retrieval inputs
- context budget
- graph/repository adapter interface
- memory/knowledge integration points
- deterministic context package metadata

---

## P0.11 Isolated worker execution

Goal:

- parallel workers do not corrupt shared state

Acceptance criteria:

- worker workspace abstraction
- Git worktree/branch strategy for coding
- cleanup
- merge/evaluation path
- conflict handling

---

## P0.12 Open-source/privacy boundary

Goal:

- public QUACK core contains no private OPTINX/customer material

Acceptance criteria:

- secret scan
- branding/internal endpoint audit
- private config separated
- example values sanitized
- `.env.example` contains no secrets
- public/private module boundary documented

---

# 9. P1 production capabilities

Implement only after P0 foundations are stable.

## P1.1 Bounded task DAG scheduler

- dependencies
- parallel-ready detection
- worker limit
- cancellation
- resume
- failed dependency propagation

## P1.2 Skill runtime

- skill manifest
- versioning
- required tools/capabilities
- install/list/execute
- validation

## P1.3 Observation providers

Start with:

- logs
- screenshots
- source/repository state

Then extend.

## P1.4 Computer-use tool family

Only after capability and policy gates are working.

## P1.5 Search/retrieval providers

- web
- files
- repository
- memory
- knowledge

## P1.6 GitHub workflow

- issue ingestion
- branch/worktree
- implementation
- evaluation
- PR proposal

## P1.7 Authentication and workspace identity

For server/team deployments.

## P1.8 Telemetry

- traces
- metrics
- model usage
- tool usage
- evaluator results

---

# 10. P2 intelligence capabilities

Implement after runtime trustworthiness.

## P2.1 Validated knowledge promotion

Experience → validation → reusable knowledge.

## P2.2 Adaptive model routing

Learn which model performs best per task class, but retain deterministic policy controls.

## P2.3 Adaptive worker fan-out

Increase/decrease parallelism based on task DAG, compute, budget, and historical value.

## P2.4 Visual regression agent

Screenshot → detect issue → trace → patch → re-evaluate.

## P2.5 Domain adapters

Examples:

- KrishiBot
- robotics
- ADAS analysis
- enterprise automation

These should live outside core.

---

# 11. P3 optimizations

- caching
- semantic context reuse
- incremental graph updates
- provider batching
- speculative planning
- tool-call deduplication
- context compression quality improvements
- benchmark automation

---

# 12. Model decision matrix

Before coding, classify the requested change.

| Question | If YES | Action |
|---|---|---|
| Is correctness currently broken? | Yes | Fix first |
| Does it affect canonical runtime? | Yes | P0 |
| Does it introduce a side effect/tool? | Yes | Add permission/policy path |
| Does it depend on one provider? | Yes | Move provider-specific logic to adapter |
| Does it create another loop/scheduler? | Yes | Stop and integrate with canonical runtime |
| Does it add autonomy? | Yes | Require evaluator + budget + retry bounds |
| Does it need entire repo context? | Usually no | Query graph and scope files |
| Is it domain-specific? | Yes | Prefer plugin/skill/application layer |
| Does it store durable state? | Yes | Define persistence + migration + recovery |
| Is it claimed complete without evidence? | Yes | Add evaluator/test |

---

# 13. Model selection guidance

QUACK development agents should choose models by task.

## Low-cost/local model

Use for:

- mechanical refactors
- targeted tests
- documentation updates
- simple adapters
- repetitive edits

## Strong coding model

Use for:

- non-trivial TypeScript architecture
- scheduler changes
- provider interfaces
- test reconstruction

## Strong reasoning model

Use for:

- canonical runtime migration
- concurrency bugs
- policy/security architecture
- state-machine redesign
- cross-package dependency decisions

## Vision model

Use only for:

- screenshots
- visual regression
- diagrams/images

Do not use an expensive model where a local model is sufficient.

---

# 14. Task ticket format

Every meaningful implementation task should be represented like this:

```md
## TASK: <short name>

### Goal
<single measurable outcome>

### Why
<why this is required>

### Current state
<verified repository state>

### Gap
<what is missing/broken>

### Allowed scope
- path/a
- path/b

### Explicit non-goals
- unrelated refactor
- architecture redesign outside task
- new provider unless required

### Required behavior
1. ...
2. ...

### Acceptance criteria
- [ ] ...
- [ ] ...

### Validation
- targeted test:
- typecheck:
- build:
- full suite required? yes/no

### Documentation updates
- CURRENT_STATE.md
- ADR if architecture changed

### Stop conditions
Stop and report if:
- scope must expand materially
- existing architecture conflicts with task
- destructive migration is required
- test baseline is already failing
```

---

# 15. Implementation loop for coding agents

```text
UNDERSTAND
   ↓
VERIFY BASELINE
   ↓
QUERY GRAPH
   ↓
LIMIT SCOPE
   ↓
PLAN
   ↓
IMPLEMENT
   ↓
TARGETED TEST
   ↓
TYPECHECK
   ↓
EVALUATE
   ↓
UPDATE DOCS
   ↓
FULL VALIDATION AT MILESTONE
```

---

# 16. Test discipline

Do not run the full repository suite after every edit.

Preferred sequence:

```text
1. nearest unit tests
2. package tests
3. typecheck affected package
4. integration test
5. build if relevant
6. full suite once at milestone completion
```

If a targeted test fails, fix that before running broader validation.

---

# 17. Command-output discipline

Avoid sending giant logs into model context.

Prefer:

```bash
git status --short
git diff --stat
targeted-test-command
tail of failed log
```

Avoid unnecessary:

```bash
tree /
recursive directory dumps
full verbose test output
huge git diff
entire build logs when only last error matters
```

---

# 18. Scope discipline

A model must not:

- rewrite unrelated files “for cleanliness”
- introduce a new framework without justification
- rename broad APIs during a targeted bugfix
- change public behavior without acceptance criteria
- remove compatibility paths before verifying callers
- convert architecture based only on preference

If scope must expand, stop and explain why.

---

# 19. Legacy-code policy

Legacy code must be categorized:

```text
ACTIVE
COMPATIBILITY
DEPRECATED
MIGRATION_PENDING
DEAD
UNKNOWN
```

Before deleting legacy code:

1. search callers
2. graph impact
3. run tests
4. identify external/public API use
5. add migration notes if needed

---

# 20. ADR requirement

Create/update an ADR when changing:

- canonical runtime
- persistence model
- provider contract
- scheduler semantics
- security model
- plugin ABI
- public API compatibility
- memory/knowledge architecture
- major dependency

Do not create ADRs for trivial implementation details.

---

# 21. Security implementation gate

Any new powerful tool must answer:

```text
What can it access?
What can it modify?
What is its side-effect class?
Can it leak secrets?
Can untrusted content influence it?
Can it be replayed?
Can it be cancelled?
Can its action be audited?
Does it require approval?
```

If these are unanswered, the feature is incomplete.

---

# 22. Open-source readiness checklist

Before public release:

- [ ] remove private OPTINX secrets/config
- [ ] remove personal paths
- [ ] remove private URLs
- [ ] remove internal/customer data
- [ ] license audit
- [ ] dependency license audit
- [ ] secret scan
- [ ] example configuration sanitized
- [ ] contributor guide
- [ ] security policy
- [ ] code of conduct if desired
- [ ] public roadmap
- [ ] issue templates
- [ ] reproducible build
- [ ] test instructions
- [ ] provider key handling documented

---

# 23. Provider implementation contract

Each provider should implement the same behavior where possible.

Required:

```text
id
health
list models
model descriptor
generate
errors
timeouts
usage metadata
capabilities
```

Provider-specific options belong in provider config.

Do not expose provider quirks throughout core.

---

# 24. Tool implementation contract

Required for each tool:

```text
identifier
description
input schema
output schema if practical
side effect class
required permissions
timeout
cancellation support
error mapping
event emission
```

---

# 25. Evaluator implementation contract

Every evaluator must define:

```text
input
criteria
evidence
pass/fail semantics
retry recommendation
error behavior
```

Evaluation should be deterministic where possible.

---

# 26. Storage implementation contract

Persistent state changes must consider:

- migration
- rollback
- version
- transactional safety
- restart behavior
- corruption handling
- tests

---

# 27. Context compiler implementation contract

Inputs may include:

```text
task
graph results
files
memory
knowledge
skills
policies
tool schemas
```

Output should include:

```text
selected context
source refs
token/size estimate
why included
priority
```

The compiler should prefer evidence over verbosity.

---

# 28. Worker isolation implementation contract

For coding workers:

```text
create workspace
create branch/worktree
apply changes
run targeted tests
collect patch/evidence
return result
cleanup or retain on failure
```

Never allow two parallel workers to modify the same files without explicit conflict strategy.

---

# 29. Budget implementation contract

At minimum support:

```ts
interface ExecutionBudget {
  maxModelCalls?: number
  maxToolCalls?: number
  maxRetries?: number
  maxWorkers?: number
  maxDurationMs?: number
  maxCost?: number
}
```

Budget checks happen before expensive actions.

---

# 30. Failure taxonomy

Use structured failure reasons.

```text
MODEL_ERROR
TOOL_ERROR
TIMEOUT
BUDGET_EXHAUSTED
PERMISSION_DENIED
POLICY_DENIED
INVALID_PLAN
DEPENDENCY_FAILED
EVALUATION_FAILED
CONTEXT_INSUFFICIENT
USER_INPUT_REQUIRED
CANCELLED
INTERNAL_ERROR
```

Do not flatten every failure into “agent failed.”

---

# 31. Events required for observability

At minimum:

```text
mission.*
task.*
worker.*
model.*
tool.*
policy.*
evaluation.*
checkpoint.*
budget.*
```

Every event should include:

- timestamp
- mission ID
- task ID when applicable
- correlation ID
- actor/worker
- event type
- structured payload

---

# 32. Current recommended implementation sequence

The coding model should verify the repository and then execute the first incomplete item in this order:

```text
01 Canonical runtime convergence
02 Legacy runtime isolation/removal
03 Durable mission state + resume verification
04 Provider contract cleanup
05 Capability registry
06 Model router
07 Typed tool registry normalization
08 Permission/capability enforcement
09 Evaluator contract + evidence
10 Retry/escalation/budget normalization
11 Checkpoint + context compaction
12 Context compiler
13 Repository graph adapter
14 Worker isolation
15 Bounded DAG scheduler
16 Skill runtime normalization
17 Observation provider interface
18 Telemetry/trace cleanup
19 Auth/workspace layer
20 GitHub workflow
21 Computer-use tools
22 Knowledge promotion pipeline
23 Adaptive routing/fan-out
24 Domain adapters
```

**Do not blindly implement this list.**
For every item, first classify it as DONE/PARTIAL/MISSING/LEGACY/DUPLICATED/UNVERIFIED.

Skip verified completed items.

---

# 33. Required CURRENT_STATE.md format

After a milestone, maintain:

```md
# Current State

## Verified complete
- ...

## Partial
- ...

## Missing
- ...

## Deprecated/legacy
- ...

## Known failing tests
- ...

## Architecture decisions
- ...

## Next task
- ...

## Last validated
<date + commit/hash if available>
```

This prevents future models from rediscovering the project from scratch.

---

# 34. Milestone definition of done

A milestone is complete only when:

- required behavior implemented
- targeted tests pass
- typecheck passes where applicable
- build passes where applicable
- evaluator/acceptance criteria pass
- state docs updated
- no unexplained regression
- no hidden alternative production path introduced
- security implications reviewed
- public API impact documented

---

# 35. What a model must report before editing

Required short report:

```text
CURRENT STATE:
<what exists>

GAP:
<what is wrong/missing>

NEXT TASK:
<one task>

FILES:
<smallest expected file set>

VALIDATION:
<tests/checks>

RISKS:
<only real risks>
```

Then it may implement.

---

# 36. What a model must report after editing

```text
CHANGED:
<summary>

FILES:
<changed files>

VALIDATION:
<commands + outcomes>

ACCEPTANCE:
<criteria passed/failed>

REMAINING:
<next unresolved item>

DOCS:
<state/ADR updates>
```

---

# 37. Stop conditions

The model must stop instead of guessing when:

- repository baseline is already failing unexpectedly
- requested architecture conflicts with verified ADR
- required secrets/credentials are unavailable
- destructive migration is required but not authorized
- scope expansion becomes substantial
- user decision is genuinely required
- security risk cannot be resolved safely
- task cannot be validated

---

# 38. Coding model master prompt

Use this for OpenCode, Codex, Muse, Nemotron, GPT, or another coding agent:

```text
You are implementing QUACK.

Read AGENTS.md, QUACK.md, IMPLEMENTATION.md and CURRENT_STATE.md first.

Rules:
- Verify repository state before changing code.
- Use Graphify/repository graph before broad scanning when available.
- Do not redo verified completed work.
- Follow the canonical runtime architecture.
- Keep provider-specific logic outside core.
- Do not create another agent loop or scheduler unless replacing the canonical one through an explicit migration.
- Use typed tools, permission gates, bounded retries and evaluated completion.
- Keep changes scoped.
- Use targeted tests while implementing.
- Run broad validation only at milestone completion.
- Preserve backward compatibility unless the current task explicitly changes it.
- Do not leak OPTINX/private/customer data into public QUACK code.
- Update CURRENT_STATE.md after verified progress.
- Create/update an ADR only for material architecture changes.

Before editing, output:
CURRENT STATE
GAP
NEXT TASK
FILES
VALIDATION
RISKS

Then implement the smallest complete next task.

Stop and report if scope must materially expand or if the repository contradicts these documents.
```

---

# 39. Final implementation philosophy

QUACK should grow by completing trusted layers, not by accumulating features.

The order is:

```text
correct
→ canonical
→ bounded
→ observable
→ recoverable
→ evaluated
→ extensible
→ autonomous
→ optimized
```

Never reverse that order just to make QUACK look more powerful.
