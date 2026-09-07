# QUACK — Windows Release Blocker Closure (cloud/bridge session, 2026-08-15 b)

Environment: Cowork cloud + device bridge (Linux VM, **Node v22.22.3**). NOT the
Windows 11 / Node 24 workstation. Cross-platform *logic* results below are real
corroboration; they are **not** final Windows production proof. Platform-, secret-,
and hardware-bound gates are marked BLOCKED with the exact reason.

## Phase outcomes this session

| Phase | Result | Basis |
|---|---|---|
| P0 Windows env proof | **BLOCKED (git root unreachable)** | Only the `QUACK` subfolder is mounted; the Git root is the parent the parent repository. Folder-grant dialog could not be shown ("Claude desktop window isn't available"). Open the desktop app to grant the parent repository. |
| P1 Windows regression determinism | **BLOCKED (not this OS/runtime)** | Requires Windows + Node 24 + real Git worktrees. Linux/Node22 cannot manifest the V8 Maglev `0xC0000409` crash; concurrent full-suite runs here also hit sandbox SQLite `disk I/O error`. |
| P2 NVIDIA visibility | **BLOCKED (no PowerShell on device)** | `device_bash` is a Linux VM; it cannot read the Windows User env var. Must run on the workstation. |
| P3 NVIDIA live cert | **BLOCKED (depends on P2)** | No key in this process; nothing sent. |
| P4 Local-model release decision | **DELIVERED (decision below)** | Reasoned; environment-agnostic. |
| P5 Windows MCP isolation | **BLOCKED (Windows-only to test)** | Isolation launcher + hostile fixtures require Windows job objects/restricted tokens. |
| P6 DNS rebinding / TOCTOU | **DEFECT CONFIRMED + remediation designed** | Cross-platform code analysis + isolated test run. See below. |
| P7 Company runtime conformance | **PARTIAL — corroborated, but named matrix missing** | 13 focused tests pass on Linux; AGT-001–020 named suite = 0; adversarial matrix incomplete. |
| P8 Real temporary-company mission | **BLOCKED (needs faithful runtime)** | Depends on SQLite/worktree/provider paths that don't run faithfully here. |
| P9 Endurance | **BLOCKED (45–60s command cap)** | Sustained runs impossible via the bridge. |
| P10 Windows package/signing | **BLOCKED (Windows + no cert)** | Packaging is a PowerShell/Windows task; signing has no certificate. |
| P11 Final security re-audit | **BLOCKED (depends on above)** | Cannot certify CRITICAL/HIGH=0 without P1/P3/P5/P9/P10 evidence. |

Faithful gates re-confirmed present/green from the last session: TYPECHECK, BUILD,
LINT all PASS (compiled `dist/` intact this session).

## P6 — CONFIRMED DEFECT: DNS-rebinding TOCTOU in NetworkPolicyEngine.fetch()

**File:** `src/security/network-policy.ts`

**Root cause.** `evaluate()` resolves the hostname (`resolveAddresses` → `dns.lookup`),
validates every resolved IP with `isNonPublicAddress`, and returns `allowed:true`
with `resolvedAddresses`. But `fetch()` then calls the **global `fetch(current, …)`**
with the original *hostname*. Node's fetch performs its **own DNS resolution at
connect time** — a second lookup. The approved address from `evaluate()` is never
pinned to the actual socket.

**Attack sequence.**
1. Attacker DNS for `evil.example` returns a public IP (e.g. `93.184.216.34`) on the
   first lookup → `evaluate()` validates it as public → `allowed:true`.
2. `fetch()` calls `fetch("http://evil.example/…")`; undici re-resolves; attacker DNS
   now returns `127.0.0.1` (or `169.254.169.254`, `192.168.x.x`).
3. The connection reaches a **private/loopback/metadata** address the policy never
   approved. SSRF protection is bypassed.

The P6 invariant — *"the actual connection must use the approved destination"* — is
violated. This matches the readiness report's open item: *"address pinning through
connect remains open."*

**Existing coverage** (`network-policy.test.ts`, 3 tests, all PASS isolated on
Linux/Node22): the `rebinding.example` case only proves `evaluate()` rejects a host
that resolves to a private IP on a *single* lookup. It does **not** exercise the
two-lookup transport path, so the live TOCTOU hole is untested.

**Remediation (design — must be regression-tested on Windows before merge).**
Pin the approved IP through the connection while preserving Host header + TLS SNI:

