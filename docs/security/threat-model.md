# QUACK Threat Model

Status: SUPPORTED (living document — reflects implemented defenses only).

## Assets

1. **Host integrity** — files, processes, credentials on the user machine.
2. **User privacy** — personal documents, credentials, browser data.
3. **Runtime authority** — capability grants, policies, receipts.
4. **Durable state** — tasks, checkpoints, journal, registry, leases.
5. **Model/provider boundary** — no ungoverned provider contact.

## Adversaries

- **Malicious remote skill manifests** — prompt injection, shell
  injection, credential harvesting, policy redefinition attempts.
- **Tampered local skill content** — post-installation modification
  (supply chain).
- **Path-attack inputs** — traversal, UNC, device paths, ADS, symlinks,
  encoded forms, case/separator tricks.
- **Process-attack inputs** — shell metacharacters, argument injection,
  output flooding, timeout abuse, environment secret leakage.
- **Rogue/stale processes** — a second QUACK process or a crashed owner
  writing stale recovery state.
- **Compromised evidence chain** — forged receipts, foreign evidence,
  tampered verification.

## Trust boundaries and defenses

| Boundary | Defense | Status |
| --- | --- | --- |
| Any path into runtime/tools/skills | `resolveInsideRoot` path policy | SUPPORTED, adversarially tested |
| Any child process | argv-only `executeProcess`, no implicit shell, materialized env, bounded output, tree-kill | SUPPORTED, adversarially tested |
| Discovered metadata → model | PrivacyFirewall (only path) | SUPPORTED, adversarially tested |
| Remote skill manifest | Quarantine-first static inspection + policy re-derivation | SUPPORTED, tested |
| Discovered skill → executable | Registry lifecycle + human approval + hash revalidation | SUPPORTED, tested |
| Skill execution | CapabilityBroker → policy → admission → isolation profile → worker | SUPPORTED, tested |
| Provider/model contact | `provider.invoke` broker resolution, fail-closed (ADR 0032/0036) | SUPPORTED |
| MCP actions | Broker-gated dispatch + operation-identity evidence (ADR 0036) | SUPPORTED |
| Delegation | Derived attenuated grants, depth ceiling, verified receipts (ADR 0035) | SUPPORTED |
| Tool invocation replay | Journal + idempotency + retry-safety classes, fail-closed ambiguity (ADR 0028) | SUPPORTED |
| Cross-process ownership | SQLite lease + version fencing (coordination primitive) | SUPPORTED as primitive; recovery NOT yet wired |
| Completion claims | `CompletionReceiptV1` proof chain (ADR 0033) | SUPPORTED |

## Known accepted limitations (documented, not hidden)

- Worker isolation is NOT a security sandbox (see `sandbox.md`).
- PrivacyFirewall is heuristic pattern classification, not cryptographic.
- Terminal tool executes shell strings by design — permission-gated,
  env-sanitized, dangerous-pattern-blocked; it is the single intentional
  shell path.
- No container/microVM backend, no network sealing, no secret
  mediation, no remote skill execution (all UNSUPPORTED).
- Multi-process recovery is UNSUPPORTED until the coordination primitive
  is wired into the recovery stores (ADR 0031).

## Verification surfaces

- `src/security/adversarial-cross-suite.test.ts` (20 cross-surface tests)
- `src/platform/platform.test.ts` (13)
- `src/isolation/` (17: 4 contract + 13 adversarial worker security)
- `src/skills/discovery/*` (12 discovery + 6 search + 3 execution-profile)
- `src/storage/coordination.test.ts` (9 real-fork multi-process)
- `src/runtime/interrupted-recovery.test.ts` (22 real crash/restart cases)
