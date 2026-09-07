# QUACK Platform Abstraction — Architecture

Status: SUPPORTED (contract + Windows runtime verification); Linux/macOS runtime verification pending CI (see `windows.md` / `linux.md` / `macos.md`).

ADR: [0040](../adr/0040-cross-platform-platform-abstraction.md)

## Purpose

The core runtime must not scatter `process.platform`, shell conventions, or
OS-specific path behavior inline. `src/platform/` is the single seam where
OS behavior enters QUACK. Capabilities are declared honestly per platform:
`SUPPORTED`, `BEST_EFFORT`, or `UNAVAILABLE` — an UNAVAILABLE capability
fails closed when requested, never silently degrades.

## Modules

| Module | Responsibility | Status |
| --- | --- | --- |
| `platform.ts` | `PlatformAdapter` with kind, architecture, per-capability support matrix, default-shell descriptor | SUPPORTED (contract); matrix verified on Windows runtime |
| `paths.ts` | `resolveInsideRoot` path policy: traversal, UNC, device paths, alternate data streams, NUL, symlink/junction containment | SUPPORTED; adversarially tested (platform suite + adversarial cross-suite) |
| `process.ts` | `executeProcess` argv execution (no implicit shell), `childProcessEnvironment()`, `resolveNodeCliArgv()`, `probeBinaryAvailable()` | SUPPORTED; verified on Windows runtime |

Other files under `src/platform/` (`platform-runtime.ts`, `dnpl.ts`,
`container-runtime.ts`, etc.) are pre-existing module skeletons, not part
of the Phase 4 verified contract; they must not be treated as verified
platform capabilities.

## Capability matrix (declared)

| Capability | Windows | Linux | macOS |
| --- | --- | --- | --- |
| coreRuntime | SUPPORTED | SUPPORTED | SUPPORTED |
| filesystem | SUPPORTED | SUPPORTED | SUPPORTED |
| processExecution | SUPPORTED | SUPPORTED | SUPPORTED |
| workerIsolation | SUPPORTED | SUPPORTED | SUPPORTED |
| networkPolicy | SUPPORTED | SUPPORTED | SUPPORTED |
| sqliteCoordination | SUPPORTED | SUPPORTED | SUPPORTED |
| fileLocking | BEST_EFFORT | SUPPORTED | SUPPORTED |
| secretStore | BEST_EFFORT | BEST_EFFORT | BEST_EFFORT |
| containerBackend | BEST_EFFORT | SUPPORTED | BEST_EFFORT |
| osNativeSandbox | BEST_EFFORT | BEST_EFFORT | BEST_EFFORT |

**Declared ≠ verified.** The declaration is a contract about intended
behavior; runtime verification status per platform is tracked in the
per-platform documents. As of 2026-09-07, runtime verification exists for
Windows only.

## Process execution policy (ADR 0040 §process)

- Commands are argv arrays; `shell: false` always. A shell string passed
  as a command fails to start instead of executing.
- Environment is materialized from an explicit record. Production callers
  use `childProcessEnvironment()` (PATH + OS-identity allowlist) or the
  terminal tool's sanitized environment — never `process.env` wholesale.
- Working directory is caller-authorized (workspace-contained).
- stdout/stderr are size-bounded with truncation flags.
- Timeout and cancellation terminate the process tree (Windows
  `taskkill /T /F` best-effort; POSIX SIGKILL) with terminal intent
  recorded before the kill.
- `npx` on Windows is a `.cmd` shim that cannot spawn shell-less
  (CVE-2024-27980); `resolveNodeCliArgv("npx", args)` returns
  `[process.execPath, <npx-cli.js>, ...]` instead.

## Enforcement

`scripts/static-quality.mjs` fails the build (`npm run lint`) on
`execSync(`, shell stderr-merge operators, or shell exit-code masking
operators in production `src/`. Exemptions are explicit and reviewed:
`src/platform/process.ts` (the governed abstraction itself), `src/cli.ts`
(argv `execFile`), and `src/tools/terminal.ts` (the permission-gated
shell tool — the ONLY intentional shell path in production code).

## Related

- ADR 0039 — execution isolation contract
- `docs/security/process-security.md`, `docs/security/path-security.md`
