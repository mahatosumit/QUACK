import type { IsoTimestamp, JsonObject, JsonValue, QuackResult } from "../../core/types.js";

/** Public contract version shared by the first stable QUACK plugin boundary. */
export const QUACK_CONTRACT_VERSION = "1.0.0" as const;
export type QuackContractVersion = typeof QUACK_CONTRACT_VERSION;

export type CapabilityName =
  | "text"
  | "vision"
  | "audio"
  | "embedding"
  | "reranking"
  | "streaming"
  | "tool-calling"
  | "parallel-tool-calling"
  | "structured-output"
  | "json-schema"
  | "reasoning"
  | "context-window"
  | "max-output"
  | "batch"
  | "cancellation"
  | "token-accounting";

export type CapabilitySupportLevel = "NATIVE" | "EMULATED" | "DEGRADED" | "UNSUPPORTED";

/** Explicit capability truth. Numeric limits live in `value`; support quality never does. */
export interface ProviderCapabilitySupport {
  readonly capability: CapabilityName;
  readonly level: CapabilitySupportLevel;
  readonly value?: number;
  readonly reason?: string;
  readonly verifiedAt?: IsoTimestamp;
}

export interface CapabilityRequirement {
  readonly capability: CapabilityName;
  readonly minimumLevel?: Exclude<CapabilitySupportLevel, "UNSUPPORTED">;
  readonly minimumValue?: number;
  readonly required?: boolean;
}

export type ExecutionBoundary = "local" | "cloud" | "remote-private";

export interface ProviderMetadataV1 {
  readonly contractVersion: QuackContractVersion;
  readonly providerId: string;
  readonly displayName: string;
  readonly runtime: string;
  readonly boundary: ExecutionBoundary;
  readonly endpoint?: string;
  readonly credentialEnvironmentVariables: readonly string[];
}

export type ProviderHealthStatus = "HEALTHY" | "DEGRADED" | "OFFLINE" | "AUTHENTICATION_ERROR" | "RATE_LIMITED";

export interface ProviderHealthV1 {
  readonly status: ProviderHealthStatus;
  readonly checkedAt: IsoTimestamp;
  readonly latencyMs?: number;
  readonly message?: string;
}

export interface ModelDescriptorV1 {
  readonly id: string;
  readonly providerId: string;
  readonly runtime: string;
  readonly capabilities: readonly ProviderCapabilitySupport[];
  readonly metadata?: JsonObject;
}

export interface ProviderModelRequestV1 {
  readonly model: string;
  readonly prompt: string;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly responseSchema?: JsonObject;
  readonly tools?: readonly ProviderToolDefinitionV1[];
  readonly toolChoice?: "auto" | "none" | "required" | string;
  readonly metadata?: JsonObject;
}

export interface ProviderToolDefinitionV1 {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
}

export interface ProviderToolCallV1 {
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
}

export interface NormalizedTokenUsageV1 {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly source: "provider" | "estimated" | "unavailable";
}

export interface ProviderModelResponseV1 {
  readonly executionId: string;
  readonly providerId: string;
  readonly model: string;
  readonly text: string;
  readonly toolCalls?: readonly ProviderToolCallV1[];
  readonly finishReason?: string;
  readonly usage: NormalizedTokenUsageV1;
  readonly latencyMs: number;
  readonly rawMetadata?: JsonObject;
}

export interface ProviderModelEventV1 {
  readonly executionId: string;
  readonly providerId: string;
  readonly model: string;
  readonly type: "TEXT_DELTA" | "USAGE" | "COMPLETED";
  readonly text?: string;
  readonly usage?: NormalizedTokenUsageV1;
}

export interface ExecutionContextV1 {
  readonly contractVersion: QuackContractVersion;
  readonly missionId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly actor: string;
  readonly signal?: AbortSignal;
  readonly deadline?: IsoTimestamp;
  readonly metadata?: JsonObject;
}

