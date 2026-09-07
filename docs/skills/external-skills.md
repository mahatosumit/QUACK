# External Skills (Quarantine-First Search)

Status: SUPPORTED (implemented + tested).
ADR: [0041](../adr/0041-universal-skills-privacy-discovery.md)
Source: `src/skills/discovery/search.ts` · tests: 6 + adversarial cross-suite

Remote skill content is **UNTRUSTED**. The pipeline:

```text
fetch (caller-provided fetcher)
→ quarantine directory (isolated, containment-checked)
→ static inspection
→ manifest extraction
→ capability analysis (QUACK's own classifier re-derives risk)
→ privacy screening (PrivacyFirewall)
→ registry policy decision
→ recommendation (RECOMMEND / REVIEW / BLOCK)
→ [optional, separate, human] approval
```

## Static inspection blockers (BLOCKER severity → QUARANTINED)

- **shell-injection** patterns (`rm -rf`, `mkfs`, `dd if=`,
  `chmod 777`, `curl|sh`, `wget|sh`)
- **prompt-injection** ("ignore previous instructions",
  "disregard your system prompt", "you are now")
- **credential-harvest** (read/send/upload/exfiltrate near
  `.env`/`ssh`/credentials/cookies/passwords/keychain)

Warnings: hidden network endpoints (webhook/beacon/telemetry), elevated
shell (`sudo`, `runas`, `powershell -enc`).

## Non-overridable policy

A skill author can never redefine QUACK security policy:

- Declared permissions are re-derived through `classifySkillRisk` — a
  remote manifest claiming LOW risk with secret requests classifies HIGH.
- PrivacyFirewall screens manifest content; DENY forces QUARANTINED.
- Search never installs. Recommendations are data for a human decision.

## Verified behaviors

6-test quarantine-first suite: prompt/shell-injection blockers,
credential-harvest blocker, HIGH-risk → REVIEW, privacy denial, policy
re-derivation. Plus adversarial cross-suite cases (malicious manifest →
HIGH + review; tamper → REVALIDATION_REQUIRED).
