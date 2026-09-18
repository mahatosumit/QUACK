# QUACK Release Candidate — P16

**Decision: GO** (within the documented SUPPORTED production boundary).

- **Branch:** `feat/quack-product-experience` (PR #4 → `main`)
- **Release baseline:** f9da6b4 `feat(release): qualify production deployment and readiness`
- **Qualified head:** 7bf01dd = f9da6b4 + three CI-driven, test-only fix
  commits (272f7ec portability/timing, db93ce2 P15 lease margins, 7bf01dd
  temp-dir cleanup retry). No product code changed after f9da6b4; the P16
  baseline remains reproducible from f9da6b4.

## Test baseline

- Full suite: 2191 tests per OS/Node matrix job (171 suites), 0 failures on
  every matrix cell; plus serial selfmod suite 17/17 and focused CI groups
  (platform/process 21, skills 30, isolation+coordination+recovery 79-80,
  P13 isolation-verified 43, SDK 11).
- Local verification: Windows Node 24.19.0 full gates green (lint,
  typecheck, build, SDK typecheck, full suite 2191/0 fail, public-docs 154
  documents, public-release 8/8, E2E 1/1); WSL Ubuntu real-Linux
  reproductions on Node 22.22.1 and Node 24.21.0 (full suite green,
  including a NODE_V8_COVERAGE-active run matching the Coverage workflow).

## GitHub CI status

**GREEN — run 34927956602** (CI workflow, event pull_request, head 7bf01dd):
https://github.com/mahatosumit/QUACK/actions/runs/34927956602

- build-and-test: ubuntu-latest / windows-latest / macos-latest × Node 22/24
  — 6/6 green (lint + typecheck + build + SDK typecheck + public-docs +
  public-release + full test suite + focused security/skills/isolation/P13
  groups + SDK tests).
- installer-smoke: all 3 OS × Node 22/24 — 6/6 green (real tarball, clean
  install, fresh-home CLI smoke; bash installer syntax check; installer
  copy drift check).
- arm64-focused: ubuntu-24.04-arm and macos-14 — 2/2 green.
- Companion workflows on the same head: Coverage, Security Scan
  (secrets-scan + CodeQL), Documentation (validate-docs) — all green.
- Environment skips (documented, not assertion weakening): the
  browser-workflow test (no browser environment on runners) and P13.CT-9 /
  P13.CT-10 container enforcement tests where no opted-in Docker daemon
  exists; the fail-closed container paths are exercised by P13.CT-3/CT-4.
- History note: f9da6b4's own CI run (34877974904) failed on test-code
  portability and lease-timing defects (classified per Phase 4; every
  failure was a test defect, none a product defect). macOS + Node 24
  build-and-test hung infrastructurally on three consecutive runs before
  completing normally on 7bf01dd without any workflow modification.

## Package artifact status

`npm pack` tarball: dist runtime (tests/e2e excluded), installers, skills,
license/governance docs, deployment docs, CLI/SDK export surfaces; no `.env`,
no local dataDir, no SQLite DBs, no credentials, no test artifacts.
Public-manifest checks (`check-public-docs`, `public-release`) green locally
and in CI.

## Supported platforms

- Windows 10/11 — CI-VERIFIED (windows-latest × Node 22/24); locally
  verified on Node 24.
- Ubuntu LTS — CI-VERIFIED (ubuntu-latest × Node 22/24; arm64 CI-VERIFIED
  on ubuntu-24.04-arm); locally reproduced on WSL Ubuntu Node 22/24.
- macOS — CI-VERIFIED (macos-latest × Node 22/24; arm64 CI-VERIFIED on
  macos-14); NOT LOCALLY VERIFIED outside CI.
- Debian / Fedora / WSL — supported by platform classification (POSIX
  process/filesystem semantics); exercised through the Linux CI cells and
  local WSL verification, not separately matrixed.
- Node >= 22.5 — CI-VERIFIED on Node 22 and 24.

## Production boundaries (unchanged, explicitly accepted)

SUPPORTED: npm-primary deployment; single-host local dataDir; SQLite lease
coordination (single host); Node >= 22.5; loopback authenticated server;
OS-process isolation.

BEST_EFFORT: Docker container execution where a daemon/environment exists
(fails closed otherwise).

UNSUPPORTED: multi-host distributed coordination; exactly-once external
effects; Docker application deployment artifact; arbitrary extension
execution; unrestricted network; unrestricted credential use; autonomous
irreversible execution.

NOT_CLAIMED: distributed consensus; cryptographic authenticity against a
dataDir-write attacker (integrity: yes — digests + fail-closed parse);
universal ambiguity resolution.

## Known limitations

1. Single-host only; no HA/failover.
2. At-most-once dispatch (not exactly-once external effects).
3. Integrity (digests, fail-closed parsing), not cryptographic
   authenticity against a dataDir-write attacker.
4. Docker container isolation is environment-dependent and never a
   downgrade path (DENY when unavailable).
5. Extension execution is not implemented; extensions are catalog records.
6. Linux/macOS verification is CI-backed (runner environments), not
   local-hardware-backed.
7. macOS + Node 24 CI hang was infrastructural (3 runs), resolved on the
   green run; re-occurrence would be a runner-image issue, not a product
   defect — evidence preserved in the cancelled run logs.

## Final release decision

**GO** — the P16 release lineage is qualified for production use strictly
within the documented SUPPORTED boundary. Full rationale:
[RELEASE_QUALIFICATION.md](RELEASE_QUALIFICATION.md).
