# QUACK Security Report

> Historical audit narrative, superseded for current security claims by [SECURITY.md](../SECURITY.md). The old severity counts and pass markers are not a current assessment. In-process plugins are trusted code without OS isolation; JSONL audit logging has no cryptographic integrity protection or general payload redaction. Authentication and path coverage must be checked per current entry point.

**Date:** 2026-07-04
**Version:** 1.0.0-rc.1
**Scope:** Full codebase audit of QUACK AI Operating System

## Historical Summary (Not Current Certification)

| Category | Status | Notes |
|----------|--------|-------|
| Secrets Management | ✅ | Env-only, no hardcoded credentials |
| Permission System | ✅ | Two-level (tool + policy) |
| Path Traversal | ✅ | Protected in all file tools |
| Shell Injection | ✅ | Dangerous-pattern detection |
| Plugin permission declarations | Limited | In-process trusted code; no OS isolation |
| IPC Security | ⚠️ | Desktop API exposed on localhost |
| Supply Chain | ⚠️ | No signed packages yet |
| Audit Logging | Limited | JSONL persistence; no cryptographic integrity protection or general redaction |
| TLS/SSL | ⚠️ | No HTTPS configured |
| Authentication | ⚠️ | Desktop API has no auth |

## Historical Findings (Not Current Severity Counts)

### Critical (0)
None found.

### High (0)
None found.

### Medium (2)

**M-01: Desktop API lacks authentication**
- File: `src/desktop/server.ts`
- API returns system state with no authn/authz
- Mitigation: Bound to localhost only by default; add token-based auth for production

**M-02: No package signing**
- File: `src/plugins/updater.ts`, `src/plugins/loader.ts`
- Plugins and marketplace packages are not cryptographically signed
- Mitigation: Implement package signing using ed25519; verify before loading

### Low (3)

**L-01: Environment variable exposure in error messages**
- General: Error messages may include env var names in stack traces
- Mitigation: Strip environment variable values from user-facing errors

**L-02: No rate limiting on desktop API**
- File: `src/desktop/server.ts`
- No request throttling could enable DoS
- Mitigation: Add rate limiting for production deployments

**L-03: Terminal tool dangerous patterns are regex-based**
- File: `src/tools/terminal.ts`
- Pattern matching may have false negatives
- Mitigation: Use allowlist approach instead of blocklist

## Security Architecture

```
User Request
    │
    ▼
Permission Policy ── Deny → Log & Return
    │ Allow
    ▼
Tool Executor ── Sandbox ── Audit Log
    │
    ▼
System Operation
```

## Recommendations

1. Add JWT auth to Desktop API for production deployments
2. Implement package signing for marketplace
3. Add rate limiting to API server
4. Add HTTPS support (let QUACK manage self-signed certs)
5. Implement credential rotation for API keys
6. Add security headers to Desktop API responses
