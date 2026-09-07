# Universal Skill Specification

Status: SUPPORTED (implemented + tested).
ADR: [0041](../adr/0041-universal-skills-privacy-discovery.md)
Source: `src/skills/universal.ts`

## Model

`UniversalSkillFields` layers on the existing `SkillManifest`:

| Field | Meaning |
| --- | --- |
| `kind` | `INSTRUCTION_ONLY` \| `TOOL` \| `WORKFLOW` \| `EXECUTABLE` \| `PLUGIN` \| `BROWSER` \| `MCP` \| `PROVIDER` \| `COMPOSITE` |
| `riskClass` | `LOW` \| `MEDIUM` \| `HIGH` |
| `sandboxProfile` | ADR 0039 isolation level the skill requests |
| requirements | network / filesystem / secrets (what the skill REQUESTS) |
| provenance | source URL, commit, content hash |
| checksum / hashes | supply-chain change detection |

## Risk derivation — requests, never claims

`classifySkillRisk` derives risk from what a skill **requests**:

- Secret requirements or any `secrets.*` permission → **HIGH**.
- Network requirements, write-capable filesystem requirements, or
  medium-risk permissions (`terminal.execute`, `network.*`,
  `browser.control`, `mcp.*`, `git.write`, `external.write`, `email.send`,
  `plugin.install`, `filesystem.write.external`) → **MEDIUM**.
- Otherwise → **LOW**.

A manifest claiming `riskClass: "LOW"` while requesting secrets still
classifies HIGH — the claim is never trusted (covered by the adversarial
cross-suite).

## Review requirement

`requiresReviewBeforeActivation(risk, trust)`:

- HIGH risk → always review.
- Trust `QUARANTINED` / `BLOCKED` / `UNVERIFIED` → always review.

High-risk skills never silently activate.

## Hashes

- `skillContentHash(content)` — sha-256 of content.
- `skillManifestHash(manifest)` — sha-256 of canonical manifest JSON.

Used by the registry for supply-chain change detection: a content-hash
change after installation forces `REVALIDATION_REQUIRED` with
`UNVERIFIED` verification — modified content never silently keeps its
installation.

## Execution

The universal model is metadata + policy. Execution happens exclusively
through the canonical portable-skill path (compiler → governed graph →
capability broker → isolation profile). A discovered or external skill
record is never executable by virtue of existing; see
`docs/skills/installation.md`.
