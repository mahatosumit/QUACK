# Changelog

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
