import { type IsoTimestamp } from "../core/types.js";

// ── Platform Abstraction ──────────────────────────────────────────

export type PlatformType = "win32" | "linux" | "darwin" | "unknown";
export type ArchType = "x64" | "arm64" | "ia32" | "unknown";

export interface PlatformInfo {
  platform: PlatformType;
  arch: ArchType;
  hostname: string;
  username: string;
  osVersion: string;
  kernelVersion: string;
  uptime: number;
  isWsl: boolean;
  isContainer: boolean | null;
  isVirtualMachine: boolean | null;
}

export interface PlatformCapabilities {
  canManageProcesses: boolean;
  canManageServices: boolean;
  canReadRegistry: boolean;
  canNotify: boolean;
  canUseClipboard: boolean;
  canUseGlobalShortcuts: boolean;
  canUseSystemTray: boolean;
  canUseNativeDialogs: boolean;
  canUseFileAssociations: boolean;
  canUsePowerManagement: boolean;
  canUseHardwareMonitoring: boolean;
  supportsWayland: boolean;
  supportsX11: boolean;
  supportsSystemd: boolean;
  supportsDbus: boolean;
  supportsWinRT: boolean;
  supportsPowerShell: boolean;
  supportsWsl: boolean;
  supportsFlatpak: boolean;
  supportsSnap: boolean;
  supportsAppImage: boolean;
}

export interface PlatformEnvironment {
  variables: Record<string, string>;
  paths: { home: string; temp: string; config: string; data: string; cache: string; desktop: string; documents: string; downloads: string };
  locale: string;
  timezone: string;
  shell: string;
  terminalEmulators: string[];
}

export interface PlatformPermissions {
  isAdmin: boolean;
  canElevate: boolean;
  canAccessNetwork: boolean;
  canAccessFileSystem: boolean;
  canAccessHardware: boolean;
  constrained: boolean;
}

// ── Hardware ──────────────────────────────────────────────────────

export type GpuVendor = "nvidia" | "amd" | "intel" | "apple" | "unknown";

export interface CpuInfo {
  model: string;
  cores: number;
  logicalCores: number;
  architecture: ArchType;
  frequencyMHz: number;
  cacheL1: number;
  cacheL2: number;
  cacheL3: number;
  vendor: string;
  flags: string[];
  utilization: number;
  temperatureCelsius?: number;
}

export interface GpuInfo {
  id: string;
  model: string;
  vendor: GpuVendor;
  driverVersion: string;
  memoryTotalMB: number;
  memoryFreeMB: number;
  computeUnits: number;
  clockMHz: number;
  temperatureCelsius?: number;
  utilization: number;
  cudaCores?: number;
  cudaVersion?: string;
  rocmVersion?: string;
  directMLSupported: boolean;
  vulkanSupported: boolean;
  openCLSupported: boolean;
}

export interface MemoryInfo {
  totalGB: number;
  freeGB: number;
  usedGB: number;
  utilization: number;
  swapTotalGB: number | null;
  swapUsedGB: number | null;
}

export interface DiskInfo {
  mountPoint: string;
  fileSystem: string;
  totalGB: number;
  freeGB: number;
  usedGB: number;
  type: "ssd" | "hdd" | "nvme" | "ram" | "network";
}

export interface NetworkInterface {
  name: string;
  type: "ethernet" | "wifi" | "loopback" | "virtual";
  macAddress: string;
  ipv4: string[];
  ipv6: string[];
  speedMbps: number;
  connected: boolean;
  mtu: number;
}

export interface BatteryInfo {
  present: boolean;
  charging: boolean;
  levelPercent: number;
  timeRemainingMinutes?: number;
  healthPercent?: number;
  cycleCount?: number;
  temperatureCelsius?: number;
}

export interface HardwareInfo {
  cpu: CpuInfo;
  gpus: GpuInfo[];
  memory: MemoryInfo;
  disks: DiskInfo[];
  network: NetworkInterface[];
  battery?: BatteryInfo;
  powerMode: "performance" | "balanced" | "powersave";
  thermalState: "nominal" | "fair" | "serious" | "critical";
  numaNodes: number;
}

// ── Capability Negotiation ────────────────────────────────────────

export type CapabilityCategory =
  | "compute" | "gpu" | "memory" | "storage" | "network"
  | "ai" | "vision" | "speech" | "browser" | "desktop"
  | "container" | "ros2" | "docker" | "kubernetes" | "hardware"
  | "platform" | "skill" | "plugin" | "model" | "remote";

