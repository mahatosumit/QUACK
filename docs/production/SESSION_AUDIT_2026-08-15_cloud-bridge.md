# QUACK vNext — Cloud/Bridge Session Audit

Date: 2026-08-15 (Asia/Calcutta)
Session environment: Cowork cloud sandbox + device bridge (Linux VM), **not** the Windows workstation.

## Purpose

An independent re-check of the QUACK vNext release baseline, run from a different
environment than the prior Windows-based Codex work, to (a) corroborate the
environment-agnostic gates against the *current* source and (b) record precisely
which mission phases are and are not verifiable from this session, with reasons.

This file does **not** overwrite or contradict the prior, Windows-native audit
artifacts (`BASELINE_AUDIT.md`, `NONDETERMINISM_ROOT_CAUSE.md`,
`PRODUCTION_READINESS_REPORT.md`, `COMPANY_RUNTIME_READINESS_REPORT.md`). Those
were produced on the faithful workstation environment and remain authoritative
for the runtime/regression/provider claims.

## Environment reconciliation (important)

| Fact | Prior Codex audit | This session |
|---|---|---|
| Host | Windows 11 workstation | Linux VM device bridge + cloud container |
| Node | v24.15.0 | v22.22.3 |
| Git repo | Root at the parent repository; QUACK is a subdirectory | Only the `QUACK` subfolder is mounted → **no `.git` visible** |
| Providers | RTX 4060 (8 GB), NVIDIA key absent, Ollama absent | none reachable |
| Command budget | Full runs (~90–113 s regressions) | 45–60 s per command cap |

The absence of `.git` in this session is fully explained: the connected folder is
a **subdirectory** of the actual repository, whose root is the parent the parent repository
directory. Nothing is wrong with the repo.

## Independently verified this session (faithful signals)

Run against the current on-disk source (422 TS source files, 121 test files):

```text
TYPECHECK = PASS   (tsc -p tsconfig.json --noEmit, 0 errors)
BUILD     = PASS   (tsc -p tsconfig.json, clean emit)
LINT      = PASS   (scripts/static-quality.mjs → "Static quality checks passed.")
```

These are compilation + static-analysis gates with no OS/DB/network dependence,
so they are trustworthy from any environment. They corroborate the top row of the
existing `PRODUCTION_READINESS_REPORT.md`.

## Not verifiable from this session — with precise reasons

- **Full regression suite (`npm test`, ~1103 tests): NOT FAITHFULLY RUNNABLE HERE.**
  Under the concurrent runner, SQLite raises `disk I/O error` repeatedly in this
  sandbox filesystem. A single-threaded `node:sqlite` open+write in `/tmp`
  succeeds, so this is concurrent-load behavior of the sandbox FS, **not** a QUACK
  defect. The 14 observed failures were all in the self-modification /
  code-improvement integration tests (Scenarios 1–7, Safety A–K) — exactly the
  storage/worktree-heavy paths — and a later concurrent suite hung. On Node 22 the
  Windows Maglev crash also cannot manifest. Net: the "1103/1103 ×5" claim can be
  neither reproduced nor disproved here; the environment is not faithful for it.

- **P1 nondeterminism (release blocker): NOT REPRODUCIBLE HERE.**
  Root cause per `NONDETERMINISM_ROOT_CAUSE.md` is a Windows-specific Node 24 / V8
  Maglev `0xC0000409` child-process crash plus non-idempotent Git worktree
  cleanup. It requires Windows + Node 24 + a real Git repo/worktrees — none of
  which this Linux/Node-22/no-git mount provides.

- **P3 NVIDIA live certification: BLOCKED_BY_SECRET.**
  `NVIDIA_API_KEY` is not present in this process (correctly never printed).

- **P4 Ollama live certification: BLOCKED_NOT_INSTALLED.**

- **Windows signing / clean-VM packaging: BLOCKED** (no code-signing certificate).

- **Endurance / performance / UI-FPS / long-run memory gates: BLOCKED** by the
  45–60 s per-command cap on the bridge.

## Honest status

The current best, evidence-backed private-readiness label remains what the prior
Windows audit concluded:

```text
COMPANY_RUNTIME / PRODUCTION = NOT_READY
PUBLIC_DISTRIBUTION_READY     = NO
```

with the seven blocking items enumerated in `PRODUCTION_READINESS_REPORT.md`.
Nothing observed this session contradicts that verdict; the three gates I could
faithfully re-run (build, typecheck, lint) all PASS on the current source.

## Recommended next actions (must run on the Windows workstation)

1. Make `NVIDIA_API_KEY` visible to the QUACK launch process (User→process env)
   and complete P3 (real minimal inference through the QUACK provider path,
   credential never logged).
2. Decide whether Ollama local inference is a required release feature; if yes,
   install it and complete P4 with the exact discovered model ID.
3. Ship + test a concrete Windows isolation launcher for untrusted stdio MCP.
4. Pin the policy-approved DNS result through the outbound connection (anti-rebind).
5. Obtain a code-signing certificate; sign + clean-VM validate the Windows package.
6. Run sustained concurrency / failover / UI-FPS / memory-growth endurance passes.
7. Close the Company Runtime security/execution boundary (AGT-001–020, adversarial
   scenarios, real mission integrations) per `COMPANY_RUNTIME_READINESS_REPORT.md`.

To let a cloud/bridge session do faithful regression work in future, connect the
**repository root (the parent repository)** rather than the `QUACK` subfolder, and prefer
running the suite on the workstation (or a Windows runner) so Node 24 / Git
worktree / SQLite-concurrency behavior matches production.
