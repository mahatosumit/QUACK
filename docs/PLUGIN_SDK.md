# Plugin SDK Documentation

Plugins allow third-party developers to extend QUACK OS. In-process plugins are trusted code.

## Architecture
`PluginSandbox` validates declared permissions; it is not a VM, subprocess, or OS sandbox. In-process plugins can access host privileges outside cooperative runtime APIs. Only install code you trust; permission declarations alone do not confine it.

## Creating a Plugin
Implement the `QuackPlugin` interface:

```typescript
export interface QuackPlugin {
  readonly id: string;
  readonly version: string;
  onMount(context: PluginContext): Promise<void>;
  onUnmount(): Promise<void>;
}
```

## Permissions
Plugins must declare required permissions and use runtime-mediated tool and provider paths. Approval and capability checks apply at the boundaries that call them; they do not automatically intercept arbitrary plugin code or every host operation. See [Security Policy](../SECURITY.md).

## Capabilities
Plugins can:
- Register new `QuackTool` instances.
- Hook into `EventBus` telemetry.
- Register new `ProviderAdapter` engines.
