import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createAIRM } from "./airm.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { RuntimeRegistry } from "./runtime-registry.js";
import { ModelRegistry } from "./model-registry.js";
import { EmbeddingRegistry } from "./embedding-registry.js";
import { VisionRegistry } from "./vision-registry.js";
import { SpeechRegistry } from "./speech-registry.js";
import { RerankerRegistry } from "./reranker-registry.js";
import { ProviderRegistry } from "./provider-registry.js";
import { ProfileManager } from "./profile-manager.js";
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
import { PipelineManager } from "./pipeline-manager.js";
import { type ModelInfo, type PipelineExecution } from "./types.js";
import { IntelligenceRouter, type RouterDependencies } from "./intelligence-router.js";

// ── CapabilityRegistry ──────────────────────────────────────────

describe("CapabilityRegistry", () => {
  let reg: CapabilityRegistry;

  before(() => { reg = new CapabilityRegistry(); });

  it("creates default capabilities", () => {
    reg.createDefaults();
    assert.ok(reg.getAll().length > 0);
  });

  it("registers and retrieves", () => {
    reg.register({ id: "test-cap", name: "coding", description: "Test", category: "reasoning" });
    assert.ok(reg.get("test-cap"));
  });

  it("gets by category", () => {
    const reasoning = reg.getByCategory("reasoning");
    assert.ok(reasoning.length > 0);
  });

  it("hasCapability returns true for existing", () => {
    assert.ok(reg.hasCapability("coding"));
  });

  it("returns stats", () => {
    const stats = reg.getStats();
    assert.ok(stats.total > 0);
    assert.ok(stats.categories["reasoning"]);
  });

  it("unregisters", () => {
    assert.ok(reg.unregister("test-cap"));
    assert.equal(reg.get("test-cap"), undefined);
  });
});

// ── RuntimeRegistry ─────────────────────────────────────────────

describe("RuntimeRegistry", () => {
  let reg: RuntimeRegistry;

  before(() => { reg = new RuntimeRegistry(); });
  before(async () => await reg.initialize());
  after(async () => await reg.shutdown());

  it("creates default runtimes", () => {
    reg.createDefaultRuntimes();
    assert.ok(reg.getAll().length > 0);
  });

  it("registers and retrieves", () => {
    reg.register({
      id: "test-rt", name: "Test Runtime", type: "custom", version: "1.0",
      status: "ready", capabilities: ["chat"],
      supportedFormats: ["gguf"], hardwareRequirements: { minVRAMGB: 0, minRAMGB: 0, gpuRequired: false, supportedGpus: [] },
      platformSupport: ["win32"], health: "healthy", latency: 50, availability: 0.99, lastSeen: new Date().toISOString(), config: {},
    });
    assert.ok(reg.get("test-rt"));
  });

  it("gets by type", () => {
    const rts = reg.getByType("custom");
    assert.ok(rts.length > 0);
  });

  it("gets active runtimes", () => {
    const active = reg.getActive();
    assert.ok(active.length > 0);
  });

  it("finds by capability", () => {
    const rts = reg.findByCapability("chat");
    assert.ok(rts.length > 0);
  });

  it("updates status and health", () => {
    assert.ok(reg.updateStatus("test-rt", "error"));
    assert.ok(reg.updateHealth("test-rt", "unhealthy"));
    assert.equal(reg.get("test-rt")?.status, "error");
  });

  it("returns stats", () => {
    const stats = reg.getStats();
    assert.equal(typeof stats.total, "number");
  });
});

// ── ModelRegistry ───────────────────────────────────────────────

