# QUACK Current State

**Verified:** 2026-09-08 (Phase 5 complete)

## Baseline

Phase 1 is complete. Its verification report records passing root and SDK
typechecks, build, lint, full test suite, and public-release staging. Phase 2
is in progress. This document records only current, reproducible evidence;
historical architecture audits remain context, not proof of current behavior.

## Subsystem status

| Subsystem | Status | Current evidence |
| --- | --- | --- |
| Phase 1 correctness and authority invariants | DONE | `.phase1-checks/PHASE1_REPORT.md` records the completed verification. |
| Canonical public mission runtime | DONE | CLI, API, HTTP server, SDK, and direct `QuackRuntime` submit through `QuackRuntime → SessionRuntime → DefaultLoopDriver → WorkflowEngine/ExecutionScheduler → CapabilityBroker → explicit verification`. |
| Session runtime, workflow engine, scheduler | PARTIAL | The public mission path is verified. `CompanyTaskScheduler` is an explicitly unsupported compatibility boundary; it no longer owns a workflow engine or scheduler and cannot run arbitrary callbacks. |
| Agent loop | DONE | `DefaultLoopDriver` is the active public loop. The exported `AgentLoop` is a compatibility facade that delegates to `QuackRuntime` and rejects standalone execution. |
| Capability authority | DONE | Phase 1 verified fail-closed authority and child attenuation. New extension-policy integration is PARTIAL until phase-level verification. |
| Typed tool execution | PARTIAL | The governed runtime dispatches registered tools through the capability broker. Unified tool/provider materialization is implemented (ADR 0032), and live dispatch seams are now wired (ADR 0036): the SWE composition's exposed `modelRuntime` shadows `generate`/`stream` with broker-gated versions, `governedProviderRouter` and `governedModelRuntime` are exposed on the system surface, and MCP action evidence carries operation identity, retry safety, permissions, provider version, and namespace. Remaining: SWE-distribution caller migrations beyond the system surface. |
| Portable skill execution | PARTIAL | Portable skills submit task graphs to `QuackRuntime.executeGraph`. On 2026-09-04, promoted candidate execution passed through the governed graph fixture, together with all compiler and sandbox tests. Direct callable legacy skills now fail closed rather than bypassing runtime authority or evaluation. |
| Evaluated completion | PARTIAL | Selected extension validators receive runtime-created workflow evidence. Completion requires a valid receipt citing current evidence and matching mission, execution, and verifier (ADR 0033 adds an explicit `CompletionReceiptV1` proof chain with fail-closed minting/validation; the checkpoint stays authoritative). A broader evaluation ledger across non-durable missions and wider evaluation integration remain incomplete. |
| Extension registry and policy | PARTIAL | Admission, provenance, profile ceilings, restrictive policy hooks, exact memory-provider selection/execution binding, declarative plugin-hook admission, and governed hook execution (ADR 0034) are implemented. Hook emission is wired into canonical runtime events (ADR 0036): `RuntimeHookBridge` subscribes to `task.*`, `tool.*`, `capability.decided`, and `memory.written` and dispatches admitted hooks through the `GovernedHookExecutor`; `createQuackSystem` exposes `system.hookBridge` with per-dispatch audit records. Remaining: SWE-distribution hook wiring and intervention-style hook kinds. |
| Provider and model routing | PARTIAL | Versioned provider contracts exist; `GovernedProviderRouter` (ADR 0032) now enforces `provider.invoke` capability authority before provider contact on the canonical composition. User-managed provider/auth ecosystem work remains deferred. |
| Memory, context, checkpoints, recovery | PARTIAL | Configured data directories persist neutral runtime tasks and durable execution checkpoints. Interrupted-mission recovery is verified for single-process restarts through `QuackRuntime.resumeMission` (ADR 0028). A selected admitted `MemoryProvider` now binds through the canonical runtime (ADR 0029): governed reads feed bounded planner context, completion writes are durably acknowledged, exact provider/version/namespace identity survives restart, and ambiguous writes fail closed. Canonical local memory now supports deterministic, host-owned compaction (ADR 0030): per-scope bounds, within-scope deduplication, and age pruning that never removes protected records. **Multi-process recovery is now SUPPORTED (Phase 5, single-host scope): mission ownership via the SQLite coordination primitive with lease/heartbeat/fencing — see ADR 0031 update and docs/recovery/multi-process-recovery.md.** |
| MCP and plugins | PARTIAL | Unsupported isolation rejects and plugins do not claim sandboxing. Governed plugin-hook execution is wired (ADR 0034/0036). MCP actions dispatch through the ActionRuntime broker path and their evidence now cites governed operation materialization — operationId, retry safety, required permissions, provider version, namespace (ADR 0036). Remaining: full MCP provider materialization envelope across all transports and a container-isolation backend. |
| Delegation runtime | PARTIAL | `DelegationRuntime` (ADR 0035) implements governed delegation with derived agent-scoped grants, lifecycle states, depth ceiling, duplicate guard, grant revocation, and verified child receipts (ADR 0033). Live composition wiring (ADR 0036): `createQuackSystem` wires delegation when `delegationMaxDepth > 0` plus a parent grant (explicit id or exactly one seeded mission grant); default remains disabled. Fan-out aggregation (`delegateFanOut`) completes the parent only when every child produced a verified receipt; partial completion reports `PARTIAL`. Remaining: parallel child orchestration beyond sequential fan-out and delegation wiring in the SWE distribution. |
| SWE/company surfaces | LEGACY / COMPATIBILITY | SWE composition moved under the SWE distribution boundary; compatibility surfaces remain while callers migrate. |
| Duplicate orchestration | PARTIAL | The public AgentLoop duplicate is isolated. Direct callable legacy skills and legacy company scheduler execution fail closed. Workforce portable skill dispatch remains compatibility wiring over the canonical graph runtime. |
| SDK and public exports | PARTIAL | Neutral and SWE export boundaries exist. The public package and SDK now export the governed execution surfaces (ADR 0032–0035): `materializeTool`/`ToolMaterialization`, `GovernedProviderRouter`, `buildCompletionReceipt`/`CompletionReceiptV1`, `GovernedHookExecutor`, `DelegationRuntime`/`assertChildReceipt`, and `InMemoryCapabilityGrantRegistry`, with SDK package compatibility tests (3). `QuackRuntimeV1.resume` remains a declared, unimplemented contract member and stays unexported. Package-level compatibility tests for the SWE surface and the remaining `QuackRuntimeV1` contract remain later phase gates. |
| Open-source/privacy boundary | DONE | Phase 1 excluded private local state and generalized public-core wording; do not redo without a concrete regression. |

## Phase 4 stage status (2026-09-07, finalization session)

