# QUACK.md
## QUACK — Model-Independent Agent Runtime and Intelligence Operating Layer

> **Status:** Product/architecture constitution  
> **Purpose:** Define what QUACK is, what it is not, how its major subsystems fit together, and the engineering principles every future implementation must preserve.

---

## 1. One-sentence definition

**QUACK is a model-independent agent runtime that turns goals into bounded, observable, verifiable execution using pluggable models, tools, memory, knowledge, skills, policies, and isolated workers.**

QUACK is not “another chatbot” and it is not “another coding CLI.” Coding is one workload. The same runtime should later support research, automation, robotics workflows, enterprise agents, agriculture workflows, ADAS analysis, knowledge systems, and other OPTINX/non-OPTINX products without coupling QUACK to any one product.

---

## 2. Core mission

QUACK should make intelligent systems:

1. **Model-independent** — GPT, Nemotron, Muse, GLM, local models, or future providers can be swapped without redesigning the runtime.
2. **Tool-capable** — models act through typed, permissioned tools rather than through unstructured side effects.
3. **Stateful** — missions survive long sessions, restarts, compaction, and model changes.
4. **Bounded** — agents operate within explicit scope, budgets, path limits, tool limits, and step limits.
5. **Inspectable** — every important action is observable, attributable, and auditable.
6. **Evaluated** — results are checked against success criteria before being accepted.
7. **Recoverable** — failures can retry, escalate, roll back, or resume from checkpoints.
8. **Efficient** — QUACK minimizes repeated repository scanning, unnecessary context, redundant tool calls, and runaway subagents.
9. **Safe by architecture** — high-impact actions require capability gates and policy checks.
10. **Open-source ready** — the core must not leak private OPTINX data, private infrastructure, secrets, internal branding assumptions, or proprietary workflows.

---

## 3. What QUACK is NOT

QUACK must not become:

- A hard-coded wrapper for one LLM provider.
- A giant prompt with hidden architecture.
- A collection of unrelated “agents” with no canonical execution model.
- A framework where every feature creates a new agent loop.
- A coding-only product.
- A memory store that treats every model output as truth.
- A workflow engine that silently performs destructive actions.
- A system that requires huge context windows to function.
- A system that rediscoveries the same repository architecture every run.
- An unbounded multi-agent swarm.
- A product that stores private company/project data in the public core.

---

# 4. Product principles

## 4.1 One canonical execution loop

There must be exactly one production execution path for missions.

Legacy loops, duplicate executive brains, alternate schedulers, experimental routers, or older orchestration systems may exist temporarily during migration, but production runtime behavior must converge on one canonical loop.

Conceptually:

```text
Goal
  ↓
Mission
  ↓
Context Build
  ↓
Plan / Task DAG
  ↓
Policy + Capability Check
  ↓
Supervisor
  ↓
Worker Execution
  ↓
Tool Calls / Observations
  ↓
Evaluation
  ↓
Retry / Escalate / Complete
  ↓
Checkpoint + Experience
```

---

## 4.2 Models reason; QUACK owns the system

The model should not own durable system behavior.

QUACK owns:

- mission state
- tool registry
- provider registry
- capabilities
- permissions
- policies
- memory
- knowledge
- skills
- budgets
- checkpoints
- execution history
- evaluations
- experience
- observability
- retry logic
- model routing

Models are replaceable reasoning engines.

---

## 4.3 Knowledge is not memory

These must be separate concepts.

### Working context
Short-lived information needed for the current step.

### Mission memory
State and facts required for the active mission.

### Experience
Records of what happened previously, including outcomes and evidence.

### Knowledge
Validated reusable information that has passed quality checks.

### Skills
Reusable procedures or tool-usage recipes.

### Policy
Rules governing what may or may not be done.

A model response must never automatically become “knowledge.”

---

# 5. High-level architecture

