# QUACK OS Release Checklist

First public release gate (5N). Evidence must be produced by the run
that claims it — historical numbers are not current evidence.

## Repository

- [x] Correct default branch (`main`)
- [x] Correct lineage: `main @ 298b6c3` → P0 `b1d7911` → P1-P4 `2861231` → P5 `331239e` → P6 `dc2cf5b` → P7 `d7b9ae2`
- [x] Clean working tree
- [x] No unrelated branch content (single product branch, no master merge)

## Build

- [x] `npm ci` install (clean checkout equivalent: fresh tarball install verified)
- [x] `npm run typecheck` — PASS
- [x] `npm run typecheck:sdk` — PASS
- [x] `npm run lint` (incl. static architectural guards) — PASS
- [x] `npm run build` — PASS

## Tests

- [x] Ordinary suite — 1,496 tests, 0 failures, 0 skipped
- [x] Serial suite (`test:selfmod`) — 17 tests, 0 failures
- [x] Security tests — included in ordinary suite (redaction, fail-closed, forging; see `audit-and-retirement.test.ts`, `model-stream.test.ts`, skills adversarial suites)
- [x] Control Room E2E (`test:e2e`) — PASS (a11y serious/critical + console-error gates; covers Studio surfaces)

## Package

- [x] `npm pack` contents verified — 1,283 files, 1.2 MB, no `.env`/dev artifacts/test files (guards in `scripts/public-release.test.mjs`)
- [x] CLI executable verified from a fresh tarball install (`quack --version`, `help`)
- [x] Install verified (fresh dir, `npm install <tarball>`, 0 vulnerabilities)
- [x] Uninstall: `npm uninstall` removes the package; user data (`~/.quack`) is untouched by uninstall and removable via `quack uninstall --purge-data`

## Product (Studio smoke)

- [x] Control Room (Overview)
- [x] Mission Detail (capabilities, verification, evidence, timeline, View Trace)
- [x] Approval Center (queue decisions, action approvals, improvements)
- [x] Console (mission composer, governed streaming, honest states)
- [x] Trace Center + Trace Detail (repository timelines, filters)
- [x] Evidence (evaluation history + memory/decisions/failures)
- [x] Artifacts (evidence-backed outputs only)
- [x] Audit (governance record, redacted)
- [x] Operations/System (providers, actions, integrations, health)
- [x] Agent Workspace (registry + assignment + eval summaries)

## Security

- [x] No committed secrets (pattern scan: only adversarial test fixtures)
- [x] Authorization enforced server-side (401 unauthorized audit; no anonymous routes)
- [x] No provider credentials exposed (keys never returned; values hidden in doctor output)
- [x] No fake security claims (no sandbox/container/microVM isolation claims; threat model documents the real boundary)

## Documentation

- [x] README (Studio areas updated to P7; honest limitations section)
- [x] Getting started / deployment / API reference (retired desktop surface removed)
- [x] Product docs (PRODUCT_SURFACES, ROADMAP, TRACE_MODEL, OPERATIONS_MODEL)
- [x] QUACK_STUDIO_UI.md updated to the P7 navigation
- [x] Release notes: [RELEASE_NOTES.md](RELEASE_NOTES.md)

## Release evidence

- [x] Local gate green (see Tests)
- [x] Package verified (fresh tarball → install → doctor → init → run mission → trace → status)
- [x] Smoke test verified (CLI §10 + Studio §11 via E2E)
- [x] Release notes prepared
- [ ] CI green on the release commit **(requires pushing the branch / opening the PR — remote `origin` exists; CI workflows verified in-repo)**
- [ ] npm publish executed **(deliberately deferred: publish is an external irreversible action requiring owner approval)**
