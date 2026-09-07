import { now } from "../core/types.js";
import type { AiCapability, RoutingRequest, RoutingDecision, ModelInfo, DashboardData, RuntimeMonitorSnapshot } from "./types.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { RuntimeRegistry } from "./runtime-registry.js";
import { ModelRegistry } from "./model-registry.js";
import { EmbeddingRegistry } from "./embedding-registry.js";
import { VisionRegistry } from "./vision-registry.js";
import { SpeechRegistry } from "./speech-registry.js";
import { RerankerRegistry } from "./reranker-registry.js";
import { ProviderRegistry } from "./provider-registry.js";
import { IntelligenceRouter, type RouterDependencies } from "./intelligence-router.js";
import { ProfileManager } from "./profile-manager.js";
import { PipelineManager } from "./pipeline-manager.js";
import { BenchmarkEngine } from "./benchmark-engine.js";
import { EvaluationEngine } from "./evaluation-engine.js";
import { RuntimeMonitor } from "./runtime-monitor.js";
import { RuntimeScheduler } from "./runtime-scheduler.js";
import { RuntimeLoader } from "./runtime-loader.js";
import { PromptCache } from "./prompt-cache.js";
import { ModelCache } from "./model-cache.js";
import { GpuScheduler } from "./gpu-scheduler.js";
import { MemoryManager } from "./memory-manager.js";
import { QuantizationManager } from "./quantization-manager.js";
import { DownloadManager } from "./download-manager.js";
import { MarketplaceClient } from "./marketplace-client.js";
import { Dashboard } from "./dashboard.js";

export class AiRuntimeManager {
  readonly capabilities: CapabilityRegistry;
  readonly runtimes: RuntimeRegistry;
  readonly models: ModelRegistry;
  readonly embeddings: EmbeddingRegistry;
  readonly vision: VisionRegistry;
  readonly speech: SpeechRegistry;
  readonly rerankers: RerankerRegistry;
  readonly providers: ProviderRegistry;
  readonly router: IntelligenceRouter;
  readonly profiles: ProfileManager;
  readonly pipelines: PipelineManager;
  readonly benchmarks: BenchmarkEngine;
  readonly evaluations: EvaluationEngine;
  readonly monitor: RuntimeMonitor;
  readonly scheduler: RuntimeScheduler;
  readonly loader: RuntimeLoader;
  readonly promptCache: PromptCache;
  readonly modelCache: ModelCache;
  readonly gpuScheduler: GpuScheduler;
  readonly memoryManager: MemoryManager;
  readonly quantization: QuantizationManager;
  readonly downloads: DownloadManager;
  readonly marketplace: MarketplaceClient;
  readonly dashboard: Dashboard;
  private initialized = false;

  constructor() {
    this.capabilities = new CapabilityRegistry();
    this.runtimes = new RuntimeRegistry();
    this.models = new ModelRegistry();
    this.embeddings = new EmbeddingRegistry();
    this.vision = new VisionRegistry();
    this.speech = new SpeechRegistry();
    this.rerankers = new RerankerRegistry();
    this.providers = new ProviderRegistry();
    this.memoryManager = new MemoryManager();
    this.quantization = new QuantizationManager();
    this.downloads = new DownloadManager();
    this.marketplace = new MarketplaceClient();
    this.gpuScheduler = new GpuScheduler();
    this.promptCache = new PromptCache();
    this.modelCache = new ModelCache();

    const routerDeps: RouterDependencies = {
      capabilityRegistry: this.capabilities,
      runtimeRegistry: this.runtimes,
      modelRegistry: this.models,
    };
    this.router = new IntelligenceRouter(routerDeps);
    this.profiles = new ProfileManager();
    this.pipelines = new PipelineManager(this.router);
    this.benchmarks = new BenchmarkEngine(this.models);
    this.evaluations = new EvaluationEngine();
    this.monitor = new RuntimeMonitor(this.runtimes, this.models);
    this.scheduler = new RuntimeScheduler();
    this.loader = new RuntimeLoader(this.models, this.runtimes);
    this.dashboard = new Dashboard(this.runtimes, this.models, this.pipelines, this.benchmarks, this.downloads, this.gpuScheduler, this.monitor);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.runtimes.initialize();
    await this.models.initialize();
    await this.providers.initialize();
    await this.downloads.initialize();
    await this.marketplace.initialize();
    await this.gpuScheduler.initialize();
    this.capabilities.createDefaults();
    this.runtimes.createDefaultRuntimes();
    this.embeddings.createDefaults();
    this.vision.createDefaults();
    this.speech.createDefaults();
    this.rerankers.createDefaults();
    this.profiles.createDefaults();
    this.pipelines.createDefaults();
    this.marketplace.createDefaultPackages();
    this.discoverModels();
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    await this.scheduler.stop();
    this.loader.cancelAllAutoLoads();
    await this.runtimes.shutdown();
    await this.models.shutdown();
    await this.providers.shutdown();
    await this.downloads.shutdown();
    await this.marketplace.shutdown();
    await this.gpuScheduler.shutdown();
    this.initialized = false;
  }

  async routeRequest(request: RoutingRequest): Promise<RoutingDecision | null> {
    return this.router.route(request);
  }

  async executePipeline(pipelineId: string, input: unknown): Promise<any> {
    return this.pipelines.execute(pipelineId, input);
  }

  async discoverModels(): Promise<ModelInfo[]> {
    const rtIds = this.runtimes.getAll().map((r) => r.id);
    return this.models.autoDiscover(rtIds);
  }

  getDashboardData(): DashboardData {
    return this.dashboard.getData();
  }

  getMonitorSnapshot(): RuntimeMonitorSnapshot | undefined {
    return this.monitor.getLatestSnapshot();
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