| Stage | Status | Evidence |
| --- | --- | --- |
| 4A audit | ✅ | subagent architecture map (skills, discovery gaps, shell strings, browser contexts) |
| 4B platform abstraction | ✅ | ADR 0040; 13 platform tests |
| 4C universal skill spec | ✅ | ADR 0041; `src/skills/universal.ts` |
| 4D/4E privacy + discovery | ✅ | 12 discovery tests |
| 4F registry | ✅ | lifecycle + revalidation tests (in 12) |
| 4G quarantine-first search | ✅ | 6 search tests |
| 4H sandbox integration | ✅ | 3 execution-profile tests |
| 4I MCP envelopes | ✅ | Phase 3 (ADR 0036), 16 action/MCP tests |
| 4J delegation fan-out | ✅ | Phase 3 (ADR 0036), 12+1 tests; parallel children remain future work |
| 4K cross-platform process/fs | ✅ | all production shell strings migrated; static guard active; 4 GitStatusTool tests; full suite green |
| 4L SQLite coordination | ✅ (primitive) | `src/storage/coordination.ts`; 9 real-fork multi-process tests; recovery rewiring deliberately deferred per ADR 0031 |
| 4M CI matrix | 🟡 implementation complete / CI execution evidence pending | ci.yml windows/linux/macos × node 22/24 + arm64 job; all command shapes verified locally on Windows; no GitHub Actions run yet |
| 4N adversarial cross-suite | ✅ | 20 tests, `src/security/adversarial-cross-suite.test.ts`; found + fixed 2 real bugs (registry durability, migration race) |
| 4O documentation | ✅ | docs/platform/{architecture,windows,linux,macos}.md, docs/skills/ (7), docs/security/ (6), docs/recovery/ (3); every capability labeled SUPPORTED/BEST_EFFORT/UNSUPPORTED |
| 4P production gate | ✅ (local) | all local gates green 2026-09-07; static security + governance audits passed; CI execution evidence unavailable (no git remote) → release decision **PRODUCTION CANDIDATE**, blocker: Linux/macOS/ARM64 runtime verification |

## Phase 5 stage status (2026-09-08, finalization session)

| Stage | Status | Evidence |
| --- | --- | --- |
| 5A baseline audit | ✅ | Phase 4 baseline rerun green (1,442+17) before any Phase 5 change |
| 5B multi-process recovery | ✅ | `MissionOwnershipGuard` (`src/runtime/ownership.ts`) over the Phase 4 coordination primitive; resumeMission + fresh submitGoal acquire mission leases; all durable transitions epoch-fenced; ADR 0031 boundary lifted |
| 5C ownership lifecycle | ✅ | UNOWNED→ACQUIRING→OWNED→HEARTBEATING→COMPLETING→RELEASED + OWNERSHIP_CONFLICT/LEASE_LOST/STALE_OWNER failure states |
| 5D crash/restart recovery | ✅ | 12/12 real-fork suite: 6 SIGKILL boundaries, takeover-after-expiry, ≤1 executing owner in races, repeated crash cycles, no-re-execution, verified receipts |
| 5E durable state | ✅ | `docs/recovery/durable-state.md` — durable/ephemeral/derived split; no automatic retention/compaction (documented honestly) |
| 5F observability | ✅ | typed events `ownership.*` + `mission.*` on the EventBus; no secrets in payloads |
| 5G resource/cancellation | ✅ | release-after-final-persist ordering; heartbeat unref'd; fenced failure transitions; adversarial guard lifecycle test |
| 5H skill operations | ✅ lifecycle / DEFERRED stats | all 11 lifecycle ops test-backed (discover→…→revoke→execute); execution statistics deliberately deferred (no consumer in architecture) |
| 5I cross-platform CI | 🟡 configured / execution pending | matrix in `.github/workflows/ci.yml`; no git remote so never executed |
| 5J security hardening | ✅ | adversarial cross-suite 22/22 incl. DB-tamper boundary, version-rollback, guard fencing; interrupted-recovery 22/22 preserved |
| 5K dogfood E2E | ✅ | SKILL.md → compiler → governed graph → durable run → SIGKILL → second-process resume → verified receipt (in 12/12 suite) |
| 5L documentation | ✅ | this file, checkpoint rewrite, ADR 0031 update, `docs/recovery/{multi-process-recovery,durable-state}.md` rewrite/new, `docs/operations/README.md` |
| 5M release prep | ✅ | secret audit, .gitignore audit, first clean commit (see Git status) |
| 5N publication | ⛔ blocked | no git remote configured, no GitHub auth tooling — exact user actions recorded; local commit exists |

## Latest verification

