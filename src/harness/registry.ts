/**
 * QUACK Harness Provider Registry
 * 
 * Multiple harness implementations must coexist.
 * Selection is based on task type, required tools, subagent capability,
 * workspace needs, checkpoint/resume needs, security, health,
 * historical performance, owner preference, cost, availability.
 */

import { createId, type JsonObject } from "../core/types.js";
import { type EventBus } from "../events/event-bus.js";
import {
  type Harness,
  type HarnessProviderEntry,
  type HarnessFactory,
  type HarnessRegistry,
  type HarnessSelectionCriteria,
  type HarnessSelectionResult,
  type HarnessConfig,
  type HarnessMetadata,
  type HarnessCapabilities,
  type HarnessHealth,
  type HarnessCertification,
  type HarnessStatus,
  type HarnessTaskInput,
  type HarnessExecutionContext,
  type HarnessTaskOutput,
  type HarnessCheckpoint,
  type SubagentSpawnOptions,
  type SubagentReport,
  type BackgroundJob,
  type BackgroundJobStatus,
  type CapabilitySupport,
} from "./contract.js";

export type { HarnessRegistry };

/** Default capability set for unknown harnesses */
const DEFAULT_CAPABILITIES: HarnessCapabilities = {
  tools: "UNSUPPORTED",
  mcp: "UNSUPPORTED",
  subagents: "UNSUPPORTED",
  continuableSubagents: "UNSUPPORTED",
  streaming: "UNSUPPORTED",
  structuredOutput: "UNSUPPORTED",
  checkpoint: "UNSUPPORTED",
  resume: "UNSUPPORTED",
  interrupt: "UNSUPPORTED",
  workspace: "UNSUPPORTED",
  isolatedEnvironment: "UNSUPPORTED",
  backgroundJobs: "UNSUPPORTED",
  humanApproval: "UNSUPPORTED",
};

/** In-memory harness registry implementation */
export class DefaultHarnessRegistry implements HarnessRegistry {
  private readonly providers = new Map<string, HarnessProviderEntry>();
  private readonly healthCache = new Map<string, { health: HarnessHealth; timestamp: number }>();
  private readonly HEALTH_CACHE_TTL_MS = 60_000;
  private readonly eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  register(entry: HarnessProviderEntry): void {
    if (this.providers.has(entry.id)) {
      throw new Error(`Harness ${entry.id} already registered`);
    }
    this.providers.set(entry.id, { ...entry, certification: "H0_DETECTED" });
    this.emit("harness.registered", { harnessId: entry.id, name: entry.metadata.name });
  }

  unregister(harnessId: string): boolean {
    const removed = this.providers.delete(harnessId);
    this.healthCache.delete(harnessId);
    if (removed) {
      this.emit("harness.unregistered", { harnessId });
    }
    return removed;
  }

  get(harnessId: string): HarnessProviderEntry | undefined {
    return this.providers.get(harnessId);
  }

  list(): readonly HarnessProviderEntry[] {
    return Array.from(this.providers.values());
  }

  select(criteria: HarnessSelectionCriteria): HarnessSelectionResult {
    const candidates = Array.from(this.providers.values())
      .filter((entry) => this.matchesCriteria(entry, criteria))
      .sort((a, b) => {
        // Sort by priority (higher first), then by certification level
        const priorityDiff = b.priority - a.priority;
        if (priorityDiff !== 0) return priorityDiff;
        return this.certificationRank(b.certification) - this.certificationRank(a.certification);
      });

    if (candidates.length === 0) {
      return {
        harnessId: "none",
        reason: "No harness matches the selection criteria",
        alternatives: [],
      };
    }

    const selected = candidates[0];
    const alternatives = candidates.slice(1).map((c) => ({
      harnessId: c.id,
      reason: `Alternative: ${c.metadata.name} (certification: ${c.certification})`,
    }));

    return {
      harnessId: selected.id,
      reason: `Selected ${selected.metadata.name} (priority: ${selected.priority}, certification: ${selected.certification})`,
      alternatives,
    };
  }

