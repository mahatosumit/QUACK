# ADR 0003: Add Workspace-Scoped Filesystem Tools

Status: Accepted

## Context

The first QUACK application is an autonomous software engineering agent. It needs to inspect a workspace, but filesystem access is a security boundary and must not bypass permissions or audit logging.

## Decision

Add read-only workspace filesystem tools:

- `core.workspace.list-files`
- `core.workspace.read-file`

Both tools resolve paths against the configured workspace root and require `workspace.read`. Tools are executed through `QuackRuntime.executeTool`, which emits permission and tool lifecycle events.

## Consequences

QUACK can now safely inspect its workspace through a capability boundary. Write operations, patch application, and terminal execution remain future tools with stricter permission gates.