/** QUACK Provider Contract v1. Providers are runtime plugins, not kernel dependencies. */
export interface QuackProviderV1 {
  metadata(): ProviderMetadataV1;
  health(context?: Pick<ExecutionContextV1, "signal" | "deadline">): Promise<ProviderHealthV1>;
  discoverModels(context?: Pick<ExecutionContextV1, "signal" | "deadline">): Promise<readonly ModelDescriptorV1[]>;
  capabilities(model: string): Promise<readonly ProviderCapabilitySupport[]>;
  generate(request: ProviderModelRequestV1, context: ExecutionContextV1): Promise<ProviderModelResponseV1>;
  stream?(request: ProviderModelRequestV1, context: ExecutionContextV1): AsyncIterable<ProviderModelEventV1>;
  cancel?(executionId: string): Promise<void>;
}

export type ProviderFailureCategory =
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "CONNECTION"
  | "MODEL_NOT_FOUND"
  | "CAPABILITY_MISMATCH"
  | "CONTEXT_OVERFLOW"
  | "INVALID_REQUEST"
  | "MALFORMED_RESPONSE"
  | "TOOL_CALL_INVALID"
  | "PROVIDER_INTERNAL"
  | "CANCELLED"
  | "POLICY_DENIED";

export interface NormalizedProviderErrorV1 {
  readonly contractVersion: QuackContractVersion;
  readonly category: ProviderFailureCategory;
  readonly providerId: string;
  readonly model?: string;
  readonly message: string;
  readonly retriable: boolean;
  readonly retryAfterMs?: number;
  readonly causeCode?: string;
}

export interface ExecutionRequestV1 {
  readonly contractVersion: QuackContractVersion;
  readonly intent: string;
  readonly missionId: string;
  readonly actor: string;
  readonly requirements: readonly CapabilityRequirement[];
  readonly policy?: JsonObject;
  readonly input?: JsonObject;
}

export interface ExecutionResultV1 {
  readonly contractVersion: QuackContractVersion;
  readonly missionId: string;
  readonly executionId: string;
  readonly status: "COMPLETED" | "FAILED" | "CANCELLED" | "POLICY_DENIED";
  readonly output?: JsonValue;
  readonly evidenceIds: readonly string[];
  readonly verificationIds: readonly string[];
  readonly error?: NormalizedProviderErrorV1;
}

/** QUACK Runtime Contract v1. */
export interface QuackRuntimeV1 {
  execute(request: ExecutionRequestV1): Promise<QuackResult<ExecutionResultV1>>;
  cancel(executionId: string): Promise<void>;
  resume(missionId: string): Promise<QuackResult<ExecutionResultV1>>;
}

export type ActionRiskClass =
  | "READ_ONLY"
  | "LOW_RISK_WRITE"
  | "EXTERNAL_COMMUNICATION"
  | "DATA_MODIFICATION"
  | "DESTRUCTIVE"
  | "FINANCIAL"
  | "SECURITY_SENSITIVE"
  | "ADMINISTRATIVE";

export interface ActionDescriptorV1 {
  readonly contractVersion: QuackContractVersion;
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly riskClass: ActionRiskClass;
  readonly sideEffect: "read" | "write" | "destructive";
  readonly externalCommunication: boolean;
  readonly financialImpact: boolean;
  readonly authenticationScopes: readonly string[];
  readonly requiredPermissions: readonly string[];
  readonly idempotent: boolean;
  readonly supportsDryRun: boolean;
  readonly supportsCompensation: boolean;
  readonly timeoutMs: number;
  readonly dataClassification: "public" | "internal" | "confidential" | "restricted";
  readonly networkRequirements: readonly string[];
  readonly approval: "NEVER" | "POLICY" | "ALWAYS";
}

export interface ActionProviderMetadataV1 {
  readonly contractVersion: QuackContractVersion;
  readonly providerId: string;
  readonly displayName: string;
  readonly transport: "local" | "mcp" | "rest" | "openapi" | "cli" | "browser" | "workflow" | "webhook" | "plugin";
  readonly boundary: ExecutionBoundary;
}

