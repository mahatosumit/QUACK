# Discovery Registry

Status: SUPPORTED (implemented + tested).
ADR: [0041](../adr/0041-universal-skills-privacy-discovery.md)
Source: `src/skills/discovery/registry.ts`

## Lifecycle

```text
DISCOVERED
→ REVIEW_REQUIRED        (HIGH risk, privacy DENY, secrets permissions)
→ APPROVED               (explicit human action only)
→ INSTALLED              (explicit, only from APPROVED)
→ DISABLED / REVOKED / QUARANTINED   (terminal-ish states)

any content-hash change → REVALIDATION_REQUIRED (verification: UNVERIFIED)
```

## Guarantees

- **Discovery never auto-approves.** A discovered record is metadata; no
  state transition to APPROVED happens without an explicit `approve()`
  call.
- **Installation requires approval.** `install()` throws unless the
  record is APPROVED (or already INSTALLED).
- **QUARANTINED / REVOKED cannot be approved** without an explicit
  unquarantine path.
- **Supply-chain integrity**: a content-hash change after installation
  (including on-disk tampering) forces `REVALIDATION_REQUIRED` with
  `UNVERIFIED` verification — modified content never silently keeps its
  installation. Adversarially tested (tampered-content case).
- **Metadata-only persistence**: the registry stores hashes, states,
  permissions, privacy data classes — never executable content.

## Persistence

`JsonFileSkillRegistryStore` persists atomically (tmp + rename with
Windows EPERM/EBUSY/EACCES retry). Note: during 4N an unawaited-async
write race was found and fixed — persistence is now synchronous under the
store's sync contract, so a save is durable before any subsequent load.

`InMemorySkillRegistryStore` exists for tests.

## Trust model integration

Records carry `trustLevel` (`SkillTrustModel`) and transition on
approve/install/quarantine/revoke. See `docs/skills/trust-model.md`.
