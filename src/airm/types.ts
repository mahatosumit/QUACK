import { type IsoTimestamp } from "../core/types.js";

// ── Capability System ───────────────────────────────────────────

export type AiCapability =
  | "reasoning" | "coding" | "planning" | "architecture"
  | "vision" | "ocr" | "speech-recognition" | "speech-synthesis"
  | "embeddings" | "reranking" | "summarization" | "translation"
  | "mathematics" | "scientific" | "tool-calling" | "function-calling"
  | "json-generation" | "long-context" | "multimodal" | "code-execution"
  | "chat" | "instruction-following" | "roleplay" | "creative-writing"
  | "data-analysis" | "search" | "memory" | "computer-use";

export interface CapabilityDefinition {
  id: string;
  name: AiCapability;
  description: string;
  category: CapabilityCategory;
  minScore?: number;
  dependencies?: string[];
}

export type CapabilityCategory =
  | "reasoning" | "perception" | "generation" | "analysis"
  | "interaction" | "memory" | "execution" | "custom";

// ── Runtime System ──────────────────────────────────────────────

export type RuntimeType =
  | "ollama" | "llamacpp" | "vllm" | "lmstudio"
  | "tensorrt-llm" | "onnx" | "openvino"
  | "mlx" | "huggingface" | "openai-compatible"
  | "cloud" | "custom";

export type ModelFormat =
  | "gguf" | "safetensors" | "onnx" | "tensorrt"
  | "mlx" | "pt" | "bin" | "h5" | "custom";

export type Quantization =
  | "fp16" | "bf16" | "int8" | "int4"
  | "gguf_q2" | "gguf_q3" | "gguf_q4" | "gguf_q5" | "gguf_q6" | "gguf_q8"
  | "gptq" | "awq" | "exl2"
  | "none";

export interface RuntimeInfo {
  id: string;
  name: string;
  type: RuntimeType;
  version: string;
  status: RuntimeStatus;
  endpoint?: string;
  capabilities: AiCapability[];
  supportedFormats: ModelFormat[];
  hardwareRequirements: HardwareRequirements;
  platformSupport: string[];
  health: HealthStatus;
  latency: number;
  availability: number;
  lastSeen: IsoTimestamp;
  config: Record<string, unknown>;
}

export type RuntimeStatus = "ready" | "loading" | "error" | "unavailable" | "updating";
export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface HardwareRequirements {
  minVRAMGB: number;
  minRAMGB: number;
  recommendedVRAMGB?: number;
  gpuRequired: boolean;
  supportedGpus: string[];
  minDiskGB?: number;
}

// ── Model System ────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  version: string;
  runtimeId: string;
  format: ModelFormat;
  quantization: Quantization;
  architecture: string;
  contextWindow: number;
  parameters: number;
  capabilities: AiCapability[];
  capabilityScores: Partial<Record<AiCapability, number>>;
  memoryUsage: ModelMemoryUsage;
  toolSupport: boolean;
  visionSupport: boolean;
  audioSupport: boolean;
  functionCalling: boolean;
  streaming: boolean;
  jsonMode: boolean;
  status: ModelStatus;
  source: ModelSource;
  licensing: ModelLicense;
  performance: BenchmarkResult;
  qualityScores: Record<string, number>;
  discoveryMethod: DiscoveryMethod;
  registeredAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface ModelMemoryUsage {
  loadGB: number;
  inferenceGB: number;
  peakGB: number;
  cpuGB: number;
}

export type ModelStatus = "available" | "loading" | "loaded" | "error" | "unavailable" | "downloading";
export type ModelSource = "cloud" | "local" | "marketplace" | "enterprise" | "custom";
export type DiscoveryMethod = "automatic" | "manual" | "marketplace" | "import";

export interface ModelLicense {
  name: string;
  url?: string;
  allowsCommercial: boolean;
  allowsModification: boolean;
  attributionRequired: boolean;
}

