# macOS Platform Support

Implementation status: **EXISTS** (platform abstraction is OS-neutral
Node/TypeScript; capability matrix declares macOS SUPPORTED for core
runtime, filesystem, process execution, worker isolation, network policy,
SQLite coordination, file locking; container backend declared
BEST_EFFORT).

Runtime verification: **NOT VERIFIED**. No macOS execution of the QUACK
test suite has been observed. macOS verification requires a successful
GitHub Actions run on `macos-latest` (Node 22/24) and `macos-14`/arm64
(focused gates) as configured in `.github/workflows/ci.yml`. Until such a
run completes, every "SUPPORTED" entry for macOS is a declaration of
intended behavior, not evidence.

## Expected macOS-specific behaviors (implemented, unverified)

- Shell resolution: `/bin/zsh`, `/bin/bash` (first existing) for the
  explicitly authorized shell path only.
- Process-tree termination: SIGKILL to the direct child (child cleanup
  documented best-effort).
- `npx` resolves through the node-distributed `npx-cli.js` identically to
  Windows.
- Symlink containment uses POSIX symlink semantics; case-insensitive
  default APFS volumes are not specially handled (containment compares
  resolved realpaths, which neutralizes case-spelling differences).

## Known unverified risks

- Apple Silicon (arm64) runner differences for the native SQLite build.
- Sandbox-exec restrictions on GitHub macOS runners for forked
  multi-process tests (coordination suite forks real workers).
- Filesystem normalization behavior of APFS (Unicode normalization forms)
  for path containment comparisons.

These are expected to work; expectation is not verification.
