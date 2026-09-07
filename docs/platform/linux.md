# Linux Platform Support

Implementation status: **EXISTS** (platform abstraction is OS-neutral
Node/TypeScript; capability matrix declares Linux SUPPORTED for core
runtime, filesystem, process execution, worker isolation, network policy,
SQLite coordination, file locking; container backend declared SUPPORTED).

Runtime verification: **NOT VERIFIED**. No Linux execution of the QUACK
test suite has been observed. Linux verification requires a successful
GitHub Actions run on `ubuntu-latest` (Node 22/24) and
`ubuntu-24.04-arm` (focused gates) as configured in
`.github/workflows/ci.yml`. Until such a run completes, every "SUPPORTED"
entry for Linux is a declaration of intended behavior, not evidence.

## Expected Linux-specific behaviors (implemented, unverified)

- Shell resolution: `/bin/bash`, `/usr/bin/bash`, `/bin/sh` (first
  existing) for the explicitly authorized shell path only.
- Process-tree termination: SIGKILL to the direct child (child cleanup
  documented best-effort).
- `npx` resolves through the node-distributed `npx-cli.js` identically to
  Windows.
- Symlink containment checks use POSIX symlink semantics.

## Known unverified risks

- Path case-sensitivity differences (Linux FS is case-sensitive; the
  adversarial case-difference tests were written for and verified on
  case-insensitive Windows semantics).
- Junctions do not exist on Linux; symlink tests cover the equivalent.
- Worker-backend crash/termination semantics under Linux signals.
- SQLite `begin immediate` behavior under Linux filesystem locking.

These are expected to work; expectation is not verification.
