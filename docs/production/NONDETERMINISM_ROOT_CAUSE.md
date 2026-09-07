# Self-Modification Nondeterminism Root Cause

Date: 2026-08-15

Checkpoint investigated: `454d72d670dcf95956aee38208404a310dab5545`

## Decision

**CLOSED_FOR_CURRENT_WINDOWS_BASELINE**

The release gate was not closed after an isolated pass. The final fix completed
20 consecutive targeted mixed-state repetitions and five consecutive complete
1,103-test regressions.

## Reproduction and root cause

The original full runner allowed Node to execute up to sixteen test files in
parallel. Two Git-heavy self-modification integration files also launched many
nested npm, Node, and Git processes. Under that load, otherwise identical
candidate checks intermittently changed from passing to `REJECTED`, or clean
promotions changed from `PROMOTED` to `ROLLED_BACK`.

Structured exit diagnostics exposed the decisive failure. A fixture command
whose script was `node -e "process.exit(0)"` or an equally trivial `npm test`
was sometimes terminated without semantic test output using Windows exit code
`3221226505` (`0xC0000409`). QUACK previously stored only `passed=false`, so an
infrastructure process crash was indistinguishable from a code regression.

The workstation runs Node `v24.15.0`. Current upstream Node reports document a
Windows Node 24 child-process crash that does not reproduce on Node 22, and a
Windows `0xC0000409` V8 Maglev crash for which `--no-maglev` is the narrow
workaround:

- <https://github.com/nodejs/node/issues/62125>
- <https://github.com/nodejs/node/issues/62260>

An independent repository audit also found a second correctness problem:
tests and production terminal paths recursively deleted or abandoned Git
repositories while linked worktrees and branches were still registered.
Cleanup existed only for explicit discard and was neither idempotent nor
reconciliatory.

## Fix

1. The normal test runner keeps ordinary files parallel at four workers, then
   runs the two nested npm/Git integration files in a separate serialized phase.
2. On Windows Node 24+, the self-modification verifier invokes the trusted npm
   CLI with `node --no-maglev`. Other platforms and Node versions retain the
   normal npm command.
3. Verification evidence now records raw exit code, process error code, signal,
   and killed state in addition to the bounded output summary.
4. Worktree removal is idempotent: bounded retry for transient Windows/Git
   failures, prune, conditional branch removal, and continued reconciliation
   after partial cleanup.
5. Rejected, aborted, promoted, rolled-back, and crash-recovered terminal
   experiments release their worktrees after state/evidence persistence.
6. Test teardown unregisters secondary worktrees, prunes metadata, removes
   experiment branches, proves only the main worktree remains, and only then
   deletes the fixture root.
7. Fixture `.gitignore` files exclude runtime worktrees/data; the stale-base
   test stages its intended file rather than using `git add -A`.
8. Atomic JSON replacement uses UUID temp names and bounded retry for transient
   Windows rename failures.

No test was skipped, no assertion was weakened, and semantic test failures are
not retried.

## Evidence

Targeted post-fix canary:

```text
20 consecutive PASS
states: clean promotion, restart awaiting approval, approval then promotion
test concurrency: 1
real Git repositories/worktrees and nested verification processes
```

Full post-fix regression:

```text
run 1: 1,103/1,103 PASS, 111.203 s
run 2: 1,103/1,103 PASS, 110.291 s
run 3: 1,103/1,103 PASS, 113.104 s
run 4: 1,103/1,103 PASS, 112.476 s
run 5: 1,103/1,103 PASS, 111.817 s
```

Build, typecheck, lint, and static-quality checks passed before the final
repetition series.

## Remaining uncertainty

The Node/V8 crash is an upstream runtime defect, not proven repaired in Node
24 itself. QUACK mitigates the affected verifier host and preserves raw
termination evidence. Node 22 LTS remains the conservative Windows production
runtime until the upstream Node 24 issue is resolved and requalified. Cross-
process self-modification mutation locking remains separate future hardening;
the current solo runtime permits one in-process experiment and serializes the
release integration gate.
