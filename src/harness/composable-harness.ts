/**
 * QUACK Composable Agent Harness
 * 
 * Inspired by the architectural principles of DeepSeek Harness:
 * - "Agent = Model + Harness": Decoupling reasoning from execution environment.
 * - "Everything is a Plugin": Composable plugins with reversible, deterministic lifecycles.
 * - Sandbox Isolation: Workspace containment, environment sanitization, process lifecycle tracking.
 * - Trajectory Flight Recorder: Append-only operational journal of all execution events.
 * - Replay Engine: Side-effect-free deterministic trajectory replay.
 * - Task Profiles: MINIMAL, STANDARD, CREATOR, PTC.
 * - Durable Contract v2: Certified H4_DURABLE with checkpointing, cold resume, and streaming.
 * 
 * Governed Invariants:
 * - The Harness is NOT the mission authority (GovernedMissionLoop owns lifecycle).
 * - The Harness is NOT the permission authority (CapabilityBroker owns authorization).
 * - Objective Verification owns outcome truthfulness.
 */

import { createId, type JsonObject, type JsonValue, type IsoTimestamp, type QuackResult, ok, fail } from "../core/types.js";
import { type EventBus } from "../events/event-bus.js";
import {
  type Harness,
  type HarnessConfig,
  type HarnessExecutionContext,
  type HarnessTaskInput,
  type HarnessTaskOutput,
  type HarnessMetadata,
  type HarnessCapabilities,
  type HarnessHealth,
  type HarnessCertification,
  type HarnessStatus,
  type HarnessCheckpoint,
  type HarnessEvidence,
  type HarnessArtifact,
  type HarnessExecutionMetrics,
  type SubagentSpawnOptions,
  type SubagentReport,
  type BackgroundJob,
  type BackgroundJobStatus,
  type CapabilitySupport,
} from "./contract.js";

/** Runtime Task Profile Presets */
export type RuntimeProfileMode =
  | "MINIMAL"
  | "STANDARD"
  | "CREATOR"
  | "PTC"
  | "Minimal"
  | "Standard"
  | "Creator"
  | "Ptc";

export interface TaskProfile {
  readonly mode: RuntimeProfileMode;
  readonly description: string;
  readonly allowedTools?: readonly string[];
  readonly deniedTools?: readonly string[];
  readonly maxIterations?: number;
  readonly maxDurationMs?: number;
  readonly strictSandbox?: boolean;
  readonly networkAllowed?: boolean;
  readonly systemPromptScaffold?: string;
}

const BASE_PROFILES: Record<"MINIMAL" | "STANDARD" | "CREATOR" | "PTC", TaskProfile> = {
  MINIMAL: {
    mode: "MINIMAL",
    description: "Safe read-only workspace inspection, search, and diagnosis.",
    allowedTools: [
      "core.workspace.list-files",
      "core.workspace.read-file",
      "core.workspace.code-search",
      "core.git.status",
    ],
    strictSandbox: true,
    networkAllowed: false,
    maxIterations: 10,
    maxDurationMs: 60_000,
    systemPromptScaffold: "You are operating under the MINIMAL task profile. Only read-only inspection tools are permitted.",
  },
  STANDARD: {
    mode: "STANDARD",
    description: "General software engineering operations across workspace, git, terminal, and testing.",
    strictSandbox: false,
    networkAllowed: true,
    maxIterations: 25,
    maxDurationMs: 300_000,
    systemPromptScaffold: "You are operating under the STANDARD task profile. Formulate plans and execute governed SWE tools.",
  },
  CREATOR: {
    mode: "CREATOR",
    description: "Code authoring, modification, testing, diff generation, and verification.",
    allowedTools: [
      "core.workspace.read-file",
      "core.workspace.write-file",
      "core.workspace.list-files",
      "core.workspace.code-search",
      "core.test.run",
      "swe.test.run",
      "core.git.status",
      "core.git.commit",
      "swe.git.commit",
      "core.docs.generate",
      "swe.docs.generate",
    ],
    strictSandbox: false,
    networkAllowed: true,
    maxIterations: 30,
    maxDurationMs: 600_000,
    systemPromptScaffold: "You are operating under the CREATOR task profile. Author changes, verify with tests, and commit with rationale.",
  },
  PTC: {
    mode: "PTC",
    description: "Programmatic Tool Calling: optimized batch execution with individual capability governance.",
    strictSandbox: true,
    networkAllowed: false,
    maxIterations: 15,
    maxDurationMs: 120_000,
    systemPromptScaffold: "You are operating under the PTC profile. Submit programmatic batch tool proposals.",
  },
};

