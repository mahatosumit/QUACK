# Changelog

## [Unreleased — 5N release readiness gate] — 2026-09-10

- **Product line P0–P7** (see `docs/release/RELEASE_NOTES.md`): mission operations (approval queue, cancel/resume, trace-by-mission, SSE redaction), Mission Control + Approval Center UI, Console (conversational composer + live state), governed model streaming (`POST /models/stream`, broker-gated, redacted), harness expansion (15-scenario pack incl. adversarial fail-closed families + 4 evaluation dimensions), Agent Workspace, Trace Center + Artifact View + Audit Center, surface consolidation (duplicate DesktopServer, `gui/` SPA, legacy dashboard HTML, and fake benchmark/evaluation endpoints removed — one HTTP surface, one GUI).
- **5N gate**: release checklist + notes (`docs/release/`); README/QUACK_STUDIO_UI updated to P7 truth; fresh-tarball install→doctor→init→governed mission→trace verified; package audit clean (1,283 files, 0 vulnerabilities, no secrets); full local gate re-verified (1,496 ordinary + 17 serial + SDK + E2E + public-release checks, 0 failures).

## [Unreleased — v1.0 production gate] — 2026-09-08

### Phase 6 — Distribution
- Global CLI (`quack`), npm distribution, Windows/Linux/macOS installers, `quack init/status/run/resume/config/update/uninstall`, release workflow, fresh-tarball installation verified.

### Phase 6.5 — Production hardening
- Planner actionable-tool bug fixed; verification-record binding fixed; fresh mission execution fixed; provider secret handling implemented.

### Phase 7 — Intelligent skill ecosystem
- **Provider validation (7A)**: `quack provider list|doctor|test`; SecretProvider is the sole credential boundary (allowlist + consumer binding + broker-gated runtime reads); persistent secret-free provider health records; auth failures fail closed. Docs: `docs/providers/setup.md`.
- **External skill intelligence pipeline (7B)**: `src/skills/intelligence/` — SkillAnalyzer (bounded read-only static analysis), SkillClassifier (risk from requirements, not claims), SkillSecurityReviewer (APPROVE/REVIEW/REJECT), SkillAdapter, SkillInstaller (declarative-only staging; external code never executed). No second execution path: adaptation flows through the existing governed installer.
- **External repository analyses (7C)**: five reference repos analyzed into `docs/skills/analyses/*.skill-analysis.json` (agency-agents REJECTED for prompt injection; Graft/codebase-memory-mcp classified requires-tool-port).
- **Reasoning capability pack (7D)**: 8 governed LOW-risk reasoning skills (`ultrathink`, `skeptic`, `mirror`, `punch`, `no-yap`, `blind-spots`, `ooda`, `artifacts`) shipped as declarative packages in `skills/reasoning/`; policy text injected verbatim into mission workflows; read-only, deny-escalation, no network/secrets.
- **Persona framework (7E)**: 7 style-only personas (architect, researcher, debugger, security-reviewer, product-manager, engineer, critic) — routing/style metadata only; cannot grant permissions, tools, or trust; `quack personas`.
- **Skill generator (7F)**: `quack skill create <id>` scaffolds dual-format packages (human contract + governed machine contract) with mandatory risk declaration; never auto-activated.
- **Security review (7G)**: adversarial suite for the new surfaces (excessive permissions, hidden network, credential harvesting, staging traversal, prompt injection); fixed real redaction gap — bare `sk-`/`ghp_`/`AKIA`/`nvapi-` literals now redacted.
- **Live verification (7H)**: NVIDIA NIM provider health verified against the real API; CLI missions complete with evidence-backed verification records and receipts.

