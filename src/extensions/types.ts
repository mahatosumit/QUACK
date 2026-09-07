import type {
  AgentManifestV1, EvidenceRecordV1, ExecutionContextV1, ModelDescriptorV1,
  QuackContractVersion, QuackProviderV1, VerificationRecordV1,
} from "../contracts/v1/contracts.js";
import type { IsoTimestamp, JsonObject, QuackResult } from "../core/types.js";
import type { TaskGraph } from "../engine/types.js";
import type { MemoryAccessContext, MemoryItem, MemoryQuery, MemoryStoreInput } from "../memory/os.js";
import type { PluginManifest } from "../plugins/manifest.js";
import type { ProviderRoutingPolicyV1 } from "../providers/kernel.js";
import type { CapabilityGrantScopeRestrictions, CapabilityRequest } from "../security/capability-broker.js";
import type { SkillDefinition, SkillManifest } from "../skills/types.js";
import type { QuackTool, ToolMetadata } from "../tools/tool.js";

export interface ExtensionDependency {
  readonly id: string;
  /** Exact version; version ranges are deliberately not interpreted by admission. */
  readonly version: string;
}

export interface ExtensionManifest {
  readonly id: string;
  readonly version: string;
  readonly contractVersion: QuackContractVersion;
  readonly dependencies?: readonly ExtensionDependency[];
}

export interface ExtensionComponentIdentity {
  readonly id: string;
  readonly version: string;
}

export interface AgentContextPolicy {
  readonly namespaces: readonly string[];
  readonly maxTokens: number;
  readonly maxBytes: number;
  readonly inheritParentContext: boolean;
}

export interface AgentResourceBudget {
  readonly maxIterations: number;
  readonly maxToolCalls: number;
  readonly maxModelCalls: number;
  readonly timeoutMs: number;
  readonly maxConcurrency: number;
  readonly maxTokens?: number;
  readonly maxCostUsd?: number;
}

/** A profile is a policy ceiling and selection metadata, never a capability grant. */
export interface AgentProfile extends AgentManifestV1 {
  readonly mode: "primary" | "subagent";
  readonly modelPolicy: ProviderRoutingPolicyV1;
  readonly capabilityPolicy: {
    readonly ceiling: readonly string[];
    readonly scope?: CapabilityGrantScopeRestrictions;
  };
  readonly allowedTools: readonly string[];
  readonly contextPolicy: AgentContextPolicy;
  readonly resourceBudget: AgentResourceBudget;
  readonly delegationDepth: number;
}

export interface PlannerStrategyContext {
  readonly execution: ExecutionContextV1;
  readonly sessionId: string;
  readonly goal: string;
  readonly context: readonly ContextFragment[];
  readonly catalog: {
    readonly tools: readonly ToolMetadata[];
    readonly skills: readonly SkillManifest[];
    readonly profiles: readonly AgentProfile[];
    readonly models: readonly ModelDescriptorV1[];
  };
  readonly constraints: {
    readonly maxNodes: number;
    readonly allowedTools: readonly string[];
    readonly budget: AgentResourceBudget;
  };
}

/** Proposes the existing TaskGraph. No execution, scheduler or grant API is supplied. */
export interface PlannerStrategy extends ExtensionComponentIdentity {
  plan(context: PlannerStrategyContext): Promise<QuackResult<TaskGraph>> | QuackResult<TaskGraph>;
  replan?(context: PlannerStrategyContext, previous: TaskGraph, observations: JsonObject): Promise<QuackResult<TaskGraph>> | QuackResult<TaskGraph>;
}

export interface ContextRequest {
  readonly execution: ExecutionContextV1;
  readonly sessionId: string;
  readonly namespace: string;
  readonly purpose: string;
  readonly maxTokens: number;
  readonly maxBytes: number;
}

export interface ContextFragment {
  readonly id: string;
  readonly namespace: string;
  readonly content: JsonObject;
  readonly classification: "public" | "internal" | "confidential" | "restricted";
  readonly provenance: { readonly sourceId: string; readonly recordId?: string; readonly observedAt?: IsoTimestamp };
  readonly retention: "ephemeral" | "session" | "persistent";
}

export interface ContextProvider extends ExtensionComponentIdentity {
  load(request: ContextRequest): Promise<readonly ContextFragment[]>;
}