- Resolve + validate **once** (reuse `evaluate()`'s `resolvedAddresses`).
- Connect to a **validated address literal**, not the hostname, via a custom
  `lookup` that returns only approved IPs, keeping `servername = hostname` for TLS
  cert validation and the `Host` header intact. Concretely, either:
  - a `node:https`/`node:http` Agent with `lookup: (host, opts, cb) => cb(null, approvedIp, family)` and `servername: hostname`; or
  - `undici.Agent({ connect: { lookup } })` passed as `fetch(url,{dispatcher})` if an undici dependency is acceptable (the RULE discourages new deps — prefer the node:https path).
- Re-validate on **every redirect hop** (the loop already re-`evaluate()`s the URL;
  ensure each hop also pins its own resolved+approved address).
- Add a regression test that injects a resolver returning a **public IP first, private
  IP second**, and asserts the connection is refused or pinned to the first approved
  address (i.e., never reaches the private one).

This is a security-critical transport change touching every `fetch()` caller
(NVIDIA adapter, MCP Streamable HTTP, browser navigation), so it must pass the full
Windows regression before commit. It was **not** blind-merged into the working tree
this session precisely because that regression cannot be run faithfully here.

## P7 — Company runtime: corroborated, but required matrix not implemented

Isolated Linux/Node22 runs (real corroboration for cross-platform logic):

```text
dist/company/runtime.test.js       10 pass / 0 fail
dist/actions/conformance.test.js    2 pass / 0 fail
dist/providers/conformance.test.js  1 pass / 0 fail
```

Gap: `grep "AGT-0"` across `src/` and `tests/` = **0** — the mission's formal
AGT-001–020 conformance suite (spawn, assignment, completion, cancellation,
parent/child, delegation depth, permission isolation, budget, provider routing,
resource wait, dependencies, parallelism, crash recovery, restart recovery,
workspace isolation, conflict detection, verifier reject/success, evidence
propagation, recursive-delegation prevention) is **not present as a named suite**,
and the adversarial matrix (forged principal, expired lease, self-budget/permission
increase, cross-agent workspace access, approval/verification bypass, cyclic DAG,
infinite retry, tool doom-loop) exists only partially inside `company/runtime.test.ts`.
Authoring the complete matrix is real remaining work; note AGT-013/014 (crash/restart
recovery) and AGT-015/016 (worktree workspace isolation/conflict) cannot be validated
faithfully in this sandbox (SQLite IOERR under load; no Git in the mounted subfolder).

## P4 — Local-model (Ollama) release decision

**Decision: local inference is NOT required for the private solo release →
`OLLAMA = OPTIONAL_NOT_INSTALLED` (non-blocking).**

Reasoning:
- The product promise ("give QUACK an outcome; it assembles a team and returns a
  proven result") is provider-independent by design; a certified cloud provider
  (NVIDIA, once P3 passes) satisfies it end-to-end.
- The privacy invariant is a **policy** property (local-only missions must never fall
  back to cloud), not a requirement that a local provider be installed. It is proven
  by the fallback/privacy conformance tests, which can pass with a *simulated* local
  provider being unavailable.
- Forcing an Ollama install + multi-GB model download onto the single owner's 8 GB
  RTX 4060 as a release gate adds setup burden and hardware risk for no release-level
  benefit.

Consequence: the two P4 privacy tests should still be verified on the workstation as
**logic** (local-only + provider-unavailable → NVIDIA requests = 0; cloud-fallback
allowed → NVIDIA selected), but Ollama's absence must **not** block private readiness.

## Net status (unchanged, honestly)

```text
COMPANY_RUNTIME = NOT_READY
PUBLIC_DISTRIBUTION_READY = NO
```

Reason it cannot advance to READY from here: the load-bearing evidence (P1 Windows
determinism, P3 NVIDIA live, P5 isolation, P7 full matrix, P9 endurance, P10 package)
requires the Windows workstation, the NVIDIA secret, a signing certificate, and a
faithful (non-sandbox) filesystem/runtime. The one blocker that is fully code-level —
P6 — is now precisely characterized with a remediation ready to implement and
regression-test on the workstation.

## To make the next cloud session more useful
- Open the Claude desktop app and connect the **the parent repository repo root** (not the
  `QUACK` subfolder) so P0 git facts and worktree paths are reachable.
- Better: run this blocker-closure task **on your computer** (desktop app → "Run this
  task"), so Windows / Node 24 / Git worktrees / real SQLite match production.