| Check | Result |
| --- | --- |
| **Phase 5 final gate, 2026-09-08** | **PASS: 1,456 ordinary + 17 serial tests; 0 failures, skips, or cancellations (includes all dogfood/grant/adversarial changes). Root/SDK typechecks, build, lint pass. Focused: platform+terminal+git-status 20 · skills/privacy/sandbox 30 · isolation 17 · coordination 9 · multi-process recovery 12 (real forks) · interrupted-recovery 22 · adversarial cross-suite 22 · compiler 9 · SDK 3. Release decision: PRODUCTION CANDIDATE (Windows fully verified incl. multi-process recovery; Linux/macOS/ARM64 CI never executed).** |
| **Phase 4 final gate (4P), 2026-09-07** | **PASS: 1,442 ordinary + 17 serial tests; 0 failures, skips, or cancellations. Root/SDK typechecks, build, lint pass. Focused gates rerun fresh: platform+terminal+git-status 20, skills/privacy/sandbox 30, isolation 13 adversarial + 4 contract, coordination 9 (real forks), adversarial cross-suite 20, interrupted-recovery 22, compiler 9, SDK 3. Static security audit: every child_process/process.env site intentional + governed; zero `shell: true`. Governance audit: single canonical chain, no Phase 4 bypass. CI: IMPLEMENTED, EXECUTION PENDING (no git remote; matrix never run). Release decision: PRODUCTION CANDIDATE (Windows-verified; Linux/macOS unverified).** |
| Phase 4 stage gate 4K finish + 4L coordination, 2026-09-07 | PASS: 1,422 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. Root/SDK typechecks, build, and lint pass. Includes 9 new multi-process coordination tests (real forked processes) and 4 new GitStatusTool argv tests. |
| Phase 4 stage gate (4B–4K), 2026-09-06 | PASS: 1,409 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. Root/SDK typechecks, build, and lint pass. |
| Phase 4 external-skill search suite, 2026-09-06 | PASS: 6 quarantine-first tests in `dist/skills/discovery/search.test.js` (prompt/shell-injection and credential-harvest blockers, HIGH-risk review, privacy denial, policy re-derivation); 0 failures. |
| Phase 4 skill-execution-profile suite, 2026-09-06 | PASS: 3 tests in `dist/skills/execution-profile.test.js` (least-privilege defaults, risk never lowers isolation, explicit-secrets fail closed); 0 failures. |
| Phase 4 terminal env-sanitization suite, 2026-09-06 | PASS: 3 tests in `dist/tools/terminal.test.js` (secret-shaped env removal, dangerous-command blocking, non-secret env preserved); 0 failures. |
| Phase 4 platform suite, 2026-09-06 | PASS: 13 tests in `dist/platform/platform.test.js` (detection, capability matrix, path adversarial incl. UNC/device/ADS/symlink/short-path, argv process execution with env isolation, timeout/cancel/output bounds); 0 failures. |
| Phase 4 platform suite, 2026-09-06 | PASS: 13 tests in `dist/platform/platform.test.js` (detection, capability matrix, path adversarial incl. UNC/device/ADS/symlink/short-path, argv process execution with env isolation, timeout/cancel/output bounds); 0 failures. |
| Phase 4 skills discovery suite, 2026-09-06 | PASS: 12 tests in `dist/skills/discovery/discovery.test.js` (firewall classification/redaction/deny, forbidden files/dirs, risk derivation, explicit-root manifest-only discovery, registry lifecycle, supply-chain revalidation); 0 failures. |
| Phase 3 full repository suite, 2026-09-06 | PASS: 1,372 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| Phase 3 root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Phase 3 SDK package integration, 2026-09-06 | PASS: 3 tests. |
| Phase 3 isolation suite, 2026-09-06 | PASS: 17 tests (4 contract + 13 adversarial worker-backend security); 0 failures. |
| Phase 3 governance wiring, 2026-09-06 | PASS: governed model runtime (7), SWE surface gate (1), hook bridge (6+1), delegation wiring + fan-out (12+1), actions/MCP (16). |
| Stage E SDK package integration, 2026-09-06 | PASS: 3 tests in `sdk/test/client.test.mjs` including new governed-surface compatibility coverage; 0 failures. |
| Stage E root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Stage E full repository suite, 2026-09-06 | PASS: 1,334 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| Stage D focused delegation tests, 2026-09-06 | PASS: 7 tests in `dist/runtime/delegation.test.js`; 0 failures. |
| Stage D root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Stage D full repository suite, 2026-09-06 | PASS: 1,334 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| Stage C focused hook tests, 2026-09-06 | PASS: 23 extension tests (10 new `dist/extensions/hooks.test.js` + 13 registry tests with the updated hook-admission contract); 0 failures. |
| Stage C system/plugins gate, 2026-09-06 | PASS: 66 tests; 0 failures. |
| Stage C root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Stage C full repository suite, 2026-09-06 | PASS: 1,327 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations (rerun after one unrelated skill-runtime timeout flake passed in isolation and rerun). |
| Stage B focused receipt tests, 2026-09-06 | PASS: 11 tests in `dist/engine/completion-receipt.test.js` and `dist/runtime/completion-receipt-runtime.test.js`; 0 failures. |
| Stage B runtime/engine gate, 2026-09-06 | PASS: 147 tests; 0 failures. |
| Stage B root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Stage B full repository suite, 2026-09-06 | PASS: 1,317 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| Stage A focused materialization tests, 2026-09-06 | PASS: 13 tests in `dist/tools/materialization.test.js` and `dist/providers/governed-router.test.js`; 0 failures. |
| Stage A tools/providers gate, 2026-09-06 | PASS: 39 tests; 0 failures. |
| Stage A system/security gate, 2026-09-06 | PASS: 89 tests; 0 failures. |
| Stage A root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| Stage A full repository suite, 2026-09-06 | PASS: 1,306 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| `npm run build` | PASS |
| focused `dist/skills/sandbox-runtime.test.js` | PASS (9 tests, 0 failures), including direct callable-skill fail-closed regression coverage |
| promoted portable-skill compiler test | PASS (9 tests, 0 failures) |
| portable-skill compiler and sandbox tests | PASS (17 tests, 0 failures) |
| `npm run typecheck` | PASS |
| `npm run typecheck:sdk` | PASS |
| `npm run lint` | PASS |
| `npm test` full repository suite after callable-skill containment | PASS; superseded by the verified scheduler-containment run below. |
| focused company scheduler and company runtime tests | PASS (13 tests, 0 failures) after scheduler containment |
| focused canonical runtime tests | PASS (24 tests, 0 failures) after scheduler containment |
| focused portable skill and workforce tests | PASS (13 tests, 0 failures) after scheduler containment |
| `skills/runtime/skill-runtime.test.js` | PASS (5 tests, 0 failures); timeout-fixture cleanup no longer blocks runner exit. |
| `npm test` full repository suite after scheduler containment | PASS; main suite 1,195 tests and serial self-modification gate 17 tests, 0 failures, skips, or cancellations. |
| continuation full suite, 2026-09-05 | PASS: 1,224 ordinary tests + 17 serial tests; no failures, skips, or cancellations. |
| continuation build, root/SDK typechecks, lint | PASS |
| SDK package integration | PASS: 2 tests. |
| Control Room browser E2E | PASS: keyboard navigation and serious/critical accessibility gates; no console errors. |
| public documentation and staging regression checks | PASS: 131 documents, 122 manifest entries, 7 staging tests. |
| package/release staging after Phase 2 changes | PASS: fresh local public artifact staged and verified; nothing published. |
| graphify update | PASS with limitations: 15 files produced zero nodes; HTML visualization skipped above its size limit. |
| interrupted-recovery focused gate, 2026-09-06 | PASS: 86 checkpoint/session/workflow/runtime/validation tests, including 22 real restart and recovery-policy cases; 0 failures, skips, or cancellations. |
| interrupted-recovery root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| interrupted-recovery full repository suite, 2026-09-06 | PASS: 1,261 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| memory-provider binding focused gate, 2026-09-06 | PASS: 74 memory/provider/registry/context/runtime/recovery tests; 0 failures, skips, or cancellations. |
| memory-provider binding root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| memory-provider binding SDK package integration | PASS: 2 tests. |
| memory-provider binding public documentation and staging regressions | PASS: 133 documents, 124 manifest entries, and 7 staging tests; fresh local public artifact staged and verified, nothing published. |
| memory-provider binding full repository suite, 2026-09-06 | PASS: 1,286 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |
| memory-compaction focused gate, 2026-09-06 | PASS: 37 memory/os/provider-binding/decision-memory/identity-memory/knowledge-graph tests, including 7 new compaction cases; 0 failures, skips, or cancellations. Independent verifier confirmed build, typecheck, and source semantics. |
| memory-compaction root/SDK typechecks, build, and lint, 2026-09-06 | PASS. |
| memory-compaction full repository suite, 2026-09-06 | PASS: 1,293 ordinary tests + 17 serial self-modification tests; 0 failures, skips, or cancellations. |

## Latest continuation — 2026-09-08 (Phase 5)

Multi-process mission ownership + crash/restart recovery shipped and
verified (ADR 0031 boundary lifted; single-host scope):

