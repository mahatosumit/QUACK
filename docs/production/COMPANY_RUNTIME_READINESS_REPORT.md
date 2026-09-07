# QUACK Company Runtime Readiness Report

Date: 2026-08-15

Baseline commit: `65f5abcc646b3b8b991eac53e81789261fa44aca`

Candidate branch: `codex/production-vnext`

## Decision

**COMPANY_RUNTIME_NOT_READY**

QUACK no longer constructs a permanent 18-agent organization at system boot.
It now has a versioned, durable foundation for objective-specific temporary
companies whose worker instances and grants are released after the mission,
while evidence and knowledge references persist. That foundation passes its
focused tests. The Windows nondeterminism gate is now reproducibly green, but
this is not yet the complete Company Runtime described by the release gate.

## Baseline and verification

| Gate | Result | Evidence |
|---|---|---|
| Baseline build/typecheck/lint | PASS | All passed before changes |
| Baseline regression | PASS | 1,093 passed; 0 failed; 0 skipped; 88.001 s |
| Final build/typecheck/lint | PASS | `npm run build`, `npm run typecheck`, `npm run lint` |
| Company Runtime focused tests | PASS | 10 passed; 0 failed |
| Final regression | PASS_X5 | Five consecutive post-fix runs passed 1,103/1,103; durations 111.203 s, 110.291 s, 113.104 s, 112.476 s, 111.817 s |
| NVIDIA environment | BLOCKED_BY_SECRET_VISIBILITY | `Boolean(process.env.NVIDIA_API_KEY) === false`; no request sent |
| Ollama | BLOCKED_NOT_INSTALLED | Existing doctor and production report; no model downloaded |

The current [official NVIDIA LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis)
confirms the configured hosted endpoint as
`https://integrate.api.nvidia.com/v1/chat/completions`. Endpoint validation is
not live model certification. No model ID is claimed because QUACK could not
authenticate or discover a usable hosted model in this process.

The previous nondeterministic gate is closed for this Windows baseline. Raw
process diagnostics identified a Node 24/V8 Windows `0xC0000409` crash rather
than a semantic verification failure. The verifier mitigation, bounded test
runner, and explicit worktree reconciliation passed the required 20-run
targeted canary and five-run full regression. See
`NONDETERMINISM_ROOT_CAUSE.md` for evidence and remaining runtime uncertainty.

## Architecture changes

- Added `QUACK Company Runtime Contract v1` (`quack.company/v1`).
- Added durable Company -> Goal -> Project -> Mission ancestry and success criteria.
- Replaced boot-time `spawnAllAgents()` with zero live organization agents.
- Added deterministic research, software, and company-operations team planners.
- Added bounded parent/child topology: four concurrent, three children, depth two,
  twelve total; recursion, unknown parents, and excess fan-out fail closed.
- Added exactly one independent verifier per plan and verifier-last task edges.
- Added SQLite mission-company records with monotonic revisions and serialized
  immediate transactions; stale revisions are rejected.
- Added mission/agent-scoped grants, hard usage ceilings, dormant snapshots,
  evidence/knowledge references, and explicit startup reconciliation.
- Added opaque runtime-issued Company execution principals bound to mission,
  agent instance, grant, and expiring lease for tool and action entry points.
- Added a validated bounded-concurrency Company DAG scheduler with dependency
  ordering, named-resource locks, retry caps, verifier-last execution, timeout,
  cancellation drain, and persisted task-transition support.
- Completion now requires `VERIFYING`, the designated verifier identity, an
  approved verdict, and linked durable evidence.
- CLI, desktop app, and self-created server instances run startup reconciliation;
  pure system composition remains side-effect-free for embedding and tests.

## Upstream decisions

| Source | Decision |
|---|---|
| Paperclip | ADAPT_PATTERN_ONLY |
| Agency Agents | OPTIONAL_IMPORTER |
| Agent Swarm | ADAPT_PATTERN_ONLY |
| Gas Town | ADAPT_PATTERN_ONLY |
| Microsoft Agent Framework | ADAPT_PATTERN_ONLY |
| Dapr Agents | OPTIONAL_ADAPTER |
| Zeroshot | ADAPT_PATTERN_ONLY |
| OpenHands | OPTIONAL_ADAPTER |
| OpenAkita | REFERENCE_ONLY |
| Ruflo | REJECT_FOR_CORE |
| Karpathy LLM Wiki | ADAPT_PATTERN_ONLY |

