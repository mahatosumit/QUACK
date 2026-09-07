# Skill Installation

Status: PARTIALLY SUPPORTED — registry lifecycle and approval gating are
implemented and tested; there is NO automated installer that materializes
a discovered skill into an executable package. Execution remains the
canonical portable-skill path (compiler → governed graph).

## What "installation" means today

Installation is a **registry state transition** (`APPROVED → INSTALLED`),
gated on explicit human approval:

```text
discovered record (DISCOVERED / REVIEW_REQUIRED)
→ human approves            (registry.approve — USER_APPROVED)
→ install                   (registry.install — INSTALLED + HASH_VERIFIED)
→ execution only via canonical portable-skill composition
```

## What is enforced

- `install()` throws unless the record is APPROVED first (tested).
- QUARANTINED/REVOKED records cannot be approved (tested).
- Content-hash change at any point after installation →
  `REVALIDATION_REQUIRED` + `UNVERIFIED`: modified content never silently
  keeps INSTALLED state (adversarially tested).
- Discovery/search never install. Search returns
  RECOMMEND/REVIEW/BLOCK — never an implicit install.

## What is NOT implemented (do not assume it exists)

- No copy/materialization of skill files into an execution workspace.
- No dependency installation for skills.
- No marketplace sync or auto-update.
- No remote-skill execution.

These are future capabilities; none are release blockers for Phase 4.