/** Context is supplied by the authenticated runtime, not by model-generated tool input. */
export interface MemoryProviderContext extends MemoryAccessContext {
  readonly namespace: string;
  readonly sessionId: string;
  readonly taskId: string;
  readonly executionId: string;
  readonly operationId: string;
  readonly signal?: AbortSignal;
  readonly deadline?: IsoTimestamp;
}

export interface MemoryProvider extends ExtensionComponentIdentity {
  store(input: MemoryStoreInput, context: MemoryProviderContext): Promise<QuackResult<MemoryItem>>;
  retrieve(query: MemoryQuery, context: MemoryProviderContext): Promise<MemoryItem[]>;
  forget?(id: string, context: MemoryProviderContext): Promise<QuackResult<void>>;
  export?(query: MemoryQuery, context: MemoryProviderContext): Promise<QuackResult<readonly MemoryItem[]>>;
}

/** Use the existing versioned provider protocol rather than another model protocol. */
export type ModelProvider = QuackProviderV1;

export interface ValidationRequest {
  readonly execution: ExecutionContextV1;
  readonly successCriteria: readonly string[];
  readonly output?: JsonObject;
  readonly evidence: readonly EvidenceRecordV1[];
}

export interface ValidationProvider extends ExtensionComponentIdentity {
  validate(request: ValidationRequest): Promise<VerificationRecordV1> | VerificationRecordV1;
}

export interface PolicyRestriction {
  /** ALLOW means this contributor adds no restriction; the broker must still establish authority. */
  readonly decision: "ALLOW" | "ASK" | "DENY";
  readonly reason: string;
}

export interface PolicyProvider extends ExtensionComponentIdentity {
  restrict(request: Readonly<CapabilityRequest>): Promise<PolicyRestriction> | PolicyRestriction;
}

export type PluginHookKind = "runtime" | "mission" | "session" | "model" | "tool" | "capability" | "evidence" | "memory" | "evaluation";

export interface PluginHookContribution {
  readonly kind: PluginHookKind;
  readonly handler: (event: Readonly<JsonObject>) => Promise<void> | void;
}

/** Declarative plugin admission only. Hook execution is unavailable in this contract version. */
export interface PluginContribution {
  readonly manifest: PluginManifest;
  readonly hooks?: readonly PluginHookContribution[];
}

export interface ExtensionContributions {
  readonly agentProfiles?: readonly AgentProfile[];
  readonly skills?: readonly SkillDefinition[];
  readonly tools?: readonly QuackTool[];
  readonly plannerStrategies?: readonly PlannerStrategy[];
  readonly contextProviders?: readonly ContextProvider[];
  readonly memoryProviders?: readonly MemoryProvider[];
  readonly modelProviders?: readonly ModelProvider[];
  readonly validationProviders?: readonly ValidationProvider[];
  readonly policyProviders?: readonly PolicyProvider[];
  readonly plugins?: readonly PluginContribution[];
}

export type ContributionKind = keyof ExtensionContributions;

export interface ExtensionDefinition {
  readonly manifest: ExtensionManifest;
  readonly contributions: ExtensionContributions;
}

export interface AgentProfilePack extends ExtensionDefinition {
  readonly contributions: ExtensionContributions & { readonly agentProfiles: readonly AgentProfile[] };
}

export interface SkillPack extends ExtensionDefinition {
  readonly contributions: ExtensionContributions & { readonly skills: readonly SkillDefinition[] };
}

export interface ToolPack extends ExtensionDefinition {
  readonly contributions: ExtensionContributions & { readonly tools: readonly QuackTool[] };
}

export interface ExtensionSource {
  readonly kind: "builtin" | "application" | "plugin";
  readonly sourceId: string;
  /** Caller-supplied provenance. Admission does not claim to verify code integrity or sandbox it. */
  readonly integrity?: string;
}

export interface ContributionProvenance {
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly kind: ContributionKind;
  readonly id: string;
  readonly version: string;
  readonly source: ExtensionSource;
}

export interface AdmittedExtension extends ExtensionDefinition {
  readonly provenance: readonly ContributionProvenance[];
  readonly source: ExtensionSource;
}

export interface ExtensionAdmissionOptions {
  readonly source: ExtensionSource;
  /** IDs already owned by the host's existing registries; no registry mutation occurs here. */
  readonly occupied?: Partial<Record<ContributionKind, readonly string[]>>;
}
