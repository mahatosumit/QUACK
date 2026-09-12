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
import {
  resolveExecutionPolicy,
  clampOutputBytes,
  type ExecutionPolicy,
} from "./execution-policy.js";

/** Result of harness execution. */
export interface HarnessResult {
  readonly outcome: ActionOutcome;
  readonly verification: ResultVerification;
  /** P12 runtime-observed settlement evidence (never provider-claimed). */
  readonly evidence: {
    readonly timedOut: boolean;
    readonly cancelled: boolean;
  };
  /** P12 resolved policy when the execution reached policy resolution. */
  readonly policy?: ExecutionPolicy;
}

/** Harness execution context from the executive loop. */
export interface HarnessExecutionContext {
  readonly missionId: string;
  readonly runId: string;
  readonly iterationId: string;
  readonly actor: string;
  readonly signal?: AbortSignal;
  readonly deadline?: IsoTimestamp;
  /**
   * P13 (ADR 0047, review finding 10): the CANONICAL mission step index,
   * assigned by the runtime loop — never derived from model output and
   * never supplied by a proposal payload. Binds execution evidence to the
   * step that actually dispatched it; a mismatched index fails identity
   * settlement fail-closed. Optional only for pre-P13 callers; the governed
   * loop always supplies it.
   */
  readonly stepIndex?: number;
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
  /** P12 (ADR 0046): trusted isolation requirement from deployer configuration. */
  readonly requiredIsolation?: import("../../isolation/contract.js").IsolationLevel;
  /** P12: isolation backend available to this composition, when any. */
  readonly isolationBackend?: import("../../isolation/contract.js").IsolationBackend;
  /** P12: trusted containment overrides (deployer configuration), never proposal data. */
  readonly policyOverrides?: { readonly maxOutputBytes?: number; readonly timeoutCeilingMs?: number };
  /**
   * P13 (ADR 0047): governed isolated-execution surface. When provided AND
   * the proposal's capability has a REGISTERED workload adapter, execution
   * routes through the trusted IsolationSupervisor — a real isolated
   * environment — instead of the in-process host path. Capabilities without
   * an adapter keep the honest POLICY_RESTRICTED path; no silent downgrade
   * exists in either direction.
   */
  readonly isolation?: {
    readonly supervisor: import("../../isolation/supervisor.js").IsolationSupervisor;
    readonly adapters: import("../../isolation/workload-adapter.js").WorkloadAdapterRegistry;
    /** P13: trusted probe runner for runtime-derived verification. */
    readonly probeRunner?: import("../../isolation/probe-runner.js").ProbeRunner;
    /** P13 review finding 10: when provided, verification settlement must
     * produce a durable record or the reported verdict downgrades to
     * INCONCLUSIVE (never PASSED/VERIFIED over an unconfirmable state). */
    readonly evidenceStore?: {
      load(executionId: string): Promise<import("../../isolation/execution-evidence.js").ExecutionEvidenceRecord | undefined>;
    };
  };
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
    let policy: ExecutionPolicy | undefined;
    // P12 runtime-observed settlement evidence — never taken from provider output.
    const evidence = { timedOut: false, cancelled: false };

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

