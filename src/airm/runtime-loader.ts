import { now } from "../core/types.js";
import type { ModelInfo, ModelStatus, RuntimeInfo } from "./types.js";
import { ModelRegistry } from "./model-registry.js";
import { RuntimeRegistry } from "./runtime-registry.js";

export class RuntimeLoader {
  private modelRegistry: ModelRegistry;
  private runtimeRegistry: RuntimeRegistry;
  private loadTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(modelRegistry: ModelRegistry, runtimeRegistry: RuntimeRegistry) {
    this.modelRegistry = modelRegistry;
    this.runtimeRegistry = runtimeRegistry;
  }

  async loadModel(modelId: string): Promise<boolean> {
    throw new Error("AIRM model/runtime loading is unsupported: no runtime controller is configured.");
  }

  async unloadModel(modelId: string): Promise<boolean> {
    throw new Error("AIRM model/runtime loading is unsupported: no runtime controller is configured.");
  }

  async loadRuntime(runtimeId: string): Promise<boolean> {
    throw new Error("AIRM model/runtime loading is unsupported: no runtime controller is configured.");
  }

  async unloadRuntime(runtimeId: string): Promise<boolean> {
    throw new Error("AIRM model/runtime loading is unsupported: no runtime controller is configured.");
  }

  scheduleAutoLoad(modelIds: string[], intervalMs = 30000): void {
    throw new Error("AIRM model/runtime loading is unsupported: no runtime controller is configured.");
  }

  cancelAutoLoad(modelId: string): void {
    const timer = this.loadTimers.get(modelId);
    if (timer) {
      clearTimeout(timer);
      this.loadTimers.delete(modelId);
    }
  }

  cancelAllAutoLoads(): void {
    for (const [id, timer] of this.loadTimers) {
      clearTimeout(timer);
    }
    this.loadTimers.clear();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
