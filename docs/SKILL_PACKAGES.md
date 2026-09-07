# Skill Package Management

Skill Package Management adds a portable lifecycle around declarative QUACK skills. It does not execute arbitrary JavaScript or Python. Packages are imported, validated, registered, enabled, disabled, and removed through the existing Skill Runtime security path.

## Package Format

```text
skill/
  manifest.json
  workflow.json
  README.md
  tests/
```

`manifest.json` must include:

- `id`, `name`, `version`, `description`, `author`
- `trustLevel`
- `requiredCapabilities`
- `allowedTools`
- `inputSchema`, `outputSchema`
- `executionLimits`

`workflow.json` contains declarative `steps`. Each step declares its required tools and bounded tool invocations. Those invocations are still executed only through:

```text
Skill Package Manager
-> Manifest Validation
-> Trust Validation
-> Capability Broker
-> Skill Runtime
-> Runtime Executor
-> Tools
```

## Security

Imported packages cannot claim `builtin` trust. Package validation rejects unknown tools, malformed manifests, non-permission-backed capabilities, missing required capabilities, and capabilities denied by the configured Capability Broker policy.

The package manager stores workflows as data only. The Skill Runtime converts the package into a portable workflow and enforces:

- timeout limits
- iteration limits
- max tool call limits
- tool allowlists
- capability restrictions
- workspace boundaries inherited from the runtime executor

## Persistence

Installed package metadata, validation results, enabled state, and declarative workflows are persisted under the configured QUACK data directory:

```text
dataDir/skills/packages.json
```

On startup, installed packages are rehydrated through `SkillRuntime.loadSkillManifest()`. Packages that were enabled before shutdown are re-enabled through the Skill Runtime lifecycle API.

## CLI

```bash
quack skills list
quack skills install ./examples/packages/coding-assistant
quack skills enable coding-assistant
quack skills disable coding-assistant
```

`quack skills` defaults to `list` and returns both registry skills and installed packages.

## HTTP API

```text
POST /skills/import
GET  /skills
POST /skills/:id/enable
POST /skills/:id/disable
```

Import request:

```json
{
  "path": "./examples/packages/coding-assistant"
}
```

Enable and disable optionally accept:

```json
{
  "version": "1.0.0"
}
```

## Events

The Event Bus emits:

- `skill.package.imported`
- `skill.package.validated`
- `skill.package.enabled`
- `skill.package.disabled`
- `skill.package.rejected`

These events are available to audit logs, SSE streams, and dashboard consumers.
