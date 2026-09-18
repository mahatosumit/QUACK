# ADR 0044: Governed Extension Ecosystem Foundation

## Status

Accepted — 2026-09-11

## Context

QUACK has governed execution surfaces (tools, skills, providers, MCP actions,
hooks) but no governed way to describe, validate, and track third-party
extension PACKAGES. The roadmap's P10 calls for an extension ecosystem
WITHOUT creating a second authority surface, a marketplace, or an execution
bypass. The product principle: a package manifest is DATA, never AUTHORITY —
exactly like memory content (ADR 0043) and instruction payloads (ADR 0042).

A package manifest may contain arbitrary text and structure, including
instruction-override attempts, fake signature claims, capability
self-escalation, or traversal paths. None of that may change trust,
capability, policy, identity, provider authority, approval state, or
execution authority.

## Decision

### Architecture (the P10 boundary)

One declarative, broker-governed package catalog — BEFORE any runtime
admission or execution:

```
LOCAL PACKAGE DIRECTORY (manifest.json + content)
  → DISCOVERY (P10.4, read-only, no network)
  → MANIFEST VALIDATION (P10.1, fail-closed, unknown-field rejection)
  → INTEGRITY VERIFICATION (P10.2, sha256, honest states)
  → DEPENDENCY RESOLUTION (P10.9, exact versions only, cycle/conflict fail)
  → TRANSACTIONAL INSTALL (P10.5/P10.6, all-or-nothing with rollback)
  → DETERMINISTIC REGISTRY (P10.17, canonical order, tamper exclusion)
  → LIFECYCLE (P10.10, explicit 8-state table, REMOVED terminal)
  → METADATA-ONLY EVALUATION (P10.12, deterministic dimensions)
  → EventBus OBSERVABILITY (P10.11, nine extension.* types, metadata only)
```

`src/ecosystem/` implements this. Package content is NEVER executed,
loaded, dynamically imported, or spawned here. Runtime code contributions
continue to flow exclusively through the existing host-trusted
`ExtensionRegistry` (ADR 0034) and its governed execution surfaces.

### Manifest model (P10.1)

`ExtensionManifestV2`: id (lowercase namespaced), name, version (semver),
kind (skill | knowledge-pack | agent | connector | tool | workflow |
provider | model-adapter | ui), description, quackContractVersion,
publisher, compatibleWith (semver range), entry (package-relative path —
traversal rejected), capabilities, permissions, dependencies, integrity,
optional ui metadata. Validation is STRICT and fail-closed: unknown fields
are rejected (never ignored), unknown publisher/dependency/integrity/ui
sub-fields are rejected, entry traversal fails closed, and
`publisher.signatureState` may only be `UNSIGNED` or `UNVERIFIED` — a
manifest can never self-assert verified status. Parsing returns structured
error codes; nothing is coerced.

### Identity and integrity (P10.2/P10.3)

Identity is `id@version`. Content integrity is a sha256 digest over the
package content bytes (`packageDigest`); manifests additionally carry a
deterministic `manifestDigest` over the CANONICAL manifest form, so two
manifests with identical semantics but different key order are the same
extension. `verifyPackageIntegrity` supports sha256 only and fails closed
on algorithm or digest mismatch. There is NO cryptographic signature
verification in P10: `signatureState` is honestly `UNSIGNED` or
`UNVERIFIED`, and the trust view (`extensionTrustView`) reports exactly
what was verified — digests — and nothing more. No fake signature claims.

### Lifecycle (P10.10)

Eight explicit states: DISCOVERED, VALIDATED, ADMITTED, INSTALLED, ENABLED,
DISABLED, QUARANTINED, REMOVED. A frozen, deterministic transition table
defines every legal move; everything else fails closed with
`extension.lifecycle_invalid_transition`. REMOVED is terminal and removal
deletes the registry record — no ghost entries.

### Deterministic registry (P10.17)

`ExtensionRegistryCatalog` persists one JSON record per extension under
the data directory. Every record is re-parsed fail-closed on load
(`parseRegistryRecord`): identity mismatch between record and manifest,
manifest-digest mismatch, malformed digests, digest-correspondence
tampering (package digest vs the manifest integrity declaration), invalid
timestamps, provenance, signature state, or lifecycle state exclude the
record — it is never coerced or silently rendered. Listing is
deterministic: sorted by id, then version — insertion order and file
system order never decide. Rollback removes records; duplicates fail with
`extension.registry_duplicate`.

### Dependency resolution (P10.9)

Exact-version, local-only resolution. Dependencies declare `id` + exact
semver `version`; there is no "latest", no range picking, and no network
fetching. Resolution is deterministic (topological order, stable
tie-breakers), detects cycles (`extension.dependency_cycle`) and
conflicts (`extension.dependency_conflict`), and fails closed on missing
local availability. Silent conflict resolution does not exist.