  private matchesCriteria(entry: HarnessProviderEntry, criteria: HarnessSelectionCriteria): boolean {
    // Health check
    if (criteria.healthRequirement) {
      const cached = this.healthCache.get(entry.id);
      const health = cached && Date.now() - cached.timestamp < this.HEALTH_CACHE_TTL_MS
        ? cached.health
        : "UNKNOWN";
      if (health !== "HEALTHY" && health !== criteria.healthRequirement) {
        return false;
      }
    }

    // Required capabilities
    if (criteria.requiredCapabilities) {
      for (const cap of criteria.requiredCapabilities) {
        const support = this.getCapabilitySupport(entry, cap);
        if (support === "UNSUPPORTED") return false;
      }
    }

    // Subagent capability
    if (criteria.subagentCapability && entry.metadata.capabilities.subagents === "UNSUPPORTED") {
      return false;
    }

    // Workspace needs
    if (criteria.workspaceNeeds === "isolated" && entry.metadata.capabilities.workspace !== "NATIVE") {
      return false;
    }

    // Checkpoint/resume needs
    if (criteria.checkpointResumeNeeds && 
        (entry.metadata.capabilities.checkpoint !== "NATIVE" || entry.metadata.capabilities.resume !== "NATIVE")) {
      return false;
    }

    // Security level (higher security requires higher certification)
    if (criteria.securityLevel === "high" && this.certificationRank(entry.certification) < this.certificationRank("H4_DURABLE")) {
      return false;
    }

    // Owner preference
    if (criteria.ownerPreference && entry.id !== criteria.ownerPreference) {
      // Don't filter out, just deprioritize (handled in sort)
    }

    // Cost limit - would need historical data
    // Availability - would need health check

    return true;
  }

  private getCapabilitySupport(entry: HarnessProviderEntry, capability: keyof HarnessCapabilities): CapabilitySupport {
    const caps = entry.metadata.capabilities;
    return caps[capability] ?? "UNSUPPORTED";
  }

  private certificationRank(cert: HarnessCertification): number {
    const ranks: Record<HarnessCertification, number> = {
      "H0_DETECTED": 0,
      "H1_BASIC": 1,
      "H2_TOOLS": 2,
      "H3_CONTROL": 3,
      "H4_DURABLE": 4,
      "H5_SUBAGENTS": 5,
      "H6_PRODUCTION_CERTIFIED": 6,
    };
    return ranks[cert] ?? 0;
  }

  async getHealth(harnessId: string): Promise<HarnessHealth> {
    const entry = this.providers.get(harnessId);
    if (!entry) return "UNKNOWN";

    const cached = this.healthCache.get(harnessId);
    if (cached && Date.now() - cached.timestamp < this.HEALTH_CACHE_TTL_MS) {
      return cached.health;
    }

    try {
      const health = await entry.healthCheck();
      this.healthCache.set(harnessId, { health, timestamp: Date.now() });
      return health;
    } catch {
      const health: HarnessHealth = "UNHEALTHY";
      this.healthCache.set(harnessId, { health, timestamp: Date.now() });
      return health;
    }
  }

  async checkAllHealth(): Promise<Map<string, HarnessHealth>> {
    const results = new Map<string, HarnessHealth>();
    for (const [id, entry] of this.providers) {
      try {
        const health = await entry.healthCheck();
        this.healthCache.set(id, { health, timestamp: Date.now() });
        results.set(id, health);
      } catch {
        this.healthCache.set(id, { health: "UNHEALTHY", timestamp: Date.now() });
        results.set(id, "UNHEALTHY");
      }
    }
    return results;
  }

  async certify(harnessId: string, level: HarnessCertification): Promise<boolean> {
    const entry = this.providers.get(harnessId);
    if (!entry) return false;

    // Registration is detection, not independent execution certification.
    return level === "H0_DETECTED";
  }

  getCertification(harnessId: string): HarnessCertification {
    return this.providers.get(harnessId)?.certification ?? "H0_DETECTED";
  }

  private emit(type: string, payload: JsonObject): void {
    if (this.eventBus) {
      this.eventBus.emit(type as any, payload).catch(() => {});
    }
  }
}

/**
 * QUACK Native Harness Implementation
 * Uses the existing QUACK execution infrastructure
 */
export class QuackNativeHarness implements Harness {
  private started = false;
  private readonly startTime = Date.now();
  private readonly activeRuns = new Set<string>();
  private readonly results = new Map<string, HarnessTaskOutput>();

  constructor(
    private readonly system: { readonly runtime: Pick<import("../runtime/runtime.js").QuackRuntime, "executeTool"> },
    private readonly config: HarnessConfig,
  ) {}

