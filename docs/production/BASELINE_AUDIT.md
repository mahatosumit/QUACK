# QUACK Production vNext Baseline Audit

## 2026-08-15 master-convergence rebaseline

```text
BRANCH=codex/production-vnext
HEAD=454d72d670dcf95956aee38208404a310dab5545
DIRTY_USER_FILE=QUACK/.claude/settings.local.json (untouched)
NODE=v24.15.0
NPM=11.12.1
NPM_INSTALL=PASS (up to date; lifecycle scripts disabled for rebaseline)
BUILD=PASS
TYPECHECK=PASS
LINT=PASS
INITIAL_REGRESSION=1,102/1,103 PASS; selfmod promotion fixture nondeterministic
POST_FIX_TARGETED=20/20 consecutive PASS
POST_FIX_REGRESSION_X5=1,103/1,103 PASS each run
PROVIDER_LIVE_VALIDATION=NOT_RUN
OLLAMA=NOT_ON_PATH
```

The P1 nondeterminism investigation and evidence are recorded in
`NONDETERMINISM_ROOT_CAUSE.md`. No provider call was made during rebaseline.
The user-owned `.claude/settings.local.json` was not read, modified, staged, or
deleted.

> Historical note: this file records the original v0.2.0-rc1 audit at `a015cdb`.
> The Solo Production mission resumed from `3481416` on
> `codex/production-vnext`; the final readiness report uses that later foundation
> as its comparison point. The user-owned untracked `.claude/` directory was not
> read, modified, staged, or deleted during either audit.

Audit date: 2026-08-15 (Asia/Calcutta)

## Repository checkpoint

```text
REPOSITORY_ROOT=<repository-root>
PROJECT_ROOT=<repository-root>/QUACK
BASELINE_COMMIT=a015cdb611964ec4d977cc5ebbdccccc1c22d2db
BASELINE_BRANCH=master
WORKING_BRANCH=codex/production-vnext
```

At this historical checkpoint, QUACK was a project subdirectory inside a parent
repository. This does not describe the topology of every later checkout. Before the checkpoint branch was created,
`git status --porcelain=v1 --untracked-files=all` reported one user-owned,
untracked file:

```text
?? QUACK/.claude/settings.local.json
```

That file was not read, modified, staged, or deleted. No tracked QUACK files
were modified at baseline. The full test suite's self-modification tests created
and removed their own isolated worktrees and branches; the default branch HEAD
and working-tree status were unchanged after the run.

## Baseline gates

```text
BUILD=PASS (npm.cmd run build)
TYPECHECK=PASS (npm.cmd run typecheck)
LINT=NOT_AVAILABLE (no lint script or linter dependency; current lint workflow only runs typecheck and grep checks)
UNIT_TESTS=PASS (included in aggregate Node test run)
INTEGRATION_TESTS=PASS (included in aggregate Node test run)
CONTRACT_TESTS=PARTIAL (existing provider/tool/planner contracts only; no complete v1 conformance suites)
E2E_TESTS=PARTIAL (Node system scenarios pass; no Playwright desktop E2E suite)
AGGREGATE_TESTS=PASS (1058 passed, 0 failed, 0 skipped, 90.765 seconds)
DEPENDENCY_AUDIT=PASS (0 known vulnerabilities reported by npm audit)
CLI_DOCTOR=PASS_WITH_FALSE_PRODUCTION_CLAIM
WINDOWS_STATUS=PARTIAL
```

Commands were invoked through `npm.cmd` because the workstation's PowerShell
execution policy blocks `npm.ps1`. This is a Windows developer-experience issue,
not a build failure.

## Workstation inventory

```text
OS=Windows
NODE=v24.15.0
NPM=11.12.1
PNPM=INSTALLED_BUT_POWERSHELL_SHIM_BLOCKED
PYTHON=DETECTED_VIA_UV_SHIM_BUT_CHILD_PROCESS_PERMISSION_DENIED
GIT=2.54.0.windows.1
DOCKER=29.6.1 (Docker config could not be read in the sandbox)
OLLAMA=NOT_INSTALLED_OR_NOT_ON_PATH
GPU=NVIDIA GeForce RTX 4060 Laptop GPU
VRAM=8188 MiB
NVIDIA_API_KEY=ABSENT
```

