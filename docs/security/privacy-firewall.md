# Privacy Firewall (Security View)

Status: SUPPORTED (heuristic classification — hard classes deny the
whole record rather than over-trust redaction).

Detailed spec: `docs/skills/privacy.md`. This document records the
security boundary.

## The boundary

The PrivacyFirewall (`src/skills/discovery/privacy.ts`) is the only path
through which discovered local or quarantined external metadata reaches:

- a model (planner context),
- user-facing registry records (safe metadata).

Everything else is denied by default.

## Attack rejections (adversarially verified)

Attempting to disclose through skill metadata:

| Attempt | Outcome |
| --- | --- |
| `ghp_…` token, `AKIA…` key, JWT | DENY/REDACT — no raw value in safe output |
| `password =` / `client_secret` content | PASSWORD/SECRET class → hard DENY (record) |
| `-----BEGIN PRIVATE KEY-----` | PRIVATE_KEY class → hard DENY |
| browser session/cookie references | BROWSER_SESSION class → hard DENY |
| secrets under sensitive field names (`apiKey: …`) | classified by field name, redacted/denied |
| `.ssh`/`AppData`/`Library`/personal dirs | never entered structurally (discovery) |
| `.env` / `id_rsa` / cookies DBs / password DBs | never read structurally (discovery) |

The adversarial cross-suite asserts that none of the raw secret values
survive into `safe` output for every case family.

## Limitations (honest)

- Pattern classification is heuristic; a novel secret format not matching
  any pattern can pass as ALLOW. This is why secret-shaped VALUES and
  sensitive FIELD names are checked independently of key syntax — but no
  classifier is complete.
- Hard-deny classes deny the whole record; that is deliberate: losing a
  record is safer than leaking a private key through partial redaction.
- The firewall protects the discovery/quarantine metadata path. It does
  not seal worker environments (see `sandbox.md`) and is not a substitute
  for secret mediation (UNSUPPORTED).