```text
                         ┌────────────────────────────┐
                         │          CLIENTS           │
                         │ CLI / API / SDK / UI / MCP │
                         └──────────────┬─────────────┘
                                        │
                                        ▼
                         ┌────────────────────────────┐
                         │       MISSION LAYER        │
                         │ goals, constraints, state  │
                         └──────────────┬─────────────┘
                                        │
                                        ▼
               ┌──────────────────────────────────────────────┐
               │               CONTEXT COMPILER               │
               │ graph + files + memory + knowledge + skills │
               └──────────────────────┬───────────────────────┘
                                      │
                                      ▼
                         ┌────────────────────────────┐
                         │       PLANNER / DAG        │
                         └──────────────┬─────────────┘
                                        │
                                        ▼
                         ┌────────────────────────────┐
                         │         SUPERVISOR         │
                         │ budget / scope / workers   │
                         └───────┬──────────┬─────────┘
                                 │          │
                    ┌────────────┘          └────────────┐
                    ▼                                    ▼
          ┌───────────────────┐                ┌───────────────────┐
          │     WORKER A      │                │     WORKER B      │
          │ isolated context  │                │ isolated context  │
          └─────────┬─────────┘                └─────────┬─────────┘
                    │                                    │
                    ▼                                    ▼
          ┌───────────────────┐                ┌───────────────────┐
          │ TOOL / OBSERVATION│                │ TOOL / OBSERVATION│
          └─────────┬─────────┘                └─────────┬─────────┘
                    └────────────────┬───────────────────┘
                                     ▼
                         ┌────────────────────────────┐
                         │         EVALUATOR          │
                         └──────────────┬─────────────┘
                                        │
                         ┌──────────────┴─────────────┐
                         ▼                            ▼
                    complete                    retry/escalate
                         │                            │
                         └──────────────┬─────────────┘
                                        ▼
                         ┌────────────────────────────┐
                         │ CHECKPOINT + EXPERIENCE    │
                         └────────────────────────────┘
```

---

# 6. Required subsystems

## 6.1 Mission system

A Mission is the durable unit of work.

Minimum fields:

```ts
interface Mission {
  id: string
  goal: string
  constraints: MissionConstraint[]
  successCriteria: SuccessCriterion[]
  status: MissionStatus
  priority: number
  createdAt: string
  updatedAt: string
  budget: MissionBudget
  contextRefs: string[]
  currentPlanId?: string
}
```

Mission state must survive process restarts.

Recommended statuses:

```text
CREATED
PLANNING
READY
RUNNING
BLOCKED
WAITING
EVALUATING
RETRYING
COMPLETED
FAILED
CANCELLED
```

---

## 6.2 Canonical agent runtime

The canonical runtime is responsible for:

- loading mission state
- building context
- selecting/creating a plan
- routing model requests
- invoking tools
- tracking step count
- enforcing budgets
- persisting checkpoints
- running evaluation
- retrying or escalating
- marking completion

There must not be separate production loops for coding, research, automation, or robotics. Domain-specific behavior belongs in skills, policies, tools, planners, and observation providers.

---

## 6.3 Planner and task DAG

Complex missions should be decomposed into tasks with explicit dependencies.

```ts
interface TaskNode {
  id: string
  goal: string
  dependencies: string[]
  successCriteria: string[]
  allowedTools?: string[]
  allowedPaths?: string[]
  modelRequirements?: ModelRequirements
  status: TaskStatus
}
```

The scheduler must support:

- sequential tasks
- independent parallel tasks
- bounded concurrency
- retries
- failed dependency handling
- cancellation
- resumption
- task-level budgets

Parallelism must be useful, not automatic.

---

## 6.4 Supervisor / worker model

### Supervisor responsibilities

- understand the mission
- maintain global state
- choose which tasks can run
- allocate workers
- enforce budgets
- merge worker outputs
- ask evaluator for verification
- retry or escalate when necessary

### Worker responsibilities

- perform one scoped assignment
- use only allowed tools
- stay inside allowed paths/domain
- return evidence
- escalate instead of improvising outside scope

Worker contract:

```ts
interface AgentAssignment {
  goal: string
  allowedTools: string[]
  allowedPaths?: string[]
  maxSteps: number
  successCriteria: string[]
  contextRefs: string[]
  escalationPolicy: "RETURN" | "ASK" | "ABORT"
}
```

---

## 6.5 Isolated execution

Parallel coding workers should not edit the same working tree.

Preferred implementation:

```text
main repo
   ├── worker-A worktree / branch
   ├── worker-B worktree / branch
   └── worker-C worktree / branch
```

For non-code workloads, workers still require isolated state and namespaces where practical.

Isolation goals:

- prevent file collisions
- make rollback possible
- make provenance clear
- allow independent evaluation
- simplify merge decisions

---

## 6.6 Model provider abstraction

QUACK must support many providers through a common contract.

```ts
interface ModelProvider {
  id: string
  listModels(): Promise<ModelDescriptor[]>
  generate(request: ModelRequest): Promise<ModelResponse>
  stream?(request: ModelRequest): AsyncIterable<ModelEvent>
  healthCheck(): Promise<ProviderHealth>
}
```

