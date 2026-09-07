import { createId, type QuackResult, type IsoTimestamp, type JsonObject, type JsonValue } from "../../core/types.js";
import { type ActionProposal, type ActionOutcome, type ExpectedEffect, type VerificationStrategy, type ResultVerification, type ExecutionRiskLevel } from "./action-contract.js";
import { type MissionState, type MissionTransitionTrigger, planMissionTransition, assertMissionTransition, type MissionTransition } from "./mission-state-machine.js";
import { 
  QUACK_CONTRACT_VERSION,
  type ActionDescriptorV1,
  type ActionProviderV1,
  type ActionRequestV1,
  type ActionResultV1,
  type EvidenceRecordV1,
  type ExecutionContextV1,
} from "../../contracts/v1/contracts.js";
import { type ActionRuntime, type ActionProviderRegistry, type ActionRuntimeDependencies } from "../../actions/runtime.js";
import { type CapabilityBroker, type CapabilityRequest, type CapabilityDecision, capabilityIdForPermission, resourceKindForPermission, buildToolCapabilityRequest } from "../../security/capability-broker.js";
import { type Permission } from "../../security/permissions.js";
import { type ToolRegistry } from "../../tools/tool.js";
import { type EventBus } from "../../events/event-bus.js";

/** Result of harness execution. */
export interface HarnessResult {
  readonly outcome: ActionOutcome;
  readonly verification: ResultVerification;
}

/** Harness execution context from the executive loop. */
export interface HarnessExecutionContext {
  readonly missionId: string;
  readonly runId: string;
  readonly iterationId: string;
  readonly actor: string;
  readonly signal?: AbortSignal;
  readonly deadline?: IsoTimestamp;
}

/** Capability resolution result. */
export interface CapabilityResolution {
  readonly providerId: string;
  readonly descriptor: JsonObject; // ActionDescriptorV1
  readonly actionId: string;
}

/** Harness for executing action proposals through the canonical execution boundary. */
export interface ExecutionHarness {
  /**
   * Execute an action proposal through the full harness pipeline:
   * validate → authorize → resolve capability → execute → verify
   */
  execute(proposal: ActionProposal, context: HarnessExecutionContext): Promise<HarnessResult>;
  
  /**
   * Cancel an in-flight execution.
   */
  cancel(executionId: string): Promise<void>;
}

/** Configuration for the harness. */
export interface HarnessConfig {
  /** Maximum execution time for any single action. */
  readonly defaultTimeoutMs: number;
  /** Whether to require verification strategies for irreversible actions. */
  readonly requireVerificationForIrreversible: boolean;
  readonly executeTool?: (toolId: string, input: JsonObject, options: import("../runtime.js").RuntimeAccessOptions) => Promise<QuackResult<JsonObject>>;

}

/** Timeout configuration per risk level. */
export interface RiskLevelTimeouts {
  readonly READ_ONLY: number;
  readonly REVERSIBLE: number;
  readonly IRREVERSIBLE: number;
  readonly DESTRUCTIVE: number;
}

/** Default timeouts per risk level. */
export const DEFAULT_RISK_TIMEOUTS: RiskLevelTimeouts = {
  READ_ONLY: 30_000,
  REVERSIBLE: 60_000,
  IRREVERSIBLE: 120_000,
  DESTRUCTIVE: 300_000,
};

/** Circuit breaker state for provider resilience. */
export interface CircuitBreakerState {
  readonly failures: number;
  readonly lastFailure: IsoTimestamp | null;
  readonly state: "CLOSED" | "OPEN" | "HALF_OPEN";
  readonly nextAttempt: IsoTimestamp | null;
}

/** Circuit breaker configuration. */
export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly resetTimeoutMs: number;
  readonly halfOpenMaxCalls: number;
}

/** Default circuit breaker config. */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxCalls: 3,
};

/** Default harness implementation. */
export class DefaultExecutionHarness implements ExecutionHarness {
  private readonly activeExecutions = new Map<string, AbortController>();
  private readonly circuitBreakers = new Map<string, CircuitBreakerState>();

