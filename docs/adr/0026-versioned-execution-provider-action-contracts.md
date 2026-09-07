# ADR 0026: Versioned Execution, Provider, and Action Contracts

- Status: Accepted
- Date: 2026-08-15

## Context

QUACK had three useful but incompatible provider abstractions in `src/providers`,
`src/models`, and `src/airm`. Capability support was expressed as booleans or
broad task labels, provider fallback was caller-ordered, and there was no common
contract for external actions. Replacing those subsystems would risk working
runtime, persistence, and safety behavior.

## Decision

QUACK defines a serializable public v1 boundary in `src/contracts/v1` for:

- execution and runtime;
- providers, models, capabilities, events, normalized usage, and errors;
- actions and action providers;
- tools and agent manifests;
- evidence and verification.

Capability support is explicit: `NATIVE`, `EMULATED`, `DEGRADED`, or
`UNSUPPORTED`. Missing capability metadata means unsupported. Provider identity,
runtime, model, endpoint, credential source, and local/cloud boundary are
separate fields.

Existing provider implementations migrate through `LegacyProviderV1Bridge`.
Legacy `true` booleans are mapped to `DEGRADED`, not `NATIVE`, until a native v1
adapter and conformance evidence prove the stronger claim. The existing APIs
remain available during migration.

`CapabilityProviderRouter` evaluates hard privacy/provider/capability constraints
before scoring or contacting a provider. In particular, a local-only mission
does not health-check or discover a cloud provider. Deterministic fallback,
normalized failure categories, bounded retry/backoff, cancellation, timeout, and
circuit recovery are part of the routing layer.

External effects go through `ActionRuntime`: registry lookup, schema validation,
permission decision, risk classification, approval, idempotency gate, bounded
execution, evidence, and audit. MCP is an Action Provider transport rather than
a kernel dependency.

## Consequences

- New providers and action providers can be registered without edits to routing
  or runtime code.
- Compatibility is preserved while weak legacy claims are made visible.
- Existing provider/model abstractions are not removed in this phase; callers
  should migrate to the v1 kernel incrementally.
- A provider cannot be described as fully supported until the reusable
  conformance suite has no failures for its advertised capabilities.
- Live adapters remain independently gated by credentials, local runtimes, and
  their own conformance reports.
