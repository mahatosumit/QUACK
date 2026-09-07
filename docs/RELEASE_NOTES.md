# QUACK Release Notes

> Historical release narrative. The earlier General Availability and production-readiness claims are withdrawn. Current packages remain private candidates, and the native harness is uncertified. Test counts and timings below describe earlier assertions, not current release evidence.

## Version 1.0.0 — 2026-07-04

### Overview

This document records the original v1.0.0 development milestone. It does not establish General Availability, production readiness, or current conformance.

### New Since v0.1.0

- **Phase 1-9**: Full architectural implementation spanning core runtime, event bus, Executive Brain, COS, multi-agent organization (18 roles), Software Engineering Agent, Universal Computer Use, Desktop Platform, Distributed Runtime, Native Platform Layer, and AI Runtime Manager.
- **Phase 10**: Production Readiness — CI/CD pipelines, Docker support, documentation (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, MIGRATION), code quality (JSDoc, CLI rewrite), security hardening, packaging configuration (electron-builder), release engineering (CHANGELOG, semantic-release), 31 new tests, SDK foundation, website assets, benchmark/security/performance reports.
- **Phase 11**: Production Hardening — Critical bug fixes (error swallowing, race conditions), code quality improvements (isMissingFile dedup, require()→import, magic number extraction), documentation freeze (Architecture Book, API Reference, Deployment Guide, Troubleshooting Guide, FAQ, Release Notes, Developer Handbook, User Manual, Administrator Guide, Security Guide), release engineering (v1.0.0 GA), quality gates verification.

### Historically Reported Metrics (Not Current Evidence)

| Metric | Value |
|--------|-------|
| Tests | 742 passing, 0 failing |
| Source files | 184+ |
| Modules | 19 |
| ADRs | 22 |
| Build time | ~4s |
| Test time | ~8s |

### Known Issues

- No production HTTP server (HTTPS, auth, rate limiting) — for local use only
- In-memory stores default — SQLite backend planned for v2.0
- Mock provider implementations — real runtime connectors planned for v2.0

### Requirements

- Node.js 20+
- npm 9+
- TypeScript 5.8+