Provider examples:

- OpenAI-compatible APIs
- OpenAI
- NVIDIA / Nemotron
- Meta / Muse-compatible endpoints
- Ollama
- LM Studio
- llama.cpp
- vLLM
- local custom adapters
- future providers

No provider-specific logic belongs in the canonical runtime.

---

## 6.7 Model capability registry

QUACK should route by capability, not name.

```ts
interface ModelCapabilities {
  reasoning: boolean
  coding: boolean
  vision: boolean
  audio: boolean
  toolCalling: boolean
  structuredOutput: boolean
  computerUse: boolean
  contextWindow: number
  maxOutputTokens: number
  local: boolean
  costClass: "FREE" | "LOW" | "MEDIUM" | "HIGH"
  latencyClass: "LOW" | "MEDIUM" | "HIGH"
}
```

A task asks for capabilities:

```ts
interface ModelRequirements {
  required: Array<keyof ModelCapabilities>
  preferred?: Array<keyof ModelCapabilities>
  maxCostClass?: string
  preferLocal?: boolean
}
```

---

## 6.8 Model router

Selection should consider:

1. required capabilities
2. safety/policy restrictions
3. task type
4. quality requirement
5. local availability
6. latency
7. cost
8. context size
9. current provider health
10. user preferences

Model routing must be explainable.

Example:

```text
Task: TypeScript refactor
Needs: coding + tools
Prefer: local + low cost

Candidates:
Nemotron local   ✓
GPT              ✓
vision model     unnecessary

Selected: Nemotron local
Reason: satisfies all requirements at lowest configured cost
```

---

## 6.9 Tool system

Tools must be typed and registered.

```ts
interface ToolDefinition {
  id: string
  description: string
  inputSchema: unknown
  outputSchema?: unknown
  permissions: CapabilityRequirement[]
  sideEffectLevel: SideEffectLevel
  timeoutMs: number
}
```

Side-effect classes:

```text
READ_ONLY
INTERACTIVE
WRITE
DESTRUCTIVE
SENSITIVE
```

Examples:

```text
file.read              READ_ONLY
web.search             READ_ONLY
browser.click          INTERACTIVE
file.write             WRITE
git.commit             WRITE
file.delete            DESTRUCTIVE
email.send             SENSITIVE
purchase.execute       SENSITIVE
```

---

## 6.10 Capability and permission system

Agents must not get universal access.

Permissions should be granted per:

- mission
- task
- worker
- tool
- environment

Capabilities should be revocable.

Sensitive operations should support approval policies.

---

## 6.11 Policy engine

The policy engine evaluates:

```text
agent
mission
task
tool
arguments
environment
risk
user policy
```

and returns:

```text
ALLOW
DENY
REQUIRE_APPROVAL
ALLOW_WITH_LIMITS
```

Policies must be code/config driven, not prompt-only.

---

# 7. Context architecture

## 7.1 Context compiler

QUACK should not dump entire repositories or knowledge stores into a model.

The Context Compiler assembles the minimum relevant context from:

- Graphify/repository graph
- AST/symbol data
- source files
- mission memory
- validated knowledge
- experience
- skills
- policies
- user-provided files
- external retrieval

Concept:

```text
Question/task
   ↓
Graph lookup
   ↓
Relevant modules/entities
   ↓
Relevant memory/knowledge
   ↓
Compact context package
   ↓
Model
```

---

## 7.2 Graphify integration

Graphify should be an optional repository intelligence adapter, not a hard dependency of QUACK core.

Uses:

- symbol relationships
- module dependencies
- impact analysis
- likely relevant files
- execution path discovery
- reducing broad repository scans

QUACK should eventually expose a generic repository graph interface so other graph engines can replace Graphify.

```ts
interface CodeGraphProvider {
  query(input: CodeGraphQuery): Promise<CodeGraphResult>
  neighbors(nodeId: string): Promise<CodeGraphNode[]>
  impact(nodeId: string): Promise<CodeGraphNode[]>
}
```

---

## 7.3 Context budgets

Every task should have a context budget.

The system should prefer:

1. summaries
2. relevant graph nodes
3. exact file slices
4. full files only when necessary
5. large raw logs only as a last resort

---

# 8. Context compaction and checkpoints

Long-running agents need compaction.

Checkpoint schema:

```ts
interface MissionCheckpoint {
  missionId: string
  completed: string[]
  verified: string[]
  unresolved: string[]
  currentDecision: string[]
  nextActions: string[]
  relevantArtifacts: string[]
  relevantFiles: string[]
  evidenceRefs: string[]
  createdAt: string
}
```

