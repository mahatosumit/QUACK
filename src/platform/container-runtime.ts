import type { ContainerRuntimeType, ContainerInfo, ContainerImageInfo } from "./types.js";

export class ContainerRuntime {
  private type: ContainerRuntimeType = "docker";
  private containers: Map<string, ContainerInfo> = new Map();
  private images: Map<string, ContainerImageInfo> = new Map();
  private initialized = false;

  constructor(type?: ContainerRuntimeType) {
    if (type) this.type = type;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  getRuntimeType(): ContainerRuntimeType {
    return this.type;
  }

  async listContainers(): Promise<ContainerInfo[]> {
    return Array.from(this.containers.values());
  }

  async getContainer(id: string): Promise<ContainerInfo | undefined> {
    return this.containers.get(id);
  }

  async runContainer(name: string, image: string, options?: { ports?: string[]; env?: Record<string, string> }): Promise<ContainerInfo> {
    throw new Error("Container runContainer is unsupported: no container executor is configured.");
  }

  async stopContainer(id: string): Promise<boolean> {
    throw new Error("Container stopContainer is unsupported: no container executor is configured.");
  }

  async startContainer(id: string): Promise<boolean> {
    throw new Error("Container startContainer is unsupported: no container executor is configured.");
  }

  async removeContainer(id: string): Promise<boolean> {
    throw new Error("Container removeContainer is unsupported: no container executor is configured.");
  }

  async listImages(): Promise<ContainerImageInfo[]> {
    return Array.from(this.images.values());
  }

  async pullImage(repository: string, tag: string): Promise<ContainerImageInfo> {
    throw new Error("Container pullImage is unsupported: no container executor is configured.");
  }

  async removeImage(id: string): Promise<boolean> {
    throw new Error("Container removeImage is unsupported: no container executor is configured.");
  }

  async execInContainer(containerId: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    throw new Error("Container execInContainer is unsupported: no container executor is configured.");
  }

  async getContainerLogs(containerId: string, _tail?: number): Promise<string> {
    throw new Error("Container getContainerLogs is unsupported: no container executor is configured.");
  }

  async getUsage(): Promise<{ containers: { running: number; stopped: number; total: number }; images: number; memoryUsedMB: number; cpuUsage: number }> {
    throw new Error("Container getUsage is unsupported: no container executor is configured.");
  }
}