Detailed primary-source evidence and license notes are in
`docs/research/AGENT_COMPANY_RUNTIME_COMPARISON.md`.

## Agent Runtime and conformance

| Area | Status | Evidence / blocker |
|---|---|---|
| Temporary spawn | PASS_FOUNDATION | Objective-specific instances are created only by `assemble()` |
| Parent/child plan | PASS_FOUNDATION | Bounded and cycle-checked durable plan |
| Completion and dormancy | PASS_FOUNDATION | Workers/grants released; metrics/evidence/knowledge persist |
| Budget hard stop | PASS_FOUNDATION | Overrun fails mission and releases live workers |
| Independent verification | PASS_FOUNDATION_WITH_IDENTITY_RISK | Correct designated instance and evidence required; opaque principals cover Company tool/actions, not every egress path |
| Restart handling | PASS_FAIL_CLOSED | Interrupted companies become failed/dormant; resumable lease recovery is absent |
| Parallel DAG execution | PASS_FOUNDATION | Deterministic overlap, dependency, verifier-last, retry, cycle, timeout, and cancellation-drain tests pass |
| Resource-aware scheduling | PARTIAL | Exclusive named-resource locks pass; no CPU/RAM/GPU/VRAM/provider/workspace claim ledger |
| Workspace isolation | NOT_IMPLEMENTED | `git-worktree` is declarative only |
| Dynamic subagents | NOT_IMPLEMENTED | Initial plan only; no runtime delegation API |
| AGT-001–020 suite | NOT_IMPLEMENTED | Ten focused foundation tests are not the required conformance suite |

## Security findings

The release remains blocked by these reviewed risks:

1. Company tool/action entry points now require opaque execution principals, but
   model/provider and terminal egress paths do not yet enforce the same boundary.
2. The Company scheduler signals and drains operations, but an external action
   can ignore abort; teardown outside the scheduler can still race a late effect.
3. Capability grant creation remains a public registry operation with caller-authored
   approval metadata; issuance authority must be separated from query/revocation.
4. Company worktree leases, overlap detection, fencing tokens, heartbeat expiry,
   concrete capacity claims, and orphan garbage collection are absent.
5. Knowledge references persist, but source hashing, contradiction tracking,
   lint, and verifier-gated promotion are not enforced.
6. Local-only zero-cloud is proven for the canonical provider router only, not
   every legacy model, terminal, tool, and action path.

## UI, routines, importers, and knowledge

- Company Control Room UI: **NOT_IMPLEMENTED**. Existing surfaces were preserved.
- Routines: **NOT_IMPLEMENTED**; current time primitives are not durable mission triggers.
- Agency Agents importer: **NOT_IMPLEMENTED**; classified optional importer only.
- Knowledge Fabric: **PARTIAL_CONTRACT**; evidence/knowledge references survive
  dormancy, but ingestion/lint/provenance enforcement is open.
- Obsidian adapter: **OPTIONAL_NOT_IMPLEMENTED**.
- Graphify adapter: **OPTIONAL_NOT_IMPLEMENTED**.

## Required next closure order

1. Make `NVIDIA_API_KEY` visible to the actual QUACK process and run live NVIDIA
   mission/PCT certification without exposing or persisting the credential.
2. Extend opaque execution principals through model/provider/terminal egress and
   one mission grant and privacy boundary.
3. Add lease fencing, atomic durable DAG claims, crash replay, concrete compute
   resources, and worktree ownership on top of the scheduler foundation.
4. Implement and pass AGT-001–020 plus all adversarial tests.
5. Run deterministic parallel, coding-team, research-team, and solo-company missions.
6. Add durable routines/importer/knowledge lint, then expose real state in the
   Control Room with accessibility and E2E gates.
7. Re-run performance/security audits and live Ollama certification if installed.

No external write, purchase, message, email, financial action, or live provider
inference was performed in this phase.