      // Step 3b (P12): resolve the canonical execution policy from TRUSTED
      // inputs only (descriptor risk/timeout + trusted isolation config).
      // Proposal-supplied timeout/risk/sandbox never feed the policy.
      policy = resolveExecutionPolicy({
        capability: proposal.capability,
        providerKind: resolution.providerId === "core.tools" ? "CORE_TOOL" : "ACTION_PROVIDER",
        riskLevel: actionDescriptor
          ? this.mapRiskClassToExecutionRiskLevel(actionDescriptor.riskClass)
          : "REVERSIBLE",
        ...(actionDescriptor ? { descriptorTimeoutMs: actionDescriptor.timeoutMs } : {}),
        ...(this.config.requiredIsolation ? { requiredIsolation: this.config.requiredIsolation } : {}),
        ...(this.config.isolationBackend ? { isolationBackend: this.config.isolationBackend } : {}),
        ...(this.config.policyOverrides ? { overrides: this.config.policyOverrides } : {}),
      });
      await this.eventBus.emit("execution.policy.resolved", {
        executionId, missionId: context.missionId, capability: proposal.capability,
        riskLevel: policy.riskLevel, timeoutMs: policy.timeoutMs,
        isolation: policy.isolation.state, policyDigest: policy.digest,
      }, { actor: "harness" }).catch(() => undefined);
      if (policy.isolation.state === "FAILED_CLOSED") {
        // Required isolation unavailable: durable denial, no fallback, no
        // silent downgrade to a weaker mode.
        await this.eventBus.emit("execution.denied", {
          executionId, missionId: context.missionId, capability: proposal.capability,
          reason: `required isolation '${policy.isolation.requiredLevel}' unavailable`,
        }, { actor: "harness" }).catch(() => undefined);
        const outcome = this.createDeniedOutcome(
          proposal, executionId, context,
          `Required isolation level '${policy.isolation.requiredLevel}' is unavailable on this runtime; execution fails closed.`,
        );
        return { outcome, verification: this.createSkippedVerification(proposal, "Isolation requirement unavailable"), evidence, policy };
      }

      // Step 4: Authorize through capability broker
      const capabilityDecision = await this.authorize(proposal, context, resolution, actionDescriptor, authorizedRequests);
      if (!capabilityDecision.granted) {
        await this.eventBus.emit("execution.denied", {
          executionId, missionId: context.missionId, capability: proposal.capability,
          reason: capabilityDecision.reason,
        }, { actor: "harness" }).catch(() => undefined);
        const outcome = this.createDeniedOutcome(proposal, executionId, context, capabilityDecision.reason);
        return { outcome, verification: this.createSkippedVerification(proposal, "Authorization denied"), evidence, policy };
      }

      // Step 5: Lower proposal to ActionRequestV1
      const actionRequest = this.lowerProposal(proposal, resolution);

