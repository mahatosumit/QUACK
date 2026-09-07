# Skill Discovery (Local)

Status: SUPPORTED (implemented + tested).
ADR: [0041](../adr/0041-universal-skills-privacy-discovery.md)
Source: `src/skills/discovery/discovery.ts` · tests: 12 + adversarial cross-suite

## What discovery is — and is not

QUACK does **NOT** interpret

> "find all skills on my PC"

as

> "scan the entire computer".

Discovery reads ONLY:

1. **Explicitly configured skill roots** (constructor `roots: string[]` —
   at least one required, or the constructor throws).
2. Inside a root, ONLY skill manifest files (`skill.json`,
   `manifest.json`). Never neighboring content, never other file types.

It NEVER scans the personal filesystem, never enters forbidden
directories (`.ssh`, `.aws`, `AppData`, `Library`, `Desktop`, `Documents`,
`Downloads`, `Pictures`, `Videos`, `Music`, `Maildir`, `.mozilla`,
`.config/google-chrome`, `.git`, dot-directories), and never reads
forbidden filenames (`.env`, `id_rsa`, `.pem`, `.key`, `cookies.sqlite`,
password databases, `known_hosts`, `.git-credentials`, history files,
wallet files).

## Pipeline

```text
explicit roots
→ per-root directory scan (bounded, max 200 entries default)
→ skip dot + forbidden directories
→ read ONLY skill.json / manifest.json
→ resolveInsideRoot containment check
→ PrivacyFirewall evaluation
→ risk derivation (classifySkillRisk)
→ DiscoveredSkill records (safe metadata only)
→ registry registration (states, never approval)
```

## Guarantees

- **Manifest-only**: a manifest's neighbors are never read. A test places
  an `id_rsa` next to a skill manifest in a configured root: the key is
  never ingested.
- **Forbidden dirs are structural**: a `skill.json` inside `.ssh` under a
  configured root is never discovered (adversarially tested).
- **Bounded**: max entries per root; no unbounded walks.
- **Firewall-gated**: every parsed manifest is evaluated by the
  PrivacyFirewall; the returned `safeMetadata` is the ONLY form allowed to
  reach a model.
- **Discovery ≠ approval**: records enter the registry as `DISCOVERED`
  (or `REVIEW_REQUIRED` for HIGH risk / privacy-DENY / secrets
  permissions). See `docs/skills/registry.md`.

## Verified behaviors

12-test discovery suite plus adversarial cross-suite cases:
classification/redaction/deny, forbidden files and directories, risk
derivation from requested capabilities, explicit-root manifest-only
discovery, and the encoded-traversal / case-difference / separator
path-attack family.