Compaction must preserve facts and evidence while discarding repetitive conversation/tool chatter.

Never compact away:

- unresolved risks
- failed tests
- user constraints
- security decisions
- acceptance criteria
- destructive actions
- evidence links
- pending approvals

---

# 9. Memory system

QUACK memory should be layered.

```text
Working Memory
Mission Memory
Session Memory
Experience Store
Validated Knowledge Store
```

Memory entries should have:

- source
- timestamp
- confidence
- scope
- provenance
- expiry policy
- validation status

---

# 10. Experience and learning

QUACK may learn from previous missions without retraining model weights.

Pipeline:

```text
Execution
  ↓
Outcome
  ↓
Evaluation
  ↓
Correction
  ↓
Evidence check
  ↓
Regression check
  ↓
Experience Store
  ↓
Knowledge candidate
  ↓
Validation
  ↓
Knowledge Store
```

Never promote failures or unverified model claims into knowledge.

---

# 11. Skill system

A Skill is a reusable procedure.

Examples:

- repository audit
- TypeScript refactor
- GitHub issue triage
- research paper review
- PDF extraction
- deployment verification
- visual regression workflow
- robotics diagnostic routine

Skill definition should include:

```ts
interface Skill {
  id: string
  version: string
  description: string
  requiredTools: string[]
  requiredCapabilities: string[]
  procedure: SkillStep[]
  validation: SkillValidation[]
}
```

Skills must be versionable.

---

# 12. Observation system

Agents should reason from observations, not only text.

Generic interface:

```ts
interface ObservationProvider {
  id: string
  observe(request: ObservationRequest): Promise<Observation>
}
```

Potential providers:

- logs
- screenshots
- DOM
- video frames
- telemetry
- source code
- sensor values
- database state
- command output

This abstraction is important because QUACK should support coding today and robotics/ADAS/automation later.

---

# 13. Computer-use abstraction

Computer control should be a tool family, not model-specific logic.

```text
computer.screenshot
computer.click
computer.type
computer.keypress
computer.scroll
computer.drag
computer.inspect
```

All actions must pass permission and policy checks.

---

# 14. Evaluation architecture

Completion must be evidence-based.

Evaluator types may include:

- tests
- compiler/typecheck
- lint
- build
- schema validation
- screenshots
- benchmark thresholds
- factual verification
- user-defined criteria
- security checks
- policy checks

Evaluation result:

```ts
interface EvaluationResult {
  passed: boolean
  score?: number
  failedCriteria: string[]
  evidence: EvidenceRef[]
  recommendation: "ACCEPT" | "RETRY" | "ESCALATE" | "REJECT"
}
```

---

# 15. Retry and escalation

Retries must be bounded.

Retry policies should distinguish:

- transient failure
- tool failure
- bad plan
- insufficient context
- model failure
- permission denial
- evaluation failure

A worker should be able to say:

```text
BLOCKED: missing permission
BLOCKED: task requires files outside allowed scope
BLOCKED: success criterion is ambiguous
BLOCKED: dependency failed
```

instead of hallucinating progress.

---

# 16. Budget system

QUACK needs explicit budgets.

Possible budgets:

```text
max model calls
max tokens
max cost
max tool calls
max wall-clock time
max retries
max worker count
max context size
```

Budget exhaustion should result in a controlled state, not silent termination.

---

# 17. Multi-agent execution

Multi-agent behavior is optional and bounded.

Use multiple agents only when tasks are truly independent.

Default policy:

```text
simple task      -> 1 worker
medium task      -> 1 worker, optional reviewer
parallelizable   -> bounded worker pool
high-risk task   -> worker + independent evaluator
```

Never equate “more agents” with “better result.”

---

# 18. Repository intelligence

For coding workloads:

```text
Task
 ↓
Graph query
 ↓
Relevant files
 ↓
Targeted reads
 ↓
Change
 ↓
Targeted validation
 ↓
Full validation at milestone
```

Avoid:

```text
recursive scan
read everything
full tests repeatedly
huge logs
unbounded grep
```

---

# 19. Plugin architecture

Plugins should extend QUACK without modifying core.

Plugin categories:

- model provider
- tool
- observation provider
- memory backend
- knowledge backend
- evaluator
- policy
- repository graph provider
- UI/transport
- skill package

Plugin metadata should include version and compatibility requirements.

---

# 20. API surface

