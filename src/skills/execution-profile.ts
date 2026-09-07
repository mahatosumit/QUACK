import type { IsolationProfile, IsolationRequest, IsolatedWorkload } from "../isolation/contract.js";
import { validateIsolationProfile } from "../isolation/contract.js";
import { resolveInsideRoot } from "../platform/paths.js";
import type { SkillRiskClass, UniversalSkillFields } from "./universal.js";

/**
 * Skill sandbox integration (ADR 0041): binds the universal skill model to
 * the ADR 0039 isolation contract. Default policy is least privilege —
 * workspace-only filesystem, DENY network, materialized environment, DENY
 * secrets — and every relaxation must be explicitly requested by the
 * skill's declared requirements and authorized through the capability
 * broker before execution. Sandbox creation itself never grants additional
 * capabilities.
 */

export interface SkillExecutionProfile {
  readonly executionId: string;
  readonly skillId: string;
  readonly missionId: string;
  readonly taskId?: string;
  readonly actor: string;
  readonly capabilities: readonly string[];
  readonly filesystemPolicy: IsolationProfile["filesystem"];
  readonly networkPolicy: IsolationProfile["network"];
  readonly environmentPolicy: IsolationProfile["environment"];
  readonly secretPolicy: { readonly mode: "DENY" | "EXPLICIT" };
  readonly resourceLimits: IsolationProfile["limits"];
  readonly timeoutMs: number;
  readonly cancellation?: AbortSignal;
  readonly retrySafety: "READ_ONLY" | "IDEMPOTENT_WRITE" | "NON_IDEMPOTENT_WRITE" | "DESTRUCTIVE" | "UNKNOWN";
  readonly sandboxBackend: IsolationProfile["level"];
}

/**
 * Derive a conservative sandbox profile from a skill's universal fields and
 * declared requirements. Higher-risk requirements can only tighten the
 * sandbox level, never loosen it: a skill declaring subprocess/network/
 * secrets keeps worker isolation and explicit policies rather than getting
 * broader access by claiming a stronger profile.
 */
export function deriveSkillExecutionProfile(input: {
  readonly executionId: string;
  readonly skillId: string;
  readonly missionId: string;
  readonly taskId?: string;
  readonly actor: string;
  readonly capabilities: readonly string[];
  readonly workspaceRoot: string;
  readonly fields: UniversalSkillFields;
  readonly riskClass: SkillRiskClass;
  readonly retrySafety?: SkillExecutionProfile["retrySafety"];
  readonly signal?: AbortSignal;
}): SkillExecutionProfile {
  const declaredNetwork = input.fields.networkRequirements.length > 0
    || input.capabilities.some(capability => capability.startsWith("network.")
      || capability === "browser.control" || capability.startsWith("mcp."));
  const networkPolicy: IsolationProfile["network"] = declaredNetwork
    ? { mode: "ALLOWLIST", hosts: [], schemes: [] }
    : { mode: "DENY" };
  const secretPolicy = input.fields.secretRequirements.length > 0
    || input.capabilities.some(capability => capability.startsWith("secrets."))
    ? { mode: "EXPLICIT" as const }
    : { mode: "DENY" as const };

  const profile: SkillExecutionProfile = {
    executionId: input.executionId,
    skillId: input.skillId,
    missionId: input.missionId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    actor: input.actor,
    capabilities: [...input.capabilities],
    filesystemPolicy: { workspaceRoot: input.workspaceRoot },
    networkPolicy,
    environmentPolicy: { variables: {}, secrets: [] },
    secretPolicy,
    resourceLimits: { wallClockMs: 30_000 },
    timeoutMs: 30_000,
    ...(input.signal ? { cancellation: input.signal } : {}),
    retrySafety: input.retrySafety ?? "UNKNOWN",
    // Risk never lowers isolation: HIGH risk keeps at least worker process.
    sandboxBackend: input.riskClass === "LOW" && input.fields.sandboxProfile === "IN_PROCESS"
      ? "IN_PROCESS"
      : input.fields.sandboxProfile === "IN_PROCESS" ? "WORKER_PROCESS" : input.fields.sandboxProfile,
  };
  return profile;
}

/**
 * Validate a derived profile: contradiction checks beyond the isolation
 * contract's own validation. Network ALLOWLIST with no hosts is a pending
 * authorization, not implicit access; secrets EXPLICIT with none listed is
 * denied until materialized.
 */
export function validateSkillExecutionProfile(profile: SkillExecutionProfile): void {
  const isolation: IsolationProfile = {
    level: profile.sandboxBackend,
    filesystem: profile.filesystemPolicy,
    network: profile.networkPolicy,
    environment: profile.environmentPolicy,
    limits: profile.resourceLimits,
  };
  validateIsolationProfile(isolation);
  const workspace = resolveInsideRoot(profile.filesystemPolicy.workspaceRoot, profile.filesystemPolicy.workspaceRoot);
  if (!workspace.allowed) throw new Error("Skill workspace root is not a valid contained path.");
  if (profile.secretPolicy.mode === "EXPLICIT" && profile.environmentPolicy.secrets.length === 0) {
    throw new Error("EXPLICIT secret policy requires materialized secret grants before execution.");
  }
}

/**
 * Build the isolation request for a skill module workload. The workload
 * receives only IsolatedIo: workspace root, materialized environment, and
 * the signal. No host registries, brokers, or runtime APIs cross the
 * boundary.
 */
export function toIsolationRequest(profile: SkillExecutionProfile, workload: IsolatedWorkload, deadline?: string): IsolationRequest {
  validateSkillExecutionProfile(profile);
  const isolation: IsolationProfile = {
    level: profile.sandboxBackend,
    filesystem: profile.filesystemPolicy,
    network: profile.networkPolicy,
    environment: profile.environmentPolicy,
    limits: profile.resourceLimits,
  };
  return {
    missionId: profile.missionId,
    ...(profile.taskId ? { taskId: profile.taskId } : {}),
    executionId: profile.executionId,
    actor: profile.actor,
    profile: isolation,
    workload,
    ...(profile.cancellation ? { signal: profile.cancellation } : {}),
    ...(deadline ? { deadline } : {}),
  };
}
