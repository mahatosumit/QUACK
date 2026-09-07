# ADR 0041: Universal Skills and Privacy-Safe Discovery

## Status

Accepted — 2026-09-06

## Context

QUACK needs a universal skill model that can describe local and external
skills, discover skills on a user's machine without violating privacy, and
never let a discovered skill become executable merely because it exists.
The audit found: no filesystem-based skill discovery at all (packages are
imported one explicit path at a time), no privacy classifier (only two
inline regex redactors), an unused `EvidenceRecordV1.redactions` field, and
existing trust enums (`SkillTrustLevel`, `SkillStatus` with `quarantined`)
that predate a discovery lifecycle.

## Decision

### Universal skill specification (`src/skills/universal.ts`)

Layered on the existing `SkillManifest`: skill kinds
(`INSTRUCTION_ONLY`, `TOOL`, `WORKFLOW`, `EXECUTABLE`, `PLUGIN`, `BROWSER`,
`MCP`, `PROVIDER`, `COMPOSITE`), source, license, platforms, network/
filesystem/secret requirements, `riskClass` (`LOW`/`MEDIUM`/`HIGH`),
`sandboxProfile` (the ADR 0039 isolation levels), checksum, and provenance
(source URL, commit, content hash).

- `classifySkillRisk` derives risk from what the skill requests — never
  from what it claims to be. Secret requirements, `secrets.*` permissions,
  network requirements, write-capable filesystem requirements, and
  medium-risk permissions (terminal/network/browser/MCP/git/external/email/
  plugin-install) produce MEDIUM or HIGH.
- `requiresReviewBeforeActivation`: HIGH always requires review;
  QUARANTINED/BLOCKED/UNVERIFIED always require review. High-risk skills
  never silently activate.
- `skillContentHash`/`skillManifestHash` support supply-chain change
  detection.

### PrivacyFirewall (`src/skills/discovery/privacy.ts`)

The only path through which discovered local metadata may reach a model:
classification → redaction → policy evaluation → safe metadata. Default
policy is DENY for sensitive classes. Detection covers content patterns
(`-----BEGIN PRIVATE KEY-----`, `password=`, `api_key:`, environment-secret
names, cookie/session identifiers, browser profile databases), secret-shaped
VALUES independent of key syntax (`sk-…`, `ghp_…`, `AKIA…`, JWTs, long
base64 blobs), and sensitive FIELD names (`apiKey`, `client_secret`, …).
HARD-DENY classes (PRIVATE_KEY, BROWSER_SESSION, PASSWORD) reject the whole
record; other matches redact the field to `[REDACTED]`. Forbidden filename
patterns (`.env`, `id_rsa`, `*.pem`, `cookies.sqlite`, password databases,
`.git-credentials`, history files) and forbidden directories (`.ssh`,
`.aws`, `AppData`, `Library`, `Desktop`, `Documents`, `Downloads`, …) are
never read or entered by discovery.

### Privacy-safe discovery (`src/skills/discovery/discovery.ts`)

`SkillDiscovery` scans ONLY explicitly configured roots. Inside a root it
reads ONLY skill manifests (`skill.json`/`manifest.json`) — never
neighboring files — skips dot and forbidden directories, bounds entries
per root, and passes every parsed manifest through the firewall before
returning. Discovery NEVER scans the user's personal filesystem, NEVER
interprets "add all skills from my PC" as "read my entire PC", and NEVER
implies approval or executability.

### Discovery registry (`src/skills/discovery/registry.ts`)

`DiscoveredSkillRegistry` persists metadata-only `SkillRecord`s (canonical
atomic tmp+rename JSON store pattern) with states `DISCOVERED →
REVIEW_REQUIRED → APPROVED → INSTALLED → DISABLED/REVOKED/QUARANTINED` plus
`REVALIDATION_REQUIRED`. Discovery never auto-approves; installation
requires explicit approval; quarantined/revoked skills cannot be approved
without an explicit unquarantine; HIGH risk or firewall-DENY records enter
as REVIEW_REQUIRED. A content-hash change after installation (including
tampering) forces `REVALIDATION_REQUIRED` with `UNVERIFIED` verification —
modified content never silently keeps its installation. `verifySkillRecord
Content` re-checks stored hashes.

## Consequences

- Skills remain executable only through the existing canonical portable
  execution path (ADR 0034 skill sandbox + canonical runtime); this ADR adds
  discovery, classification, and lifecycle, not a new execution path.
- External/remote skill acquisition (download → quarantine → inspection →
  approval) is the natural next stage on top of this registry and is NOT
  yet implemented.
- The firewall is heuristic pattern classification, not a cryptographic
  guarantee; hard classes deny the whole record rather than risk
  over-trusting redaction.

## Verification

`src/skills/discovery/discovery.test.ts` (12 tests): classification of
secrets/keys/tokens/cookies; redaction and hard-DENY; forbidden
files/directories; risk derivation from requested capabilities; review
requirements; explicit-root manifest-only discovery ignoring neighboring
sensitive files; dot/forbidden-dir skipping; secret-in-manifest redaction
with registry DISCOVERED (not REVIEW) unless risk demands; full lifecycle
with install-requires-approval and revoke terminality; content-change →
REVALIDATION_REQUIRED with blocked reinstall; HIGH-risk → REVIEW_REQUIRED.

Full repository suite: 1,397 ordinary + 17 serial tests, 0 failures.