export interface NodeCapability {
  category: CapabilityCategory;
  name: string;
  version: string;
  description: string;
  score: number;
  properties: Record<string, unknown>;
}

export interface NodeAdvert {
  nodeId: string;
  nodeName: string;
  platform: PlatformInfo;
  hardware: Partial<HardwareInfo>;
  capabilities: NodeCapability[];
  availability: "available" | "busy" | "degraded" | "offline";
  load: number;
  address: string;
  port: number;
  lastSeen: IsoTimestamp;
  priority: number;
}

// ── Distributed Runtime ───────────────────────────────────────────

export type NodeStatus = "online" | "offline" | "degraded" | "joining" | "leaving";
export type NodeRole = "leader" | "worker" | "coordinator" | "edge";

export interface ClusterNode {
  id: string;
  name: string;
  role: NodeRole;
  status: NodeStatus;
  advert: NodeAdvert;
  tasks: number;
  maxTasks: number;
  heartbeatIntervalMs: number;
  lastHeartbeat: IsoTimestamp;
  createdAt: IsoTimestamp;
}

export interface ClusterConfig {
  nodeId: string;
  nodeName: string;
  role: NodeRole;
  port: number;
  discoveryMethod: "udp" | "dns" | "static" | "kubernetes";
  discoveryAddress?: string;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  maxNodes: number;
  autoJoin: boolean;
}

export interface DistributedTask {
  id: string;
  type: string;
  payload: unknown;
  requiredCapabilities: string[];
  preferredNode?: string;
  assignedTo?: string;
  status: "pending" | "assigned" | "running" | "completed" | "failed" | "timed_out";
  priority: number;
  createdAt: IsoTimestamp;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  result?: unknown;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

export interface HealthCheckResult {
  nodeId: string;
  status: NodeStatus;
  uptime: number;
  load: number;
  memoryUtilization: number;
  cpuUtilization: number;
  tasksRunning: number;
  tasksQueued: number;
  lastError?: string;
  checkedAt: IsoTimestamp;
}

// ── Remote Execution ──────────────────────────────────────────────

export interface RemoteConnection {
  id: string;
  type: "ssh" | "tcp" | "ws" | "tls";
  host: string;
  port: number;
  user: string;
  authenticated: boolean;
  connectedAt: IsoTimestamp;
  lastActivity: IsoTimestamp;
  keepalive: boolean;
}

export interface RemoteFileInfo {
  path: string;
  size: number;
  isDirectory: boolean;
  permissions: string;
  owner: string;
  group: string;
  modifiedAt: IsoTimestamp;
}

// ── Local AI Runtime ──────────────────────────────────────────────

export type LocalAiProvider = "ollama" | "llamacpp" | "vllm" | "lmstudio" | "none";

export interface LocalAiModel {
  name: string;
  provider: LocalAiProvider;
  sizeGB: number;
  quantization: string;
  contextLength: number;
  loaded: boolean;
  capabilities: string[];
  endpoint: string;
  health: "healthy" | "degraded" | "unavailable";
  throughputTokensPerSec?: number;
}

export interface LocalAiRuntimeInfo {
  provider: LocalAiProvider;
  available: boolean;
  endpoint: string;
  version: string;
  models: LocalAiModel[];
  loadedModels: number;
  totalModels: number;
  memoryUsedMB: number;
  memoryAvailableMB: number;
  healthy: boolean;
}

// ── Container Runtime ─────────────────────────────────────────────

export type ContainerRuntimeType = "docker" | "podman" | "nerdctl";

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: "running" | "exited" | "paused" | "created" | "restarting";
  ports: string[];
  created: IsoTimestamp;
  started: IsoTimestamp;
  cpuUsage: number;
  memoryUsageMB: number;
  platform: ContainerRuntimeType;
}

export interface ContainerImageInfo {
  id: string;
  repository: string;
  tag: string;
  sizeMB: number;
  created: IsoTimestamp;
}

// ── Security ──────────────────────────────────────────────────────

export interface SecretVaultEntry {
  id: string;
  key: string;
  value: string;
  scope: "local" | "node" | "cluster";
  encrypted: boolean;
  createdAt: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  accessCount: number;
  lastAccessed?: IsoTimestamp;
}

export type SecretVaultMetadata = Omit<SecretVaultEntry, "value">;

