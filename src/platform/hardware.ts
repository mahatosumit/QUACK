import { totalmem, freemem } from "node:os";
import type { CpuInfo, GpuInfo, MemoryInfo, DiskInfo, NetworkInterface, BatteryInfo, HardwareInfo } from "./types.js";

export class HardwareMonitor {
  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async getHardwareInfo(): Promise<HardwareInfo> {
    throw new Error('Hardware getHardwareInfo is unsupported: a verified platform sampler is required.');
  }

  async getCpuInfo(): Promise<CpuInfo> {
    throw new Error('Hardware getCpuInfo is unsupported: a verified platform sampler is required.');
  }

  async getGpuInfo(): Promise<GpuInfo[]> {
    throw new Error('Hardware getGpuInfo is unsupported: a verified platform sampler is required.');
  }

  async getMemoryInfo(): Promise<MemoryInfo> {
    const total = totalmem();
    const free = freemem();
    const used = total - free;
    return { totalGB: this.toGB(total), freeGB: this.toGB(free), usedGB: this.toGB(used), utilization: total > 0 ? (used / total) * 100 : 0, swapTotalGB: null, swapUsedGB: null };
  }

  async getDiskInfo(): Promise<DiskInfo[]> {
    throw new Error('Hardware getDiskInfo is unsupported: a verified platform sampler is required.');
  }

  async getNetworkInterfaces(): Promise<NetworkInterface[]> {
    throw new Error('Hardware getNetworkInterfaces is unsupported: a verified platform sampler is required.');
  }

  async getBatteryInfo(): Promise<BatteryInfo | undefined> {
    return undefined;
  }

  getPowerMode(): "performance" | "balanced" | "powersave" {
    throw new Error('Hardware getPowerMode is unsupported: a verified platform sampler is required.');
  }

  getThermalState(): "nominal" | "fair" | "serious" | "critical" {
    throw new Error('Hardware getThermalState is unsupported: a verified platform sampler is required.');
  }

  private toGB(bytes: number): number {
    return Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100;
  }
}