  constructor(
    private readonly actionRuntime: ActionRuntime,
    private readonly capabilityBroker: CapabilityBroker,
    private readonly actionProviderRegistry: ActionProviderRegistry,
    private readonly toolRegistry: ToolRegistry,
    private readonly eventBus: EventBus,
    private readonly config: HarnessConfig = {
      defaultTimeoutMs: 120_000,
      requireVerificationForIrreversible: true,
    },
    private readonly riskTimeouts: RiskLevelTimeouts = DEFAULT_RISK_TIMEOUTS,
    private readonly circuitBreakerConfig: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
  ) {}

  async execute(proposal: ActionProposal, context: HarnessExecutionContext): Promise<HarnessResult> {
    const executionId = createId("exec");
    const controller = new AbortController();
    const combinedSignal = combineSignals(context.signal, controller.signal);
    this.activeExecutions.set(executionId, controller);

    let actionDescriptor: ActionDescriptorV1 | undefined;

    try {
      proposal = structuredClone(proposal);
      const authorizedRequests: CapabilityRequest[] = [];
      // Step 1: Validate proposal
      await this.validateProposal(proposal);

      // Step 2: Resolve capability to provider + action (needed for authorization)
      const resolution = await this.resolveCapability(proposal, context);

      // Step 2b: Get action descriptor to determine correct risk level and permissions
      for (const provider of this.actionProviderRegistry.list()) {
        const actions = await provider.discoverActions({ signal: context.signal });
        const descriptor = actions.find((a: ActionDescriptorV1) => a.id === proposal.capability);
        if (descriptor) {
          actionDescriptor = descriptor;
          break;
        }
      }

      if (this.config.requireVerificationForIrreversible && actionDescriptor) {
        const actualRisk = this.mapRiskClassToExecutionRiskLevel(actionDescriptor.riskClass);
        if (actualRisk === "IRREVERSIBLE" || actualRisk === "DESTRUCTIVE") {
          throw new Error("Irreversible action execution requires a verification runner, which is unsupported by this harness.");
        }
      }

      // Step 3: Check circuit breaker
      if (actionDescriptor) {
        const cbState = this.getCircuitBreakerState(actionDescriptor.providerId);
        if (cbState.state === "OPEN" && new Date(cbState.nextAttempt!).getTime() > Date.now()) {
          throw new Error(`Circuit breaker OPEN for provider ${actionDescriptor.providerId}. Next attempt at ${cbState.nextAttempt}.`);
        }
      }

      // Step 4: Authorize through capability broker
      const capabilityDecision = await this.authorize(proposal, context, resolution, actionDescriptor, authorizedRequests);
      if (!capabilityDecision.granted) {
        const outcome = this.createDeniedOutcome(proposal, executionId, context, capabilityDecision.reason);
        return { outcome, verification: this.createSkippedVerification(proposal, "Authorization denied") };
      }

      // Step 5: Lower proposal to ActionRequestV1
      const actionRequest = this.lowerProposal(proposal, resolution);

      // Step 6: Determine effective timeout
      const effectiveTimeoutMs = this.getEffectiveTimeout(proposal, actionDescriptor);

      // Step 7: Execute through ActionRuntime with timeout enforcement
      const executionContext: ExecutionContextV1 = {
        contractVersion: "1.0.0",
        missionId: context.missionId,
        taskId: context.runId,
        executionId,
        actor: context.actor,
        signal: combinedSignal,
        deadline: context.deadline,
      };

      for (const approved of authorizedRequests) {
        const request = buildToolCapabilityRequest({ taskId: context.runId, missionId: context.missionId, agentId: context.actor, actor: context.actor,
          toolId: proposal.capability, permission: approved.permission!, input: proposal.arguments, reason: proposal.intent });
        const current = this.capabilityBroker.revalidateAuthority?.(request);
        if (current && !current.granted) {
          const outcome = this.createDeniedOutcome(proposal, executionId, context, current.reason);
          return { outcome, verification: this.createSkippedVerification(proposal, current.reason) };
        }
      }

      const actionResult = await this.executeWithTimeout(
        resolution.providerId,
        actionRequest,
        executionContext,
        effectiveTimeoutMs,
        controller,
        actionDescriptor
      );

      // Step 8: Update circuit breaker on success
      if (actionDescriptor && actionResult.status === "SUCCEEDED") {
        this.recordCircuitBreakerSuccess(actionDescriptor.providerId);
      }

      // Step 9: Verify result
      const verification = await this.verifyResult(proposal, actionResult, executionId);

      // Step 10: Build outcome
      const outcome: ActionOutcome = {
        proposalId: proposal.id,
        executionId,
        missionId: context.missionId,
        executedAt: new Date().toISOString(),
        actionResult,
        verification,
      };

      // Emit completion event
      await this.eventBus.emit("harness.execution.completed", {
        executionId,
        missionId: context.missionId,
        proposalId: proposal.id,
        status: actionResult.status,
        verification: verification.status,
      }, { actor: "harness" });

      return { outcome, verification };
    } catch (error) {
      // Handle execution errors
      const message = error instanceof Error ? error.message : String(error);
      
      // Update circuit breaker on failure
      if (actionDescriptor) {
        this.recordCircuitBreakerFailure(actionDescriptor.providerId);
      }

      const actionResult: ActionResultV1 = {
        executionId,
        providerId: "harness",
        actionId: proposal.capability,
        status: "FAILED",
        output: { error: message },
        evidenceIds: [],
      };

      const verification = await this.verifyResult(proposal, actionResult, executionId);

      const outcome: ActionOutcome = {
        proposalId: proposal.id,
        executionId,
        missionId: context.missionId,
        executedAt: new Date().toISOString(),
        actionResult,
        verification,
      };

      return { outcome, verification };
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  async cancel(executionId: string): Promise<void> {
    const controller = this.activeExecutions.get(executionId);
    if (!controller) throw new Error("No active harness execution with this identifier.");
    if (controller) {
      controller.abort(new Error("Execution cancelled by harness"));
      await this.actionRuntime.cancel(executionId);
    }
  }

  private async validateProposal(proposal: ActionProposal): Promise<void> {
    // Check required fields
    if (!proposal.capability) throw new Error("Proposal missing capability");
    if (!proposal.arguments) throw new Error("Proposal missing arguments");
    if (!proposal.intent) throw new Error("Proposal missing intent");
    if (!proposal.riskLevel) throw new Error("Proposal missing riskLevel");
    if (!proposal.sandbox) throw new Error("Proposal missing sandbox");
    if (!proposal.timeoutMs || proposal.timeoutMs <= 0) throw new Error("Proposal missing valid timeoutMs");
    if (!proposal.selectionReason) throw new Error("Proposal missing selectionReason");
    if (!proposal.proposedBy) throw new Error("Proposal missing proposedBy");

    // Verify verification strategy for irreversible actions
    if (this.config.requireVerificationForIrreversible && 
        (proposal.riskLevel === "IRREVERSIBLE" || proposal.riskLevel === "DESTRUCTIVE") &&
        !proposal.verificationStrategy) {
      throw new Error("Irreversible/DESTRUCTIVE actions require a verification strategy");
    }

    // Verify idempotency key for non-read actions
    if (proposal.riskLevel !== "READ_ONLY" && !proposal.idempotencyKey) {
      throw new Error("Non-read actions require an idempotency key");
    }
  }

  private getEffectiveTimeout(proposal: ActionProposal, actionDescriptor?: ActionDescriptorV1): number {
    // Use the minimum of: proposal timeout, descriptor timeout, risk-level default
    let timeout = proposal.timeoutMs;
    
    if (actionDescriptor) {
      timeout = Math.min(timeout, actionDescriptor.timeoutMs);
    }
    
    const riskTimeout = this.riskTimeouts[proposal.riskLevel] ?? this.config.defaultTimeoutMs;
    return Math.min(timeout, riskTimeout);
  }

  private getCircuitBreakerState(providerId: string): CircuitBreakerState {
    const existing = this.circuitBreakers.get(providerId);
    if (existing) return existing;
    
    const initialState: CircuitBreakerState = {
      failures: 0,
      lastFailure: null,
      state: "CLOSED",
      nextAttempt: null,
    };
    this.circuitBreakers.set(providerId, initialState);
    return initialState;
  }

  private recordCircuitBreakerFailure(providerId: string): void {
    const state = this.getCircuitBreakerState(providerId);
    const now = new Date().toISOString();
    const failures = state.failures + 1;
    
    let newState = state;
    if (failures >= this.circuitBreakerConfig.failureThreshold && state.state === "CLOSED") {
      newState = {
        failures,
        lastFailure: now,
        state: "OPEN",
        nextAttempt: new Date(Date.now() + this.circuitBreakerConfig.resetTimeoutMs).toISOString(),
      };
    } else if (state.state === "HALF_OPEN") {
      newState = {
        failures,
        lastFailure: now,
        state: "OPEN",
        nextAttempt: new Date(Date.now() + this.circuitBreakerConfig.resetTimeoutMs).toISOString(),
      };
    } else {
      newState = { ...state, failures, lastFailure: now };
    }
    
    this.circuitBreakers.set(providerId, newState);
  }

  private recordCircuitBreakerSuccess(providerId: string): void {
    const state = this.getCircuitBreakerState(providerId);
    if (state.state === "HALF_OPEN") {
      this.circuitBreakers.set(providerId, {
        failures: 0,
        lastFailure: null,
        state: "CLOSED",
        nextAttempt: null,
      });
    } else if (state.state === "CLOSED") {
      this.circuitBreakers.set(providerId, {
        ...state,
        failures: 0,
        lastFailure: null,
      });
    }
  }

  private async authorize(proposal: ActionProposal, context: HarnessExecutionContext, resolution: CapabilityResolution, actionDescriptor: ActionDescriptorV1 | undefined, authorizedRequests: CapabilityRequest[]): Promise<CapabilityDecision> {
    // Get the action descriptor to find required permissions
    let requiredPermissions: readonly string[] = [];
    let actionRiskClass = proposal.riskLevel;
    
    if (actionDescriptor) {
      requiredPermissions = actionDescriptor.requiredPermissions;
      actionRiskClass = this.mapRiskClassToExecutionRiskLevel(actionDescriptor.riskClass);
    } else {
      // Fallback: look up descriptor from registry
      for (const provider of this.actionProviderRegistry.list()) {
        const actions = await provider.discoverActions({ signal: context.signal });
        const descriptor = actions.find((a: ActionDescriptorV1) => a.id === proposal.capability);
        if (descriptor) {
          requiredPermissions = descriptor.requiredPermissions;
          actionRiskClass = this.mapRiskClassToExecutionRiskLevel(descriptor.riskClass);
          break;
        }
      }
    }
    
    if (resolution.providerId === "core.tools") {
      const tool = this.toolRegistry.get(proposal.capability);
      if (!tool.ok) throw new Error(tool.error.message);
      requiredPermissions = tool.data.describe().permissions;
    }
    if (requiredPermissions.length === 0) return { requestId: createId("cap"), capabilityId: proposal.capability, granted: false, reason: "Operation declares no capability authority and cannot execute." };
    let decision: CapabilityDecision = { requestId: createId("cap"), capabilityId: proposal.capability, granted: true, reason: "No permissions are required by this registered operation." };
    for (const permission of requiredPermissions) {
      const request = buildToolCapabilityRequest({
        taskId: context.runId, missionId: context.missionId, actor: context.actor, agentId: context.actor,
        toolId: proposal.capability, permission: permission as Permission, input: structuredClone(proposal.arguments),
        reason: proposal.intent,
      });
      decision = await this.capabilityBroker.resolve(request);
      await this.eventBus.emit("harness.authorization", { missionId: context.missionId, proposalId: proposal.id,
        capabilityId: request.capabilityId, granted: decision.granted, reason: decision.reason }, { actor: "harness" });
      if (!decision.granted) return decision;
      authorizedRequests.push(request);
    }
    return decision;
  }

  private async resolveCapability(proposal: ActionProposal, context: HarnessExecutionContext): Promise<CapabilityResolution> {
    // First check action providers
    const providers = this.actionProviderRegistry.list();
    for (const provider of providers) {
      const actions = await provider.discoverActions({ signal: context.signal });
      const descriptor = actions.find((a: ActionDescriptorV1) => a.id === proposal.capability);
      if (descriptor) {
        return {
          providerId: descriptor.providerId,
          descriptor: descriptor as unknown as JsonObject,
          actionId: proposal.capability,
        };
      }
    }

    // Fallback: check if it's a tool
    const tool = this.toolRegistry.get(proposal.capability);
    if (tool.ok) {
      return {
        providerId: "core.tools",
        descriptor: tool.data.describe() as unknown as JsonObject,
        actionId: proposal.capability,
      };
    }

    throw new Error(`Capability not found: ${proposal.capability}`);
  }

  private lowerProposal(proposal: ActionProposal, resolution: CapabilityResolution): ActionRequestV1 {
    return {
      actionId: resolution.actionId,
      input: proposal.arguments,
      dryRun: false,
      idempotencyKey: proposal.idempotencyKey,
    };
  }

  private mapRiskClassToExecutionRiskLevel(riskClass: string): ExecutionRiskLevel {
    switch (riskClass) {
      case "READ_ONLY": return "READ_ONLY";
      case "LOW_RISK_WRITE": return "REVERSIBLE";
      case "EXTERNAL_COMMUNICATION": return "REVERSIBLE";
      case "DATA_MODIFICATION": return "IRREVERSIBLE";
      case "DESTRUCTIVE": return "DESTRUCTIVE";
      case "FINANCIAL": return "DESTRUCTIVE";
      case "SECURITY_SENSITIVE": return "DESTRUCTIVE";
      case "ADMINISTRATIVE": return "DESTRUCTIVE";
      default: return "IRREVERSIBLE";
    }
  }

  private mapRiskLevelToActionClass(riskLevel: string): "READ" | "REVERSIBLE_CHANGE" | "IRREVERSIBLE_ACTION" {
    switch (riskLevel) {
      case "READ_ONLY": return "READ";
      case "REVERSIBLE": return "REVERSIBLE_CHANGE";
      case "IRREVERSIBLE":
      case "DESTRUCTIVE": return "IRREVERSIBLE_ACTION";
      default: return "IRREVERSIBLE_ACTION";
    }
  }

  private async executeWithTimeout(
    providerId: string,
    request: ActionRequestV1,
    context: ExecutionContextV1,
    timeoutMs: number,
    controller: AbortController,
    actionDescriptor?: ActionDescriptorV1
  ): Promise<ActionResultV1> {
    if (context.signal?.aborted) throw new Error("Execution cancelled before dispatch.");
    if (context.deadline && (!Number.isFinite(Date.parse(context.deadline)) || Date.now() >= Date.parse(context.deadline))) throw new Error("Execution deadline expired or is invalid.");
    if (providerId === "core.tools") {
      if (!this.config.executeTool) throw new Error("Legacy tool execution requires the policy-enforced runtime executor.");
      const effectiveDeadline = new Date(Math.min(Date.now() + timeoutMs, context.deadline ? Date.parse(context.deadline) : Infinity)).toISOString();
      const result = await this.config.executeTool(request.actionId, request.input, {
        taskId: context.taskId, actor: context.actor, agentId: context.actor, missionId: context.missionId,
        signal: context.signal, deadline: effectiveDeadline,
      });
      return { executionId: context.executionId, providerId, actionId: request.actionId,
        status: result.ok ? "SUCCEEDED" : result.error.category === "permission" ? "DENIED" : "FAILED", output: result.ok ? result.data : { error: result.error.message }, evidenceIds: [] };
    }
    const effectiveTimeout = Math.min(timeoutMs, actionDescriptor?.timeoutMs ?? timeoutMs,
      context.deadline ? Date.parse(context.deadline) - Date.now() : Infinity);
    const timer = setTimeout(() => controller.abort(new Error("Action execution timed out.")), effectiveTimeout);
    try {
      // ActionRuntime owns policy, validation, idempotency, approval and evidence.
      // Await settlement even after abort so the harness cannot return while effects are still running.
      return await this.actionRuntime.execute(providerId, request, context);
    } finally {
      clearTimeout(timer);
    }
  }

  // Store dependencies for executeWithTimeout
  private dependencies: ActionRuntimeDependencies | null = null;
  
  setDependencies(deps: ActionRuntimeDependencies): void {
    this.dependencies = deps;
  }

  private async verifyResult(proposal: ActionProposal, result: ActionResultV1, executionId: string): Promise<ResultVerification> {
    // This is a simplified verification - the full implementation uses the action-contract's verifyActionResult
    const strategy = proposal.verificationStrategy ?? { kind: "trust_executed", reason: "No verification strategy specified" };
    
    if (result.status !== "SUCCEEDED") {
      return {
        strategy,
        status: "FAILED",
        message: `Action ${result.status.toLowerCase()}: ${result.output?.[ "error" ] ?? "unknown error"}`,
        checkedAt: new Date().toISOString(),
      };
    }

    if (strategy.kind === "trust_executed") {
      return {
        strategy,
        status: "INCONCLUSIVE",
        message: "The operation succeeded, but trust_executed does not validate mission success criteria.",
        checkedAt: new Date().toISOString(),
      };
    }

    // For other strategies, return INCONCLUSIVE (would need probe runner)
    return {
      strategy,
      status: "INCONCLUSIVE",
      message: "Strategy requires probe runner not yet implemented in harness",
      checkedAt: new Date().toISOString(),
    };
  }

  private createDeniedOutcome(proposal: ActionProposal, executionId: string, context: HarnessExecutionContext, reason: string): ActionOutcome {
    const actionResult: ActionResultV1 = {
      executionId,
      providerId: "harness",
      actionId: proposal.capability,
      status: "DENIED",
      output: { reason, error: `CapabilityDeniedError: ${reason}` },
      evidenceIds: [],
    };
    const verification = this.createSkippedVerification(proposal, reason);
    return {
      proposalId: proposal.id,
      executionId,
      missionId: context.missionId,
      executedAt: new Date().toISOString(),
      actionResult,
      verification,
    };
  }

  private createSkippedVerification(proposal: ActionProposal, reason: string): ResultVerification {
    return {
      strategy: proposal.verificationStrategy ?? { kind: "trust_executed", reason },
      status: "SKIPPED",
      message: reason,
      checkedAt: new Date().toISOString(),
    };
  }
}

function combineSignals(parent: AbortSignal | undefined, local: AbortSignal): AbortSignal {
  if (!parent) return local;
  return AbortSignal.any([parent, local]);
}

function evidenceFor(descriptor: ActionDescriptorV1, context: ExecutionContextV1, result: ActionResultV1): EvidenceRecordV1 {
  return {
    contractVersion: QUACK_CONTRACT_VERSION,
    id: createId("evidence"),
    missionId: context.missionId,
    taskId: context.taskId,
    executionId: context.executionId,
    kind: "action",
    createdAt: new Date().toISOString(),
    source: `${descriptor.providerId}:${descriptor.id}`,
    data: {
      status: result.status,
      output: result.output ?? null,
      dryRunSupported: descriptor.supportsDryRun,
    },
    redactions: [],
  };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(bearer|api[_-]?key|token|secret)\s*[:=]?\s*[^\s,;]+/gi, "$1=[REDACTED]");
}