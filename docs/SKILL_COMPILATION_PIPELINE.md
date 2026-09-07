# SKILL.md Compilation Pipeline

QUACK treats natural-language `SKILL.md` files as untrusted source material.
They are never executed directly. The safe compiler accepts only a constrained
subset of instructions and produces a bounded portable skill definition that is
validated by the existing sandbox runtime.

## Trust Boundary

Natural language may describe intent, but deterministic validation authorizes
execution. A parser or LLM may propose structured intent in the future, but the
trusted path is:

```text
SKILL.md
SkillSourceIR
SkillPlanIR
PortableSkillExecutionDefinition
DurableSkillSandboxRuntime
ToolRegistry / QuackRuntime permissions
```

The compiler does not generate or run JavaScript, TypeScript, Python, shell,
eval, templates, expressions, dynamic imports, or downloaded code.

## Source IR

`SkillSourceIR` is a non-executable representation extracted from common
markdown sections:

```text
Name, Description, Purpose, Inputs, Outputs, Tools, Constraints,
Preconditions, Postconditions, Verification, Examples, Steps
```

Missing or loose sections produce structured diagnostics. The parser may extract
partial information, but it does not invent missing tools, permissions, inputs,
or capabilities.

## Plan IR

`SkillPlanIR` is also non-executable. Each step records its logical id, intent,
candidate tool, resolved tool metadata, safe input bindings, dependencies,
requested retry count, requested timeout, and verification text if present.

The deterministic compiler validates this IR before producing portable
execution:

```text
no dependency cycles
bounded step count
bounded retries and timeout
registered tools only
manifest tools derived from resolved tools
permissions derived from resolved tool metadata
supported bindings only
```

## Tool Resolution

Tool resolution is conservative. A step should mention an exact registered tool
id such as `core.workspace.list-files`. A small capability fallback exists only
for unambiguous built-in read-only operations such as listing files, reading a
file, or echoing a message.

The compiler never fabricates tool identifiers and never falls back to shell
commands. Unknown or ambiguous tools produce diagnostics and no portable
definition.

## Bindings

Compiled inputs can use only the bindings already supported by the portable
sandbox:

```text
$goal or $fromInput:goal
$parameter:name or $fromParameter:name
$fromNode:step.path
constants
```

There is no expression language or recursive runtime interpolation.

## Risk Classification

Risk is derived from resolved tools and permissions, not from prose labels:

```text
READ_ONLY
LOW_RISK_MUTATION
WORKSPACE_MUTATION
EXTERNAL_SIDE_EFFECT
DESTRUCTIVE
PRIVILEGED
```

Privileged and destructive plans are rejected. Workspace mutations remain
candidates and require explicit evaluation and promotion.

## Dry Run

Dry run reports the resolved DAG, selected tools, permissions, dependencies,
bindings, predicted side effects, and execution bounds. It does not execute
mutating tools. If a tool has no native simulator, side effects are predicted
from tool metadata.

## Persistence And Fingerprinting

Compiled candidates persist as portable definitions with structured compilation
provenance:

```text
source type and id
source hash
compiler version
schema version
tool registry fingerprint
timestamp
diagnostics
outcome
risk
```

Executable fingerprints remain based on manifest metadata plus normalized
portable execution. Raw prose and timestamps are not executable identity.

Portable execution also records the metadata fingerprint of each resolved tool.
If tool metadata changes after restart, sandbox validation blocks execution and
requires review or recompilation.

## Lifecycle

Compilation does not activate a skill:

```text
SKILL.md source
compiled candidate
explicit evaluation
promotion
active default version
```

Candidates execute only in explicit experiment/evaluation mode. Production
selection can execute promoted active portable artifacts through the existing
`SkillExecutor` and sandbox runtime.

## Example

Input `SKILL.md`:

```markdown
# Workspace Inspector

## Description
List workspace files.

## Tools
- core.workspace.list-files

## Steps
1. list: use core.workspace.list-files path=. depth=1
```

Source IR:

```json
{
  "name": "Workspace Inspector",
  "suggestedTools": ["core.workspace.list-files"],
  "steps": [{ "id": "list", "text": "use core.workspace.list-files path=. depth=1" }]
}
```

Plan IR:

```json
{
  "skillId": "workspace-inspector",
  "requiredTools": ["core.workspace.list-files"],
  "permissions": ["workspace.read"],
  "risk": "READ_ONLY"
}
```

Portable execution:

```json
{
  "schemaVersion": 1,
  "steps": [{
    "id": "list",
    "requiredTools": ["core.workspace.list-files"],
    "toolInvocations": [{
      "toolId": "core.workspace.list-files",
      "input": { "path": ".", "depth": 1 }
    }]
  }]
}
```

## Unsupported Operations

The compiler rejects arbitrary code, raw shell snippets, unbounded loops,
infinite retries, unknown tools, permission escalation, destructive ambiguity,
dynamic downloads followed by execution, and unsupported verification code.