- **MissionOwnershipGuard** (`src/runtime/ownership.ts`): one guard per
  mission execution over the SQLite coordination primitive. Atomic lease
  acquisition (`begin immediate`), heartbeat renewal at lease/3
  (live-owner only, expired leases never resurrect), release-as-tombstone
  keeping the fencing version monotonic across ownership epochs, and
  `assertOwnedForWrite` fencing that fails closed on any owner/epoch/lease
  mismatch before a durable mutation.
- **Runtime integration** (`src/runtime/runtime.ts`): `resumeMission` and
  fresh durable `submitGoal` acquire the mission lease BEFORE any durable
  state transition; `fencedTransition` + `assertOwnedForWrite` wrap
  checkpoint init, every mission-state transition, task-store writes, and
  the COMPLETING receipt→memory→SUCCEEDED→completed persist; ownership is
  released only AFTER the final durable persist. Ownership loss fails
  closed (`recovery.ownership_conflict` / fenced throws) — never
  concurrent execution. `disableOwnership: true` preserves ADR 0028
  single-process semantics (used by the interrupted-recovery suite).
  Coordination DB derives from `dataDir/coordination.sqlite`
  (or explicit `coordinationDbPath`), lease tunable via `ownershipLeaseMs`.
- **Verification — real processes only**: 12/12
  `src/runtime/multi-process-recovery.test.ts` (forked children sharing
  one dataDir): SIGKILL at six boundaries (before-ownership,
  after-ownership, during-heartbeat, tool-entered, after-tool-before-
  persist, after-receipt-before-complete) each recovered by a second
  process after lease expiry with a verified completion receipt;
  simultaneous resume race never yields two executing owners; stale
  process resume returns the stored terminal result with zero
  re-execution (durable call count exactly 2); repeated crash/restart
  cycles complete; forged-owner/version-guessing writes fenced out; and
  the 5K dogfood E2E (SKILL.md → SafeSkillCompiler → governed graph →
  durable run → SIGKILL → second-process resume → verified receipt).
- **Adversarial hardening**: cross-suite grown to 22 (DB-tamper trust
  boundary, version-rollback, guard lifecycle/spend, release ordering);
  interrupted-recovery suite preserved 22/22; the Phase 4 process-policy
  static guard and all security boundaries unchanged.
- **Observability**: typed `ownership.acquired/rejected/heartbeat/lost/
  released` and `mission.started/resumed/completed/failed/
  recovery_started/recovery_completed` events; no secrets in payloads.
- **Fixes en route**: improvement-coordinator test fixture now drains the
  async audit sink before cleanup (a real ENOTEMPTY durability race);
  recoveryFixture opts into `disableOwnership` (single-process suite
  stays single-process semantics).
- **Documentation**: ADR 0031 status updated (boundary lifted, history
  preserved); `docs/recovery/multi-process-recovery.md` rewritten as
  SUPPORTED with the full ownership/fencing model;
  `docs/recovery/durable-state.md` (5E) records durable/ephemeral/derived
  state and states plainly that NO automatic retention/compaction exists;
  `docs/operations/README.md` (deployment, lease tuning, recovery runbook,
  events, failure handling).
- **Release decision: PRODUCTION CANDIDATE.** Windows runtime fully
  verified (1,456+17; all focused suites). Linux/macOS/ARM64 runtime
  verification requires an actual GitHub Actions execution, blocked only
  by the missing git remote/publication (see 5N).

## Latest continuation — 2026-09-07

4N adversarial cross-suite + 4O documentation (finalization session):

- **4N — adversarial cross-suite.** `src/security/adversarial-cross-suite.test.ts`
  (20 tests) attacks the real boundaries across surfaces: path attacks
  (URL-encoded traversal, drive-case, mixed separators, deep chains, NUL,
  device names, symlink/junction escapes for existing and new-file
  targets), process attacks (shell metacharacters fail-to-start, argument
  injection through working directories, environment-secret leakage,
  output flooding bounds, runaway-child timeout kill), skill attacks
  (secret/network manifest → HIGH + review; claimed-LOW override
  rejected; firewall hard-DENY; tampered content → REVALIDATION_REQUIRED),
  privacy attacks (tokens/keys/JWTs/cookies denied-or-redacted with no
  raw secret surviving; forbidden directories never entered), and
  recovery attacks (stale-owner fenced writes, expired-lease heartbeat
  resurrection rejected, version guessing rejected, 12-owner acquire
  storm with exactly one winner).
  **The suite found two real defects, both root-cause fixed:**
  1. `JsonFileSkillRegistryStore.save()` (discovery registry) fired an
     async `atomicWriteFile` without awaiting under a sync contract —
     saves raced subsequent loads and records vanished; persistence is
     now a synchronous tmp+rename with Windows transient-retry.
  2. `runMigrations` (SQLite storage) used an unprotected
     check-then-insert that raced across concurrently opening processes
     (UNIQUE constraint failure under a real 4-way fork race);
     migrations now run inside `begin immediate`.
  After both fixes: full suite 1,442 ordinary + 17 serial, 0 failures.
- **4O — documentation tree.** `docs/platform/` (architecture + per-OS
  verification status), `docs/skills/` (universal spec, discovery, privacy,
  registry, installation, trust model, external skills),
  `docs/security/` (threat model, sandbox, process, path, privacy
  firewall, recovery), `docs/recovery/` (architecture, SQLite
  coordination, multi-process boundary). Every capability is labeled
  SUPPORTED/BEST_EFFORT/UNSUPPORTED; Linux/macOS docs state runtime
  verification is pending CI; recovery docs explicitly separate the
  verified coordination primitive from the still-unsupported
  multi-process recovery integration; the sandbox doc states plainly
  that the worker backend is not a security sandbox.

## Previous continuation — 2026-09-07

4K finished, 4L coordination primitive landed, 4M CI implemented (ADRs
0040/0031):

- **4M — cross-platform CI implemented (run evidence pending).** `.github/
  workflows/ci.yml` now runs a windows/linux/macos × node 22/24 matrix with
  the full gates (lint incl. the new process-policy guard, build, SDK
  typecheck, full test suite, public-doc checks) plus three focused
  security gates as separate steps so failures are attributable: platform/
  process security (20 tests), skills/privacy/sandbox (30), isolation/
  coordination/recovery (31). An `arm64-focused` job covers linux-arm64
  and macos-arm64 with the platform and multi-process coordination gates.
  `engines.node` is now `>=22.5.0` (Node 20 is EOL; `node:sqlite` requires
  22.5). All CI command shapes were verified locally on Windows (81
  focused tests green). Actual Linux/macOS runners have NOT executed yet —
  until a real GitHub Actions run completes, cross-platform evidence
  remains Windows-only.

4K finished and 4L coordination primitive landed (ADRs 0040/0031):

