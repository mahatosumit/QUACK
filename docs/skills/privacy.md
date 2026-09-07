# Privacy Firewall

Status: SUPPORTED (implemented + tested; heuristic classification, not a
cryptographic guarantee — hard classes deny rather than over-trust
redaction).
ADR: [0041](../adr/0041-universal-skills-privacy-discovery.md)
Source: `src/skills/discovery/privacy.ts`

## Position in the pipeline

The PrivacyFirewall is **the only path** through which discovered local or
quarantined external metadata may reach a model or the registry's
user-facing records:

```text
content / field
→ classify (patterns + secret-shaped values + sensitive field names)
→ evaluate (default-DENY policy)
→ redact or deny
→ safe metadata (the only releasable form)
```

## Detection classes

- **Content patterns**: `-----BEGIN PRIVATE KEY-----` (RSA/EC/OPENSSH/
  DSA/PGP), `password=`/`passwd=`/`pwd=`, `api_key:`/`token:`/`bearer:`,
  secret/client_secret, environment-secret NAMES (`*_KEY`, `*_TOKEN`,
  `*_SECRET`, `*_PASSWORD`), session/auth-cookie identifiers, browser
  profile databases (`cookies.sqlite`, `login.data`, `webdata.db`,
  `places.sqlite`).
- **Secret-shaped VALUES** (independent of key syntax): `sk-…`/`pk-…`/
  `rk-…`, `gh[pousr]_…`, `AKIA…`, JWTs (`eyJ…`), long base64 blobs,
  `-----BEGIN` private-key headers.
- **Sensitive FIELD names**: `apiKey`, `client_secret`, `password`,
  `token`, `bearer`, and `*_api_key`-style suffixes.

## Decisions

- **HARD-DENY** classes — `PRIVATE_KEY`, `BROWSER_SESSION`, `PASSWORD`:
  the whole record is DENIED, not redacted. Over-trusting redaction is
  worse than losing a record.
- Other matches: the field is redacted to `[REDACTED]` → decision
  `REDACT`.
- No matches: `ALLOW`.

Audit data carries only class names — never matched content.

## Never-enter / never-read

Filename patterns (`.env`, `id_rsa`, `id_ed25519`, `.pem`, `.key`,
`cookies.sqlite`, `kdbx`, `known_hosts`, `.git-credentials`, `history`,
`wallet.dat`) and directory names (`.ssh`, `.gnupg`, `.aws`, `.azure`,
`.gcloud`, `.kube`, `AppData`, `Library`, `Desktop`, `Documents`,
`Downloads`, `Pictures`, `Videos`, `Music`, `Maildir`, `.mozilla`,
`.config/google-chrome`, `.git`) are refused structurally by discovery
and quarantine — those files/dirs are never opened in the first place.

## Verified behaviors

Discovery suite (12), adversarial cross-suite privacy attacks
(tokens/keys/cookies/JWTs denied-or-redacted with no raw secret surviving
into safe metadata), and quarantine-search privacy denial. Attempting to
expose credentials, tokens, cookies, private keys, personal documents,
browser data, or environment secrets through discovered metadata is
blocked at this boundary.