QUACK should provide stable programmatic interfaces.

Recommended external surfaces:

- TypeScript/JavaScript SDK
- HTTP API
- CLI
- MCP server/client integration where useful
- event stream/websocket for live missions

Core API concepts:

```text
createMission
startMission
pauseMission
resumeMission
cancelMission
getMission
getMissionEvents
registerProvider
registerTool
registerSkill
evaluateMission
```

---

# 21. Event system

Important runtime behavior should be event-driven and observable.

Example events:

```text
mission.created
mission.started
mission.completed
mission.failed

plan.created
task.started
task.completed
task.failed

model.requested
model.responded
model.failed

tool.requested
tool.completed
tool.failed

policy.allowed
policy.denied
approval.requested

checkpoint.created
evaluation.completed
memory.updated
knowledge.promoted
```

Events should have correlation IDs.

---

# 22. Observability

Minimum observability:

- structured logs
- mission timeline
- task timeline
- model call metrics
- tool call metrics
- token/cost estimates
- retry count
- evaluator outcomes
- error traces
- provider health
- worker state

Eventually add:

- OpenTelemetry
- traces
- metrics
- dashboard
- exportable run bundles

---

# 23. Provenance

Every important result should be traceable to:

- model response
- tool output
- file
- database record
- web source
- user input
- prior validated knowledge

This is essential for research, enterprise, and safety-critical use cases.

---

# 24. Security

Core requirements:

- secret redaction
- environment isolation
- path restrictions
- tool permissions
- prompt-injection defenses
- untrusted content boundaries
- output sanitization
- network policy controls
- safe subprocess execution
- approval gates
- audit logging

Never expose secrets to model context unless absolutely required.

---

# 25. Privacy and open-source boundary

The public QUACK core must not contain:

- OPTINX secrets
- private customer data
- internal credentials
- private endpoint URLs
- unpublished business plans
- personal information
- hard-coded product dependencies
- private model keys
- internal infrastructure identifiers

Preferred structure:

```text
quack-core/              public
quack-sdk/               public
quack-cli/               public
quack-provider-*         public where license allows
private-integrations/    private
optinx-internal/         private
```

QUACK branding itself may remain, but the runtime must work independently of OPTINX.

---

# 26. Authentication and tenancy

QUACK should support authentication at deployment level.

Capabilities:

- API keys
- user identities
- service identities
- organizations/workspaces
- roles
- scoped permissions

Do not force multi-tenancy into the smallest local runtime, but keep the architecture compatible with it.

---

# 27. Storage

Storage interfaces should be abstracted.

Potential backends:

```text
SQLite        local/default
PostgreSQL    server/enterprise
filesystem    artifacts
object store  large artifacts
vector DB     optional semantic retrieval
graph DB      optional knowledge graph
```

SQLite is appropriate for local mission state and lightweight installations.

---

# 28. Artifact system

Agents should be able to create and reference artifacts.

Examples:

- patches
- reports
- generated documents
- screenshots
- benchmark results
- build outputs
- model traces

Artifacts require:

- ID
- path/reference
- MIME/type
- provenance
- checksum
- owner mission
- creation time

---

# 29. Search and retrieval

Search should be a tool/provider abstraction.

Types:

- repository search
- web search
- knowledge search
- memory search
- file search
- database search

Search results should preserve provenance.

---

# 30. Coding-agent workload

QUACK should support a first-class coding workflow without becoming coding-only.

```text
Issue / goal
  ↓
Repository graph
  ↓
Plan
  ↓
Scoped worker
  ↓
Isolated branch/worktree
  ↓
Patch
  ↓
Targeted tests
  ↓
Review/evaluation
  ↓
Merge proposal
```

Possible future GitHub workflow:

```text
issue -> branch -> implementation -> tests -> review -> PR
```

---

# 31. Research-agent workload

```text
research question
  ↓
source search
  ↓
source quality filter
  ↓
evidence extraction
  ↓
claim/evidence graph
  ↓
analysis
  ↓
citation validation
  ↓
report
```

---

# 32. Robotics / automation workload

QUACK must eventually be able to orchestrate real-world systems through adapters.

Concept:

```text
Mission
 ↓
Planner
 ↓
Policy
 ↓
Robot/automation tools
 ↓
Sensor observations
 ↓
Evaluator
 ↓
next action
```

Safety-critical control loops should remain deterministic and local; LLMs should not directly replace hard real-time controllers.

QUACK should operate at supervisory/task-planning level unless a specific validated architecture permits otherwise.