- **4K complete — all production shell strings migrated.**
  `git-status.ts` (3 `execSync` git shell strings), `validation-pipeline.ts`
  (4 `npx tsc/eslint … 2>&1 || true` strings), and `test-runner.ts`
  (3 execution sites + shell-string command detection) now run through the
  argv-based `executeProcess` platform abstraction: no implicit shell,
  explicit allowlisted environment (`childProcessEnvironment()` — PATH plus
  OS-identity variables, never `process.env` spread), no exit-code masking
  (eslint/tsc failures surface as findings), bounded output and timeouts.
  Windows `npx` is a `.cmd` shim that cannot be spawned shell-less
  (CVE-2024-27980), so `resolveNodeCliArgv("npx", …)` resolves the
  node-distributed `npx-cli.js` and spawns `[process.execPath, npx-cli.js]`.
  `lsp-manager.ts` reuses the shared environment helper. The terminal tool
  remains the ONLY intentional shell path (permission-gated, sanitized,
  dangerous-pattern-blocked). A static-quality guard now fails the build on
  any `execSync(`, stderr-merge, or shell-masking operators in production
  `src/`. New GitStatusTool tests (4) exercise real-repo branch/status,
  traversal rejection, and fail-closed behavior outside a repo.
- **4L — SQLite multi-process coordination primitive (ADR 0031
  prerequisite).** `src/storage/coordination.ts` adds
  `SqliteCoordinationStore` over the existing `SqliteConnection`
  (migration `004_coordination_leases`): atomic acquire
  (`begin immediate`), live-lease rejection, stale-lease takeover with a
  version bump, heartbeat renewal (expired leases never resurrect),
  release via tombstone (fencing version stays monotonic across ownership
  epochs — a released resource's next owner can never re-issue a version
  an old writer held), and version-fenced payload writes that reject
  stale owners after takeover. Verified by 9 tests using REAL forked
  worker processes: 4-way acquire race with exactly one winner, live-lease
  rejection, expiry takeover, fencing after takeover, cross-process
  writes, real SIGKILL crash + lease-expiry recovery, heartbeat, and
  lifecycle. Scope: single-host multi-process coordination only; no
  distributed/HA claims. The JSON recovery stores are NOT yet rewired onto
  this primitive — per ADR 0031 that migration is a separate, deliberate
  change and multi-process recovery remains UNSUPPORTED until then
  (ADR 0031 records this exact boundary).

Full suite: 1,422 ordinary + 17 serial tests, 0 failures; root and SDK
typechecks, build, and lint pass.

## Latest continuation — 2026-09-06

Canonical local memory now supports deterministic, host-owned compaction
(ADR 0030):

- `MemoryStore` gains an optional `compact` operation. Both canonical local
  implementations (`InMemoryMemoryStore`, `JsonFileMemoryStore`) implement it;
  the memory-provider binding reports compaction unsupported.
- `compact` performs one deterministic pass: records older than an optional
  `olderThan` timestamp are dropped, records are grouped by `scope` with an
  optional per-scope `maxItemsPerScope` bound keeping the newest, and
  duplicate content within a scope is collapsed keeping the newest copy.
- A protected record is never removed: `validated-knowledge` class
  (`memoryClass === "validated-knowledge"`) or an explicit `protected` /
  `protect` metadata marker. The per-scope retention bound applies only to
  ordinary records, so a bound cannot compact away host-marked durable
  knowledge.
- Compaction is deterministic, requires no LLM or provider service, and
  returns a `MemoryCompactResult`. The JSON store persists the compacted set
  atomically; the in-memory store mutates its visible cache only after a
  successful pass.
- `MemoryCompactionPolicy` is the extension seam: it receives per-scope
  candidates and returns retention order. The default policy keeps newest
  first with a stable id tie-break. No automatic/background compaction is
  scheduled; behavior is unchanged until `compact` is explicitly called.
- Provider-owned consolidation and multi-process recovery remain unsupported.

Focused memory tests pass (37 tests including 7 new compaction cases). The
full repository suite, root and SDK typechecks, build, and lint all pass;
exact counts are recorded under Latest verification.

## Stage E continuation — SDK/public API compatibility, 2026-09-06

The public package and SDK now expose only supported canonical behavior for
the new governed execution surfaces (ADR 0032–0035):

- `src/index.ts` (public `@quack/os` exports) adds `runtime/delegation.js`,
  `extensions/hooks.js`, `tools/materialization.js`,
  `engine/completion-receipt.js`, and `providers/governed-router.js`.
- `sdk/src/index.ts` adds `materializeTool`, `createGovernedToolExecutor`,
  `materializationSnapshot`, `GovernedProviderRouter`,
  `InMemoryCapabilityGrantRegistry`, `DelegationRuntime`, `assertChildReceipt`,
  `buildCompletionReceipt`, `assertCompletionReceipt`, `receiptSnapshot`,
  `GovernedHookExecutor`, and their types.
- `QuackRuntimeV1.resume` remains a declared, unimplemented contract member
  and is intentionally not exported; canonical resume is
  `QuackRuntime.resumeMission`.
- SDK package compatibility tests extend from 2 to 3: exports resolve to the
  public implementation, governed surfaces behave fail-closed through the SDK
  (materialization rejects invalid identity, hook dispatch denies without
  authority, forged receipts fail), and configuration/failure propagation is
  unchanged.

Root and SDK typechecks, build, and lint pass; the SDK package tests pass
(3); the full repository suite passes 1,334 ordinary + 17 serial tests with 0
failures.

## Stage D continuation — governed delegation runtime, 2026-09-06

Delegation now exists as governed parent → child execution (ADR 0035):

- `DelegationRuntime` (`src/runtime/delegation.ts`) delegates by submitting
  the child through the canonical `QuackRuntime.submitGoal` — no second
  orchestration path. The child grant derives from the parent grant via the
  existing `deriveGrant` attenuation (mission lock, capability/scope subset,
  expiry ceiling); widening attempts fail closed with
  `delegation.attenuation_denied`.
- Lifecycle: `REQUESTED → ACCEPTED → RUNNING → COMPLETED | FAILED |
  CANCELLED | BLOCKED` with timestamps. Depth is tracked per chain and
  capped by `maxDepth`; duplicates of an active (parent execution, goal)
  delegation fail closed.
- The derived grant is revoked whenever the child completes, fails, is
  cancelled, or cannot start — no authority residue outlives a delegation.
- A child's completion is trusted only through its durable receipt chain
  (ADR 0033): `DelegationRecord.childReceipt` carries the child receipt, and
  `assertChildReceipt` rejects unverified, forged, or incomplete child
  results. Children inherit ADR 0028 recovery unchanged.
- The default neutral composition keeps `maxDelegationDepth: 0` (delegation
  disabled until a composition wires a parent grant); fan-out aggregation
  is not implemented.

Focused delegation tests (7) pass; the full repository suite passes 1,334
ordinary + 17 serial tests with 0 failures; root and SDK typechecks, build,
and lint pass.