export interface ActionRequestV1 {
  readonly actionId: string;
  readonly input: JsonObject;
  readonly dryRun?: boolean;
  readonly idempotencyKey?: string;
}

export interface ActionResultV1 {
  readonly executionId: string;
  readonly providerId: string;
  readonly actionId: string;
  readonly status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "DENIED";
  readonly output?: JsonObject;
  readonly evidenceIds: readonly string[];
  readonly compensationToken?: string;
}

/** QUACK Action Contract v1. */
export interface ActionProviderV1 {
  metadata(): ActionProviderMetadataV1;
  health(context?: Pick<ExecutionContextV1, "signal" | "deadline">): Promise<ProviderHealthV1>;
  discoverActions(context?: Pick<ExecutionContextV1, "signal" | "deadline">): Promise<readonly ActionDescriptorV1[]>;
  execute(request: ActionRequestV1, context: ExecutionContextV1): Promise<ActionResultV1>;
  reconcile?(request: ActionRequestV1, context: ExecutionContextV1): Promise<ActionResultV1>;
  cancel?(executionId: string): Promise<void>;
  compensate?(compensationToken: string, context: ExecutionContextV1): Promise<ActionResultV1>;
}

/** QUACK Tool Contract v1. Tools are local action implementations with explicit schemas. */
export interface ToolDescriptorV1 {
  readonly contractVersion: QuackContractVersion;
  readonly id: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly requiredPermissions: readonly string[];
  readonly riskClass: ActionRiskClass;
}

/** QUACK Agent Manifest v1. External formats must be imported into this boundary. */
export interface AgentManifestV1 {
  readonly contractVersion: QuackContractVersion;
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly requiredCapabilities: readonly CapabilityRequirement[];
  readonly requiredPermissions: readonly string[];
  readonly entrypoint?: string;
  readonly metadata?: JsonObject;
}

/** QUACK Evidence Contract v1. */
export interface EvidenceRecordV1 {
  readonly contractVersion: QuackContractVersion;
  readonly id: string;
  readonly missionId: string;
  readonly taskId?: string;
  readonly executionId: string;
  readonly kind: "provider" | "action" | "tool" | "verification" | "state";
  readonly createdAt: IsoTimestamp;
  readonly source: string;
  readonly digest?: string;
  readonly data: JsonValue;
  readonly redactions: readonly string[];
}

/** QUACK Verification Contract v1. */
export interface VerificationRecordV1 {
  readonly contractVersion: QuackContractVersion;
  readonly id: string;
  readonly missionId: string;
  readonly executionId: string;
  readonly verifier: string;
  readonly status: "PASSED" | "FAILED" | "INCONCLUSIVE";
  readonly checkedAt: IsoTimestamp;
  readonly evidenceIds: readonly string[];
  readonly message: string;
  readonly details?: JsonObject;
}

export function capabilitySupport(
  capabilities: readonly ProviderCapabilitySupport[],
  name: CapabilityName,
): ProviderCapabilitySupport {
  return capabilities.find((candidate) => candidate.capability === name) ?? {
    capability: name,
    level: "UNSUPPORTED",
    reason: "Provider did not advertise this capability.",
  };
}

export function satisfiesCapability(
  support: ProviderCapabilitySupport,
  requirement: CapabilityRequirement,
): boolean {
  if (support.level === "UNSUPPORTED") return false;
  const ranks: Record<CapabilitySupportLevel, number> = {
    UNSUPPORTED: 0,
    DEGRADED: 1,
    EMULATED: 2,
    NATIVE: 3,
  };
  const minimum = requirement.minimumLevel ?? "DEGRADED";
  if (ranks[support.level] < ranks[minimum]) return false;
  return requirement.minimumValue === undefined || (support.value !== undefined && support.value >= requirement.minimumValue);
}