      // Step 5b (P13): isolated-execution routing. When the composition
      // provides the governed isolation surface AND the capability has a
      // REGISTERED workload adapter, execution crosses the real isolation
      // boundary via the trusted supervisor. The adapter registry is
      // deployer-registered; model output can only NAME capabilities.
      // Authorization already happened (step 4) — the broker remains the
      // single authority; isolation decides WHERE, not WHETHER.
      //
      // DOWNGRADE GATE (P13 security review findings 1+2): there are
      // exactly two legal outcomes once an isolation surface exists:
      //   a) adapter REGISTERED → execute through isolation, or
      //   b) adapter UNREGISTERED AND policy.isolation.state is
      //      POLICY_RESTRICTED → honest host path (never was
      //      isolation-eligible).
      // Everything else DENIES fail-closed:
      //   - adapter REJECTED (model-controlled arguments must NEVER select
      //     the execution environment),
      //   - requiredIsolation above policy-only with no adapter (the
      //     policy would claim isolation while executing in-process).
      const isolationSurface = this.config.isolation;
      const adapterResolution = isolationSurface
        ? isolationSurface.adapters.resolve(proposal.capability, proposal.arguments)
        : undefined;
      const isolatedStateDemanded = policy.isolation.state === "PROCESS_ISOLATED" || policy.isolation.state === "OS_ISOLATED";
      if (isolationSurface && adapterResolution?.kind === "REJECTED") {
        const reason = adapterResolution.reason;
        await this.eventBus.emit("execution.denied", {
          executionId, missionId: context.missionId, capability: proposal.capability,
          reason: "workload adapter rejected the arguments; isolated execution fails closed",
        }, { actor: "harness" }).catch(() => undefined);
        const outcome = this.createDeniedOutcome(proposal, executionId, context, `${reason}; execution fails closed rather than downgrading to the host path.`);
        return { outcome, verification: this.createSkippedVerification(proposal, "Adapter rejected arguments"), evidence, policy };
      }
      if (isolatedStateDemanded && adapterResolution?.kind !== "REGISTERED") {
        // Trusted configuration demanded process/OS isolation but no
        // registered adapter can provide it for this capability: DENY.
        // Never claim isolation while executing in-process.
        await this.eventBus.emit("execution.denied", {
          executionId, missionId: context.missionId, capability: proposal.capability,
          reason: `required isolation '${policy.isolation.requiredLevel}' has no registered workload adapter for this capability`,
        }, { actor: "harness" }).catch(() => undefined);
        const outcome = this.createDeniedOutcome(proposal, executionId, context,
          `Required isolation '${policy.isolation.requiredLevel}' cannot be provided for capability '${proposal.capability}' (no registered workload adapter); execution fails closed.`);
        return { outcome, verification: this.createSkippedVerification(proposal, "Isolation requirement unmet"), evidence, policy };
      }
      if (isolationSurface && adapterResolution?.kind === "REGISTERED") {
        const adapter = adapterResolution.adapter;
        // P13 review finding 10: the evidence stepIndex is the RUNTIME's
        // canonical mission step (context.stepIndex), never a constant and
        // never model-supplied. A composition that failed to provide it is
        // a wiring bug — fail closed rather than record misattributed
        // evidence.
        if (typeof context.stepIndex !== "number" || !Number.isInteger(context.stepIndex) || context.stepIndex < 0) {
          await this.eventBus.emit("execution.denied", {
            executionId, missionId: context.missionId, capability: proposal.capability,
            reason: "isolated execution requires the canonical runtime stepIndex",
          }, { actor: "harness" }).catch(() => undefined);
          const outcome = this.createDeniedOutcome(proposal, executionId, context,
            "Isolated execution requires the canonical runtime stepIndex; execution fails closed rather than recording misattributed evidence.");
          return { outcome, verification: this.createSkippedVerification(proposal, "Missing canonical stepIndex"), evidence, policy };
        }
        const isolatedResult = await isolationSurface.supervisor.execute({
          missionId: context.missionId,
          stepIndex: context.stepIndex,
          capability: proposal.capability,
          executionId,
          requiredLevel: adapter.requiredLevel,
          profile: {
            filesystem: { workspaceRoot: isolationSurface.supervisor.workspaceRoot },
            network: { mode: "DENY" },
            environment: { variables: {}, secrets: [] },
            limits: {
              wallClockMs: policy.timeoutMs,
              maxOutputBytes: policy.limits.maxOutputBytes,
            },
          },
          workload: { kind: "module", entry: adapter.entry, args: proposal.arguments },
          sourceDirectory: adapter.sourceDirectory,
          signal: combinedSignal,
        });
        if (isolatedResult.status === "DENIED") {
          await this.eventBus.emit("execution.denied", {
            executionId, missionId: context.missionId, capability: proposal.capability,
            reason: isolatedResult.error ?? "isolated execution denied",
          }, { actor: "harness" }).catch(() => undefined);
          const deniedOutcome = this.createDeniedOutcome(proposal, executionId, context, isolatedResult.error ?? "Isolated execution failed closed.");
          return { outcome: deniedOutcome, verification: this.createSkippedVerification(proposal, "Isolation unavailable"), evidence, policy };
        }
        // Runtime-observed terminal facts from the supervisor (never workload
        // self-report): timeout/cancellation flags for P12 classification.
        if (isolatedResult.status === "TIMED_OUT") evidence.timedOut = true;
        if (isolatedResult.status === "CANCELLED") evidence.cancelled = true;

        const contained = clampOutputBytes(
          isolatedResult.status === "SUCCEEDED" ? (isolatedResult.output ?? {}) : { error: isolatedResult.error ?? isolatedResult.status },
          policy.limits.maxOutputBytes,
        );
        const isolatedActionResult: ActionResultV1 = {
          executionId,
          providerId: `isolation:${isolatedResult.backendId}`,
          actionId: proposal.capability,
          status: isolatedResult.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
          output: (contained.output ?? {}) as JsonObject,
          evidenceIds: [],
        };

        // P13 verification: run the trusted probe runner against the
        // supervisor-observed result. Model output never supplies the
        // verification result; probes read runtime evidence only.
        let verification: ResultVerification;
        if (isolatedResult.status === "SUCCEEDED" && isolationSurface.probeRunner && proposal.verificationStrategy?.kind === "probe_external_state") {
          const probed = await isolationSurface.probeRunner.verify({
            strategy: proposal.verificationStrategy,
            result: isolatedActionResult,
            facts: isolatedResult.evidence.facts,
            missionId: context.missionId,
            executionId,
          });
          // P13 review finding 10: durable settlement is part of the
          // verdict. A journal/evidence-settlement failure means the
          // runtime can no longer CONFIRM the verified state durably —
          // the reported verdict downgrades to INCONCLUSIVE (never
          // PASSED/VERIFIED). This includes the no-record case: when the
          // durable store cannot produce the evidence record, the state
          // is unconfirmed. The settlement error is surfaced, never
          // swallowed.
          let settled: import("../../isolation/execution-evidence.js").ExecutionEvidenceRecord | undefined;
          let settlementError: string | undefined;
          try {
            settled = await isolationSurface.supervisor.settleVerification({
              missionId: context.missionId,
              stepIndex: context.stepIndex,
              capability: proposal.capability,
              executionId,
              verification: {
                state: probed.kind === "PASSED" ? "VERIFIED" : probed.kind === "FAILED" ? "FAILED" : "INCONCLUSIVE",
                probesRun: probed.probesRun,
                checkedAt: new Date().toISOString(),
                ...(probed.summary !== undefined ? { summary: probed.summary } : {}),
              },
            });
          } catch (error) {
            settlementError = error instanceof Error ? error.message : String(error);
          }
          const settlementOk = settled !== undefined && settlementError === undefined;
          // P13 review finding 10 (no-record case): when the composition
          // provides a durable evidence store, settlement must produce a
          // loadable record — otherwise the verified state is unconfirmable
          // and the verdict stays INCONCLUSIVE.
          if (settlementOk && isolationSurface.evidenceStore) {
            const durable = await isolationSurface.evidenceStore.load(executionId).catch(() => undefined);
            if (!durable) {
              settlementError = "no durable evidence record could be loaded after settlement";
            }
          }
          const finalOk = settled !== undefined && settlementError === undefined;
          const reportedKind = finalOk ? probed.kind : "INCONCLUSIVE";
          if (!finalOk) {
            await this.eventBus.emit("execution.unverified", {
              executionId, missionId: context.missionId, capability: proposal.capability,
              probes: probed.probesRun.length, reason: settlementError ?? "verification settlement produced no durable record; verdict downgraded to INCONCLUSIVE",
            }, { actor: "harness" }).catch(() => undefined);
          } else {
            await this.eventBus.emit(probed.kind === "PASSED" ? "execution.verified" : "execution.unverified", {
              executionId, missionId: context.missionId, capability: proposal.capability,
              probes: probed.probesRun.length,
            }, { actor: "harness" }).catch(() => undefined);
          }
          verification = {
            strategy: proposal.verificationStrategy,
            status: reportedKind === "PASSED" ? "PASSED" : reportedKind === "FAILED" ? "FAILED" : "INCONCLUSIVE",
            ...(reportedKind === "INCONCLUSIVE" && !finalOk
              ? { message: `Verification settlement failed; the durable journal cannot confirm this state: ${settlementError ?? "no durable evidence record was produced"}. Verdict stays INCONCLUSIVE — never VERIFIED.` }
              : { message: probed.summary }),
            checkedAt: new Date().toISOString(),
          };
        } else {
          verification = await this.verifyResult(proposal, isolatedActionResult, executionId);
          await this.eventBus.emit("execution.unverified", {
            executionId, missionId: context.missionId, capability: proposal.capability,
            probes: 0,
          }, { actor: "harness" }).catch(() => undefined);
        }

        const outcome: ActionOutcome = {
          proposalId: proposal.id,
          executionId,
          missionId: context.missionId,
          executedAt: new Date().toISOString(),
          actionResult: isolatedActionResult,
          verification,
        };
        await this.eventBus.emit("harness.execution.completed", {
          executionId, missionId: context.missionId, proposalId: proposal.id,
          status: isolatedActionResult.status, verification: verification.status,
          backend: isolatedResult.backendId,
        }, { actor: "harness" }).catch(() => undefined);
        return { outcome, verification, evidence, policy };
      }
      // Remaining legal host-path case: adapter UNREGISTERED (or no
      // isolation surface) AND the policy honestly says POLICY_RESTRICTED.
      // The downgrade gate above already denied REJECTED-adapter and
      // isolation-demanding-without-adapter cases.


