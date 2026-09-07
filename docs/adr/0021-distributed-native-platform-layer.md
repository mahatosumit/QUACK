# ADR-0021: Distributed Runtime & Native Platform Layer

**Status:** Accepted
**Date:** 2026-07-04
**Phase:** 8
**Components:** Platform Runtime, Hardware Monitor, Native Services, Distributed Runtime, Capability Negotiation, Remote Execution, Local AI Runtime, Container Runtime, Secret Vault, Sandbox, Package Manager, Update System, Monitoring

## Context

QUACK needs a unified platform abstraction layer that:

- Detects and reports OS/hardware/environment information.
- Manages native OS services (clipboard, notifications, processes, windows).
- Supports distributed execution across multiple nodes with capability-based task routing.
- Integrates with local AI runtimes (Ollama, llama.cpp, vLLM, LM Studio).
- Manages container runtimes (Docker, Podman).
- Provides secret management and sandbox execution.
- Supports packaging, updates, and system monitoring.

Without a dedicated platform layer, platform-specific logic leaks into higher layers (ExecutiveBrain, COS), creating portability issues and breaking the offline-first requirement.

## Decision

We build a **Distributed Native Platform Layer (DNPL)** — a self-contained set of modules in `src/platform/` that provide a unified API for platform, hardware, distributed execution, AI, containers, security, packaging, and monitoring.

### Architecture

The DNPL consists of 13 modules, each with a clear responsibility:

```
PlatformRuntime ── platform detection, capabilities, environment, permissions
HardwareMonitor ── CPU, GPU, memory, disk, network, battery
NativeServices ── services lifecycle, clipboard, notifications, processes, windows
DistributedRuntime ── cluster management, node discovery, task routing, health
CapabilityNegotiator ── capability advertisement, matching, gap analysis
RemoteExecution ── SSH/TCP connections, remote commands, file transfer
LocalAiRuntime ── Ollama, llama.cpp, vLLM, LM Studio model management
ContainerRuntime ── Docker/Podman container and image lifecycle
SecretVault ── encrypted secret storage with TTL, scope, access tracking
Sandbox ── policy-based execution containment (paths, domains, executables, resources)
PackageManager ── artifact creation, dependency trees, platform/arch targeting
UpdateSystem ── version management, update channels, rollback
Monitoring ── snapshot collection, metric history, system summary
```

### Key Design Properties

1. **Platform independence**: All platform-specific code lives in `PlatformRuntime`/`HardwareMonitor`. Higher layers depend only on `PlatformInfo`/`PlatformCapabilities` interfaces.

2. **Modularity**: Each module can be used standalone. The `createDNPL()` factory wires them together into a single `DistributedNativePlatformLayer` object.

3. **Mock-friendly**: All async operations return well-defined types. `NoopComputerProvider`-style patterns can be applied to each DNPL module.

4. **Distributed by default**: The `DistributedRuntime` + `CapabilityNegotiator` pair enables task routing across nodes based on capability scores.

5. **Offline-first**: Local AI, containers, and native services all work without network connectivity.

### Module Details

#### PlatformRuntime
- `detectPlatform()` returns `PlatformInfo` from `os` module + `process`.
- `getCapabilities()` returns `PlatformCapabilities` with boolean flags for each capability.
- `getEnvironment()` returns `PlatformEnvironment` with paths, locale, timezone, shell.
- `getPermissions()` returns `PlatformPermissions` with admin/elevation checks.

#### HardwareMonitor
- Uses `os.cpus()`, `os.totalmem()`, `os.freemem()`, `os.networkInterfaces()` for cross-platform detection.
- GPU detection is mock-based (platform-specific detection requires native modules).
- Battery info may be `undefined` (desktop systems without batteries).

#### NativeServicesManager
- Service lifecycle: `registerService()`, `startService()`, `stopService()`, `getService()`.
- Clipboard: `setClipboardContent()`, `getClipboardContent()` with 100-entry history.
- Notifications: `sendNotification()`, `getNotifications()` with 100-entry buffer.
- Processes: `listProcesses()`, `getProcess()`, `killProcess()`.
- Windows: `listWindows()`, `focusWindow()`.

#### DistributedRuntime
- Configurable via `ClusterConfig` (discovery method, heartbeat interval/timeout, max nodes).
- Node registration via `NodeAdvert` (with platform info, hardware specs, capabilities).
- Task submission via `submitTask()` with type, payload, required capabilities, priority.
- Task assignment picks the best-fit node (lowest task count, preferred node support).
- Health check with history tracking (capped at 100 entries per node).
- Cluster stats aggregation.

#### CapabilityNegotiator
- `registerAdvert()` / `unregisterAdvert()` for node capability publishing.
- `findBestMatch()` scores nodes against task requirements with load penalty.
- `getCapabilityGaps()` identifies which capabilities are missing from the cluster.
- `getCapabilityHeatmap()` shows capability availability across the cluster.