Live Ollama conformance is blocked because the executable and local service are
absent. No model was downloaded. Live NVIDIA conformance is
`BLOCKED_BY_SECRET`: `NVIDIA_API_KEY` is not present. No key was requested,
printed, logged, or persisted.

## Architecture inventory

The baseline contains approximately 386 TypeScript files and 109 TypeScript
test files. The composition root is `src/system/create-system.ts`; the canonical
goal path starts at `QuackRuntime`, with `ExecutiveBrain` selected only when a
non-echo provider is registered and `SimpleBrain` used otherwise. SQLite is the
primary local persistence backend, with JSON mirrors/stores for selected state.
Tool calls are gated by `PermissionBackedCapabilityBroker` and
`RiskAwareApprovalPolicy`.

Relevant existing subsystems include:

- provider adapters and a sequential fallback router in `src/providers`;
- a second model-provider runtime and model router in `src/models`;
- a third AI runtime/model/capability registry in `src/airm`;
- mission/runtime execution, checkpointing, journals, SQLite persistence, and
  recovery components;
- tool, skill, plugin, computer/browser, security, audit, API, desktop server,
  dashboard, memory, and controlled self-modification layers.

The repository already has valuable safety coverage, including permission
denial, path containment, persisted state, restart behavior, isolated
self-modification worktrees, approval gates, rollback, and provider fallback.
These are to be evolved rather than replaced.

## Baseline gaps and known risks

These are pre-existing findings and are not regressions:

1. Provider truth is split across `src/providers`, `src/models`, and `src/airm`.
   Their capability shapes and routing semantics are inconsistent.
2. The generic provider router uses caller-supplied order and catches every
   error without a normalized taxonomy, retry policy, circuit breaker, policy
   decision record, or privacy-boundary enforcement.
3. Capability support is represented mostly as booleans or broad task labels;
   it cannot distinguish native, emulated, degraded, and unsupported support.
4. The OpenAI-compatible adapter advertises streaming, tool calling, structured
   output, and multimodal support without endpoint-specific proof.
5. `NvidiaNimProvider` contains a mock-key fallback and hard-coded model claims.
   Live/provider behavior is therefore not cleanly separated from test fakes.
6. NVIDIA configuration currently uses `QUACK_NVIDIA_API_KEY`, while the vNext
   mission requires live validation from `NVIDIA_API_KEY`; compatibility and
   migration behavior need an explicit decision.
7. Ollama registration is environment-variable-triggered and defaults to a
   specific model instead of discovering installed models.
8. There is no first-class Action Provider contract, action conformance suite,
   or first-class MCP transport implementation in the inspected baseline.
9. The browser/computer layer is largely provider-neutral scaffolding/no-op
   behavior rather than a proven Playwright-backed production adapter.
10. The HTTP API has useful request bounds and safe local defaults in parts, but
    lacks a complete versioned/authenticated production boundary and OpenAPI
    contract.
11. The desktop/control-room UI is server-rendered vanilla HTML/JavaScript; no
    Playwright visual/accessibility gate or packaged Windows artifact was proven.
12. `quack doctor` prints “Ready for production workflows” after only six basic
    checks. That claim exceeds the evidence and must be removed or qualified.
13. There is no real lint/format gate in `package.json`.
14. Git emits a warning because the global excludes file under `.config/git`
    is unreadable in this sandbox. The test run still completed successfully.

## Frozen baseline conclusion

The current codebase is a broad, passing prototype/platform foundation with
substantial test coverage, but it is **not production ready** under the vNext
release gate. P1 should introduce one versioned execution/provider contract and
compatibility adapters, then move routing decisions behind explicit capability
and policy evaluation without rewriting functioning runtime, persistence, or
security components.
