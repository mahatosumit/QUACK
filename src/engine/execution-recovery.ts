import { createHash } from "node:crypto";
import { QUACK_CONTRACT_VERSION, type EvidenceRecordV1, type VerificationRecordV1 } from "../contracts/v1/contracts.js";
import { createId, now, type JsonObject } from "../core/types.js";
import type { LoopBudget } from "../agent-loop/contract.js";
import type { MissionState } from "../runtime/mission-lifecycle/mission-state-machine.js";
import type { ToolInvocation, ToolInvocationOutcome } from "../tools/tool.js";
import type { Checkpoint, TaskGraph } from "./types.js";

export interface ExecutionIdentity {
  readonly missionId: string;
  readonly executionId: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly workflowId: string;
  readonly actor: string;
  readonly agentId?: string;
  readonly skillId?: string;
  readonly memoryProviderId?: string;
  readonly memoryProviderVersion?: string;
  readonly memoryNamespace?: string;
}

export interface MemoryWriteRecord {
  readonly id: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly purpose: "completion";
  readonly inputDigest: string;
  readonly status: "STARTED" | "COMPLETED";
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly providerRecordId?: string;
}

export type RetrySafety = "READ_ONLY" | "IDEMPOTENT_WRITE" | "NON_IDEMPOTENT_WRITE" | "DESTRUCTIVE" | "UNKNOWN";

export interface InvocationRecord {
  readonly id: string;
  readonly nodeId: string;
  readonly index: number;
  readonly attemptId: string;
  readonly attempts: number;
  readonly invocation: ToolInvocation;
  readonly safety: RetrySafety;
  readonly status: "STARTED" | "COMPLETED" | "FAILED";
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly outcome?: ToolInvocationOutcome;
}

export interface ExecutionRecovery {
  readonly version: 1;
  readonly identity: ExecutionIdentity;
  readonly status: MissionState;
  readonly graphDigest: string;
  readonly budget: LoopBudget;
  readonly deadline: string;
  readonly nodeSkillIds: Readonly<Record<string, string>>;
  readonly invocations: readonly InvocationRecord[];
  readonly memoryWrites?: readonly MemoryWriteRecord[];
  readonly evidence?: EvidenceRecordV1;
  readonly verification?: {
    readonly success: boolean;
    readonly reason: string;
    readonly evidenceId: string;
    readonly record?: VerificationRecordV1;
  };
}

export function graphDigest(graph: TaskGraph): string {
  return createHash("sha256").update(JSON.stringify({ ...graph, updatedAt: "", nodes: graph.nodes.map(node => ({
    ...node, status: "pending", retryCount: 0, result: undefined, startedAt: undefined, completedAt: undefined,
  })) })).digest("hex");
}

export function invocationId(executionId: string, nodeId: string, index: number): string {
  return createHash("sha256").update(JSON.stringify([executionId, nodeId, index])).digest("hex");
}

export function memoryOperationId(executionId: string, purpose: MemoryWriteRecord["purpose"]): string {
  return createHash("sha256").update(JSON.stringify([executionId, "memory", purpose])).digest("hex");
}

export function memoryWriteDigest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function createWorkflowEvidence(execution: { readonly missionId: string; readonly executionId: string; readonly taskId?: string }, state: Checkpoint["workflowState"]): EvidenceRecordV1 {
  return {
    contractVersion: QUACK_CONTRACT_VERSION, id: createId("evidence"),
    missionId: execution.missionId, taskId: execution.taskId, executionId: execution.executionId,
    kind: "state", createdAt: now(), source: "runtime.workflow", redactions: [],
    data: structuredClone({ workflowId: state.workflowId, sessionId: state.sessionId, status: state.status,
      nodeResults: state.nodeResults, completedNodes: state.completedNodes,
      failedNodes: state.failedNodes, skippedNodes: state.skippedNodes }) as unknown as JsonObject,
  };
}

