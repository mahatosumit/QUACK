# Windows Platform Support

Runtime verification: **VERIFIED** (2026-09-07, Node 24.19.0, Windows
x64). All statements below were executed and observed, not inferred.

## Verified on Windows runtime

| Capability | Evidence |
| --- | --- |
| Core runtime + full test suite | 1,442 ordinary + 17 serial tests, 0 failures (includes real-fork multi-process tests) |
| Platform abstraction | `dist/platform/platform.test.js` — 13 tests: detection, capability matrix fail-closed, shell adapter |
| Path security | Platform suite + adversarial cross-suite: traversal, UNC (`\\server\share`), device paths (`\\.\`, `\\?\`), alternate data streams, NUL, symlink/junction escape, 8.3 short-path equivalence |
| Process execution (argv, no shell) | Platform suite + adversarial cross-suite: env isolation, timeout tree-kill, cancellation, output bounds, shell-metacharacter fail-to-start |
| Skills / privacy / discovery | 12 discovery + 6 quarantine-search + 3 execution-profile + sandbox suites |
| SQLite coordination | `dist/storage/coordination.test.js` — 9 tests with real forked workers (races, SIGKILL crash, takeover, fencing) |
| Git / tsc / eslint via argv | GitStatusTool tests (real repo), validation-pipeline tests; `2>&1`/masking operators eliminated from production code |

## Windows-specific behaviors

- **`npx` cannot be spawned shell-less**: `npx` is a `.cmd` shim; Node
  rejects `.cmd` without a shell since CVE-2024-27980. QUACK resolves the
  node-distributed `npx-cli.js` and spawns
  `[process.execPath, npxCli, ...]` (`resolveNodeCliArgv`).
- **Environment allowlist**: Windows spawn requires `SystemRoot` (and
  related identity variables) or processes fail to start.
  `childProcessEnvironment()` materializes PATH, SystemRoot, SystemDrive,
  ComSpec, TEMP/TMP, APPDATA, LOCALAPPDATA, PROGRAMDATA (POSIX: PATH,
  HOME, LANG).
- **Atomic rename retries**: `renameWithTransientRetry` (async) and the
  discovery registry's sync equivalent retry EPERM/EBUSY/EACCES — the
  transient Windows rename failures.
- **8.3 short paths**: path containment `realpath`s BOTH sides so
  `C:\Users\FRED~1` and `C:\Users\Frederick` compare equal.
- **Process-tree termination**: `taskkill /T /F` best-effort (a tree kill
  is documented best-effort, not a guaranteed kill of detached children).
- **File locking**: BEST_EFFORT (no reliable flock equivalent); QUACK uses
  SQLite coordination for cross-process exclusion instead.

## CI

`windows-latest` × Node 22/24 is part of the CI matrix
(`.github/workflows/ci.yml`). Local runtime verification above is the
authoritative evidence; CI adds repeatable matrix execution.
