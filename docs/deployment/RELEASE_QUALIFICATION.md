# QUACK Release Qualification — P16

**Version:** 1.0.0 — qualification session: P16 on branch
`feat/quack-product-experience`

**Release baseline:** f9da6b4 (unchanged). **Qualified head:** 7bf01dd =
f9da6b4 + three CI-driven test-only fix commits (272f7ec, db93ce2, 7bf01dd)
created under the Phase 11 rules; f9da6b4's own CI run (34877974904) failed
on test-portability and lease-timing defects in test code, which the fix
commits resolve. No product code changed after f9da6b4.

This document classifies each release criterion with the evidence observed in
the P16 qualification session, then states the release decision. Criteria are
classified PASS / CONDITIONAL / FAIL / NOT APPLICABLE. Production claims carry
the standing classification vocabulary: IMPLEMENTED / BEST_EFFORT / UNSUPPORTED
/ NOT_CLAIMED.

## 1. Deployment topology

**CONDITIONAL (single-host, npm-primary).** Primary artifact is the npm
package `@quack/os` (Node >= 22.5, one host, one dataDir, loopback-only
authenticated server). Docker application deployment: UNSUPPORTED — no
Dockerfile/docker-compose artifact exists in the repository; the unsupported
docker-compose claim in docs/DEPLOYMENT.md was corrected in this session.
Multi-host coordination: UNSUPPORTED.

Evidence: PRODUCTION_TOPOLOGY.md; package.json `files`/`bin`/`engines`;
P16 configuration audit (CFG-1..9).

## 2. Configuration

**PASS.** Fail-closed configuration validation at construction; keyless start
supported (echo provider; cloud providers stay unregistered); standing-consent
permissions auto-granted only for the explicitly safe set; malformed config
refused; the broker denies unconfigured permission scopes.

Evidence: p16-configuration 19/19 (CFG-1..9).

## 3. Secret handling

**PASS.** Credentials only through the SecretProvider boundary (env vars);
never persisted to dataDir; redacted from EventBus, audit, approvals, errors,
health; excluded from backups; planted-credential scans clean.

Evidence: p16-configuration 19/19 (SEC-1..10); p16-backup-migration (BKR-5).

## 4. Persistent data

**PASS.** Versioned, fail-closed JSON stores (run records, journals,
checkpoints, approvals, evidence, grants); corrupt records throw on load;
identity mismatches refuse.

Evidence: p16-startup-provider (START-5); p16-backup-migration; DATA_LIFECYCLE.md.

## 5. Backup/restore

**PASS.** `quack-solo-backup-v1`: real backup/restore; WAITING_APPROVAL
preserved; AMBIGUOUS remains parked; corrupt/partial/incompatible backups
rejected; secrets excluded; atomic rollback; coordination DB restores.

Evidence: p16-backup-migration 15/15 (BKR-1..9).

## 6. Migration

**PASS.** Forward-only SQLite migrations 001-004; idempotent; deterministic
digests; no privilege escalation; future-version fail-closed; downgrade
unsupported by design.

Evidence: p16-backup-migration 15/15 (MIG-1..6).

## 7. Startup

**PASS.** Clean startup; interrupted startup reconciles before execution;
AMBIGUOUS parks; stale lease takeover with fencing; corrupt records/DB fail
closed; invalid configuration refused; unavailable provider fails the
mission honestly.

Evidence: p16-startup-provider 17/17 (START-1..8).

## 8. Shutdown

**PASS.** Graceful stop preserves durable state, budgets, approvals; no
fabricated verification or terminal state.

Evidence: p16-startup-provider (STOP-1..2).

## 9. Provider reliability

**PASS.** Provider failure never authorizes, never verifies, never resets
budget; bounded retries; deterministic governed errors; malicious model
output stays data.

Evidence: p16-startup-provider (PROV-1..7); SMOKE-4.

## 10. Isolation

**CONDITIONAL (OS-process SUPPORTED; container BEST_EFFORT).** OS-process
isolation with verified evidence: IMPLEMENTED and qualified (real child
processes, identity-bound evidence, trusted probes). Docker container
backend: BEST_EFFORT — used only when a Docker daemon exists in the
environment; fails closed (DENY) otherwise. No isolation downgrade to a host
path is possible (downgrade gate).

Evidence: p16-sqlite-isolation 13/13 (ISO-1..4); SMOKE-1/SMOKE-5; P13/P14
isolation suites.

## 11. SQLite coordination

**PASS (single host).** Concurrent single-winner; corrupt DB fail-closed;
10s busy timeout; stale-lease takeover with monotonic fencing; host-copy
honesty; backup while active; disk-full fail-closed. Explicitly NOT
distributed consensus.

Evidence: p16-sqlite-isolation (LIM-1..9).

## 12. Installation

**PASS (npm-primary).** `npm install @quack/os`; CLI `init`, `--version`,
`doctor --json` (`"ready": true` observed locally on Node 24/Windows);
`status`, `config` exercised in the local installer-smoke equivalent.
Installer smoke is CI-VERIFIED on every supported OS/Node combination
(installer-smoke 6/6 green in run 34927956602: real tarball pack →
clean-directory npm install → fresh-home CLI init/doctor/status/config;
bash installer syntax check on Linux/macOS; installer copy drift check
against the Pages-served copies).

## 13. Upgrade

**CONDITIONAL.** Forward-only migrations are implemented and qualified; the
upgrade path (install newer package over an existing dataDir) is covered by
migration + startup qualification. Downgrade is unsupported by design.

## 14. Release artifact

