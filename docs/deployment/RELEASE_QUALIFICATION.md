# QUACK Release Qualification — P16

**Version:** 1.0.0 — qualification session: P16 on branch
`feat/quack-product-experience`

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
Installer syntax checks exist in CI.

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

**CONDITIONAL.** Deployment documentation corrected (unsupported
docker-compose claim removed; application deployment separated from execution
isolation backend); three deployment docs added and registered in
`packaging/public-files.json` + package `files` manifest. GitHub CI
qualification (including the installer-smoke matrix) is NOT VERIFIED in this
session — it was not executed here; no evidence of failure exists either.
Classification: CI runtime execution = NOT VERIFIED.

## RELEASE DECISION

**CONDITIONAL GO**

Rationale (all evidence-based):

- All local qualification gates pass with the observed counts (final test
  run in the session report).
- The decision is CONDITIONAL, not GO, because:
  1. Single-host architecture only; multi-host coordination is UNSUPPORTED.
  2. At-most-once dispatch; exactly-once external effects are UNSUPPORTED.
  3. Data integrity is digest/fail-closed based; cryptographic authenticity
     against a full dataDir-write attacker is NOT_CLAIMED.
  4. Docker container isolation is BEST_EFFORT (daemon/environment dependent);
     no Docker application artifact exists.
  5. GitHub CI (3-OS × 2-Node matrix incl. installer-smoke) was NOT executed
     in this qualification session — classification NOT VERIFIED, not FAIL.

GO requires: a green CI run observed on GitHub for the release commit, plus
an explicit acceptance of the standing single-host/at-most-once boundaries.

## Related documents

- [PRODUCTION_TOPOLOGY.md](PRODUCTION_TOPOLOGY.md)
- [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md)
- [../DEPLOYMENT.md](../DEPLOYMENT.md)