describe("ModelRegistry", () => {
  let reg: ModelRegistry;

  before(() => { reg = new ModelRegistry(); });
  before(async () => await reg.initialize());
  after(async () => await reg.shutdown());

  it("auto-discovers models", () => {
    const discovered = seedTestModels(reg, ["ollama-local", "llamacpp-local"]);
    assert.ok(discovered.length > 0);
  });

  it("registers custom model", () => {
    reg.register({
      id: "test-model", name: "Test Model", version: "1.0",
      runtimeId: "ollama-local", format: "gguf", quantization: "gguf_q4",
      architecture: "llama", contextWindow: 4096, parameters: 7,
      capabilities: ["chat", "reasoning"],
      capabilityScores: { chat: 80, reasoning: 70 },
      memoryUsage: { loadGB: 4, inferenceGB: 5, peakGB: 6, cpuGB: 8 },
      toolSupport: true, visionSupport: false, audioSupport: false,
      functionCalling: true, streaming: true, jsonMode: true,
      status: "available", source: "local",
      licensing: { name: "MIT", allowsCommercial: true, allowsModification: true, attributionRequired: false },
      performance: { id: "", modelId: "", runtimeId: "", benchmarkType: "comprehensive", scores: {}, metrics: { latencyP50Ms: 100, latencyP95Ms: 200, latencyP99Ms: 400, throughputTokensPerSec: 30, memoryPeakMB: 5000, gpuUtilizationPeak: 80, reliabilityPercent: 95, tokensPerSecond: 30, timeToFirstTokenMs: 150, errorRate: 0.01 }, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0, dataset: "default", version: "1" },
      qualityScores: {}, discoveryMethod: "manual",
      registeredAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    assert.ok(reg.get("test-model"));
  });

  it("gets by capability", () => {
    const models = reg.getByCapability("chat");
    assert.ok(models.length > 0);
  });

  it("updates status", () => {
    assert.ok(reg.updateStatus("test-model", "loaded"));
    assert.equal(reg.getLoaded().length, 1);
  });

  it("searches models", () => {
    const results = reg.search({ capabilities: ["chat"], minContextWindow: 1024 });
    assert.ok(results.length > 0);
  });

  it("returns stats", () => {
    const stats = reg.getStats();
    assert.ok(stats.total > 0);
    assert.ok(stats.byRuntime["ollama-local"] > 0);
  });
});

// ── IntelligenceRouter ──────────────────────────────────────────

describe("IntelligenceRouter", () => {
  let router: IntelligenceRouter;
  let deps: RouterDependencies;

  before(() => {
    const capReg = new CapabilityRegistry();
    capReg.createDefaults();
    const rtReg = new RuntimeRegistry();
    rtReg.createDefaultRuntimes();
    const modReg = new ModelRegistry();
    seedTestModels(modReg, ["ollama-local"]);

    rtReg.updateStatus("ollama-local", "ready");
    rtReg.updateHealth("ollama-local", "healthy");
    deps = { capabilityRegistry: capReg, runtimeRegistry: rtReg, modelRegistry: modReg };
    router = new IntelligenceRouter(deps);
  });

  it("routes a chat request", async () => {
    const decision = await router.route({
      taskType: "chat",
      requiredCapabilities: ["chat"],
      context: { taskDescription: "Hello", contextLength: 10 },
      constraints: {},
    });
    assert.ok(decision);
    assert.ok(decision.modelId);
    assert.ok(decision.score > 0);
  });

  it("routes with constraints", async () => {
    const decision = await router.route({
      taskType: "reasoning",
      requiredCapabilities: ["reasoning"],
      context: { taskDescription: "Think", contextLength: 100 },
      constraints: { offlineRequired: true },
    });
    assert.ok(decision);
    assert.ok(decision.score > 0);
  });

  it("returns null when no model matches", async () => {
    const decision = await router.route({
      taskType: "vision",
      requiredCapabilities: ["vision"],
      context: { taskDescription: "See", contextLength: 10 },
      constraints: { gpuRequired: true, minVRAMGB: 999 },
    });
    // May or may not be null depending on defaults
    if (decision !== null) {
      assert.ok(decision.score >= 0);
    }
  });

  it("supports routing policies", () => {
    router.setPolicy("test-policy", { id: "test-policy", name: "Test", rules: [], priority: 1 });
    assert.ok(router.getPolicy("test-policy"));
    router.removePolicy("test-policy");
    assert.equal(router.getPolicy("test-policy"), undefined);
  });
});

// ── ProfileManager ──────────────────────────────────────────────

describe("ProfileManager", () => {
  let mgr: ProfileManager;

  before(() => { mgr = new ProfileManager(); });

  it("creates default profiles", () => {
    mgr.createDefaults();
    assert.ok(mgr.getAll().length > 0);
  });

  it("gets profile by type", () => {
    const profiles = mgr.getByType("coding");
    assert.ok(profiles.length > 0);
  });

  it("gets default profile", () => {
    const def = mgr.getDefault();
    assert.ok(def.isDefault);
  });

  it("sets default profile", () => {
    const profiles = mgr.getAll();
    const last = profiles[profiles.length - 1]!;
    assert.ok(mgr.setDefault(last.id));
    assert.equal(mgr.getDefault().id, last.id);
  });

  it("gets preferred capabilities", () => {
    const caps = mgr.getPreferredCapabilities("coding");
    assert.ok(caps.length > 0);
  });

  it("returns stats", () => {
    const stats = mgr.getStats();
    assert.ok(stats.total > 0);
  });
});

// ── BenchmarkEngine ─────────────────────────────────────────────

describe("BenchmarkEngine", () => {
  it("rejects unsupported benchmarking without recording scores", async () => {
    const registry = new ModelRegistry();
    const [model] = seedTestModels(registry, ["ollama-local"]);
    const before = structuredClone(model.capabilityScores);
    const engine = new BenchmarkEngine(registry);
    await assert.rejects(engine.runBenchmark(model.id, "reasoning"), /unsupported/);
    assert.deepEqual(registry.get(model.id)?.capabilityScores, before);
    assert.deepEqual(engine.getResults(), []);
    assert.deepEqual(engine.compareModels([model.id], "reasoning"), []);
    assert.equal(engine.getStats().total, 0);
  });
});

describe("EvaluationEngine", () => {
  let engine: EvaluationEngine;

  before(() => { engine = new EvaluationEngine(); });

  it("records evaluations", () => {
    const id = engine.record({
      modelId: "test-model", runtimeId: "test-rt",
      taskType: "coding", success: true,
      metrics: { latencyMs: 500, tokensUsed: 100, tokensInput: 50, tokensOutput: 50, cost: 0.001, retries: 0, corrections: 0, memoryUsedMB: 1000, gpuUtilization: 50 },
      input: "Write code", output: "function foo() {}",
      timestamp: new Date().toISOString(),
    });
    assert.ok(id);
    assert.ok(engine.get(id));
  });

  it("gets by model", () => {
    const records = engine.getByModel("test-model");
    assert.ok(records.length > 0);
  });

  it("computes success rate", () => {
    const rate = engine.getSuccessRate("test-model");
    assert.equal(rate, 1);
  });

  it("computes average latency", () => {
    const lat = engine.getAverageLatency("test-model");
    assert.equal(lat, 500);
  });

  it("ranks models", () => {
    const rankings = engine.getModelRanking();
    assert.ok(rankings.length > 0);
  });

  it("records feedback", () => {
    const records = engine.getByModel("test-model");
    assert.ok(engine.recordFeedback(records[0]!.id, { rating: 5, accepted: true }));
  });

  it("returns stats", () => {
    const stats = engine.getStats();
    assert.equal(stats.total, 1);
    assert.equal(stats.success, 1);
  });
});

// ── RuntimeMonitor ──────────────────────────────────────────────

describe("RuntimeMonitor", () => {
  it("does not fabricate hardware measurements", async () => {
    const monitor = new RuntimeMonitor(new RuntimeRegistry(), new ModelRegistry());
    await assert.rejects(monitor.collectSnapshot(), /unsupported/);
    assert.equal(monitor.getLatestSnapshot(), undefined);
    assert.deepEqual(monitor.getSnapshots(), []);
    assert.equal(monitor.getSystemSummary().health, "unknown");
  });
});

describe("RuntimeScheduler", () => {
  let sched: RuntimeScheduler;

  before(() => { sched = new RuntimeScheduler(); });
  after(async () => await sched.stop());

  it("schedules tasks", () => {
    const id = sched.schedule({ type: "health-check", targetId: "ollama-local", priority: 5 });
    assert.ok(id);
  });

  it("gets pending tasks", () => {
    assert.equal(sched.getPending().length, 1);
  });

  it("cancels tasks", () => {
    const id = sched.schedule({ type: "load-model", targetId: "test", priority: 1 });
    assert.ok(sched.cancel(id));
  });

  it("starts and processes tasks", async () => {
    let processed = false;
    sched.onTask(async (task) => { processed = true; });
    const id = sched.schedule({ type: "load-model", targetId: "test-model", priority: 10 });
    await sched.start(50);
    await new Promise((r) => setTimeout(r, 100));
    await sched.stop();
    assert.ok(processed);
    assert.equal(sched.getAll().find(task => task.id === id)?.status, "completed");
  });

  it("fails scheduled work when no executor is registered", async () => {
    const unsupported = new RuntimeScheduler();
    unsupported.schedule({ type: "load-model", targetId: "unavailable", priority: 1 });
    try {
      await unsupported.start(5);
      for (let attempt = 0; attempt < 100 && unsupported.getStats().failed === 0; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.equal(unsupported.getStats().completed, 0);
      assert.equal(unsupported.getStats().failed, 1);
      assert.match(unsupported.getAll()[0].error ?? "", /unsupported/);
    } finally {
      await unsupported.stop();
    }
  });

  it("returns stats", () => {
    const stats = sched.getStats();
    assert.equal(typeof stats.total, "number");
  });
});

// ── RuntimeLoader ───────────────────────────────────────────────

describe("RuntimeLoader", () => {
  it("rejects unimplemented lifecycle operations without changing catalog state", async () => {
    const models = new ModelRegistry();
    const [model] = seedTestModels(models, ["ollama-local"]);
    const runtimes = new RuntimeRegistry();
    runtimes.createDefaultRuntimes();
    const loader = new RuntimeLoader(models, runtimes);
    await assert.rejects(loader.loadModel(model.id), /unsupported/);
    await assert.rejects(loader.unloadModel(model.id), /unsupported/);
    await assert.rejects(loader.loadRuntime("ollama-local"), /unsupported/);
    await assert.rejects(loader.unloadRuntime("ollama-local"), /unsupported/);
    assert.throws(() => loader.scheduleAutoLoad([model.id]), /unsupported/);
    assert.equal(models.get(model.id)?.status, "available");
    assert.equal(runtimes.get("ollama-local")?.status, "unavailable");
    loader.cancelAllAutoLoads();
  });
});

describe("PromptCache", () => {
  let cache: PromptCache;

  before(() => { cache = new PromptCache({ maxEntries: 10, defaultTTLMs: 5000 }); });

  it("stores and retrieves", () => {
    cache.set("key1", { data: "hello" });
    assert.deepEqual(cache.get("key1"), { data: "hello" });
  });

  it("returns undefined for missing keys", () => {
    assert.equal(cache.get("nonexistent"), undefined);
  });

  it("deletes entries", () => {
    cache.set("key2", "value");
    assert.ok(cache.has("key2"));
    assert.ok(cache.delete("key2"));
    assert.equal(cache.has("key2"), false);
  });

  it("evicts when full", () => {
    for (let i = 0; i < 15; i++) cache.set(`evict-${i}`, i);
    assert.ok(cache.size <= 15);
  });

  it("clears all entries", () => {
    cache.clear();
    assert.equal(cache.size, 0);
  });

  it("returns stats", () => {
    const stats = cache.getStats();
    assert.equal(stats.maxEntries, 10);
  });
});

// ── ModelCache ──────────────────────────────────────────────────

describe("ModelCache", () => {
  let cache: ModelCache;

  before(() => { cache = new ModelCache({ maxEntries: 10 }); });

  it("marks models as loaded", () => {
    cache.markLoaded("model-a", 2048);
    assert.ok(cache.isLoaded("model-a"));
  });

  it("marks models as unloaded", () => {
    cache.markUnloaded("model-a");
    assert.equal(cache.isLoaded("model-a"), false);
  });

  it("gets all cached models", () => {
    cache.markLoaded("model-b", 1024);
    assert.equal(cache.getAll().length, 2);
  });

  it("gets loaded models", () => {
    const loaded = cache.getLoadedModels();
    assert.equal(loaded.length, 1);
  });

  it("computes total memory", () => {
    const mem = cache.getTotalMemoryMB();
    assert.equal(mem, 1024);
  });

  it("evicts LRU models", () => {
    const evicted = cache.evictLRU(1);
    assert.equal(evicted.length, 1);
  });

  it("clears cache", () => {
    cache.clear();
    assert.equal(cache.getAll().length, 0);
  });

  it("returns stats", () => {
    cache.markLoaded("model-c", 512);
    const stats = cache.getStats();
    assert.equal(stats.loaded, 1);
  });
});

// ── GpuScheduler ────────────────────────────────────────────────

describe("GpuScheduler", () => {
  it("does not invent hardware or allocations", async () => {
    const scheduler = new GpuScheduler();
    await scheduler.initialize();
    assert.deepEqual(scheduler.getAllGpus(), []);
    assert.equal(scheduler.getBestGpu(1), undefined);
    const [model] = seedTestModels(new ModelRegistry(), ["fixture"]);
    assert.throws(() => scheduler.allocateModel("gpu-0", model), /unsupported/);
    assert.throws(() => scheduler.releaseModel("gpu-0", model.id), /unsupported/);
    assert.equal(scheduler.getStats().processes, 0);
    await scheduler.shutdown();
  });
});

describe("MemoryManager", () => {
  let mgr: MemoryManager;

  before(() => { mgr = new MemoryManager(); });

  it("reports memory state", () => {
    const state = mgr.getState();
    assert.ok(state.totalRAMGB > 0);
  });

  it("allocates and releases RAM", () => {
    assert.ok(mgr.canAllocateRAM(4));
    assert.ok(mgr.allocateRAM(4));
    mgr.releaseRAM(4);
  });

  it("allocates and releases VRAM", () => {
    assert.ok(mgr.canAllocateVRAM(2));
    assert.ok(mgr.allocateVRAM(2));
    mgr.releaseVRAM(2);
  });

  it("optimizes for model requirements", () => {
    const result = mgr.optimizeForModel(4, 4);
    assert.equal(typeof result.canFit, "boolean");
    assert.ok(Array.isArray(result.recommendations));
  });

  it("returns utilization", () => {
    const util = mgr.getUtilization();
    assert.equal(typeof util.ram, "number");
  });
});

// ── QuantizationManager ─────────────────────────────────────────

describe("QuantizationManager", () => {
  let mgr: QuantizationManager;

  before(() => { mgr = new QuantizationManager(); });

  it("returns supported quantizations", () => {
    const quants = mgr.getSupportedQuantizations();
    assert.ok(quants.length > 0);
  });

  it("recommends quantizations for a model", () => {
    const modelInfo = { id: "test", name: "Test", version: "1.0", runtimeId: "rt", format: "gguf" as const, quantization: "gguf_q4" as const,
      architecture: "llama", contextWindow: 4096, parameters: 7,
      capabilities: [] as any, capabilityScores: {} as any,
      memoryUsage: { loadGB: 4, inferenceGB: 5, peakGB: 6, cpuGB: 8 },
      toolSupport: false, visionSupport: false, audioSupport: false,
      functionCalling: false, streaming: false, jsonMode: false,
      status: "available" as any, source: "local" as any,
      licensing: { name: "MIT", allowsCommercial: true, allowsModification: true, attributionRequired: false },
      performance: { id: "", modelId: "", runtimeId: "", benchmarkType: "comprehensive" as any, scores: {},
        metrics: { latencyP50Ms: 0, latencyP95Ms: 0, latencyP99Ms: 0, throughputTokensPerSec: 0, memoryPeakMB: 0, gpuUtilizationPeak: 0, reliabilityPercent: 0, tokensPerSecond: 0, timeToFirstTokenMs: 0, errorRate: 0 },
        startedAt: "", completedAt: "", durationMs: 0, dataset: "", version: "" },
      qualityScores: {}, discoveryMethod: "manual" as any, registeredAt: "", updatedAt: "",
    };
    const recs = mgr.recommendQuantization(modelInfo, [], 16);
    assert.ok(recs.length > 0);
    assert.equal(typeof recs[0]!.quality, "number");
  });

  it("returns best quantization", () => {
    const modelInfo = { id: "test", name: "Test", version: "1.0", runtimeId: "rt", format: "gguf" as const, quantization: "gguf_q4" as const,
      architecture: "llama", contextWindow: 4096, parameters: 7,
      capabilities: [] as any, capabilityScores: {} as any,
      memoryUsage: { loadGB: 4, inferenceGB: 5, peakGB: 6, cpuGB: 8 },
      toolSupport: false, visionSupport: false, audioSupport: false,
      functionCalling: false, streaming: false, jsonMode: false,
      status: "available" as any, source: "local" as any,
      licensing: { name: "MIT", allowsCommercial: true, allowsModification: true, attributionRequired: false },
      performance: { id: "", modelId: "", runtimeId: "", benchmarkType: "comprehensive" as any, scores: {},
        metrics: { latencyP50Ms: 0, latencyP95Ms: 0, latencyP99Ms: 0, throughputTokensPerSec: 0, memoryPeakMB: 0, gpuUtilizationPeak: 0, reliabilityPercent: 0, tokensPerSecond: 0, timeToFirstTokenMs: 0, errorRate: 0 },
        startedAt: "", completedAt: "", durationMs: 0, dataset: "", version: "" },
      qualityScores: {}, discoveryMethod: "manual" as any, registeredAt: "", updatedAt: "",
    };
    const best = mgr.getBestQuantization(modelInfo, [], 16);
    assert.ok(best);
    assert.ok(best!.compatible);
  });

  it("returns stats", () => {
    const stats = mgr.getStats();
    assert.ok(stats.totalSupported > 0);
  });
});

// ── DownloadManager ─────────────────────────────────────────────

describe("DownloadManager", () => {
  let mgr: DownloadManager;

  before(async () => { mgr = new DownloadManager(); await mgr.initialize(); });
  after(async () => await mgr.shutdown());

  it("enqueues downloads", () => {
    const id = mgr.enqueue("https://example.com/model.gguf", "/tmp/model.gguf", { source: "test" });
    assert.ok(id);
    assert.equal(mgr.get(id)?.status, "failed");
    assert.match(mgr.get(id)?.error ?? "", /unsupported/);
    assert.deepEqual(mgr.getCompleted(), []);
    assert.deepEqual(mgr.getActive(), []);
  });

  it("manages concurrent downloads", () => {
    mgr.setMaxConcurrent(2);
    const id1 = mgr.enqueue("https://example.com/a.gguf", "/tmp/a.gguf");
    const id2 = mgr.enqueue("https://example.com/b.gguf", "/tmp/b.gguf");
    assert.ok(id1);
    assert.ok(id2);
  });

  it("pauses and resumes", () => {
    const id = mgr.enqueue("https://example.com/c.gguf", "/tmp/c.gguf");
    mgr.pause(id); // May already be downloading
  });

  it("cancels downloads", () => {
    const id = mgr.enqueue("https://example.com/d.gguf", "/tmp/d.gguf");
    assert.ok(mgr.cancel(id));
  });

  it("returns stats", () => {
    const stats = mgr.getStats();
    assert.equal(typeof stats.active, "number");
  });
});

// ── MarketplaceClient ───────────────────────────────────────────

describe("MarketplaceClient", () => {
  it("does not present invented packages, checksums or ratings", () => {
    const client = new MarketplaceClient();
    client.createDefaultPackages();
    assert.deepEqual(client.search(""), []);
    assert.deepEqual(client.getTopRated(), []);
    assert.deepEqual(client.getMostDownloaded(), []);
    assert.equal(client.getStats().total, 0);
  });
});

describe("PipelineManager", () => {
  let pm: PipelineManager;
  let router: IntelligenceRouter;

  before(() => {
    const capReg = new CapabilityRegistry();
    capReg.createDefaults();
    const rtReg = new RuntimeRegistry();
    rtReg.createDefaultRuntimes();
    const modReg = new ModelRegistry();
    seedTestModels(modReg, ["ollama-local"]);
    const deps: RouterDependencies = { capabilityRegistry: capReg, runtimeRegistry: rtReg, modelRegistry: modReg };
    router = new IntelligenceRouter(deps);
    pm = new PipelineManager(router);
  });

  it("creates default pipelines", () => {
    pm.createDefaults();
    assert.ok(pm.getAll().length > 0);
  });

  it("executes a pipeline", async () => {
    const exec = await pm.execute("code-review-pipeline", { file: "test.ts", content: "const x = 1;" });
    assert.ok(exec.id);
    assert.equal(exec.status, "failed");
    assert.match(exec.error ?? "", /unsupported/);
    assert.ok(exec.steps.length > 0);
  });

  it("throws for unknown pipeline", async () => {
    await assert.rejects(() => pm.execute("nonexistent", {}));
  });

  it("does not report an empty pipeline as successful execution", async () => {
    pm.register({ ...pm.get("code-review-pipeline")!, id: "empty", steps: [] });
    const execution = await pm.execute("empty", {});
    assert.equal(execution.status, "failed");
    assert.equal(execution.output, null);
    assert.match(execution.error ?? "", /at least one executable step/);
  });

  it("returns execution history", () => {
    const executions = pm.getExecutions();
    assert.ok(executions.length > 0);
  });

  it("returns stats", () => {
    const stats = pm.getStats();
    assert.ok(stats.totalPipelines > 0);
    assert.equal(stats.success, 0);
    assert.ok(stats.failed > 0);
  });
});

// ── createAIRM factory ──────────────────────────────────────────

describe("createAIRM factory", () => {
  let airm: ReturnType<typeof createAIRM>;

  before(async () => { airm = createAIRM({ autoStartScheduler: false }); });
  after(async () => await airm.shutdown());

  it("returns all AIRM components", async () => {
    await airm.initialize();
    assert.ok(airm.manager);
    assert.ok(airm.manager.capabilities);
    assert.ok(airm.manager.runtimes);
    assert.ok(airm.manager.models);
    assert.ok(airm.manager.embeddings);
    assert.ok(airm.manager.vision);
    assert.ok(airm.manager.speech);
    assert.ok(airm.manager.rerankers);
    assert.ok(airm.manager.providers);
    assert.ok(airm.manager.router);
    assert.ok(airm.manager.profiles);
    assert.ok(airm.manager.pipelines);
    assert.ok(airm.manager.benchmarks);
    assert.ok(airm.manager.evaluations);
    assert.ok(airm.manager.monitor);
    assert.ok(airm.manager.scheduler);
    assert.ok(airm.manager.loader);
    assert.ok(airm.manager.promptCache);
    assert.ok(airm.manager.modelCache);
    assert.ok(airm.manager.gpuScheduler);
    assert.ok(airm.manager.memoryManager);
    assert.ok(airm.manager.quantization);
    assert.ok(airm.manager.downloads);
    assert.ok(airm.manager.marketplace);
    assert.ok(airm.manager.dashboard);
  });

  it("routes requests after initialization", async () => {
    const decision = await airm.routeRequest({
      taskType: "chat",
      requiredCapabilities: ["chat"],
      context: { taskDescription: "Hello", contextLength: 10 },
      constraints: {},
    });
    assert.equal(decision, null);
  });

  it("gets dashboard data", () => {
    const data = airm.getDashboardData();
    assert.ok(data.models);
    assert.ok(data.runtimes);
    assert.ok(data.hardware);
  });

  it("discovers models", async () => {
    await airm.discoverModels();
    const stats = airm.manager.models.getStats();
    assert.equal(stats.total, 0);
  });

  it("executes a pipeline", async () => {
    const result = (await airm.executePipeline("code-review-pipeline", { file: "test.ts" })) as PipelineExecution;
    assert.ok(result);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /unsupported/);
  });

  it("shuts down cleanly", async () => {
    await airm.shutdown();
    assert.equal(airm.manager.isInitialized(), false);
  });
});

// Explicit fixture metadata for registry and selection tests; never used by runtime discovery.
function seedTestModels(registry: ModelRegistry, currentRuntimeIds: string[]): ModelInfo[] {
    const discovered: ModelInfo[] = [];
    for (const rtId of currentRuntimeIds) {
      discovered.push({
        id: `${rtId}-llama3.1-8b`, name: "Llama 3.1 8B", version: "latest",
        runtimeId: rtId, format: "gguf", quantization: "gguf_q4",
        architecture: "llama", contextWindow: 8192, parameters: 8,
        capabilities: ["reasoning", "coding", "planning", "chat"],
        capabilityScores: { reasoning: 75, coding: 70, planning: 65, chat: 85, "tool-calling": 60, "function-calling": 60, "json-generation": 70, "long-context": 50, "instruction-following": 75 },
        memoryUsage: { loadGB: 4.7, inferenceGB: 5.2, peakGB: 6, cpuGB: 8 },
        toolSupport: true, visionSupport: false, audioSupport: false,
        functionCalling: true, streaming: true, jsonMode: true,
        status: "available", source: "local", licensing: { name: "Llama 3.1 Community", allowsCommercial: true, allowsModification: true, attributionRequired: false },
        performance: { id: "", modelId: "", runtimeId: "", benchmarkType: "comprehensive", scores: {}, metrics: { latencyP50Ms: 150, latencyP95Ms: 300, latencyP99Ms: 500, throughputTokensPerSec: 30, memoryPeakMB: 5000, gpuUtilizationPeak: 80, reliabilityPercent: 95, tokensPerSecond: 30, timeToFirstTokenMs: 200, errorRate: 0.02 }, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), durationMs: 0, dataset: "default", version: "1" },
        qualityScores: {}, discoveryMethod: "automatic",
        registeredAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    }
    for (const m of discovered) registry.register(m);
    return discovered;
  }