---

# 33. ADAS workload boundary

QUACK may support:

- scenario analysis
- log interpretation
- simulation orchestration
- test generation
- dataset analysis
- anomaly review
- planning outside hard real-time control

QUACK should not be the direct safety-critical steering/braking control loop.

---

# 34. Deployment modes

### Local developer
- SQLite
- local models
- local tools
- CLI
- single user

### Team server
- PostgreSQL
- auth
- shared providers
- API
- web dashboard

### Edge/robot
- constrained runtime
- local model or remote provider
- deterministic policy layer
- device adapters

### Enterprise
- tenancy
- audit
- policy packs
- external secrets manager
- observability stack
- deployment controls

---

# 35. Configuration

Configuration hierarchy should support:

```text
defaults
 ↓
system config
 ↓
workspace config
 ↓
mission config
 ↓
task override
```

No important production behavior should depend only on hidden prompts.

---

# 36. Testing strategy

Minimum test categories:

- unit tests
- provider contract tests
- tool contract tests
- scheduler tests
- mission recovery tests
- memory tests
- policy tests
- permission tests
- evaluator tests
- integration tests
- adversarial tests
- regression tests
- benchmark harness

---

# 37. Benchmarking

QUACK should benchmark itself against classes of tools, not only one competitor.

Dimensions:

- task completion rate
- tool-call efficiency
- context efficiency
- wall-clock latency
- token usage
- model cost
- recovery success
- hallucination/error rate
- safety-policy compliance
- repository modification accuracy
- test pass rate

Coding benchmarks may later include public benchmark suites where licensing and environment permit.

---

# 38. Compatibility goals

QUACK should aim for:

- OpenAI-compatible model endpoints
- MCP interoperability
- GitHub integration
- local model runtimes
- REST/HTTP tools
- standard JSON schemas
- portable skill packages

Avoid unnecessary proprietary lock-in.

---

# 39. Suggested package architecture

Illustrative target structure:

```text
packages/
  core/
    mission/
    runtime/
    planner/
    scheduler/
    evaluator/
    events/

  providers/
    base/
    openai-compatible/
    local/

  tools/
    registry/
    permissions/
    builtins/

  context/
    compiler/
    graph/
    retrieval/

  memory/
    working/
    mission/
    experience/
    knowledge/

  policy/
    engine/
    approvals/

  skills/
    runtime/
    registry/

  observations/
    base/
    screenshot/
    log/

  storage/
    sqlite/
    postgres/

  telemetry/
    logging/
    tracing/
    metrics/

  sdk/
  cli/
  api/
```

The actual repository may differ. The important requirement is clear ownership and separation of concerns.

---

# 40. Architectural invariants

Future models/agents modifying QUACK must preserve these unless an ADR explicitly changes them:

1. One canonical runtime.
2. Model-independent core.
3. Typed tools.
4. Permission checks before side effects.
5. Durable mission state.
6. Evaluated completion.
7. Bounded retries.
8. Bounded multi-agent execution.
9. Context is compiled, not dumped.
10. Knowledge requires validation.
11. Provider-specific logic stays outside core.
12. Domain-specific behavior stays outside core.
13. Safety-critical real-time control is not delegated blindly to LLMs.
14. Public core contains no private OPTINX/customer data.
15. Every major action is observable.
16. Important results retain provenance.

---

# 41. Decision rule for new features

Before adding any feature, ask:

```text
Does this belong in the core runtime?
Does it belong in a plugin?
Does it belong in a skill?
Does it belong in a provider?
Does it belong in a domain application instead?
```

Default to the smallest appropriate layer.

---

# 42. North-star behavior

A mature QUACK should be able to receive:

```text
"Fix issue #421 in this repository."
```

and safely:

```text
understand repository structure
→ build minimal context
→ plan
→ select model
→ create isolated worker
→ modify code
→ run targeted validation
→ evaluate result
→ retry if necessary
→ produce evidence
→ prepare merge/PR
→ preserve mission state
```

Then receive:

```text
"Analyze this field dataset and propose an irrigation intervention."
```

and use the same core runtime with different tools, knowledge, policies, and skills.

That is the definition of QUACK being a real runtime rather than a collection of demos.

---

# 43. Final product identity

**QUACK should become an execution and intelligence substrate.**

Models provide reasoning.

Tools provide action.

Observations provide reality.

Memory provides continuity.

Knowledge provides validated reuse.

Policies provide boundaries.

Evaluators provide trust.

QUACK connects them into one durable runtime.