export interface ModelSearchQuery {
  capabilities?: AiCapability[];
  minContextWindow?: number;
  maxParameters?: number;
  formats?: ModelFormat[];
  runtimes?: RuntimeType[];
  quantizations?: Quantization[];
  minToolSupport?: boolean;
  minVisionSupport?: boolean;
  minStreaming?: boolean;
  offlineAvailable?: boolean;
  maxCostPerToken?: number;
}

// ── Routing ─────────────────────────────────────────────────────

export interface RoutingRequest {
  taskType: AiCapability;
  requiredCapabilities: AiCapability[];
  context: RoutingContext;
  constraints: RoutingConstraints;
  preferences?: RoutingPreferences;
}

export interface RoutingContext {
  taskDescription: string;
  contextLength: number;
  workspaceSize?: number;
  repoSize?: number;
  inputTokens?: number;
  outputTokens?: number;
  sessionId?: string;
  userId?: string;
  profileId?: string;
}

export interface RoutingConstraints {
  maxLatency?: number;
  maxCost?: number;
  minReliability?: number;
  offlineRequired?: boolean;
  securityLevel?: SecurityLevel;
  gpuRequired?: boolean;
  minVRAMGB?: number;
  maxVRAMGB?: number;
}

export interface RoutingPreferences {
  preferredRuntimes?: RuntimeType[];
  preferredFormats?: ModelFormat[];
  preferredQuantizations?: Quantization[];
  avoidRuntimes?: RuntimeType[];
  costWeight?: number;
  latencyWeight?: number;
  qualityWeight?: number;
}

export type SecurityLevel = "none" | "basic" | "elevated" | "maximum";

export interface RoutingDecision {
  modelId: string;
  runtimeId: string;
  score: number;
  breakdown: RoutingBreakdown;
  alternatives: { modelId: string; score: number }[];
}

export interface RoutingBreakdown {
  capabilityScore: number;
  latencyScore: number;
  costScore: number;
  reliabilityScore: number;
  hardwareScore: number;
  preferenceScore: number;
  historicalScore: number;
}

// ── Profiles ────────────────────────────────────────────────────

export type ProfileType =
  | "coding" | "architecture" | "research" | "offline"
  | "robotics" | "computer-use" | "scientific-writing"
  | "security-review" | "performance-analysis"
  | "enterprise" | "education" | "general";