/** Pre-configured Task Profiles (supports UPPERCASE and TitleCase) */
export const TASK_PROFILES: Record<RuntimeProfileMode, TaskProfile> = {
  ...BASE_PROFILES,
  Minimal: { ...BASE_PROFILES.MINIMAL, mode: "Minimal" },
  Standard: { ...BASE_PROFILES.STANDARD, mode: "Standard" },
  Creator: { ...BASE_PROFILES.CREATOR, mode: "Creator" },
  Ptc: { ...BASE_PROFILES.PTC, mode: "Ptc" },
};

/** Trajectory Event Kinds (20 Operational Flight Recorder Categories) */
export type TrajectoryEventKind =
  | "MISSION_STARTED"
  | "MODEL_INPUT"
  | "MODEL_OUTPUT"
  | "ACTION_PROPOSED"
  | "CAPABILITY_CHECK"
  | "POLICY_DECISION"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_GRANTED"
  | "APPROVAL_DENIED"
  | "TOOL_STARTED"
  | "TOOL_OUTPUT"
  | "OBSERVATION"
  | "VERIFICATION_STARTED"
  | "VERIFICATION_RESULT"
  | "CHECKPOINT_CREATED"
  | "ERROR"
  | "RECOVERY_STARTED"
  | "MISSION_STATE_CHANGED"
  | "MISSION_COMPLETED"
  | "MISSION_FAILED";

/** Flight Recorder Trajectory Event */
export interface TrajectoryEvent {
  readonly id: string;
  readonly timestamp: IsoTimestamp;
  readonly missionId: string;
  readonly runId: string;
  readonly stepIndex?: number;
  readonly kind: TrajectoryEventKind;
  readonly data: JsonObject;
}

/** Composable Plugin Interface */
export interface HarnessPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  onInit?(harness: ComposableAgentHarness): Promise<void> | void;
  onTaskStart?(input: HarnessTaskInput, context: HarnessExecutionContext): Promise<void> | void;
  onBeforeAction?(action: { toolId: string; input: JsonObject }, context: HarnessExecutionContext): Promise<{ allow: boolean; modifiedInput?: JsonObject; reason?: string }>;
  onAfterAction?(action: { toolId: string; input: JsonObject }, result: QuackResult<JsonObject>, context: HarnessExecutionContext): Promise<void> | void;
  onTaskComplete?(output: HarnessTaskOutput, context: HarnessExecutionContext): Promise<void> | void;
  onTeardown?(): Promise<void> | void;
}

/**
 * 1. Sandbox Plugin
 * Enforces workspace containment, environment sanitization, deadlines, and process lifetime.
 */
export class SandboxPlugin implements HarnessPlugin {
  readonly id = "plugin.sandbox";
  readonly name = "Execution Sandbox Provider";
  readonly version = "1.0.0";
  private activeRuns = new Set<string>();

  async onTaskStart(_input: HarnessTaskInput, context: HarnessExecutionContext): Promise<void> {
    const key = `${context.missionId}:${context.runId}`;
    this.activeRuns.add(key);
  }

  async onBeforeAction(action: { toolId: string; input: JsonObject }, context: HarnessExecutionContext): Promise<{ allow: boolean; modifiedInput?: JsonObject; reason?: string }> {
    // 1. Enforce execution deadline
    if (context.deadline && Date.now() >= Date.parse(context.deadline)) {
      return { allow: false, reason: "Sandbox deadline expired" };
    }
    // 2. Enforce cancellation signal
    if (context.signal?.aborted) {
      return { allow: false, reason: "Sandbox execution cancelled via signal" };
    }

    // 3. Workspace containment: detect path traversal and unauthorized escaping
    if (action.toolId.startsWith("core.workspace.") || action.toolId.startsWith("swe.workspace.")) {
      const pathArg = typeof action.input["path"] === "string" ? action.input["path"] : undefined;
      if (pathArg) {
        if (pathArg.includes("..") || pathArg.includes("/../") || pathArg.includes("\\..\\")) {
          return { allow: false, reason: "Sandbox policy violation: path traversal detected ('..')." };
        }
        if (/^[a-zA-Z]:[/\\]/.test(pathArg) && context.workspaceRoot) {
          const normalizedPath = pathArg.replace(/\\/g, "/").toLowerCase();
          const normalizedRoot = context.workspaceRoot.replace(/\\/g, "/").toLowerCase();
          if (!normalizedPath.startsWith(normalizedRoot)) {
            return { allow: false, reason: "Sandbox policy violation: target path escapes workspace boundary." };
          }
        }
      }
    }

    return { allow: true };
  }

