import type { LocalAiProvider, LocalAiModel, LocalAiRuntimeInfo } from "./types.js";

export interface LocalAiProviderConfig {
  ollamaEndpoint?: string;
  llamacppEndpoint?: string;
  vllmEndpoint?: string;
  lmstudioEndpoint?: string;
}

interface ProviderState {
  provider: LocalAiProvider;
  endpoint: string;
  available: boolean;
  version: string;
  models: LocalAiModel[];
}

export class LocalAiRuntime {
  private providers: Map<LocalAiProvider, ProviderState> = new Map();
  private initialized = false;

  constructor(private config: LocalAiProviderConfig = {}) {}

  async initialize(): Promise<void> {
    // Configured endpoints alone are not evidence of running providers or installed models.
    this.providers.clear();
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  getProvider(provider: LocalAiProvider): ProviderState | undefined {
    return this.providers.get(provider);
  }

  getAllProviders(): ProviderState[] {
    return Array.from(this.providers.values());
  }

  getAvailableProviders(): ProviderState[] {
    return Array.from(this.providers.values()).filter((p) => p.available);
  }

  getRuntimeInfo(): LocalAiRuntimeInfo[] {
    // Runtime measurements require a provider adapter. No providers have been discovered.
    return [];
  }

  getModels(provider?: LocalAiProvider): LocalAiModel[] {
    if (provider) return this.providers.get(provider)?.models ?? [];
    return Array.from(this.providers.values()).flatMap((p) => p.models);
  }

  getLoadedModels(): LocalAiModel[] {
    return this.getModels().filter((m) => m.loaded);
  }

  findModelByCapability(capability: string): LocalAiModel | undefined {
    return this.getLoadedModels().find((m) => m.capabilities.includes(capability));
  }

  async loadModel(provider: LocalAiProvider, modelName: string): Promise<boolean> {
    throw new Error("Local AI loadModel is unsupported: no provider adapter is configured.");
  }

  async unloadModel(provider: LocalAiProvider, modelName: string): Promise<boolean> {
    throw new Error("Local AI unloadModel is unsupported: no provider adapter is configured.");
  }

  async checkHealth(provider: LocalAiProvider): Promise<boolean> {
    throw new Error("Local AI checkHealth is unsupported: no provider adapter is configured.");
  }

  getBestProviderForTask(task: string): { provider: LocalAiProvider; model: LocalAiModel } | null {
    const taskLower = task.toLowerCase();
    if (taskLower.includes("code") || taskLower.includes("programming") || taskLower.includes("reasoning")) {
      const model = this.findModelByCapability("reasoning") ?? this.getLoadedModels()[0];
      if (model) return { provider: model.provider, model };
    }
    if (taskLower.includes("embedding") || taskLower.includes("search")) {
      const model = this.findModelByCapability("embedding");
      if (model) return { provider: model.provider, model };
    }
    const loaded = this.getLoadedModels();
    if (loaded.length > 0) return { provider: loaded[0]!.provider, model: loaded[0]! };
    return null;
  }

}
