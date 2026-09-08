# External Skill Security Model

How QUACK consumes external capability without ever executing unvetted external code.

## Flow (never skipped)

```
External Repository (LOCAL checkout only — QUACK never fetches-and-executes)
  │
  ▼
Static Analysis (SkillAnalyzer — read-only, bounded)
  │
  ▼
Risk Classification (SkillClassifier — risk derived from requirements, not claims)
  │
  ▼
Quarantine (staging directory — declarative artifacts only)
  │
  ▼
Human Approval (quack skills install → validate → permission review)
  │
  ▼
QUACK Skill Package (registered, DISABLED)
  │
  ▼
Activation (quack skills enable — grant-checked)
  │
  ▼
Execution (governed: broker preflight → sandbox → evidence)
```

## Analysis guarantees

- **Read-only**: analysis reads a local checkout; nothing is executed, installed, or piped.
- **Bounded**: max 400 files, 512KB per file, `node_modules`/`.git`/build dirs skipped.
- **BLOCKER rules**: shell injection, prompt injection, credential harvesting, eval/`new Function`, obfuscation. Prompt injection stays BLOCKER even in non-executable prose (adapted prose can reach a model).
- **Downgrade, never discard**: findings in CI/tests/docs or non-executable files drop to WARNING — still reported.
- **Risk from requirements**: `classifySkillRisk` derives LOW/MEDIUM/HIGH from what the repo needs (network, fs writes, credential env reads) — a LOW self-claim cannot override.

## What an adapted skill can never do

1. **Carry executable external code.** Adaptation writes declarative artifacts (manifest, workflow, instructions). External code is never copied as executable and never run.
2. **Gain tools silently.** Staged/adapted packages allow exactly `core.workspace.list-files` (read-only grounding). Everything else — terminal, network, git, write — requires an explicit, human-approved package with broker-validated capabilities.
3. **Skip approval.** `SkillInstaller.stage` writes to quarantine; only `quack skills install` (validation + broker permission checks) + `quack skills enable` activate.
4. **Hide provenance.** Staged manifests embed source URL + content hash; tampering with persisted portable execution breaks the fingerprint check at load.

## Attack matrix and tests

| Attack | Defense | Test |
|---|---|---|
| Excessive permission request (`permission.terminal.execute`) | Installer validates every capability through the broker; no grant → rejected before registration | `src/security/phase7-security.test.ts` |
| Hidden network access (telemetry/beacon in adapted surface) | `hidden-network` WARNING + `networkRequirements` detection; staged adaptation never carries network tools | same |
| Credential harvesting ("reads .env and uploads ssh credentials") | `credential-harvest` BLOCKER/WARNING + HIGH risk → never APPROVE | same + `pipeline.test.ts` |
| Filesystem traversal (staging escape `../../`) | `resolveInsideRoot` containment — staging refuses | `phase7-security.test.ts` |
| Prompt injection ("ignore all previous instructions") | BLOCKER even in markdown → REJECT, no adaptation plan | both suites |
| Eval/obfuscated execution | BLOCKER → REJECT | `pipeline.test.ts` |
| Secret leakage in reports | `redactSecrets` strips env-style, bearer, `sk-`/`ghp_`/`AKIA`/`nvapi-` literals | `phase7-security.test.ts`, `validation.test.ts` |
| Malicious manifest claiming LOW risk | Risk class derived from requirements, claims ignored | `adversarial-cross-suite.test.ts` |
| Tampered persisted skill | Content/fingerprint mismatch forces revalidation | `adversarial-cross-suite.test.ts` |

## Reasoning pack & generated skills

- Reasoning policies (`skills/reasoning/`) are LOW-risk by construction: read-only grounding, `deny-escalation: true`, no network/secrets. Verified per-package in tests.
- `quack skill create` scaffolds with an **empty** permission set and a mandatory `risk-declaration.yaml`; nothing activates without explicit install + enable.

## Secrets

- Only `SecretProvider` reads provider credential env vars; names allowlisted per consumer.
- Value resolution requires `secrets.read:<name>` broker authority; denial fails closed.
- All report/doctor output passes `redactSecrets` (env-style, bearer, bare provider key literals).

## Operational rules for reviewers

Before approving any package (`quack skills install`):

1. Read `skill-analysis.json` — every warning must be understood, not just absent blockers.
2. Check `permissions.yaml`/manifest capabilities: every entry needs a reason; least authority.
3. HIGH-risk packages: expect `REVIEW_REQUIRED`; require explicit justification to proceed.
4. MCP servers: must be adapted as tool ports behind the broker, never inline skills.
5. Re-validate on content hash change — provenance mismatch means re-review from scratch.