export function assertRecoveryCheckpoint(checkpoint: Checkpoint, identity: ExecutionIdentity): asserts checkpoint is Checkpoint & { recovery: ExecutionRecovery } {
  const recovery = checkpoint.recovery;
  if (!recovery || recovery.version !== 1 || canonical(recovery.identity) !== canonical(identity)
    || !isIdentity(identity) || !isMissionState(recovery.status)
    || checkpoint.id !== identity.workflowId || checkpoint.workflowId !== identity.workflowId
    || checkpoint.sessionId !== identity.sessionId || checkpoint.planId !== identity.taskId
    || checkpoint.workflowState.workflowId !== identity.workflowId || checkpoint.workflowState.sessionId !== identity.sessionId
    || checkpoint.workflowState.planId !== identity.taskId || recovery.graphDigest !== graphDigest(checkpoint.workflowState.taskGraph)
    || !Number.isFinite(Date.parse(recovery.deadline)) || !isBudget(recovery.budget)
    || !isStringRecord(recovery.nodeSkillIds)
    || Object.keys(recovery.nodeSkillIds).some(nodeId => !checkpoint.workflowState.taskGraph.nodes.some(node => node.id === nodeId))
    || !Array.isArray(recovery.invocations)
    || new Set([identity.memoryProviderId, identity.memoryProviderVersion, identity.memoryNamespace]
      .map(value => value === undefined)).size !== 1
    || (identity.memoryProviderId !== undefined && !Array.isArray(recovery.memoryWrites))) {
    throw new Error("Invalid or unsupported recovery checkpoint identity, version, or graph.");
  }
  const memoryIds = new Set<string>();
  for (const record of recovery.memoryWrites ?? []) {
    if (!identity.memoryProviderId || !identity.memoryProviderVersion
      || record.providerId !== identity.memoryProviderId || record.providerVersion !== identity.memoryProviderVersion
      || record.purpose !== "completion" || record.id !== memoryOperationId(identity.executionId, record.purpose)
      || memoryIds.has(record.id) || !/^[a-f0-9]{64}$/.test(record.inputDigest)
      || !["STARTED", "COMPLETED"].includes(record.status) || !Number.isFinite(Date.parse(record.startedAt))
      || (record.status === "STARTED" && (record.completedAt !== undefined || record.providerRecordId !== undefined))
      || (record.status === "COMPLETED" && (!record.completedAt || !Number.isFinite(Date.parse(record.completedAt))
        || Date.parse(record.completedAt) < Date.parse(record.startedAt) || !record.providerRecordId?.trim()))) {
      throw new Error("Invalid recovery memory-write record.");
    }
    memoryIds.add(record.id);
  }
  const ids = new Set<string>();
  for (const record of recovery.invocations) {
    const node = checkpoint.workflowState.taskGraph.nodes.find(node => node.id === record.nodeId);
    if (!node || !Number.isInteger(record.index) || record.index < 0 || !node.toolInvocations?.[record.index]
      || canonical(node.toolInvocations[record.index]) !== canonical(record.invocation)
      || record.id !== invocationId(identity.executionId, record.nodeId, record.index) || ids.has(record.id)
      || !Number.isInteger(record.attempts) || record.attempts < 1 || record.attemptId !== `${record.id}:${record.attempts}`
      || !["READ_ONLY", "IDEMPOTENT_WRITE", "NON_IDEMPOTENT_WRITE", "DESTRUCTIVE", "UNKNOWN"].includes(record.safety)
      || !["STARTED", "COMPLETED", "FAILED"].includes(record.status)
      || !Number.isFinite(Date.parse(record.startedAt))
      || (record.status === "STARTED" && (record.outcome !== undefined || record.completedAt !== undefined))
      || (record.status !== "STARTED" && (!record.outcome || record.outcome.toolId !== record.invocation.toolId
        || record.outcome.success !== (record.status === "COMPLETED") || !record.completedAt
        || !Number.isFinite(Date.parse(record.completedAt)) || Date.parse(record.completedAt) < Date.parse(record.startedAt)))) {
      throw new Error("Invalid recovery invocation record.");
    }
    ids.add(record.id);
  }
  for (const node of checkpoint.workflowState.taskGraph.nodes) {
    if (node.status === "completed" && (!node.result?.success || (node.toolInvocations ?? []).some((_, index) =>
      !recovery.invocations.some(record => record.nodeId === node.id && record.index === index && record.status === "COMPLETED")))) {
      throw new Error("Completed node lacks durable tool acknowledgements.");
    }
    if (node.status === "completed" && node.toolInvocations?.length) {
      const records = node.toolInvocations.map((_, index) => recovery.invocations.find(record =>
        record.nodeId === node.id && record.index === index && record.status === "COMPLETED")!);
      const expectedToolCalls = records.map(record => record.invocation.toolId);
      const expectedToolResults = records.map(record => outcomeData(record.outcome!));
      if (canonical(node.result?.toolCalls) !== canonical(expectedToolCalls)
        || canonical(node.result?.output?.toolResults) !== canonical(expectedToolResults)
        || canonical(node.result?.output?.lastToolOutput) !== canonical(records.at(-1)?.outcome?.output ?? null)) {
        throw new Error("Completed node result does not match durable tool acknowledgements.");
      }
    }
  }
  if (recovery.evidence) assertEvidence(recovery.evidence, identity, checkpoint.workflowState);
  if (recovery.verification) {
    if (!recovery.evidence || recovery.verification.evidenceId !== recovery.evidence.id
      || typeof recovery.verification.success !== "boolean" || typeof recovery.verification.reason !== "string") {
      throw new Error("Verification is not bound to current recovery evidence.");
    }
    const record = recovery.verification.record;
    if (record && (record.contractVersion !== QUACK_CONTRACT_VERSION || !record.id?.trim()
      || record.missionId !== identity.missionId || record.executionId !== identity.executionId
      || !record.verifier?.trim() || !Number.isFinite(Date.parse(record.checkedAt))
      || (recovery.verification.success ? record.status !== "PASSED" : record.status === "PASSED")
      || !Array.isArray(record.evidenceIds) || new Set(record.evidenceIds).size !== record.evidenceIds.length
      || record.evidenceIds.some(id => id !== recovery.evidence!.id)
      || (recovery.verification.success && record.evidenceIds.length !== 1)
      || record.message !== recovery.verification.reason)) {
      throw new Error("Stored verification record is malformed or belongs to another execution.");
    }
    if (recovery.verification.success && (checkpoint.workflowState.status !== "completed"
      || checkpoint.workflowState.completedNodes.length !== checkpoint.workflowState.taskGraph.nodes.length
      || checkpoint.workflowState.failedNodes.length || checkpoint.workflowState.skippedNodes.length)) {
      throw new Error("Successful verification is not supported by a completed workflow.");
    }
  }
}

