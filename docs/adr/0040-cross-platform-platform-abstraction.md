# ADR 0040: Cross-Platform Platform Abstraction

## Status

Accepted — 2026-09-06

## Context

Phase 4 requires QUACK to run on Windows, Linux, and macOS with
architecture that can later support x64 and ARM64. The audit found platform
behavior spread inline through the codebase: `process.platform` in 9 files,
Unix-only shell strings in the intelligence subsystem
(`which X || where X`, `2>&1 || true`), Windows-only browser-executable
discovery, and no unified path or process policy (terminal tool executes
shell strings with full host `process.env` inheritance).

## Decision

### Platform adapters (`src/platform/platform.ts`)

`PlatformAdapter` exposes platform kind, architecture, an honest
capability matrix (`SUPPORTED`/`BEST_EFFORT`/`UNAVAILABLE` per capability —
core runtime, filesystem, process execution, worker isolation, network
policy, SQLite coordination, file locking, secret store, container backend,
OS-native sandbox), and the default shell (Windows: ComSpec with `/d /s /c`
argv prefix; POSIX: `/bin/bash`/`/bin/zsh` with `-c`). Unavailable
capabilities fail closed; they never silently degrade.

### Path policy layer (`src/platform/paths.ts`)

Every path entering QUACK passes `resolveInsideRoot`: traversal escape,
UNC paths (`\\server\share`), device paths (`\\.\`, `\\?\`), alternate data
streams (any colon beyond a leading drive letter), and NUL bytes are
rejected before resolution. Symlink/junction containment compares
`realpath`'d targets against the `realpath`'d root (both sides, so Windows
8.3 short-path vs long-path spellings compare equal), and the ancestor walk
stops at the root so the root's own parents are not flagged.

### Process execution (`src/platform/process.ts`)

`executeProcess` is argv-based with `shell: false` — a shell string passed
as a command fails to start instead of executing. The environment is
materialized from an explicit record, never `process.env` wholesale.
Working directory is caller-authorized; stdout/stderr are size-bounded with
truncation flags; timeout and cancellation terminate the process tree
(Windows `taskkill /T /F` best-effort, POSIX SIGKILL) with terminal intent
recorded before the kill so a close event cannot report COMPLETED for a
process we decided to terminate.

## Consequences

- The core runtime gains explicit, testable platform seams instead of
  inline OS detection.
- Existing surfaces (terminal tool, intelligence subsystem) are NOT yet
  migrated; they keep current behavior until each is moved onto the
  adapters deliberately. This ADR establishes the contract first.
- No capability is claimed where the matrix says UNAVAILABLE.

## Verification

`src/platform/platform.test.ts` (13 tests): detection mapping, honest
capability matrix with fail-closed unavailable, Windows shell adapter;
containment and traversal; UNC/device/ADS/NUL rejection; symlink escape of
existing targets and of new-file parents; argv execution without shell with
env isolation; shell strings failing to start; timeout termination;
deterministic cancellation; stdout truncation; exit-code capture.

Full repository suite: 1,397 ordinary + 17 serial tests, 0 failures.