      // Step 6 (P12): the effective timeout is POLICY-owned. The proposal's
      // timeoutMs is no longer consulted — the runtime cannot be talked
      // into a longer execution by payload data.
      const effectiveTimeoutMs = policy.timeoutMs;

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
          await this.eventBus.emit("execution.denied", {
            executionId, missionId: context.missionId, capability: proposal.capability,
            reason: current.reason,
          }, { actor: "harness" }).catch(() => undefined);
          const outcome = this.createDeniedOutcome(proposal, executionId, context, current.reason);
          return { outcome, verification: this.createSkippedVerification(proposal, current.reason), evidence, policy };
        }
      }

      const actionResult = await this.executeWithTimeout(
        resolution.providerId,
        actionRequest,
        executionContext,
        effectiveTimeoutMs,
        controller,
        actionDescriptor,
        evidence,
      );

      // Step 7b (P12): output containment at the boundary. Oversized output
      // is dropped and flagged — never previewed.
      const contained = clampOutputBytes(actionResult.output, policy.limits.maxOutputBytes);
      const containedResult: ActionResultV1 = contained.truncated
        ? { ...actionResult, output: { ...contained.output } as JsonObject }
        : actionResult;

      // Step 8: Update circuit breaker on success
      if (actionDescriptor && actionResult.status === "SUCCEEDED") {
        this.recordCircuitBreakerSuccess(actionDescriptor.providerId);
      }

      // Step 9: Verify result
      const verification = await this.verifyResult(proposal, containedResult, executionId);

      // Step 10: Build outcome
      const outcome: ActionOutcome = {
        proposalId: proposal.id,
        executionId,
        missionId: context.missionId,
        executedAt: new Date().toISOString(),
        actionResult: containedResult,
        verification,
      };

      if (evidence.timedOut) {
        evidence.cancelled = false;
        await this.eventBus.emit("execution.timeout", {
          executionId, missionId: context.missionId, capability: proposal.capability,
          timeoutMs: policy.timeoutMs,
        }, { actor: "harness" }).catch(() => undefined);
      } else if (combinedSignal.aborted || context.signal?.aborted) {
        evidence.cancelled = true;
        await this.eventBus.emit("execution.cancelled", {
          executionId, missionId: context.missionId, capability: proposal.capability,
        }, { actor: "harness" }).catch(() => undefined);
      }

      // Emit completion event
      await this.eventBus.emit("harness.execution.completed", {
        executionId,
        missionId: context.missionId,
        proposalId: proposal.id,
        status: containedResult.status,
        verification: verification.status,
      }, { actor: "harness" });

      return { outcome, verification, evidence, policy };
    } catch (error) {
      // Handle execution errors
      const message = error instanceof Error ? error.message : String(error);

      // P12 evidence: distinguish runtime-observed timeout / cancellation
      // from plain failure by the signals the harness itself controls.
      if (evidence.timedOut) {
        evidence.cancelled = false;
      } else if (context.signal?.aborted) {
        evidence.cancelled = true;
      }
      if (evidence.timedOut) {
        await this.eventBus.emit("execution.timeout", {
          executionId, missionId: context.missionId, capability: proposal.capability,
          timeoutMs: policy?.timeoutMs ?? 0,
        }, { actor: "harness" }).catch(() => undefined);
      } else if (evidence.cancelled) {
        await this.eventBus.emit("execution.cancelled", {
          executionId, missionId: context.missionId, capability: proposal.capability,
        }, { actor: "harness" }).catch(() => undefined);
      }

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

      return { outcome, verification, evidence, policy };
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
    actionDescriptor?: ActionDescriptorV1,
    evidence?: { timedOut: boolean; cancelled: boolean },
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
    const timer = setTimeout(() => {
      if (evidence) evidence.timedOut = true;
      controller.abort(new Error("Action execution timed out."));
    }, effectiveTimeout);
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