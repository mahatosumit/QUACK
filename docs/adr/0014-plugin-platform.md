# ADR 0014: Plugin Platform Architecture

Status: Accepted

## Context

QUACK needs a **Plugin Platform** that allows third-party extensions to contribute skills, tools, agents, providers, themes, panels, commands, and workflows. The platform must support discovery, installation, updates, removal, versioning, dependency management, permissions, and sandboxing.

## Decision

### Plugin Manifest

Every plugin declares a `PluginManifest`:

```typescript
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  quackApiVersion: string;
  type: PluginType;      // "tool" | "agent" | "provider" | "memory" | "knowledge-graph" | "workflow" | "prompt-pack" | "ui" | "importer" | "exporter"
  entry: string;         // Entry module path
  description?: string;
  capabilities: readonly string[];
  permissions: readonly Permission[];
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  configurationSchema?: string;
  platforms?: readonly string[];
}
```

### Plugin Lifecycle

```
discover (filesystem scan)
  → validate (manifest checks)
    → register (registry catalog)
      → load (dynamic import of entry)
        → activate (run plugin init)
          → use (runtime integration)
            → update (version check)
              → deactivate
                → unregister
```

### Core Components

| Component | Responsibility |
|-----------|---------------|
| `PluginRegistry` | Catalog all registered plugins with CRUD |
| `PluginLoader` | Load plugins from disk path or npm package |
| `PluginSandbox` | Validate permissions against allowlist |
| `PluginUpdater` | Check for updates (stub for Phase 5) |

### Security Model

- Plugins declare required permissions in their manifest
- `PluginSandbox.validatePermissions()` checks requested permissions against an allowlist
- The system can reject plugins that request unauthorized permissions
- Permissions are checked at registration time, not runtime

### Type System

Plugins are categorized by type (`PluginType`), which determines what they can contribute:
- `"tool"` — new Tool instance
- `"agent"` — new Brain implementation or agent personality
- `"provider"` — new LLM provider adapter
- `"memory"` — custom memory store
- `"workflow"` — predefined workflow template
- `"ui"` — desktop panel or theme
- `"prompt-pack"` — collection of prompts

## Consequences

**Positive:**
- Existing `PluginManifest` from Phase 1 is reused and extended.
- Clear permission declaration enables security auditing.
- Type-based categorization makes plugin discovery predictable.
- File and package loading paths enable marketplace integration.

**Negative:**
- No sandboxed execution environment yet (plugins run in-process).
- No version resolution or dependency graph (Phase 5).
- No hot-reload support (requires restart to load new plugins).

## Status

Accepted. Implemented in `src/plugins/`.
