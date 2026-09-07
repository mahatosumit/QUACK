import { type IsoTimestamp, type JsonObject } from "../core/types.js";
import { type AgentRole } from "../organization/types.js";

export const COMPANY_RUNTIME_CONTRACT_VERSION = "quack.company/v1" as const;

export type CompanyRuntimeState =
  | "PLANNED"
  | "FORMING"
  | "READY"
  | "RUNNING"
  | "WAITING"
  | "VERIFYING"
  | "DORMANT";

export type CompanyRuntimeOutcome = "COMPLETED" | "FAILED" | "CANCELLED";

export type CompanyAgentState =
  | "CREATED"
  | "READY"
  | "RUNNING"
  | "WAITING"
  | "WAITING_FOR_DEPENDENCY"
  | "WAITING_FOR_RESOURCE"
  | "WAITING_FOR_TOOL"
  | "WAITING_FOR_APPROVAL"
  | "PAUSED"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "DORMANT";

export interface CompanyGoalAncestryV1 {
  readonly company: { readonly id: string; readonly objective: string };
  readonly goal: { readonly id: string; readonly objective: string };
  readonly project: { readonly id: string; readonly objective: string };
  readonly mission: { readonly id: string; readonly objective: string; readonly successCriteria: readonly string[] };
}

export interface CompanyAgentBudgetV1 {
  readonly tokenLimit: number;
  readonly costLimitUsd: number;
  readonly runtimeMinutes: number;
  readonly modelCallLimit: number;
  readonly toolCallLimit: number;
  readonly retryLimit: number;
}

export interface CompanyAgentPlanV1 {
  readonly id: string;
  readonly role: string;
  readonly runtimeRole: AgentRole;
  readonly objective: string;
  readonly capabilities: readonly string[];
  readonly parentId?: string;
  readonly verifier: boolean;
  readonly workspace: "shared-read-only" | "git-worktree";
  readonly budget: CompanyAgentBudgetV1;
}

export interface CompanyTaskPlanV1 {
  readonly id: string;
  readonly title: string;
  readonly assignedAgentId: string;
  readonly dependencies: readonly string[];
  readonly resources: readonly string[];
  readonly verificationType: "CODE" | "TEST" | "SECURITY" | "RESEARCH" | "DATA" | "ACTION" | "UI";
}

export type CompanyTaskExecutionState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface CompanyTaskResultV1 {
  readonly evidenceRefs: readonly string[];
  readonly output?: unknown;
  readonly verificationApproved?: boolean;
}

export interface CompanyTaskExecutionV1 {
  readonly taskId: string;
  readonly agentPlanId: string;
  readonly state: CompanyTaskExecutionState;
  readonly attempt: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly result?: CompanyTaskResultV1;
  readonly error?: string;
}

export interface MissionCompanyPlanV1 {
  readonly contractVersion: typeof COMPANY_RUNTIME_CONTRACT_VERSION;
  readonly missionId: string;
  readonly companyType: "research" | "software" | "company-operations";
  readonly ancestry: CompanyGoalAncestryV1;
  readonly agents: readonly CompanyAgentPlanV1[];
  readonly tasks: readonly CompanyTaskPlanV1[];
  readonly limits: {
    readonly maxConcurrentAgents: number;
    readonly maxChildrenPerAgent: number;
    readonly maxDepth: number;
    readonly maxTotalAgents: number;
  };
  readonly createdAt: IsoTimestamp;
}

export interface CompanyAgentSnapshotV1 {
  readonly planId: string;
  readonly instanceId?: string;
  readonly leaseId?: string;
  readonly leaseExpiresAt?: IsoTimestamp;
  readonly role: string;
  readonly runtimeRole: AgentRole;
  readonly parentId?: string;
  readonly state: CompanyAgentState;
  readonly grantIds: readonly string[];
  readonly usage: {
    readonly tokens: number;
    readonly estimatedCostUsd: number;
    readonly runtimeMs: number;
    readonly modelCalls: number;
    readonly toolCalls: number;
    readonly retries: number;
  };
  readonly metrics?: JsonObject;
  readonly releasedAt?: IsoTimestamp;
}

export interface CompanyVerificationV1 {
  readonly verifierInstanceId: string;
  readonly approved: boolean;
  readonly evidenceRef: string;
  readonly verifiedAt: IsoTimestamp;
}

export interface MissionCompanyTransitionV1 {
  readonly state: CompanyRuntimeState;
  readonly at: IsoTimestamp;
  readonly reason: string;
}

export interface MissionCompanyRecordV1 {
  readonly contractVersion: typeof COMPANY_RUNTIME_CONTRACT_VERSION;
  readonly missionId: string;
  readonly revision: number;
  readonly plan: MissionCompanyPlanV1;
  readonly state: CompanyRuntimeState;
  readonly outcome?: CompanyRuntimeOutcome;
  readonly agents: readonly CompanyAgentSnapshotV1[];
  readonly evidenceRefs: readonly string[];
  readonly knowledgeRefs: readonly string[];
  readonly verification?: CompanyVerificationV1;
  readonly taskExecutions?: readonly CompanyTaskExecutionV1[];
  readonly transitions: readonly MissionCompanyTransitionV1[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly dormantAt?: IsoTimestamp;
  readonly failureCategory?: "INTERRUPTED" | "BUDGET" | "POLICY" | "EXECUTION" | "VERIFICATION";
}

export interface MissionCompanyRepository {
  save(record: MissionCompanyRecordV1): MissionCompanyRecordV1;
  get(missionId: string): MissionCompanyRecordV1 | undefined;
  list(): MissionCompanyRecordV1[];
}
