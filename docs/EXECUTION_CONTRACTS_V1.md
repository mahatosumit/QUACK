# QUACK Execution Contracts v1

The canonical public types are exported from `src/contracts/v1`. The contract
version is `1.0.0` and is carried in serialized boundary records.

## Lifecycle

```text
Intent -> Mission -> Requirements -> Capability resolution -> Policy
       -> Planning -> Scheduling -> Execution -> Evidence -> Verification
       -> Durable state -> Result
```

`ExecutiveBrain` is an optional planning/orchestration service above this
boundary. Providers, tools, MCP servers, workflows, and memory implementations
are not mandatory QUACK Core dependencies.

## Provider SDK path

1. Implement `QuackProviderV1`.
2. Advertise model capability truth with explicit support levels.
3. Register the provider in `CanonicalProviderRegistry`.
4. Run `runProviderConformance` with deterministic fixtures and, separately,
   labelled live credentials/endpoints.
5. Route through `CapabilityProviderRouter`.

Hard policy constraints run before provider network calls. Do not put provider
name checks in generic routing logic.

## Action SDK path

1. Implement `ActionProviderV1` and complete every side-effect field.
2. Register it in `ActionProviderRegistry`.
3. Execute only through `ActionRuntime`.
4. Supply permission, approval, evidence, and audit adapters.

High-risk actions fail closed without an approver. Non-idempotent write actions
require an idempotency key. A dry-run is rejected unless the descriptor says the
provider supports it.

## MCP

`McpActionProvider` accepts a wire client implementing `McpClientTransport` and
normalizes MCP tools into action descriptors. Tool descriptions, schemas, and
outputs are untrusted and bounded. Stdio and Streamable HTTP are modeled as
transport types; a production wire client must implement the negotiated MCP
revision and cancellation behavior rather than relying on this normalization
layer to do framing.

The implementation was checked against the official MCP specification. At the
time of this decision the ecosystem must handle the stable 2025-11-25 revision
and the 2026-07-28 revision/transition. HTTP+SSE is legacy; new integrations use
stdio or Streamable HTTP and must preserve version negotiation.