  metadata(): HarnessMetadata {
    return {
      id: "QUACK_NATIVE", name: "QUACK Native Harness", version: "1.0.0",
      description: "Executes explicit tool invocations through QUACK runtime policy.",
      vendor: "QUACK OS", license: "MIT",
      capabilities: { ...DEFAULT_CAPABILITIES, tools: "NATIVE", streaming: "EMULATED" },
      minQuackVersion: "1.0.0", platforms: ["win32", "linux", "darwin"],
      requiredEnvVars: [], optionalEnvVars: [],
    };
  }
  async health(): Promise<HarnessHealth> { return this.started ? "HEALTHY" : "UNKNOWN"; }
  async status(): Promise<HarnessStatus> {
    return {
      id: "QUACK_NATIVE", health: await this.health(), certification: this.certification(),
      lastHealthCheck: new Date().toISOString(), activeExecutions: this.activeRuns.size,
      uptimeMs: Date.now() - this.startTime,
    };
  }
  capabilities(): HarnessCapabilities { return this.metadata().capabilities; }
  certification(): HarnessCertification { return "H0_DETECTED"; }
  async start(_config: HarnessConfig): Promise<void> { this.started = true; }

  async send(input: HarnessTaskInput, context: HarnessExecutionContext): Promise<HarnessTaskOutput> {
    const startedAt = Date.now();
    const key = `${context.missionId}:${context.runId}`;
    if (this.activeRuns.has(key)) throw new Error("Harness run is already executing.");
    const toolCalls: { toolId: string; input: JsonObject; output?: JsonObject; error?: string; success: boolean }[] = [];
    const evidence: HarnessTaskOutput["evidence"][number][] = [];
    let error: string | undefined;
    this.activeRuns.add(key);
    try {
      if (!this.started) throw new Error("Harness has not been started.");
      if (this.config.timeoutMs !== undefined) {
        if (!Number.isFinite(this.config.timeoutMs) || this.config.timeoutMs < 0) throw new Error("Invalid harness timeout.");
        const requested = context.deadline ? Date.parse(context.deadline) : Infinity;
        if (Number.isNaN(requested)) throw new Error("Tool execution deadline is invalid.");
        context = { ...context, deadline: new Date(Math.min(requested, startedAt + this.config.timeoutMs)).toISOString() };
      }
      if (!input.toolInvocations?.length) throw new Error("Explicit planned toolInvocations are required; goal execution is unsupported.");
      const unsupportedCapability = input.requiredCapabilities?.find((capability) =>
        capability in this.capabilities() && this.capabilities()[capability as keyof HarnessCapabilities] === "UNSUPPORTED");
      if (unsupportedCapability) throw new Error(`Harness capability ${unsupportedCapability} is unsupported.`);
      for (const invocation of input.toolInvocations) {
        if (context.signal?.aborted) throw new Error("Tool execution cancelled before dispatch.");
        if (context.deadline && (!Number.isFinite(Date.parse(context.deadline)) || Date.now() >= Date.parse(context.deadline))) throw new Error("Tool execution deadline expired or invalid.");
        if (!invocation.toolId || !invocation.input || typeof invocation.input !== "object" || Array.isArray(invocation.input)) {
          throw new Error("Each planned invocation requires a toolId and JSON object input.");
        }
        const result = await this.system.runtime.executeTool(invocation.toolId, invocation.input, {
          taskId: context.iterationId, actor: context.actor, agentId: context.actor, missionId: context.missionId,
          signal: context.signal, deadline: context.deadline,
        });
        const call = result.ok
          ? { toolId: invocation.toolId, input: invocation.input, output: result.data, success: true }
          : { toolId: invocation.toolId, input: invocation.input, error: result.error.message, success: false };
        toolCalls.push(call);
        if (!result.ok) { error = result.error.message; break; }
        evidence.push({
          id: createId("evidence"), type: "tool_result", source: invocation.toolId,
          trustClass: "TRUSTED_TOOL", timestamp: new Date().toISOString(), missionId: context.missionId,
          agentId: context.actor, content: { toolId: invocation.toolId, input: invocation.input, output: result.data }, references: [],
        });
      }
      if (context.signal?.aborted) error = "Execution cancelled; completed tool effects may remain.";
      if (context.deadline && Date.now() >= Date.parse(context.deadline)) error = "Execution deadline expired; completed tool effects may remain.";
    } catch (failure) {
      error = failure instanceof Error ? failure.message : "Tool execution failed.";
    } finally {
      this.activeRuns.delete(key);
    }
    const success = !error && toolCalls.length > 0 && toolCalls.every((call) => call.success);
    const output: HarnessTaskOutput = {
      success, error, result: { toolCalls: toolCalls.map((call) => ({
        toolId: call.toolId, input: call.input, output: call.output ?? null,
        error: call.error ?? null, success: call.success,
      })), goalVerified: false }, evidence, artifacts: [],
      metrics: {
        durationMs: Date.now() - startedAt, tokensUsed: { input: 0, output: 0, total: 0 },
        costUsd: 0, toolCalls: toolCalls.length, subagentSpawns: 0, retries: 0,
        checkpointCount: 0, modelCalls: 0,
      },
    };
    this.results.set(key, output);
    return output;
  }
  async *stream(input: HarnessTaskInput, context: HarnessExecutionContext): AsyncIterable<HarnessTaskOutput> {
    yield await this.send(input, context);
  }
  async checkpoint(_missionId: string, _runId: string): Promise<HarnessCheckpoint> { throw unsupported("checkpoint"); }
  async resume(_checkpoint: HarnessCheckpoint): Promise<void> { throw unsupported("resume"); }
  async pause(_missionId: string): Promise<void> { throw unsupported("pause"); }
  async cancel(_missionId: string, _runId?: string): Promise<void> { throw unsupported("cancel"); }
  async interrupt(_missionId: string, _runId: string): Promise<void> { throw unsupported("interrupt"); }
  async getStatus(missionId: string, runId?: string): Promise<HarnessTaskOutput | undefined> {
    return runId ? this.results.get(`${missionId}:${runId}`) : undefined;
  }
  async spawnSubagent(_options: SubagentSpawnOptions): Promise<SubagentReport> { throw unsupported("subagents"); }
  async startBackgroundJob(_job: BackgroundJob): Promise<string> { throw unsupported("backgroundJobs"); }
  async getBackgroundJobStatus(_jobId: string): Promise<BackgroundJobStatus> { throw unsupported("backgroundJobs"); }
  async cancelBackgroundJob(_jobId: string): Promise<void> { throw unsupported("backgroundJobs"); }
  async waitBackgroundJob(_jobId: string): Promise<BackgroundJobStatus> { throw unsupported("backgroundJobs"); }
  async *streamBackgroundJobOutput(_jobId: string): AsyncIterable<{ stdout: string; stderr: string }> { throw unsupported("backgroundJobs"); }
  async shutdown(): Promise<void> {
    if (this.activeRuns.size > 0) throw new Error("Cannot shut down while tool executions are active; wait for them to settle.");
    this.started = false;
  }
  async dispose(): Promise<void> { await this.shutdown(); this.results.clear(); }
}