#### RemoteExecution
- Connection management: `connect()`, `disconnect()`, `reconnect()`.
- Remote commands: `execCommand()`.
- File operations: `uploadFile()`, `downloadFile()`, `readFile()`, `writeFile()`, `deleteFile()`.
- Directory operations: `listFiles()`, `createDirectory()`, `deleteDirectory()`.

#### LocalAiRuntime
- Supports 4 providers: Ollama, llama.cpp, vLLM, LM Studio.
- Each provider has default model lists with quantization, context length, capabilities.
- Model lifecycle: `loadModel()`, `unloadModel()`.
- Provider health checks.
- `getBestProviderForTask()` routes to the best model for code/chat/embedding tasks.

#### ContainerRuntime
- Supports Docker (default), Podman, nerdctl.
- Container lifecycle: `runContainer()`, `stopContainer()`, `startContainer()`, `removeContainer()`.
- Image management: `pullImage()`, `removeImage()`.
- `execInContainer()`, `getContainerLogs()`.
- Usage aggregation.

#### SecretVault
- Scoped secrets (`local` | `node` | `cluster`).
- TTL-based expiration with `clearExpired()`.
- Access counting and tracking.
- `revokeByScope()` for bulk revocation.
- Encrypted flag (actual encryption is the caller's responsibility).

#### Sandbox
- Policy-based: `createPolicy(id, options)` with fine-grained resource limits.
- `checkPathAllowed()`, `checkDomainAllowed()`, `checkExecutableAllowed()`.
- `executeInSandbox()` for running code under a policy.

#### PackageManager
- Versioned packages with format (`msi`, `exe`, `zip`, `appimage`, `deb`, `rpm`, `targz`, `dmg`).
- Platform/arch targeting.
- Dependency tree resolution.
- Semver validation.

#### UpdateSystem
- Multiple channels: `stable`, `beta`, `nightly`, `canary`.
- `checkForUpdates()`, `applyUpdate()`, `rollback()`.
- Update history tracking.

#### Monitoring
- `collectSnapshot()` captures CPU, memory, GPU, disk, network, process, platform, and QUACK-specific metrics.
- `recordMetric()` for custom metric tracking.
- `getSnapshots()`, `getLatestSnapshot()`, `getSystemSummary()` for dashboards.
- History management with per-metric cap.

## Consequences

### Positive
- Platform-specific code is isolated and can be swapped per OS.
- Distributed execution is a first-class capability, not an afterthought.
- Local AI, containers, and native services are accessible through a single factory.
- All 13 modules follow the same lifecycle pattern (`initialize()` / `shutdown()`).
- Integration with Desktop Dashboard provides full DNPL visibility.

### Negative
- GPU, battery, and other hardware-specific detection is mock-based until platform-specific modules are written.
- Remote execution uses mock implementations — real SSH/TCP requires proper shell integration.
- Container runtime doesn't actually connect to Docker daemon.
- SecretVault does not perform real encryption — callers must encrypt before storing.

### Neutral
- 93 new tests added (607 total across the project).
- Each module imports `now()` from `core/types.js` for timestamp consistency.
- The `createDNPL()` factory follows the same pattern as `createCos()` and `createUCP()`.
- 16 new Desktop API endpoints for DNPL monitoring.

## Files Changed

- `src/platform/types.ts` — All DNPL type definitions (PlatformInfo, HardwareInfo, ClusterNode, DistributedTask, NodeAdvert, RemoteConnection, LocalAiModel, ContainerInfo, SecretVaultEntry, SandboxPolicy, PackageManifest, UpdateManifest, SystemMetricsSnapshot, MetricHistoryEntry, etc.)
- `src/platform/platform-runtime.ts` — New: PlatformRuntime
- `src/platform/hardware.ts` — New: HardwareMonitor
- `src/platform/native-services.ts` — New: NativeServicesManager
- `src/platform/distributed-runtime.ts` — New: DistributedRuntime
- `src/platform/capability-negotiation.ts` — New: CapabilityNegotiator
- `src/platform/remote-execution.ts` — New: RemoteExecution
- `src/platform/local-ai-runtime.ts` — New: LocalAiRuntime
- `src/platform/container-runtime.ts` — New: ContainerRuntime
- `src/platform/security.ts` — New: SecretVault, Sandbox
- `src/platform/packaging.ts` — New: PackageManager, UpdateSystem
- `src/platform/monitoring.ts` — New: Monitoring
- `src/platform/dnpl.ts` — New: createDNPL factory
- `src/platform/index.ts` — New: platform barrel exports
- `src/platform/dnpl.test.ts` — New: 93 DNPL tests
- `src/system/create-system.ts` — Added `dnpl` to QuackSystem interface and factory
- `src/desktop/server.ts` — Added 16 DNPL API endpoints
- `src/index.ts` — Added platform export

## Test Results

```
607 tests, 0 failures
```