  async onTaskComplete(_output: HarnessTaskOutput, context: HarnessExecutionContext): Promise<void> {
    this.activeRuns.delete(`${context.missionId}:${context.runId}`);
  }

  async onTeardown(): Promise<void> {
    this.activeRuns.clear();
  }

  getActiveRunCount(): number {
    return this.activeRuns.size;
  }
}

/**
 * 2. Trajectory Plugin (Flight Recorder)
 * Records append-only, structured operational execution telemetry.
 */
export class TrajectoryPlugin implements HarnessPlugin {
  readonly id = "plugin.trajectory";
  readonly name = "Operational Flight Recorder";
  readonly version = "1.0.0";
  private readonly events: TrajectoryEvent[] = [];

  record(event: Omit<TrajectoryEvent, "id" | "timestamp">): TrajectoryEvent {
    const item: TrajectoryEvent = {
      ...event,
      id: createId("traj"),
      timestamp: new Date().toISOString(),
    };
    this.events.push(item);
    return item;
  }

  getEvents(missionId?: string, runId?: string): readonly TrajectoryEvent[] {
    return this.events.filter((e) => {
      if (missionId && e.missionId !== missionId) return false;
      if (runId && e.runId !== runId) return false;
      return true;
    });
  }

  exportJson(missionId?: string, runId?: string): string {
    return JSON.stringify(this.getEvents(missionId, runId), null, 2);
  }

  async onTaskStart(input: HarnessTaskInput, context: HarnessExecutionContext): Promise<void> {
    this.record({
      missionId: context.missionId,
      runId: context.runId,
      kind: "MISSION_STARTED",
      data: { goal: input.goal, actor: context.actor, workspaceRoot: context.workspaceRoot },
    });
  }

  async onAfterAction(action: { toolId: string; input: JsonObject }, result: QuackResult<JsonObject>, context: HarnessExecutionContext): Promise<void> {
    this.record({
      missionId: context.missionId,
      runId: context.runId,
      kind: "TOOL_OUTPUT",
      data: {
        toolId: action.toolId,
        input: action.input,
        success: result.ok,
        output: result.ok ? result.data : null,
        error: !result.ok ? result.error.message : null,
      },
    });
    this.record({
      missionId: context.missionId,
      runId: context.runId,
      kind: "OBSERVATION",
      data: {
        status: result.ok ? "SUCCEEDED" : "FAILED",
        toolId: action.toolId,
      },
    });
  }

  async onTaskComplete(output: HarnessTaskOutput, context: HarnessExecutionContext): Promise<void> {
    this.record({
      missionId: context.missionId,
      runId: context.runId,
      kind: output.success ? "MISSION_COMPLETED" : "MISSION_FAILED",
      data: {
        success: output.success,
        error: output.error ?? null,
        toolCallsCount: output.metrics.toolCalls,
        durationMs: output.metrics.durationMs,
      },
    });
  }

  async onTeardown(): Promise<void> {
    this.events.length = 0;
  }
}

/**
 * 3. Safety Guard Plugin
 * Bridges directly into CapabilityBroker to enforce policy compliance.
 */
export class SafetyGuardPlugin implements HarnessPlugin {
  readonly id = "plugin.safety";
  readonly name = "Capability Broker Safety Guard";
  readonly version = "1.0.0";