## Stage C continuation — governed plugin hooks, 2026-09-06

Executable plugin hooks now run through governed authority (ADR 0034):

- Admission (`normalizePlugin`) validates hook shape and admits hooks as
  frozen declarative contributions; it never executes a handler. Malformed
  hooks (unknown kind, non-function handler) fail closed with
  `extension.invalid`. The former `extension.unsupported_hook` rejection no
  longer exists.
- `GovernedHookExecutor` (`src/extensions/hooks.ts`) is the only execution
  path: every plugin-declared permission resolves through the capability
  broker (existing `buildToolCapabilityRequest` factory, full
  mission/task/agent/skill/actor context) before the handler is contacted;
  one denial fails closed.
- Handlers receive only a deep-frozen event payload — never registries,
  brokers, or host APIs. Timeouts (default 5 s), cancellation, expired
  deadlines, and handler failures produce deterministic
  `EXECUTED/DENIED/FAILED/CANCELLED/TIMED_OUT` dispatch records without
  crashing the host. `dispatchAll` runs one kind's hooks in registration
  order.
- No sandbox/isolation is claimed; hooks are in-process observers. Plugin
  isolation boundaries remain unchanged and unsupported.

Focused extension tests (23), the system/plugins gate (66), root and SDK
typechecks, build, and lint pass; the full repository suite passes 1,327
ordinary + 17 serial tests with 0 failures (after one unrelated
skill-runtime timeout flake passed in isolation and rerun).

## Stage B continuation — completion receipts, 2026-09-06

Evaluated completion now mints an explicit, citable proof chain (ADR 0033):

- `CompletionReceiptV1` (`src/engine/completion-receipt.ts`) cites execution
  identity, the durable evidence id and a sha-256 digest of the bound evidence
  payload, the verifier, verification status/record id, and independence.
- The receipt is derived output, not a second source of truth: the versioned
  execution checkpoint remains authoritative for execution state, invocation
  outcomes, evidence, and verification.
- `buildCompletionReceipt` fails closed on unsuccessful verification, foreign
  evidence citations, foreign evidence identity, and foreign or non-passing
  verification records. `assertCompletionReceipt` rejects forged, foreign,
  stale, or malformed receipts.
- `QuackRuntime` mints receipts only for durable executions whose checkpoint
  stored evidence and verification; the snapshot is attached to the completed
  task's `result.receipt`. Non-durable completions mint no receipt and still
  require loop-driver verification success, unchanged.

Focused tests (11), the runtime/engine gate (147), root and SDK typechecks,
build, and lint pass; the full repository suite passes 1,317 ordinary + 17
serial tests with 0 failures.

## Phase 4 continuation — platform abstraction + universal skills, 2026-09-06

Phase 4 Stages A–F are complete and verified (ADRs 0040, 0041):

