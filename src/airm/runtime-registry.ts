import { now } from "../core/types.js";
import type { RuntimeInfo, RuntimeType, RuntimeStatus, HealthStatus, AiCapability, ModelFormat, HardwareRequirements } from "./types.js";

export class RuntimeRegistry {
  private runtimes: Map<string, RuntimeInfo> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  register(runtime: RuntimeInfo): void {
    this.runtimes.set(runtime.id, runtime);
  }

  unregister(id: string): boolean {
    return this.runtimes.delete(id);
  }

  get(id: string): RuntimeInfo | undefined {
    return this.runtimes.get(id);
  }

  getAll(): RuntimeInfo[] {
    return Array.from(this.runtimes.values());
  }

  getByType(type: RuntimeType): RuntimeInfo[] {
    return this.getAll().filter((r) => r.type === type);
  }

  getActive(): RuntimeInfo[] {
    return this.getAll().filter((r) => r.status === "ready");
  }

  getHealthy(): RuntimeInfo[] {
    return this.getAll().filter((r) => r.health === "healthy");
  }

  findByCapability(capability: AiCapability): RuntimeInfo[] {
    return this.getAll().filter((r) => r.capabilities.includes(capability));
  }

  updateStatus(id: string, status: RuntimeStatus): boolean {
    const r = this.runtimes.get(id);
    if (!r) return false;
    r.status = status;
    return true;
  }

  updateHealth(id: string, health: HealthStatus): boolean {
    const r = this.runtimes.get(id);
    if (!r) return false;
    r.health = health;
    return true;
  }

  updateLatency(id: string, latency: number): boolean {
    const r = this.runtimes.get(id);
    if (!r) return false;
    r.latency = latency;
    return true;
  }

  getStats(): { total: number; active: number; healthy: number; errored: number } {
    const all = this.getAll();
    return {
      total: all.length,
      active: all.filter((r) => r.status === "ready").length,
      healthy: all.filter((r) => r.health === "healthy").length,
      errored: all.filter((r) => r.status === "error").length,
    };
  }

  createDefaultRuntimes(): void {
    this.register({
      id: "ollama-local", name: "Ollama", type: "ollama", version: "0.1.0",
      status: "unavailable", endpoint: "http://127.0.0.1:11434",
      capabilities: ["reasoning", "coding", "chat", "embeddings", "vision"],
      supportedFormats: ["gguf"], hardwareRequirements: { minVRAMGB: 4, minRAMGB: 8, gpuRequired: false, supportedGpus: [] },
      platformSupport: ["win32", "linux", "darwin"], health: "unknown", latency: 0, availability: 0, lastSeen: now(),
      config: {},
    });
    this.register({
      id: "llamacpp-local", name: "llama.cpp", type: "llamacpp", version: "0.1.0",
      status: "unavailable", endpoint: "http://127.0.0.1:8080",
      capabilities: ["reasoning", "coding", "chat"],
      supportedFormats: ["gguf"], hardwareRequirements: { minVRAMGB: 4, minRAMGB: 8, gpuRequired: false, supportedGpus: [] },
      platformSupport: ["win32", "linux", "darwin"], health: "unknown", latency: 0, availability: 0, lastSeen: now(),
      config: {},
    });
    this.register({
      id: "openai-cloud", name: "OpenAI-compatible", type: "openai-compatible", version: "1.0.0",
      status: "unavailable", endpoint: "https://api.openai.com/v1",
      capabilities: ["reasoning", "coding", "chat", "vision", "embeddings", "tool-calling", "function-calling", "json-generation", "long-context"],
      supportedFormats: ["custom"], hardwareRequirements: { minVRAMGB: 0, minRAMGB: 0, gpuRequired: false, supportedGpus: [] },
      platformSupport: ["win32", "linux", "darwin"], health: "unknown", latency: 0, availability: 0, lastSeen: now(),
      config: {},
    });
  }
}