### v1 production gate (this release)
- Full suite: 1516/1516 (0 fail, 0 skip); typecheck PASS; SDK typecheck PASS; lint PASS; build PASS.
- Secret boundary tightened: provider credential env reads moved inside the security layer (`readProviderCredentialForBoot`), allowlist + consumer binding enforced at boot.
- Packaging: reasoning pack + Phase 7 docs now shipped (`npm pack` audit clean; no `.env`, no dev artifacts).
- Fresh-install chain verified: tarball → install → init → doctor (ready) → provider list/test → skills install/enable → governed mission → PASSED verification → receipt.
- Stress: 50/50 consecutive missions, all receipts verified, avg 1315ms.
- Honest architecture note: mission execution is deterministic workflow execution; provider `generate` is invoked by provider health checks and the model runtime, not by in-mission reasoning nodes (proven by instrumentation: 0 provider generate calls during a completed mission).

## [1.0.0] — 2026-07-25

### Production Certification (v1.0.0 Final Release)
- **Performance Certification**: Implemented `quack benchmark` framework. Verified cold startup (7.28ms), warm startup (1.25ms), and router latency (0.22ms).
- **Stress Certification**: Resolved EMFILE limits in `JsonFileMemoryStore` with concurrent batch-writing mutex. System successfully allocates 100k+ virtual workspace objects and processes 10k concurrent DAG nodes with sub-100MB RSS memory footprint.
- **System Health**: Added robust diagnostic tooling (`quack doctor`) validating runtime versions, telemetry, and kernel dependencies.
- **Test Integrity**: Test suite expanded to 967 assertions across 128 suites (100% pass rate).
- **Release Documentation**: Finalized `RELEASE_NOTES_v1.md`, updated `MIGRATION.md` for upgrade paths, and produced `DEVELOPER_GUIDE.md` for the Plugin SDK.

## [1.0.0-rc.1] — 2026-07-04

### Added
- **Phase 1 Foundation**: Core runtime, event bus, service locator, typed lifecycle, task store, audit log, permission policy, CLI entry point.
- **Phase 2 OODA+**: OODA loop integration, continuous optimization system, scenario engine.
- **Phase 3 Executive Brain**: CEO agent with context engine, cognitive load balancer, multi-agent coordination.
- **Phase 4 Plugins**: Plugin lifecycle, registry, sandbox, signing, marketplace, hot-reload.
- **Phase 5 Desktop**: Electron shell, React GUI, IPC bridge, 80+ API endpoints.
- **Phase 6 State & DX**: Undo/redo, snapshots, autosave, diff/merge, terminal, file explorer.
- **Phase 7 UCP**: Universal Computer Use Platform with vision, automation, macros, session recording.
- **Phase 8 DNPL**: Distributed Runtime, Native Platform Layer, containers, secrets vault, sandbox, packaging, updates, monitoring.
- **Phase 9 AIRM**: AI Runtime Manager with capability-based routing, model/runtime registries, intelligence router, GPU scheduler, memory manager, quantization, pipelines, benchmarks, marketplace, dashboard.
- **Phase 10 Production Readiness**: CI/CD pipelines (GitHub Actions), Docker support, documentation (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, MIGRATION), code quality (JSDoc on core modules, CLI rewrite with --help/--version/subcommands), security hardening (audit report, permission tests), packaging configuration (electron-builder for MSI/EXE/AppImage/DEB/RPM/DMG), release engineering (CHANGELOG, .releaserc, VERSION), 31 new tests for uncovered modules, @quack/sdk package, website landing page, benchmark/performance/security reports.

### Changed
- Version bumped from 0.1.0 to 1.0.0-rc.1.
- All 742 tests pass with zero failures.
- Full type safety across 184 source files.
- 22 Architecture Decision Records document every design decision.

### Architecture
- 19 modules: core, events, brain, runtime, intelligence, engine, sea, tools, providers, plugins, memory, workspace, organization, cos, computer, desktop, platform, airm, skills.
- 56 test files with comprehensive coverage.
- Factory-based composition (createQuackSystem, createAIRM, createUCP, createCOS, createDNPL).