- **Platform abstraction (ADR 0040).** `src/platform/` isolates OS behavior:
  `PlatformAdapter` with an honest SUPPORTED/BEST_EFFORT/UNAVAILABLE
  capability matrix (unavailable capabilities fail closed), `resolveInside
  Root` path policy rejecting traversal, UNC, device paths (`\\.\`, `\\?\`),
  alternate data streams, and symlink/junction escapes (realpath'd both
  sides so Windows 8.3 short-path spellings compare equal), and argv-based
  `executeProcess` with no implicit shell, explicit environment
  materialization (never `process.env`), bounded output, and deterministic
  timeout/cancellation tree-kill with terminal intent recorded before the
  kill. Existing surfaces are not yet migrated onto these adapters — the
  contract is established first.
- **Universal skill spec (ADR 0041).** Skill kinds, risk classes derived
  from requested capabilities (never claims), review requirements (HIGH
  risk and untrusted skills never silently activate), and content/manifest
  hashes for supply-chain detection.
- **PrivacyFirewall.** The only path for discovered local metadata to reach
  a model: content patterns, secret-shaped values, and sensitive field
  names are classified; hard classes (private keys, browser sessions,
  passwords) deny the whole record; others redact to `[REDACTED]`. Forbidden
  filenames (`.env`, `id_rsa`, password DBs, cookies DBs) and directories
  (`.ssh`, `.aws`, `AppData`, `Library`, personal folders) are never read.
- **Privacy-safe discovery.** `SkillDiscovery` scans ONLY explicit roots,
  reads ONLY manifest files, never neighboring content, never the personal
  filesystem. "Add all skills from my PC" means reading skill manifests in
  configured locations — never scanning the disk.
- **Discovery registry.** Metadata-only persistent records with states
  DISCOVERED → REVIEW_REQUIRED → APPROVED → INSTALLED → DISABLED/REVOKED/
  QUARANTINED plus REVALIDATION_REQUIRED. Discovery never auto-approves;
  installation requires explicit approval; content changes after
  installation force revalidation and block silent execution of modified
  content.

Platform tests (13), discovery tests (12), quarantine-first search tests (6),
skill-execution-profile tests (3), and terminal env-sanitization tests (3)
pass; the full suite passes 1,409 ordinary + 17 serial tests with 0
failures; root and SDK typechecks, build, and lint pass.

Phase 4 continued (4G–4K):

- **External skill search (4G, quarantine-first).** `QuarantineFirstSkill
  Search` fetches remote manifests into an isolated quarantine directory,
  runs static inspection (shell-injection, prompt-injection,
  credential-harvest blockers; hidden-network and elevated-shell warnings),
  re-derives risk through QUACK's own classifier (a remote manifest cannot
  redefine policy by claiming LOW risk), screens content through the
  PrivacyFirewall, and registers results without ever installing. BLOCKER
  findings or privacy DENY force QUARANTINED state; HIGH risk enters
  REVIEW_REQUIRED. Recommendations are RECOMMEND/REVIEW/BLOCK — never an
  implicit install.
- **Skill sandbox integration (4H).** `deriveSkillExecutionProfile` binds
  the universal skill model to the ADR 0039 isolation contract with
  least-privilege defaults (workspace-only fs, DENY network, materialized
  env, DENY secrets). Risk never lowers isolation: a HIGH-risk skill claiming
  IN_PROCESS is held at WORKER_PROCESS; network ALLOWLIST starts empty;
  EXPLICIT secret policy without materialized secrets fails closed.
  `toIsolationRequest` builds the governed isolation request with only
  IsolatedIo crossing the boundary.
- **MCP normalization (4I)** was completed in Phase 3 (ADR 0036 evidence
  envelopes); no further envelope work was required this phase.
- **Delegation aggregation (4J)** was completed in Phase 3 (ADR 0036
  `delegateFanOut`); parallel child orchestration remains open.
- **Cross-platform process/filesystem security (4K, partial).** LSP manager
  now probes binaries portably (`spawnSync` argv, no `which || where`
  shell strings) and runs `tsc` via argv `executeProcess` (no `2>&1 ||
  true` masking). The terminal tool no longer inherits `process.env`
  wholesale: secret-shaped variables (KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL
  patterns, API keys) are removed before child execution; non-secret env
  (PATH) remains usable. Remaining 4K: migrate `test-runner`,
  `validation-pipeline`, and `git-status` shell strings onto the platform
  adapters.

Remaining Phase 4 stages: SQLite multi-process coordination (4L, the ADR
0031 prerequisite), cross-platform CI matrix (4M), broader adversarial
coverage (4N), and documentation (4O).

## Phase 3 continuation — live governed execution + isolation, 2026-09-06

Phase 3 Stages A–F are complete and verified (ADRs 0036, 0039):

- **Live governed wiring (ADR 0036).** The SWE composition's exposed
  `modelRuntime` shadows `generate`/`stream` with broker-gated versions
  (`GovernedModelRuntime`/`governModelRuntime`): every model call resolves
  `provider.invoke` through the capability broker with full
  mission/task/agent/actor identity, mid-flight revalidation, and
  fail-closed denial before any provider contact. Metadata-only
  `selectModel` stays ungated. `governedProviderRouter` and
  `governedModelRuntime` are exposed on both system surfaces; a gated
  surface without an execution context fails closed.
- **Runtime hook events.** `RuntimeHookBridge` subscribes to canonical
  events (`task.created/started/completed/failed`, `tool.requested/
  completed`, `capability.decided`, `memory.written`) and dispatches
  admitted plugin hooks through the `GovernedHookExecutor`. Hooks remain
  governed observers; failures, timeouts, and denials are contained per
  dispatch with audit records. `createQuackSystem` exposes
  `system.hookBridge`.
- **Delegation composition + fan-out.** `createQuackSystem` wires
  `DelegationRuntime` when `delegationMaxDepth > 0` with a parent grant
  (explicit id, or exactly one seeded mission grant); default remains
  disabled. `delegateFanOut` runs children in order, completes the parent
  only when every child produced a verified receipt, and reports `PARTIAL`
  otherwise. Depth ceilings, duplicate guards, and grant revocation are
  unchanged (ADR 0035).
- **MCP evidence normalization.** MCP action evidence cites `operationId`,
  retry safety derived from the descriptor, required permissions, provider
  version, and namespace. Dispatch was already broker-gated.
- **Isolation contract + worker backend (ADR 0039).** `src/isolation/`
  defines the backend-agnostic isolation contract (levels
  IN_PROCESS/WORKER_PROCESS/CONTAINER_ISOLATED/FUTURE_STRONG_ISOLATION;
  default-deny filesystem/network/environment/secrets policy; honest
  ENFORCED/BEST_EFFORT/UNSUPPORTED guarantees) and the
  `WorkerProcessIsolationBackend` on `node:worker_threads`:
  ENFORCED wall-clock timeout/cancellation and environment materialization;
  BEST_EFFORT filesystem containment at the IO boundary and crash
  containment; UNSUPPORTED network/secret sealing, container, and strong
  isolation (fail closed). Adversarial tests cover traversal and
  absolute-path escape, spin loops, crashes, cancellation, cleanup, and
  output bounds. The worker backend is NOT a security sandbox equivalent to
  a container/VM and must not be documented as one.

Focused suites pass: governed model runtime 7, SWE surface 1, hook bridge 6+1,
delegation 12+1, actions/MCP 16, isolation 17 (4 contract + 13 adversarial).
The full repository suite passes 1,372 ordinary + 17 serial tests with 0
failures; root and SDK typechecks, build, and lint pass; SDK package tests
3/3.

## Stage A continuation — unified provider/tool materialization, 2026-09-06

Unified provider/tool materialization is implemented for the canonical
composition (ADR 0032):

- `ToolMaterialization` (`src/tools/materialization.ts`) is the frozen
  executable representation of a tool or provider operation. One
  `materializeTool` factory constructs identity; providers never duplicate
  identity generation. The contract preserves provider identity/version, tool
  identity, authorizing capability id, mission/task/execution/session
  identity, actor/agent/skill, namespace, stable operation identity,
  deadline, cancellation, retry safety (ADR 0028 classes unchanged), and
  provenance source.
- `createGovernedToolExecutor` is the dispatch boundary: tool-id mismatch and
  cancellation fail closed at dispatch, and materialized identity (task,
  actor, session, operation, deadline) is forwarded to the executor.
  Authority remains the runtime's capability resolution; materialization
  never grants authority.
- `GovernedProviderRouter` (`src/providers/governed-router.ts`) wraps the
  existing `CapabilityProviderRouter`. It builds a `provider.invoke` capability
  request from the execution context through the existing
  `buildToolCapabilityRequest` factory, resolves it through the capability
  broker, and revalidates before dispatch. Denial fails closed with a
  normalized `POLICY_DENIED` error before any provider is contacted.
- `createQuackSystem` exposes `governedProviderRouter` alongside the raw
  `capabilityRouter`; the raw router remains the pure
  policy/capability/circuit component.

Focused tests (13), the tools/providers gate (39), and the system/security
gate (89) pass; the full repository suite passes 1,306 ordinary + 17 serial
tests with 0 failures. Remaining Stage A follow-up: route remaining live
dispatch seams (for example the SWE distribution's model calls) through the
governed boundary.

## Multi-process recovery decision — 2026-09-06

Multi-process recovery for the canonical runtime remains **UNSUPPORTED**
(ADR 0031). The recovery stores (`JsonFileTaskStore`,
`JsonFileCheckpointStore`, `JsonFileJournalStore`) each cache the file once in
process memory, serialize writes only within one instance, and persist via
atomic temp-file + rename. `QuackRuntime.executionOwners` and
`SessionRuntime.executionUpdates`/`activeRuns` are in-memory per instance.
There is no cross-process compare-and-swap, lease, heartbeat, or version guard
on the recovery path.

Why it stays unsupported: a durable lease or optimistic-version guard requires
atomic read-modify-write on acquisition. A sidecar JSON lease reproduces the
lost-update defect it is meant to fix (both processes read the stale cached
lease, both claim it, last rename wins). The only CAS-capable primitives are
`node:sqlite` transactions or an OS file lock — both are a new
persistence/coordination subsystem, which is explicitly out of scope and would
redesign the journal/checkpoints.

Exact prerequisite to lift the boundary (ADR 0031): back the recovery stores
with a SQLite/coordination primitive offering an atomic
`owner + lease_expires_at + version` claim, heartbeat renewal, crash-safe
stale-lease takeover, and stale-writer rejection, verified on Windows without
PID detection.

Current single-process safety is unchanged and re-verified: the focused
recovery gate passes 22 tests including real child-process `SIGKILL` crashes,
fail-closed retry classes, and single-process duplicate ownership
(`recovery.busy`); the full suite passes 1,293 ordinary + 17 serial tests;
root and SDK typechecks, build, and lint pass.

## Previous continuation — 2026-09-06

Memory-provider execution now binds through the canonical runtime (ADR 0029):

- `createQuackSystem` selects one admitted provider by exact configured id.
  Admission alone remains inert; an unknown id and duplicate provider id both
  fail closed. Without a selection, existing local memory behavior is unchanged.
- `MemoryProviderBinding` implements the existing `MemoryStore` boundary.
  Reads and writes resolve `memory.read` / `memory.write` through the current
  capability broker and restrictive extension policies before provider dispatch.
- Provider calls receive frozen host mission, task, execution, session, actor,
  namespace, operation id, capability, deadline, and cancellation context.
  Providers cannot replace identity, mutate write semantics, or manufacture
  authority.
- Retrieved records are schema-validated, bounded by item count, bytes, tokens,
  deadline, and cancellation, rechecked by host `MemoryPolicy`, and converted
  into planner `ContextFragment`s with provider/record provenance, timestamp,
  confidence, scope, policy, classification, and configured namespace.
- Runtime writes preserve Memory OS classes: working completion state maps to
  `mission.short_term`, execution experience to `skill.execution`, and
  `knowledge.long_term` requires host validation evidence.
- Durable execution identity now includes exact provider id, version, and
  namespace. Completion writes journal stable operation/input identity as
  `STARTED → COMPLETED`; acknowledged writes are reused without provider access,
  while ambiguous writes require reconciliation and are never replayed.
- `store` and `retrieve` are mandatory provider operations. Optional operations
  are discovered from method presence; the bound delete path fails explicitly
  when unsupported, while export is outside this mission binding. Provider
  marketplace, credential, plugin-hook, compaction, and multi-process work
  remains deferred.

Focused tests, the full repository suite, root and SDK typechecks, build, lint,
SDK package integration, public documentation checks, and fresh public staging
all pass; exact counts are recorded under Latest verification.

## Previous continuation — 2026-09-06

Interrupted-mission recovery now works through the canonical runtime (ADR 0028):

- Durable execution identity (`missionId`, `executionId` = task id, `sessionId`,
  `workflowId`, actor) persists in the task record and the versioned execution
  checkpoint; resumption never mints a new mission.
- `SessionRuntime` is the sole checkpoint owner: serialized mutations,
  deep-cloned records, load/mutate validation via `assertRecoveryCheckpoint`,
  atomic versioned file writes, malformed data rejected without corruption.
- Every governed tool call is journaled `STARTED → COMPLETED | FAILED` with a
  stable `idempotencyKey` and per-attempt `attemptId`. Acknowledged outcomes
  replay from the journal and never re-dispatch.
- Durable dispatch records effective tool `retrySafety` (`READ_ONLY`,
  `IDEMPOTENT_WRITE`, `NON_IDEMPOTENT_WRITE`, `DESTRUCTIVE`, default
  `UNKNOWN`). Only retry-safe invocations retry after a crash; ambiguous state
  moves the mission to `BLOCKED` and returns
  `recovery.reconciliation_required` instead of repeating the effect.
- Verification stays bound to the execution's own durable evidence (evidence
  id cited by the stored verification; mismatched, stale, or foreign evidence
  and receipts fail checkpoint validation).
- A task and its full execution identity are persisted together before
  planning. If interruption occurs before the first workflow checkpoint, the
  created task can safely repeat planning because tool dispatch cannot begin
  before checkpoint initialization.
- Persisted recovery budgets must contain the complete bounded schema. Current
  capability authority and retry-safety metadata are rechecked before replay;
  acknowledged failures use fresh attempts only for retry-safe tools.
- Recovery enters only via `QuackRuntime.resumeMission`; concurrent resume in
  one process returns `recovery.busy`. Terminal missions return stored
  results without re-execution. Multi-process recovery and automatic replay
  of ambiguous non-idempotent effects remain UNSUPPORTED. The
  `QuackRuntimeV1.resume` contract member stays an unimplemented declaration.

## Latest continuation — 2026-09-05

Closed two source-confirmed correctness gaps after reproducing the prior full
suite baseline (1,195 ordinary tests and 17 serial tests):

- Validation providers previously received no evidence and could return an
  uncited passing receipt. They now receive a separate workflow-state snapshot;
  malformed, misattributed, invented, duplicate, and empty success citations
  fail closed. Provider mutation cannot replace the host's evidence identity.
- The neutral runtime previously ignored `dataDir` for task storage. It now
  uses the existing JSON store unless an explicit store is provided. Concurrent
  initial loads share one promise, saves serialize atomic replacements, and
  failed writes leave the visible cache unchanged. Returned records are copies.
  Reopening preserves terminal tasks and results; it does not resume execution.

The task file now uses `{ version: 1, tasks: [...] }`. Existing unversioned
`{ tasks: [...] }` files load and migrate on the next successful save. Malformed
or unsupported state rejects without overwriting the file. The store serializes
writes within one runtime instance; multiple processes must not share it.

Focused interrupted-recovery and related checkpoint/session/workflow/validation
tests pass (86 tests), including 22 restart and recovery-policy cases. The full
repository suite, root and SDK typechecks, build, and lint also pass; exact
counts are recorded under Latest verification.

## Next priority

Phase 5 is COMPLETE (5A–5L verified above; 5M local; 5N blocked). The
release classification is **PRODUCTION CANDIDATE**: the Windows runtime is
fully verified (1,456 + 17 tests including real multi-process crash/
recovery), implementation is complete, no security regression or
governance bypass exists — but Linux, macOS, and ARM64 runtime
verification never executed because the repository has no git remote and
no GitHub auth tooling, so the CI matrix has never run.

Minimum user actions to unblock (exact commands):

1. Create a GitHub repository (any name, e.g. `quack`).
2. `git remote add origin <repository-url>`
3. `git push -u origin master`
4. Let GitHub Actions run `.github/workflows/ci.yml` (windows/linux/macos
   × node 22/24 + arm64-focused job).
5. Record per-OS evidence in `docs/platform/`; then reconsider PRODUCTION
   READY.

Remaining future capabilities (unchanged, not scheduled): container/
microVM isolation backend, secret mediation, network sealing,
browser-profile access, automatic durable-state retention/compaction,
remote skill execution, parallel delegation children, full MCP
materialization envelopes across transports, skill execution statistics
(5H: deferred — no consumer in the current architecture).

## Test-runner resolution — 2026-09-04

`skills/runtime/skill-runtime.test.ts` could hang in its timeout case. Its
test-only slow-tool fixture awaited a completion promise that was resolved only
when the tool body began. A one-millisecond graph deadline can cancel before
that dispatch, leaving cleanup awaiting a promise that can never resolve. The
fixture now waits only when execution began, while the test asserts the actual
deadline error text. No production runtime behavior changed.