function assertEvidence(evidence: EvidenceRecordV1, identity: ExecutionIdentity, state: Checkpoint["workflowState"]): void {
  const expected = { workflowId: state.workflowId, sessionId: state.sessionId, status: state.status,
    nodeResults: state.nodeResults, completedNodes: state.completedNodes,
    failedNodes: state.failedNodes, skippedNodes: state.skippedNodes };
  if (evidence.contractVersion !== QUACK_CONTRACT_VERSION || !evidence.id?.trim()
    || evidence.missionId !== identity.missionId || evidence.executionId !== identity.executionId
    || evidence.taskId !== identity.taskId || evidence.kind !== "state" || evidence.source !== "runtime.workflow"
    || !Number.isFinite(Date.parse(evidence.createdAt)) || !Array.isArray(evidence.redactions)
    || canonical(evidence.data) !== canonical(expected)) {
    throw new Error("Recovery evidence is malformed, stale, or belongs to another execution.");
  }
}

function outcomeData(outcome: ToolInvocationOutcome): object {
  return { toolId: outcome.toolId, success: outcome.success,
    output: outcome.output ?? null, error: outcome.error ?? null };
}

function isIdentity(value: ExecutionIdentity): boolean {
  return [value.missionId, value.executionId, value.taskId, value.sessionId, value.workflowId, value.actor]
    .every(field => typeof field === "string" && field.trim().length > 0)
    && (value.agentId === undefined || Boolean(value.agentId.trim()))
    && (value.skillId === undefined || Boolean(value.skillId.trim()))
    && (value.memoryProviderId === undefined || Boolean(value.memoryProviderId.trim()))
    && (value.memoryProviderVersion === undefined || Boolean(value.memoryProviderVersion.trim()))
    && (value.memoryNamespace === undefined || Boolean(value.memoryNamespace.trim()));
}

function isMissionState(value: unknown): boolean {
  return typeof value === "string" && ["CREATED", "QUEUED", "STARTING", "RUNNING", "WAITING", "INTERRUPTED",
    "RECOVERING", "BLOCKED", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(value);
}

function isBudget(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  const keys = ["maxIterations", "maxToolCalls", "maxDurationMs", "maxConcurrentNodes", "maxRetries",
    "maxConsecutiveFailures", "maxNoProgressIterations", "maxDelegationDepth", "maxAgents",
    "maxConcurrentAgents", "maxTokens", "maxCostUsd"];
  return entries.length === keys.length && keys.every(key => Object.hasOwn(value, key))
    && entries.every(([key, number]) => keys.includes(key)
    && typeof number === "number" && Number.isFinite(number) && number >= 0 && (key === "maxCostUsd" || Number.isInteger(number)));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).every(([key, item]) => key.trim() && typeof item === "string" && item.trim());
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
