# Capability Broker

The Capability Broker is the Phase 2 tool-access boundary for QUACK OS.

It introduces a first-class decision point between mission execution and tool runtime:

```text
Mission / Agent / Skill
-> Capability Request
-> Capability Broker
-> Mission Grant Registry
-> Permission Policy
-> Tool Execution
```

## Current Implementation

The initial broker is intentionally conservative. It preserves the existing permission model and wraps it with capability metadata:

- `CapabilityRequest`: actor, task, tool id, capability id, permission, resource scope, action class, reason, and context.
- `CapabilityDecision`: grant/deny result, policy reference, reason, optional grant id, and optional delegated permission decision.
- `CapabilityGrant`: mission-level grant with optional agent and skill scoping, allowed capabilities, scope restrictions, issue/expiry timestamps, approval metadata, and revocation metadata.
- `InMemoryCapabilityGrantRegistry`: creates, revokes, queries, and checks active mission grants.
- `JsonFileCapabilityGrantRegistry`: persists mission grants and revocation metadata to `dataDir/security/capability-grants.json`.
- `PermissionBackedCapabilityBroker`: adapter that validates mission grants when mission context exists, then delegates to the existing `PermissionPolicy`.

Runtime integration lives in `QuackRuntime.executeTool()`. Every permission declared by a tool is converted into a capability request before the tool executes.

Non-mission callers remain backward compatible. If a capability request has no `missionId`, the broker uses the existing permission policy only. If `missionId` is present, the broker requires a matching active grant before consulting the permission policy.

## Enforcement Flow

Tool execution is actively gated:

```text
Mission Request
-> Capability Broker
-> Mission Grant Check
-> Permission Check
-> Allow / Deny
-> Tool Execution
```

Before every tool call, the runtime validates:

- mission identity when a mission context is present
- required capability id
- resource scope
- permission action class
- underlying permission policy

Permission-backed capability requests must match the permission-derived capability id, action class, and resource kind. Mismatches are denied before the request reaches the permission policy.

Denied tool execution returns a stable `tool.permission_denied` error with `context.errorType = "CapabilityDeniedError"` and includes:

- `missionId`
- `toolId`
- `toolName`
- `requiredCapability`
- `missingPermission`
- `action`
- `resource`
- `decision`
- `reason`
- `policyRef`
- `grantId`

## Mission Grants

Mission grants support:

- `missionId`
- optional `agentId`
- optional `skillId`
- `capabilities`
- scope restrictions for workspace paths, commands, and resource descriptors
- `issuedAt`
- optional `expiresAt`
- approval metadata
- revocation metadata

Grants constrain access; they do not bypass runtime permissions or approval policy.

`createQuackSystem()` can bootstrap a mission context:

```typescript
createQuackSystem({
  missionId: "mission-1",
  permissions: ["workspace.read"],
  capabilityGrants: [{
    missionId: "mission-1",
    capabilities: ["permission.workspace.read"],
    scope: { workspacePaths: ["docs"] },
    approval: {
      approvedBy: "security",
      reason: "Mission may inspect docs.",
      approvedAt: "2026-08-07T00:00:00.000Z",
    },
  }],
});
```

With this configuration, workspace reads under `docs/` can proceed if the permission policy also allows `workspace.read`; workspace reads outside `docs/` are denied by the broker.

Seed grants are de-duplicated with `ensureGrant()`, then persisted. A later `createQuackSystem()` call with the same `dataDir` reloads the grant file even if `capabilityGrants` is not supplied again.

`MissionManager.onActivate()` provides a synchronous lifecycle hook for loading configured grants when a mission becomes active. System composition uses it to ensure any configured grants matching the activated mission are present before mission-scoped tool access.

## Action Classes

Capability decisions classify requested access as:

- `READ`: read-only access such as workspace, filesystem, git, or memory reads.
- `REVERSIBLE_CHANGE`: bounded state mutations such as workspace or memory writes.
- `IRREVERSIBLE_ACTION`: external, privileged, or hard-to-undo actions such as terminal execution, network access, secrets, provider invocation, plugin installation, external filesystem writes, and git writes.

This classification is additive. Existing `RiskAwareApprovalPolicy` behavior remains the enforcement source for now.

## Resource Scope

The broker records a resource kind for each permission:

- `workspace`
- `filesystem`
- `terminal`
- `network`
- `secrets`
- `git`
- `provider`
- `memory`
- `plugin`
- `unknown`

When a tool input has a string `path`, that path is included in the request scope. Workspace confinement is still enforced by workspace tools themselves.

When a tool input has a string `command`, that command is included in the request scope for terminal capabilities.

## Audit Events

Tool capability checks emit:

- `capability.requested`
- `capability.checked`
- `capability.allowed`
- `capability.denied`
- `capability.decided`

The runtime also preserves legacy permission audit events:

- `permission.requested`
- `permission.decided`

Capability audit payloads include mission, agent, skill, capability, permission, tool, action, resource, timestamp, decision, policy reference, and grant id. This gives QUACK an enforced broker-level audit trail without breaking existing permission semantics.

## Next Steps

- Add resource-specific policies beyond the compatibility permission adapter.
- Persist capability decisions in a queryable audit view.
- Use the shared action class in the execution safety layer.