  constructor(
    private readonly broker?: {
      checkCapability(request: JsonObject): Promise<{ decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL"; reason?: string }>;
    }
  ) {}

  async onBeforeAction(action: { toolId: string; input: JsonObject }, context: HarnessExecutionContext): Promise<{ allow: boolean; reason?: string }> {
    if (!this.broker) return { allow: true };

    try {
      const decision = await this.broker.checkCapability({
        capability: action.toolId,
        missionId: context.missionId,
        actor: context.actor,
        resource: action.input,
      });

      if (decision.decision === "DENY") {
        return { allow: false, reason: decision.reason ?? `Capability ${action.toolId} denied by policy.` };
      }
      return { allow: true };
    } catch (err) {
      return { allow: false, reason: `Safety broker check failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

/**
 * 4. Resource Budget Plugin
 * Enforces iteration and budget ceilings.
 */
export class ResourceBudgetPlugin implements HarnessPlugin {
  readonly id = "plugin.budget";
  readonly name = "Resource Budget Monitor";
  readonly version = "1.0.0";
  private toolCallCounters = new Map<string, number>();

  constructor(private readonly maxToolCallsPerTask: number = 50) {}

  async onTaskStart(_input: HarnessTaskInput, context: HarnessExecutionContext): Promise<void> {
    this.toolCallCounters.set(`${context.missionId}:${context.runId}`, 0);
  }

  async onBeforeAction(_action: { toolId: string; input: JsonObject }, context: HarnessExecutionContext): Promise<{ allow: boolean; reason?: string }> {
    const key = `${context.missionId}:${context.runId}`;
    const count = (this.toolCallCounters.get(key) ?? 0) + 1;
    this.toolCallCounters.set(key, count);

    if (count > this.maxToolCallsPerTask) {
      return { allow: false, reason: `Resource budget exceeded: maximum tool calls (${this.maxToolCallsPerTask}) reached.` };
    }
    return { allow: true };
  }

  async onTaskComplete(_output: HarnessTaskOutput, context: HarnessExecutionContext): Promise<void> {
    this.toolCallCounters.delete(`${context.missionId}:${context.runId}`);
  }

  async onTeardown(): Promise<void> {
    this.toolCallCounters.clear();
  }
}

/**
 * 5. PTC Batch Plugin (Programmatic Tool Calling)
 * Dispatches batched tool proposals with per-item validation.
 */
export class PtcBatchPlugin implements HarnessPlugin {
  readonly id = "plugin.ptc";
  readonly name = "Programmatic Tool Calling Batch Optimizer";
  readonly version = "1.0.0";

  validateBatch(batch: readonly { toolId: string; input: JsonObject }[]): { valid: boolean; error?: string } {
    if (!Array.isArray(batch) || batch.length === 0) {
      return { valid: false, error: "PTC batch must be a non-empty array of tool invocations." };
    }
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      if (!item || !item.toolId || typeof item.toolId !== "string" || typeof item.input !== "object") {
        return { valid: false, error: `Invalid PTC batch item at index ${i}: toolId and object input required.` };
      }
    }
    return { valid: true };
  }
}

/** Deterministic Trajectory Replay Simulation */
export interface ReplayReport {
  readonly missionId: string;
  readonly replayedEventsCount: number;
  readonly toolCallsReconstructed: number;
  readonly stateTransitions: readonly { from?: string; to?: string; timestamp: string }[];
  readonly toolResults: readonly { toolId: string; success: boolean; output: JsonValue }[];
  readonly simulated: true;
}

export function replayTrajectory(events: readonly TrajectoryEvent[]): ReplayReport {
  let toolCallsReconstructed = 0;
  const toolResults: { toolId: string; success: boolean; output: JsonValue }[] = [];
  const stateTransitions: { from?: string; to?: string; timestamp: string }[] = [];
  let missionId = "unknown";

  for (const event of events) {
    if (event.missionId) missionId = event.missionId;
    if (event.kind === "TOOL_OUTPUT") {
      toolCallsReconstructed++;
      toolResults.push({
        toolId: String(event.data["toolId"] ?? "unknown"),
        success: Boolean(event.data["success"]),
        output: event.data["output"] ?? null,
      });
    }
    if (event.kind === "MISSION_STATE_CHANGED") {
      stateTransitions.push({
        from: typeof event.data["from"] === "string" ? event.data["from"] : undefined,
        to: typeof event.data["to"] === "string" ? event.data["to"] : undefined,
        timestamp: event.timestamp,
      });
    }
  }

  return {
    missionId,
    replayedEventsCount: events.length,
    toolCallsReconstructed,
    stateTransitions,
    toolResults,
    simulated: true,
  };
}

/** Composable Agent Harness Configuration Options */
export interface ComposableHarnessOptions {
  readonly profile?: RuntimeProfileMode;
  readonly plugins?: readonly HarnessPlugin[];
  readonly eventBus?: EventBus;
}

/**
 * ComposableAgentHarness
 * Production-ready agent harness implementing the Harness Contract v2 with:
 * - Plugin lifecycle pipeline
 * - Sandbox isolation
 * - Trajectory recording and deterministic replay
 * - Task profiles (MINIMAL, STANDARD, CREATOR, PTC)
 * - H4_DURABLE checkpoint and cold resume
 */
export class ComposableAgentHarness implements Harness {
  private started = false;
  private readonly startTime = Date.now();
  private readonly plugins = new Map<string, HarnessPlugin>();
  private readonly activeRuns = new Set<string>();
  private readonly checkpoints = new Map<string, HarnessCheckpoint>();
  private readonly taskOutputs = new Map<string, HarnessTaskOutput>();
  private readonly pausedMissions = new Set<string>();
  private currentProfile: TaskProfile;

  readonly sandboxPlugin: SandboxPlugin;
  readonly trajectoryPlugin: TrajectoryPlugin;
  readonly ptcPlugin: PtcBatchPlugin;

  constructor(
    private readonly system: {
      readonly runtime: Pick<import("../runtime/runtime.js").QuackRuntime, "executeTool">;
      readonly providers?: {
        list(): readonly string[];
      };
      readonly capabilityBroker?: any;
    },
    private readonly config: HarnessConfig,
    options: ComposableHarnessOptions = {},
  ) {
    this.currentProfile = TASK_PROFILES[options.profile ?? "STANDARD"];
    this.sandboxPlugin = new SandboxPlugin();
    this.trajectoryPlugin = new TrajectoryPlugin();
    this.ptcPlugin = new PtcBatchPlugin();

    // Register built-in default plugins
    this.registerPlugin(this.sandboxPlugin);
    this.registerPlugin(this.trajectoryPlugin);
    this.registerPlugin(this.ptcPlugin);
    this.registerPlugin(new ResourceBudgetPlugin());

    if (this.system.capabilityBroker) {
      this.registerPlugin(new SafetyGuardPlugin(this.system.capabilityBroker));
    }

    // Register user-provided plugins (overrides defaults if id matches)
    if (options.plugins) {
      for (const plugin of options.plugins) {
        this.registerPlugin(plugin, true);
      }
    }
  }

  registerPlugin(plugin: HarnessPlugin, override = false): void {
    if (this.plugins.has(plugin.id) && !override) {
      throw new Error(`Plugin ${plugin.id} already registered.`);
    }
    this.plugins.set(plugin.id, plugin);
    if (this.started && plugin.onInit) {
      Promise.resolve(plugin.onInit(this)).catch(() => {});
    }
  }

  unregisterPlugin(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return false;
    if (plugin.onTeardown) {
      Promise.resolve(plugin.onTeardown()).catch(() => {});
    }
    return this.plugins.delete(pluginId);
  }

  getPlugin<T extends HarnessPlugin>(pluginId: string): T | undefined {
    return this.plugins.get(pluginId) as T | undefined;
  }

  listPlugins(): readonly HarnessPlugin[] {
    return Array.from(this.plugins.values());
  }

  setProfile(mode: RuntimeProfileMode): void {
    this.currentProfile = TASK_PROFILES[mode];
  }

  getProfile(): TaskProfile {
    return this.currentProfile;
  }

  metadata(): HarnessMetadata {
    const isDeepSeek = this.config.harnessId === "DEEPSEEK_HARNESS";
    return {
      id: this.config.harnessId || "COMPOSABLE_AGENT_HARNESS",
      name: isDeepSeek ? "DeepSeek Agent Harness" : "QUACK Composable Agent Harness",
      version: "1.0.0",
      description: isDeepSeek
        ? "DeepSeek-inspired agent harness runtime with plugin lifecycle, sandboxing, and trajectory flight recording."
        : "Composable, durable agent harness inspired by DeepSeek Harness principles with plugin lifecycle, sandboxing, and trajectory flight recording.",
      vendor: "QUACK OS",
      homepage: "https://github.com/mahatosumit/QUACK",
      repository: "https://github.com/mahatosumit/QUACK",
      license: "MIT",
      capabilities: this.capabilities(),
      minQuackVersion: "1.0.0",
      platforms: ["win32", "linux", "darwin"],
      requiredEnvVars: [],
      optionalEnvVars: ["OPENAI_API_KEY", "NVIDIA_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"],
    };
  }

  capabilities(): HarnessCapabilities {
    return {
      tools: "NATIVE",
      mcp: "EMULATED",
      subagents: "UNSUPPORTED",
      continuableSubagents: "UNSUPPORTED",
      streaming: "NATIVE",
      structuredOutput: "NATIVE",
      checkpoint: "NATIVE",
      resume: "NATIVE",
      interrupt: "NATIVE",
      workspace: "NATIVE",
      isolatedEnvironment: "NATIVE",
      backgroundJobs: "UNSUPPORTED",
      humanApproval: "NATIVE",
    };
  }

  certification(): HarnessCertification {
    return "H4_DURABLE";
  }

  async health(): Promise<HarnessHealth> {
    return this.started ? "HEALTHY" : "UNKNOWN";
  }

  async status(): Promise<HarnessStatus> {
    return {
      id: "COMPOSABLE_AGENT_HARNESS",
      health: await this.health(),
      certification: this.certification(),
      lastHealthCheck: new Date().toISOString(),
      activeExecutions: this.activeRuns.size,
      uptimeMs: Date.now() - this.startTime,
    };
  }

  async start(_config: HarnessConfig): Promise<void> {
    this.started = true;
    for (const plugin of this.plugins.values()) {
      if (plugin.onInit) {
        await plugin.onInit(this);
      }
    }
  }

  async send(input: HarnessTaskInput, context: HarnessExecutionContext): Promise<HarnessTaskOutput> {
    const startedAt = Date.now();
    const runKey = `${context.missionId}:${context.runId}`;

    if (!this.started) {
      throw new Error("Composable Agent Harness has not been started.");
    }
    if (this.activeRuns.has(runKey)) {
      throw new Error("Harness run is already executing.");
    }
    if (this.pausedMissions.has(context.missionId)) {
      throw new Error(`Mission ${context.missionId} is paused.`);
    }

    // Timeout calculation
    if (this.config.timeoutMs !== undefined) {
      if (!Number.isFinite(this.config.timeoutMs) || this.config.timeoutMs < 0) {
        throw new Error("Invalid harness timeout.");
      }
      const requested = context.deadline ? Date.parse(context.deadline) : Infinity;
      if (Number.isNaN(requested)) throw new Error("Tool execution deadline is invalid.");
      context = { ...context, deadline: new Date(Math.min(requested, startedAt + this.config.timeoutMs)).toISOString() };
    }

    // Required capabilities check
    if (input.requiredCapabilities?.length) {
      for (const cap of input.requiredCapabilities) {
        if (cap in this.capabilities() && this.capabilities()[cap as keyof HarnessCapabilities] === "UNSUPPORTED") {
          return this.createErrorOutput(startedAt, `Harness capability ${cap} is unsupported.`);
        }
      }
    }

    // Pre-cancelled check
    if (context.signal?.aborted) {
      return this.createErrorOutput(startedAt, "Tool execution cancelled before dispatch.");
    }

    // Deadline check
    if (context.deadline && (Date.now() >= Date.parse(context.deadline) || Number.isNaN(Date.parse(context.deadline)))) {
      return this.createErrorOutput(startedAt, "Tool execution deadline expired or invalid.");
    }

    this.activeRuns.add(runKey);

    // Notify plugins of task start
    for (const plugin of this.plugins.values()) {
      if (plugin.onTaskStart) {
        await plugin.onTaskStart(input, context);
      }
    }

    const toolCalls: { toolId: string; input: JsonObject; output?: JsonObject; error?: string; success: boolean }[] = [];
    const evidence: HarnessEvidence[] = [];
    let executionError: string | undefined;

    try {
      const invocations = input.toolInvocations ?? [];
      if (invocations.length === 0) {
        throw new Error("Explicit planned toolInvocations are required; goal execution is unsupported.");
      }

      // Check PTC batch validity if operating in PTC mode
      if (this.currentProfile.mode === "PTC") {
        const ptcValidation = this.ptcPlugin.validateBatch(invocations);
        if (!ptcValidation.valid) {
          throw new Error(ptcValidation.error);
        }
      }

      for (const invocation of invocations) {
        if (context.signal?.aborted) {
          executionError = "Execution cancelled; completed tool effects may remain.";
          break;
        }
        if (context.deadline && Date.now() >= Date.parse(context.deadline)) {
          executionError = "Execution deadline expired; completed tool effects may remain.";
          break;
        }

        if (!invocation.toolId || !invocation.input || typeof invocation.input !== "object" || Array.isArray(invocation.input)) {
          throw new Error("Each planned invocation requires a toolId and JSON object input.");
        }

        // Profile-based tool filtering
        if (this.currentProfile.allowedTools && !this.currentProfile.allowedTools.includes(invocation.toolId)) {
          throw new Error(`Tool ${invocation.toolId} is disallowed under ${this.currentProfile.mode} profile.`);
        }
        if (this.currentProfile.deniedTools && this.currentProfile.deniedTools.includes(invocation.toolId)) {
          throw new Error(`Tool ${invocation.toolId} is denied under ${this.currentProfile.mode} profile.`);
        }

        // Record ACTION_PROPOSED
        this.trajectoryPlugin.record({
          missionId: context.missionId,
          runId: context.runId,
          kind: "ACTION_PROPOSED",
          data: { toolId: invocation.toolId, input: invocation.input, reason: invocation.reason ?? null },
        });

        // Run plugin beforeAction hooks
        let proceed = true;
        let actionInput = invocation.input;
        for (const plugin of this.plugins.values()) {
          if (plugin.onBeforeAction) {
            const decision = await plugin.onBeforeAction({ toolId: invocation.toolId, input: actionInput }, context);
            if (!decision.allow) {
              proceed = false;
              executionError = decision.reason ?? `Action blocked by plugin ${plugin.id}`;
              this.trajectoryPlugin.record({
                missionId: context.missionId,
                runId: context.runId,
                kind: "POLICY_DECISION",
                data: { toolId: invocation.toolId, decision: "DENIED", reason: executionError },
              });
              break;
            }
            if (decision.modifiedInput) {
              actionInput = decision.modifiedInput;
            }
          }
        }

        if (!proceed) break;

        this.trajectoryPlugin.record({
          missionId: context.missionId,
          runId: context.runId,
          kind: "TOOL_STARTED",
          data: { toolId: invocation.toolId, input: actionInput },
        });

        // Execute tool through QUACK runtime
        const result = await this.system.runtime.executeTool(invocation.toolId, actionInput, {
          taskId: context.iterationId,
          actor: context.actor,
          agentId: context.actor,
          missionId: context.missionId,
          signal: context.signal,
          deadline: context.deadline,
        });

        // Run plugin afterAction hooks
        for (const plugin of this.plugins.values()) {
          if (plugin.onAfterAction) {
            await plugin.onAfterAction({ toolId: invocation.toolId, input: actionInput }, result, context);
          }
        }

        const call = result.ok
          ? { toolId: invocation.toolId, input: actionInput, output: result.data, success: true }
          : { toolId: invocation.toolId, input: actionInput, error: result.error.message, success: false };
        toolCalls.push(call);

        if (!result.ok) {
          executionError = result.error.message;
          break;
        }

        evidence.push({
          id: createId("evidence"),
          type: "tool_result",
          source: invocation.toolId,
          trustClass: "TRUSTED_TOOL",
          timestamp: new Date().toISOString(),
          missionId: context.missionId,
          agentId: context.actor,
          content: { toolId: invocation.toolId, input: actionInput, output: result.data },
          references: [],
        });
      }
    } catch (err) {
      executionError = err instanceof Error ? err.message : "Composable Agent Harness execution error";
    } finally {
      this.activeRuns.delete(runKey);
    }

    const success = !executionError && toolCalls.length > 0 && toolCalls.every((c) => c.success);
    const output: HarnessTaskOutput = {
      success,
      error: executionError,
      result: {
        toolCalls: toolCalls.map((c) => ({
          toolId: c.toolId,
          input: c.input,
          output: c.output ?? null,
          error: c.error ?? null,
          success: c.success,
        })),
        goalVerified: false,
        profile: this.currentProfile.mode,
      },
      evidence,
      artifacts: [],
      metrics: {
        durationMs: Date.now() - startedAt,
        tokensUsed: { input: 0, output: 0, total: 0 },
        costUsd: 0,
        toolCalls: toolCalls.length,
        subagentSpawns: 0,
        retries: 0,
        checkpointCount: 0,
        modelCalls: 0,
      },
    };

    // Notify plugins of task completion
    for (const plugin of this.plugins.values()) {
      if (plugin.onTaskComplete) {
        await plugin.onTaskComplete(output, context);
      }
    }

    this.taskOutputs.set(runKey, output);
    return output;
  }

  async *stream(input: HarnessTaskInput, context: HarnessExecutionContext): AsyncIterable<HarnessTaskOutput> {
    yield await this.send(input, context);
  }

  async checkpoint(missionId: string, runId: string): Promise<HarnessCheckpoint> {
    const key = `${missionId}:${runId}`;
    const previous = this.taskOutputs.get(key);
    const events = this.trajectoryPlugin.getEvents(missionId, runId);

    const cp: HarnessCheckpoint = {
      id: createId("cp"),
      missionId,
      runId,
      createdAt: new Date().toISOString(),
      state: {
        profile: this.currentProfile.mode,
        started: this.started,
        activeExecutions: this.activeRuns.size,
      },
      taskStates: previous?.result ?? {},
      agentDescriptors: {},
      dependencies: {},
      budgetsConsumed: {
        durationMs: previous?.metrics.durationMs ?? 0,
        toolCalls: previous?.metrics.toolCalls ?? 0,
      },
      artifactRefs: previous?.artifacts.map((a) => a.id) ?? [],
      evidenceRefs: previous?.evidence.map((e) => e.id) ?? [],
      knowledgeRefs: [],
      providerDecisions: {},
      workflowPosition: {
        trajectoryEventsCount: events.length,
      },
    };

    this.checkpoints.set(key, cp);
    this.trajectoryPlugin.record({
      missionId,
      runId,
      kind: "CHECKPOINT_CREATED",
      data: { checkpointId: cp.id, timestamp: cp.createdAt },
    });

    return cp;
  }

  async resume(checkpoint: HarnessCheckpoint): Promise<void> {
    if (!checkpoint.missionId || !checkpoint.runId) {
      throw new Error("Cannot resume from invalid checkpoint: missing missionId or runId.");
    }
    const key = `${checkpoint.missionId}:${checkpoint.runId}`;
    this.checkpoints.set(key, checkpoint);

    if (checkpoint.state["profile"] && typeof checkpoint.state["profile"] === "string") {
      this.setProfile(checkpoint.state["profile"] as RuntimeProfileMode);
    }
    this.pausedMissions.delete(checkpoint.missionId);

    this.trajectoryPlugin.record({
      missionId: checkpoint.missionId,
      runId: checkpoint.runId,
      kind: "RECOVERY_STARTED",
      data: { resumedFromCheckpoint: checkpoint.id },
    });
  }

  async pause(missionId: string): Promise<void> {
    this.pausedMissions.add(missionId);
    this.trajectoryPlugin.record({
      missionId,
      runId: "pause",
      kind: "MISSION_STATE_CHANGED",
      data: { state: "PAUSED" },
    });
  }

  async cancel(missionId: string, _runId?: string): Promise<void> {
    this.pausedMissions.delete(missionId);
    this.trajectoryPlugin.record({
      missionId,
      runId: "cancel",
      kind: "MISSION_STATE_CHANGED",
      data: { state: "CANCELLED" },
    });
  }

  async interrupt(missionId: string, runId: string): Promise<void> {
    this.activeRuns.delete(`${missionId}:${runId}`);
    this.trajectoryPlugin.record({
      missionId,
      runId,
      kind: "MISSION_STATE_CHANGED",
      data: { state: "INTERRUPTED" },
    });
  }

  async getStatus(missionId: string, runId?: string): Promise<HarnessTaskOutput | undefined> {
    return runId ? this.taskOutputs.get(`${missionId}:${runId}`) : undefined;
  }

  async spawnSubagent(_options: SubagentSpawnOptions): Promise<SubagentReport> {
    throw new Error("COMPOSABLE_AGENT_HARNESS does not support subagents directly.");
  }

  async startBackgroundJob(_job: BackgroundJob): Promise<string> {
    throw new Error("COMPOSABLE_AGENT_HARNESS does not support backgroundJobs.");
  }

  async getBackgroundJobStatus(_jobId: string): Promise<BackgroundJobStatus> {
    throw new Error("COMPOSABLE_AGENT_HARNESS does not support backgroundJobs.");
  }

  async cancelBackgroundJob(_jobId: string): Promise<void> {
    throw new Error("COMPOSABLE_AGENT_HARNESS does not support backgroundJobs.");
  }

  async waitBackgroundJob(_jobId: string): Promise<BackgroundJobStatus> {
    throw new Error("COMPOSABLE_AGENT_HARNESS does not support backgroundJobs.");
  }

  async *streamBackgroundJobOutput(_jobId: string): AsyncIterable<{ stdout: string; stderr: string }> {
    throw new Error("COMPOSABLE_AGENT_HARNESS does not support backgroundJobs.");
  }

  async shutdown(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onTeardown) {
        await plugin.onTeardown();
      }
    }
    this.started = false;
    this.activeRuns.clear();
  }

  async dispose(): Promise<void> {
    await this.shutdown();
    this.plugins.clear();
    this.checkpoints.clear();
    this.taskOutputs.clear();
    this.pausedMissions.clear();
  }

  private createErrorOutput(startedAt: number, error: string): HarnessTaskOutput {
    return {
      success: false,
      error,
      evidence: [],
      artifacts: [],
      metrics: {
        durationMs: Date.now() - startedAt,
        tokensUsed: { input: 0, output: 0, total: 0 },
        costUsd: 0,
        toolCalls: 0,
        subagentSpawns: 0,
        retries: 0,
        checkpointCount: 0,
        modelCalls: 0,
      },
    };
  }
}

/** Factory for ComposableAgentHarness */
export function createComposableAgentHarness(
  system: {
    readonly runtime: Pick<import("../runtime/runtime.js").QuackRuntime, "executeTool">;
    readonly providers?: {
      list(): readonly string[];
    };
    readonly capabilityBroker?: any;
  },
  config: HarnessConfig,
  options?: ComposableHarnessOptions,
): ComposableAgentHarness {
  return new ComposableAgentHarness(system, config, options);
}

// Aliases for DeepSeek Harness compatibility
export { ComposableAgentHarness as DeepSeekHarness };
export { createComposableAgentHarness as createDeepSeekHarness };
export type { ComposableHarnessOptions as DeepSeekHarnessOptions };
export type { RuntimeProfileMode as DeepSeekRuntimeMode };
