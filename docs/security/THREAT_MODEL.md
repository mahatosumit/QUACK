# QUACK Solo Production Threat Model

Review date: 2026-08-15. Method: STRIDE-informed trust-boundary and executable
control review. Provider endpoints, MCP servers, web pages, tool metadata,
model output, downloaded files, packages, and generated patches are untrusted.

## Assets and boundaries

Protected assets are provider credentials, mission inputs/results, workspace
files, browser sessions, MCP credentials, action approvals, SQLite state,
backups, audit/evidence records, and update artifacts.

```text
Solo operator -> authenticated loopback Control Room/API
              -> execution and approval policy
              -> provider/action registries
              -> MCP/browser/workspace adapters
              -> network, filesystem, SQLite and external services
```

## Current controls and residuals

| Area | Implemented control | Residual risk |
|---|---|---|
| Credentials | Environment-only provider keys; metadata exposes variable names only; browser API never returns keys; backup excludes/redacts secret-bearing material | No Windows Credential Manager integration; environment inheritance remains an operator responsibility |
| Provider routing | Capability/privacy policy before contact; normalized failures; bounded retry/timeout/cancellation/circuit breaker/fallback evidence | Legacy callers still exist; live NVIDIA/Ollama behavior is uncertified |
| Action authorization | Schema before side effect, permission check, explicit approval, risk classes, bounded output, audit/evidence | New adapters can still be unsafe if they bypass the canonical runtime; conformance is mandatory |
| Replay and crash recovery | SQLite action state machine, idempotency keys, cached successful results, ambiguous-write reconciliation/fail closed | Provider reconciliation quality is adapter-specific |
| MCP poisoning | Tool metadata/schema bounds, conservative risk defaults, allow/deny lists, untrusted server boundary | Provenance is not propagated through every legacy planner path |
| MCP stdio escape | Direct spawn without shell, minimal environment, secret filtering, cwd containment, TRUSTED/RESTRICTED/ISOLATED profiles; ISOLATED fails closed without launcher | **High:** no bundled and certified Windows restricted-token/AppContainer/container launcher |
| MCP HTTP / SSRF | Central default-deny policy, scheme/credential/host/port checks, DNS inspection, private/loopback/link-local/metadata/reserved IPv4/IPv6 denial, redirect recheck | **High:** allowed DNS address is not pinned through connect, leaving a DNS rebinding time-of-check/time-of-use gap |
| Browser injection | Isolated Edge context, service workers blocked, empty permissions, every request policy-gated, file containment, page data tagged `UNTRUSTED_WEB_CONTENT` with no policy authority, side effects approval-gated | Downloads still require downstream malware/content handling; legacy planner paths need provenance review |
| API exposure | Loopback default/refusal of accidental non-loopback bind, random or configured bearer and strict cookie, Host/origin checks, CSRF, rate limit, request/response caps, CSP and secure headers | Explicit `allowNetworkExposure` remains dangerous and is not production-certified |
| Path traversal | Canonical workspace containment in file tools and browser upload; conformance tests | External action adapters require their own resource containment evidence |
| Database corruption | SQLite migrations/transactions, bounded Windows atomic-rename retry, verified backup hashes, validate-before-touch restore, staging activation and rollback | Audit/evidence records are not cryptographically signed or chained |
| Self-modification | Isolated worktrees, fingerprint checks, protected-core policy, no self-approval, explicit human gate, post-merge verification and rollback | Git trust and host account integrity remain outside QUACK's boundary |
| Supply chain | Lockfile, small runtime dependency set, full/production npm audit, install with `--ignore-scripts`, checksum file | No SBOM, dependency provenance attestation, or signed artifact |
| Update tampering | Atomic install/update with rollback directory and marker-guarded uninstall | **High:** ZIP/hash/update metadata are unsigned; malicious replacement cannot be cryptographically rejected |
| Denial of service | Request/response/output caps, action/provider timeouts, cancellation, rate limiting | Sustained concurrency and long-duration memory growth are not certified |

## Release blockers

1. Certified OS isolation for untrusted stdio MCP.
2. Address-pinned or proxy-mediated outbound connections that close the DNS
   rebinding gap.
3. Signed Windows artifacts/update metadata and clean-VM validation.
4. Live NVIDIA NIM certification; optional Ollama certification if required.
5. Sustained load, cancellation/failover, and long-duration resource evidence.

No destructive, financial, external-communication, or real-account write action
was performed during this review.