export interface RuntimeProfile {
  id: string;
  name: string;
  type: ProfileType;
  description: string;
  preferredCapabilities: { capability: AiCapability; minScore: number }[];
  fallbackCapabilities: AiCapability[];
  preferredRuntimes: RuntimeType[];
  executionPolicy: ExecutionPolicy;
  costLimits: CostLimits;
  latencyTargets: LatencyTargets;
  securityRequirements: SecurityLevel;
  isDefault: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface ExecutionPolicy {
  maxRetries: number;
  timeoutMs: number;
  streamingAllowed: boolean;
  parallelAllowed: boolean;
  fallbackAllowed: boolean;
  requireVerification: boolean;
  requireHumanApproval: boolean;
}

export interface CostLimits {
  maxPerRequest: number;
  maxPerSession: number;
  maxPerDay: number;
  currency: string;
}

export interface LatencyTargets {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

// ── Pipelines ───────────────────────────────────────────────────

export interface PipelineDefinition {
  id: string;
  name: string;
  description: string;
  steps: PipelineStep[];
  version: string;
  tags: string[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface PipelineStep {
  id: string;
  type: PipelineStepType;
  modelCapability: AiCapability;
  input?: string;
  config: Record<string, unknown>;
  retryPolicy?: { maxRetries: number; backoffMs: number };
  timeoutMs?: number;
}

export type PipelineStepType =
  | "planner" | "retriever" | "embedding" | "reranker"
  | "reasoning" | "verifier" | "reviewer" | "vision"
  | "ocr" | "speech-recognition" | "speech-synthesis"
  | "code-execution" | "search" | "memory-update"
  | "tool-call" | "transformer" | "filter" | "router" | "custom";

export interface PipelineExecution {
  id: string;
  pipelineId: string;
  status: ExecutionStatus;
  currentStep: number;
  steps: PipelineStepExecution[];
  input: unknown;
  output: unknown;
  startedAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
  error?: string;
}

export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface PipelineStepExecution {
  stepId: string;
  status: ExecutionStatus;
  modelId?: string;
  input: unknown;
  output: unknown;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  latencyMs?: number;
  error?: string;
  tokensUsed?: number;
}

// ── Benchmark System ────────────────────────────────────────────

export interface BenchmarkResult {
  id: string;
  modelId: string;
  runtimeId: string;
  benchmarkType: BenchmarkType;
  scores: Record<string, number>;
  metrics: BenchmarkMetrics;
  startedAt: IsoTimestamp;
  completedAt: IsoTimestamp;
  durationMs: number;
  dataset: string;
  version: string;
}

export type BenchmarkType =
  | "coding" | "reasoning" | "planning" | "vision"
  | "tool-use" | "latency" | "throughput" | "memory"
  | "context" | "reliability" | "streaming" | "json"
  | "comprehensive";

export interface BenchmarkMetrics {
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  throughputTokensPerSec: number;
  memoryPeakMB: number;
  gpuUtilizationPeak: number;
  reliabilityPercent: number;
  tokensPerSecond: number;
  timeToFirstTokenMs: number;
  errorRate: number;
}

// ── Evaluation System ───────────────────────────────────────────

export interface EvaluationRecord {
  id: string;
  modelId: string;
  runtimeId: string;
  taskType: AiCapability;
  success: boolean;
  metrics: ExecutionMetrics;
  input: unknown;
  output: unknown;
  expectedOutput?: unknown;
  error?: string;
  userFeedback?: UserFeedback;
  timestamp: IsoTimestamp;
}

export interface ExecutionMetrics {
  latencyMs: number;
  tokensUsed: number;
  tokensInput: number;
  tokensOutput: number;
  cost: number;
  retries: number;
  corrections: number;
  memoryUsedMB: number;
  gpuUtilization: number;
}

export interface UserFeedback {
  rating: number;
  accepted: boolean;
  corrected?: boolean;
  comment?: string;
}

// ── Cache System ────────────────────────────────────────────────

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  size?: number;
  hits: number;
  createdAt: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  lastAccessed: IsoTimestamp;
  metadata: Record<string, unknown>;
}

export interface CacheConfig {
  maxEntries: number;
  maxSizeMB?: number;
  defaultTTLMs?: number;
  evictionPolicy: "lru" | "lfu" | "fifo" | "ttl";
}

// ── GPU & Memory System ─────────────────────────────────────────

export interface GpuInfo {
  id: string;
  name: string;
  totalVRAMMB: number;
  freeVRAMMB: number;
  utilization: number;
  temperature?: number;
  computeCapability?: string;
  processes: GpuProcess[];
}

export interface GpuProcess {
  pid: number;
  name: string;
  usedVRAMMB: number;
  modelId?: string;
}

export interface MemoryState {
  totalRAMGB: number;
  freeRAMGB: number;
  usedRAMGB: number;
  totalVRAMGB: number;
  freeVRAMGB: number;
  usedVRAMGB: number;
  swapUsedGB: number;
  swapTotalGB: number;
}

// ── Download System ─────────────────────────────────────────────

export type DownloadStatus = "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";

export interface DownloadTask {
  id: string;
  url: string;
  destination: string;
  status: DownloadStatus;
  progress: number;
  totalBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  checksum?: string;
  checksumAlgorithm?: string;
  metadata: Record<string, unknown>;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  error?: string;
}

// ── Marketplace ─────────────────────────────────────────────────

export interface MarketplacePackage {
  id: string;
  name: string;
  version: string;
  type: MarketplacePackageType;
  description: string;
  author: string;
  publisher: string;
  signature?: string;
  checksum: string;
  sizeBytes: number;
  ratings: number;
  downloads: number;
  tags: string[];
  requirements: HardwareRequirements;
  license: ModelLicense;
  screenshots: string[];
  documentation: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type MarketplacePackageType =
  | "model" | "embedding" | "vision-model" | "speech-model"
  | "reranker" | "prompt-template" | "runtime-plugin"
  | "pipeline" | "expert-pack" | "profile";

// ── Provider System ─────────────────────────────────────────────

export interface AiProviderInfo {
  id: string;
  name: string;
  type: "cloud" | "local" | "hybrid";
  status: ProviderStatus;
  capabilities: AiCapability[];
  models: string[];
  endpoints: string[];
  config: Record<string, unknown>;
  health: HealthStatus;
  latency: number;
  costPerToken: number;
}

export type ProviderStatus = "active" | "inactive" | "error" | "limited";

// ── Specialized Registries ──────────────────────────────────────

export type EmbeddingModelInfo = ModelInfo & {
  dimensions: number;
  maxInputTokens: number;
  similarityMetric: "cosine" | "dot" | "euclidean";
};

export type VisionModelInfo = ModelInfo & {
  supportedImageFormats: string[];
  maxImageSize: number;
  objectDetection: boolean;
  faceDetection: boolean;
  ocrSupport: boolean;
};

export type SpeechModelInfo = ModelInfo & {
  sampleRate: number;
  languages: string[];
  voiceCloning: boolean;
  realtimeSupport: boolean;
};

export type RerankerModelInfo = ModelInfo & {
  maxInputTokens: number;
  maxDocuments: number;
};

// ── Monitor System ──────────────────────────────────────────────

export interface RuntimeMonitorSnapshot {
  timestamp: IsoTimestamp;
  runtimes: RuntimeHealthEntry[];
  models: ModelHealthEntry[];
  gpus: GpuHealthEntry[];
  cache: { promptCache: number; modelCache: number };
  downloads: { active: number; queued: number; completed: number };
  pipelines: { running: number; queued: number };
  memory: MemoryState;
  errors: { lastError?: string; errorCount: number };
}

export interface RuntimeHealthEntry {
  runtimeId: string;
  status: RuntimeStatus;
  health: HealthStatus;
  uptime: number;
  latency: number;
  lastError?: string;
}

export interface ModelHealthEntry {
  modelId: string;
  loaded: boolean;
  memoryMB: number;
  tokensProcessed: number;
  errorRate: number;
}

export interface GpuHealthEntry {
  id: string;
  name: string;
  utilization: number;
  temperature?: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  processes: number;
}

// ── Runtime Scheduler ───────────────────────────────────────────

export interface ScheduledTask {
  id: string;
  type: "load-model" | "unload-model" | "benchmark" | "health-check" | "download" | "custom";
  targetId: string;
  priority: number;
  status: "pending" | "running" | "completed" | "failed";
  scheduledAt: IsoTimestamp;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  error?: string;
}

// ── Dashboard ───────────────────────────────────────────────────

export interface DashboardData {
  models: { total: number; loaded: number; downloading: number; errored: number };
  runtimes: { total: number; active: number; errored: number };
  pipelines: { total: number; running: number; success: number; failed: number };
  hardware: { gpuUtilization: number | null; cpuUtilization: number | null; memoryUtilization: number | null; vramUtilization: number | null };
  benchmarks: { total: number; averageScore: number; lastRun?: IsoTimestamp };
  downloads: { active: number; queued: number; speedBytesPerSec: number };
  recentActivity: DashboardActivity[];
}

export interface DashboardActivity {
  timestamp: IsoTimestamp;
  type: "model-loaded" | "model-downloaded" | "benchmark-completed" | "pipeline-completed" | "error" | "runtime-status";
  message: string;
  severity: "info" | "warning" | "error";
}