**PASS.** `npm pack` tarball inspected: dist runtime (tests/e2e excluded),
installers, skills, license/governance docs, deployment docs, CLI/SDK export
surfaces; no `.env`, no local dataDir, no SQLite DBs, no credentials, no
test/garbage artifacts. Public-manifest checks (`check-public-docs`,
`public-release` gates) pass locally.

Evidence: P16-M artifact inspection; scripts/check-public-docs.mjs.

## 15. Health/readiness

**PASS.** `/health` (identity + counts only; no secrets — SEC-7) and
`quack doctor` (runtime, storage, coordination lease probe, broker, network
policy, skills, providers) are the two surfaces; both verified live. Health
is observability only — it never grants authority. No second monitoring
system exists or is needed.

## 16. Production smoke

**PASS.** Full lifecycle start → ready → governed real OS-process execution
→ evidence → persist → stop → restart → inspect; WAITING_APPROVAL survival;
AMBIGUOUS parking; provider-unavailable fail-closed; isolation-denied
fail-closed. 5/5 observed.

Evidence: p16-production-smoke (SMOKE-1..5).

## 17. Security

**PASS (for the qualified boundary).** The 15-point P16 security review
(secret leakage; authorization/verification/budget from provider failure;
approval bypass; AMBIGUOUS auto-resume; cross-mission authorization; startup/
migration/backup authority escalation; artifact leakage; unsupported Docker
claims; provider/isolation bypass; health-as-authority) holds. Standing
boundaries: integrity-not-authenticity against a dataDir-write attacker
(NOT_CLAIMED beyond that), at-most-once (not exactly-once) external effects.

## 18. Documentation/package integrity

**PASS.** Deployment documentation corrected (unsupported
docker-compose claim removed; application deployment separated from execution
isolation backend); three deployment docs added and registered in
`packaging/public-files.json` + package `files` manifest. GitHub CI
qualification: **VERIFIED GREEN** — CI workflow run 34927956602
(`feat/quack-product-experience`, PR #4) completed with all 14 jobs passing:
build-and-test on ubuntu-latest/windows-latest/macos-latest × Node 22/24,
installer-smoke on all 3 OS × both Node versions, and arm64-focused on
ubuntu-24.04-arm + macos-14. Companion workflows green on the same head:
Coverage, Security Scan (secret-scan + codeql), Documentation (validate-docs).
The run head is 7bf01dd, the P16 release commit f9da6b4 plus three test-only
CI-hardening commits (272f7ec portability/timing, db93ce2 P15 lease margins,
7bf01dd temp-dir cleanup retry) produced under Phase 11 rules to fix
CI-driven test defects; no product code changed after f9da6b4. Environment
skips observed in CI and accepted as documented: the browser-workflow test
(no browser environment in runners) and P13.CT-9/CT-10 container enforcement
tests on hosts without an opted-in Docker daemon (fail-closed paths are
exercised by P13.CT-3/CT-4 instead). macOS + Node 24 build-and-test hung
infrastructurally on three consecutive earlier runs (f9da6b4, 272f7ec,
db93ce2; identical stop point, 3 orphaned runner processes, no test output) —
resolved without workflow modification on the 7bf01dd run, which completed
normally on the same code.

## RELEASE DECISION

**GO**

Rationale (all evidence-based):

- All local qualification gates pass with the observed counts (final test
  run in the session report; Windows Node 24 full suite 2191 tests / 0 fail,
  plus WSL Ubuntu Node 22 and Node 24 full-suite reproductions of the Linux
  CI environment).
- GitHub CI run 34927956602 is observed green across the full supported
  matrix: ubuntu/windows/macos × Node 22/24 build-and-test, installer-smoke
  on every OS/Node combination, arm64 verification, coverage, secret scan,
  CodeQL, and public-docs validation.
- Installer/package smoke passes on every supported OS/Node combination
  (tarball pack → clean-directory install → CLI init/doctor/status/config).
- No critical security defect exists; the 15-point P16 security review
  holds; CodeQL runs green (the 5 high-severity RegExp constructor findings
  on test code were false positives over literal data and were removed in
  272f7ec anyway; the stack-trace medium warning targets the loopback-only
  server, which serializes error.message only).
- The supported platform matrix is actually exercised through CI:
  Windows/macOS/Linux × Node 22/24 (CI-VERIFIED), Linux/macOS additionally
  NOT LOCALLY VERIFIED outside CI runners (local verification was performed
  on Windows Node 24, WSL Ubuntu Node 22/24).
- The standing production boundaries remain explicitly accepted and
  unchanged; GO is granted strictly within them:
  1. Single-host architecture only; multi-host coordination is UNSUPPORTED.
  2. At-most-once dispatch; exactly-once external effects are UNSUPPORTED.
  3. Data integrity is digest/fail-closed based; cryptographic authenticity
     against a full dataDir-write attacker is NOT_CLAIMED.
  4. Docker container isolation is BEST_EFFORT (daemon/environment dependent);
     no Docker application artifact exists.
  5. Extension execution, unrestricted network, unrestricted credentials,
     and autonomous irreversible execution remain UNSUPPORTED; distributed
     consensus and universal ambiguity resolution remain NOT_CLAIMED.

GO means: the P16 release baseline (f9da6b4 lineage) is qualified for
production use within the documented SUPPORTED boundary — npm-primary
single-host deployment, Node >= 22.5, loopback authenticated server,
OS-process isolation, SQLite single-host coordination.

## Related documents

- [PRODUCTION_TOPOLOGY.md](PRODUCTION_TOPOLOGY.md)
- [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md)
- [../DEPLOYMENT.md](../DEPLOYMENT.md)