### Capability governance (P10.7/P10.16)

Declared capabilities and permissions in a manifest are DATA. They grant
nothing. The existing `CapabilityBroker` remains the single authority:
catalog mutations (install/enable/disable/remove) resolve `plugin.install`
through the broker; read operations resolve `workspace.read`;
per-capability authorization (`authorizeCapability`) resolves each declared
capability through the SAME broker. An extension declaring
`terminal.execute` gains nothing — the broker decides. There is no second
policy engine, no capability self-escalation, and no bypass.

### Transactional install (P10.5/P10.6)

`install` validates the root package, resolves the full dependency set,
pre-checks EVERY staged identity for duplicates before the first write,
then registers the batch all-or-nothing. A failing step rolls back records
this call already wrote. Duplicate installation of an already-registered
identity fails closed with `extension.registry_duplicate` — never a silent
no-op. Install performs NO execution and NO network access.

### Execution-boundary honesty (P10.8)

P10 provides NO extension execution. There is no code loading, no
`child_process`, no dynamic import of package content. Extensions here are
REGISTERED / ADMITTED / NOT-EXECUTABLE records. The Studio panel, CLI, and
server surface all state this honestly. Executable extension support
requires a future governed execution surface and is explicitly out of
scope.

### EventBus integration (P10.11)

Nine metadata-only event types extend the existing EventBus union:
`extension.discovered`, `extension.validated`, `extension.admitted`,
`extension.installed`, `extension.enabled`, `extension.disabled`,
`extension.quarantined`, `extension.removed`, `extension.rejected`.
Payloads carry ids, versions, digests, and counts — never package content.
There is no second event system. Event ids stay out of deterministic
decisions.

### Evaluation and observability (P10.12)

`scoreEcosystemQuality` scores manifestIntegrity, lifecycleConsistency,
dependencyCompleteness, and provenanceExplicitness from METADATA-ONLY
evidence — deterministic, no invented quality claims beyond observable
catalog facts.

### Surfaces (P10.13/P10.14/P10.15)

- CLI: `quack extension list | inspect <id>@<version> | validate <dir> |
  install <dir> | enable|disable|remove <id>@<version>`; exit codes
  0/1/2/3; `--json` output. Catalog mutations resolve `plugin.install`
  (HIGH-RISK) through the broker with the operator as the human approver —
  `quack extension install` prompts before writing anything; a denial
  writes nothing. Read-only commands never prompt.
- Server: `GET /extensions` metadata-only, redacted at the wire, fails
  closed to an honest empty surface.
- Studio: Ecosystem panel (identity, kind, lifecycle, signature,
  integrity, declared capabilities, dependency count) with honest empty
  states and SSE refresh for `extension.*` events.
- SDK: exports the manifest/integrity/lifecycle/resolution/evaluation
  contracts. No registry file paths, no broker internals, no package
  content, no execution surface.

## Consequences

- Third-party extension packages can be described, validated, resolved,
  installed transactionally, and lifecycle-managed under the existing
  authority model.
- Integrity is digest-honest: UNSIGNED/UNVERIFIED are the only signature
  states; cryptographic signature verification remains future work.
- No marketplace, no remote fetching, no remote execution, no sandbox, no
  extension code execution exists in P10 — all explicitly deferred.
- Catalog operations are broker-governed even though nothing executes:
  mutations require `plugin.install` (human-approved); reads are
  deterministic and metadata-only.

## Verification

- `src/ecosystem/security.test.ts` — 21 adversarial tests (P10.16
  matrix): malformed/forged manifests (unknown fields, traversal,
  self-asserted signature, capability escalation text), tampered registry
  records (digest correspondence, identity mismatch), duplicate
  identities, dependency cycles/conflicts, broker-denied mutations,
  transactional rollback, lifecycle ghosts, event content-leak
  resistance, execution-boundary honesty, determinism.
- `src/ecosystem/ecosystem.test.ts` — 6 deterministic-behavior tests
  (canonical form/digest, registry listing order, resolution order,
  forged-identity exclusion).
- `src/cli.test.ts` — P10.13 CLI contract tests (parse, validate,
  install + approval prompt, duplicate, lifecycle, exit codes, honest
  empty state, no ghost after removal).
- `src/dashboard/web/studio.test.ts` — P10.14 panel tests (route,
  metadata-only columns, no content/secret leakage, SSE refresh).
- `sdk/test/client.test.mjs` — P10.15 SDK contract test (kind/lifecycle
  vocabularies, validation, canonical digests, integrity fail-closed,
  lifecycle table, resolution, evaluation dimensions).