export interface SandboxPolicy {
  enabled: boolean;
  allowNetwork: boolean;
  allowFileSystem: boolean;
  allowProcessSpawn: boolean;
  allowHardwareAccess: boolean;
  allowElevation: boolean;
  resourceLimits: {
    maxMemoryMB: number;
    maxCpuPercent: number;
    maxDiskMB: number;
    maxNetworkKbps: number;
  };
  allowedPaths: string[];
  deniedPaths: string[];
  allowedDomains: string[];
  allowedExecutables: string[];
  auditEnabled: boolean;
}

// ── Packaging & Updates ───────────────────────────────────────────

export type PackageFormat = "msi" | "exe" | "zip" | "appimage" | "deb" | "rpm" | "targz" | "dmg";
export type UpdateChannel = "stable" | "beta" | "nightly" | "canary";

export interface PackageManifest {
  version: string;
  format: PackageFormat;
  platform: PlatformType;
  arch: ArchType;
  sizeMB: number;
  checksum: string;
  signature: string;
  builtAt: IsoTimestamp;
  dependencies: string[];
  minOSVersion: string;
  recommended: boolean;
}

export interface UpdateManifest {
  currentVersion: string;
  latestVersion: string;
  channel: UpdateChannel;
  releaseDate: IsoTimestamp;
  releaseNotes: string;
  packages: PackageManifest[];
  mandatory: boolean;
  minUpgradableVersion: string;
}

// ── Monitoring ────────────────────────────────────────────────────

export interface SystemMetricsSnapshot {
  timestamp: IsoTimestamp;
  cpu: { utilization: number; temperature?: number; frequencyMHz: number };
  memory: MemoryInfo;
  gpus: { id: string; utilization: number; memoryUsedMB: number; temperature?: number }[];
  disks: { mountPoint: string; utilization: number; iops?: number }[];
  network: { bytesIn: number; bytesOut: number; packetsIn: number; packetsOut: number };
  processes: { total: number; running: number; sleeping: number; cpuTop: { pid: number; name: string; cpu: number }[] };
  platform: { uptime: number; load: number[] };
  quack: { agents: number; tasks: number; workflows: number; modelsLoaded: number; memoryUsedMB: number };
  cluster: { nodes: number; online: number; tasksDistributed: number; tasksQueued: number };
}

export interface MetricHistoryEntry {
  timestamp: IsoTimestamp;
  value: number;
  labels: Record<string, string>;
}

// ── Native Services ───────────────────────────────────────────────

export interface NativeService {
  name: string;
  description: string;
  status: "running" | "stopped" | "error" | "starting" | "stopping";
  pid?: number;
  cpuUsage?: number;
  memoryUsageMB?: number;
  startedAt?: IsoTimestamp;
  autoStart: boolean;
  dependencies: string[];
}

export interface NativeServiceDefinition {
  name: string;
  displayName: string;
  description: string;
  executablePath: string;
  args: string[];
  runAs: "user" | "system" | "elevated";
  autoStart: boolean;
  restartOnCrash: boolean;
  restartDelayMs: number;
  workingDirectory?: string;
  environment?: Record<string, string>;
}

// ── Clipboard Service ─────────────────────────────────────────────

export type ClipboardContentType = "text" | "html" | "image" | "files" | "rich_text";

export interface ClipboardContent {
  type: ClipboardContentType;
  text?: string;
  html?: string;
  files?: string[];
  format?: string;
  size?: number;
  source?: string;
  timestamp: IsoTimestamp;
}

// ── Notification Service ──────────────────────────────────────────

export interface DesktopNotification {
  id: string;
  title: string;
  body: string;
  icon?: string;
  urgency: "low" | "normal" | "critical";
  actions?: { id: string; label: string }[];
  category?: string;
  timeoutMs?: number;
  timestamp: IsoTimestamp;
  source: string;
}

// ── Process Service ───────────────────────────────────────────────

export interface ProcessInfo {
  pid: number;
  name: string;
  executablePath: string;
  arguments: string;
  status: "running" | "sleeping" | "stopped" | "zombie";
  cpuUsage: number;
  memoryUsageMB: number;
  user: string;
  created: IsoTimestamp;
  parentPid?: number;
  children: number[];
  priority: number;
  threads: number;
  openFileDescriptors: number;
  environment?: Record<string, string>;
}

// ── Window Service ────────────────────────────────────────────────

export interface NativeWindowInfo {
  id: number;
  title: string;
  processId: number;
  processName: string;
  className: string;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  focused: boolean;
  minimized: boolean;
  maximized: boolean;
  resizable: boolean;
  hasCloseButton: boolean;
  layer: number;
  workspace?: number;
  desktop?: string;
}
