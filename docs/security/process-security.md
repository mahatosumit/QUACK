# Process Security

Status: SUPPORTED (implemented + adversarially tested on Windows
runtime; Linux/macOS pending CI).

ADR: [0040](../adr/0040-cross-platform-platform-abstraction.md)
Source: `src/platform/process.ts`

## Policy

1. **No implicit shell.** Production code never constructs shell command
   strings. `executeProcess` spawns argv arrays with `shell: false`; a
   shell string as a command fails to start (adversarially verified).
2. **Explicit environment.** Children never inherit `process.env`
   wholesale. Production callers use `childProcessEnvironment()`
   (allowlist: PATH + OS identity vars) or the terminal tool's
   secret-stripped environment. Secret-shaped variables (KEY/TOKEN/
   SECRET/PASSWORD/CREDENTIAL patterns) are never passed.
3. **Bounded output.** stdout/stderr size-capped with truncation flags;
   output flooding cannot exhaust the host (10MB flood → truncated
   result, adversarially verified).
4. **Timeout + cancellation kill the tree.** Windows `taskkill /T /F`
   (best-effort tree), POSIX SIGKILL. Terminal intent is recorded BEFORE
   the kill so a close event cannot report COMPLETED for a killed
   process. Runaway infinite-loop children terminate (adversarially
   verified).
5. **Exit codes observed, never masked.** tsc/eslint failures surface as
   findings; the historical shell exit-code-masking operators are
   eliminated and now build-blocking.
6. **Windows npx**: `.cmd` shims cannot spawn shell-less
   (CVE-2024-27980); `resolveNodeCliArgv("npx", …)` resolves
   `[process.execPath, <npx-cli.js>, …]`.

## The one intentional shell path

`src/tools/terminal.ts` is a *tool* whose purpose is shell execution. It
is governed: `terminal.execute` permission required, dangerous-command
patterns blocked (`rm -rf`, `dd`, `mkfs`, fork bomb, disk overwrite),
environment sanitized (secret-shaped vars removed), working directory
workspace-contained. It is the ONLY production exemption in the
static-quality guard.

## Enforcement

`scripts/static-quality.mjs` (runs in `npm run lint`) fails on
`execSync(`, shell stderr-merge, or exit-code-masking operators anywhere
in production `src/` outside the three reviewed exemptions
(`platform/process.ts`, `cli.ts` argv `execFile`, `terminal.ts`).

## Verified attack rejections

Shell metacharacters as command (fail-to-start), argument injection via
working directory (rejected by path containment), environment secret
leakage (none in materialized env), output flooding (bounded), timeout
abuse (tree-killed).
