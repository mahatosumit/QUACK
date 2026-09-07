import { PlatformRuntime } from "./platform-runtime.js";
import { HardwareMonitor } from "./hardware.js";
import { NativeServicesManager } from "./native-services.js";
import { DistributedRuntime } from "./distributed-runtime.js";
import { CapabilityNegotiator } from "./capability-negotiation.js";
import { RemoteExecution } from "./remote-execution.js";
import { LocalAiRuntime } from "./local-ai-runtime.js";
import { ContainerRuntime } from "./container-runtime.js";
import { SecretVault, Sandbox } from "./security.js";
import { PackageManager, UpdateSystem } from "./packaging.js";
import { Monitoring } from "./monitoring.js";

export interface DistributedNativePlatformLayer {
  readonly platform: PlatformRuntime;
  readonly hardware: HardwareMonitor;
  readonly nativeServices: NativeServicesManager;
  readonly distributed: DistributedRuntime;
  readonly negotiator: CapabilityNegotiator;
  readonly remote: RemoteExecution;
  readonly localAi: LocalAiRuntime;
  readonly containers: ContainerRuntime;
  readonly vault: SecretVault;
  readonly sandbox: Sandbox;
  readonly packages: PackageManager;
  readonly updates: UpdateSystem;
  readonly monitoring: Monitoring;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface DNPLConfig {
  cluster?: import("./types.js").ClusterConfig;
  containerType?: import("./types.js").ContainerRuntimeType;
  localAi?: { ollamaEndpoint?: string; llamacppEndpoint?: string; vllmEndpoint?: string; lmstudioEndpoint?: string };
}

export function createDNPL(config: DNPLConfig = {}): DistributedNativePlatformLayer {
  const platform = new PlatformRuntime();
  const hardware = new HardwareMonitor();
  const nativeServices = new NativeServicesManager();
  const distributed = new DistributedRuntime(config.cluster);
  const negotiator = new CapabilityNegotiator();
  const remote = new RemoteExecution();
  const localAi = new LocalAiRuntime(config.localAi);
  const containers = new ContainerRuntime(config.containerType);
  const vault = new SecretVault();
  const sandbox = new Sandbox();
  const packages = new PackageManager();
  const updates = new UpdateSystem();
  const monitoring = new Monitoring();

  const dnpl: DistributedNativePlatformLayer = {
    platform, hardware, nativeServices,
    distributed, negotiator, remote,
    localAi, containers, vault, sandbox,
    packages, updates, monitoring,
    async initialize(): Promise<void> {
      await platform.initialize();
      await nativeServices.initialize();
      await distributed.initialize();
      await remote.initialize();
      await localAi.initialize();
      await containers.initialize();
      await vault.initialize();
      await packages.initialize();
      await monitoring.initialize();
    },
    async shutdown(): Promise<void> {
      await distributed.shutdown();
      await remote.shutdown();
      await localAi.shutdown();
      await containers.shutdown();
      await vault.shutdown();
      await packages.shutdown();
      await monitoring.shutdown();
      await nativeServices.shutdown();
    },
  };

  return dnpl;
}
