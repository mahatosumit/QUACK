# Skill Runtime v1

Skill Runtime v1 is the secure portable execution layer for QUACK skills. It accepts declarative manifests, validates metadata and security boundaries, resolves required capabilities, and executes bounded workflows only through the runtime tool executor.

## Manifest Format

```json
{
  "id": "filesystem-assistant",
  "name": "Filesystem Assistant",
  "version": "1.0.0",
  "description": "Lists workspace files.",
  "author": "QUACK",
  "trustLevel": "trusted",
  "requiredCapabilities": ["permission.workspace.read"],
  "allowedTools": ["core.workspace.list-files"],
  "inputSchema": { "type": "object" },
  "outputSchema": { "type": "object" },
  "executionLimits": {
    "timeoutMs": 5000,
    "maxIterations": 2,
    "maxToolCalls": 2,
    "maxRetriesPerStep": 0
  },
  "workflow": {
    "steps": [
      {
        "id": "list",
        "description": "List workspace files.",
        "requiredTools": ["core.workspace.list-files"],
        "toolInvocations": [
          {
            "toolId": "core.workspace.list-files",
            "input": { "path": ".", "depth": 2 },
            "reason": "Inspect workspace."
          }
        ]
      }
    ]
  }
}
```

Skills are declarative workflows. Skill Runtime v1 does not execute arbitrary JavaScript or Python supplied by a skill.

## Trust Model

Trust levels are metadata used by operators and future policy layers:

- `builtin`: shipped with QUACK.
- `trusted`: approved by the local operator or organization.
- `verified`: reviewed and accepted for controlled use.
- `community`: imported from a non-core source.
- `experimental`: loaded for evaluation and should remain disabled until reviewed.

Trust does not bypass capability enforcement. Every tool call still goes through the capability broker and runtime executor.

## Execution Flow

```text
Skill Manifest
  -> Skill Runtime validation
  -> Skill Registry registration
  -> Skill Runtime execution
  -> Capability Broker preflight
  -> Runtime Executor
  -> Tool Registry
```

The runtime emits:

- `skill.loaded`
- `skill.validated`
- `skill.started`
- `skill.completed`
- `skill.failed`

Capability checks also emit `capability.checked`, `capability.allowed`, and `capability.denied` during preflight, while runtime tool execution performs the final enforcement check.

## Security Boundaries

Skill Runtime v1 enforces:

- timeout limits
- iteration limits
- max tool calls
- per-step retry limits
- tool allowlists
- required capability declarations
- workspace boundaries through workspace tools
- lifecycle gating for inactive, retired, quarantined, and non-approved candidate skills

Direct tool access is not exposed to skills. Declarative workflows call tools only through `SkillRuntime.executeSkill()`, which delegates to the existing runtime executor.

## Examples

Example manifests live in `examples/`:

- `filesystem-assistant.skill.json`
- `code-analysis.skill.json`
- `research.skill.json`