function unsupported(capability: string): Error {
  return new Error(`QUACK_NATIVE does not support ${capability}.`);
}

/**
 * Registry factory
 */
export function createHarnessRegistry(eventBus?: EventBus): HarnessRegistry {
  return new DefaultHarnessRegistry(eventBus);
}

/**
 * Register the QUACK Native harness
 */
export function registerQuackNativeHarness(
  registry: HarnessRegistry,
  system: any,
  config: HarnessConfig = { harnessId: "QUACK_NATIVE" }
): void {
  const factory: HarnessFactory = async (harnessConfig) => new QuackNativeHarness(system, harnessConfig);
  
  registry.register({
    id: "QUACK_NATIVE",
    factory,
    metadata: {
      id: "QUACK_NATIVE",
      name: "QUACK Native Harness",
      version: "1.0.0",
      description: "Native QUACK execution harness",
      vendor: "QUACK OS",
      license: "MIT",
      capabilities: { ...DEFAULT_CAPABILITIES, tools: "NATIVE", streaming: "EMULATED" },
      minQuackVersion: "1.0.0",
      platforms: ["win32", "linux", "darwin"],
      requiredEnvVars: [],
      optionalEnvVars: ["NVIDIA_API_KEY", "QUACK_OPENAI_API_KEY", "QUACK_OLLAMA_BASE_URL"],
    },
    healthCheck: async () => {
      const providers = system.providers.list();
      return providers.length > 0 ? "HEALTHY" : "DEGRADED";
    },
    certification: "H0_DETECTED",
    priority: 100,
    tags: ["native", "tools", "windows", "linux", "darwin"],
  });
}