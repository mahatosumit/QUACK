import { createId, now, type JsonObject } from "../core/types.js";
import { type AgentLifecycleManager } from "../organization/lifecycle.js";
import { type AgentRegistry } from "../organization/registry.js";
import { type CapabilityGrant, type CapabilityGrantRegistry } from "../security/capability-broker.js";
import { MissionCompanyPlanner, type MissionCompanyPlanningInput } from "./planner.js";
import {
  COMPANY_RUNTIME_CONTRACT_VERSION,
  type CompanyAgentSnapshotV1,
  type CompanyTaskExecutionV1,
  type CompanyRuntimeOutcome,
  type MissionCompanyPlanV1,
  type MissionCompanyRecordV1,
  type MissionCompanyRepository,
} from "./types.js";

export interface MissionCompanyRuntimeDependencies {
  readonly planner?: MissionCompanyPlanner;
  readonly repository: MissionCompanyRepository;
  readonly lifecycle: AgentLifecycleManager;
  readonly registry: AgentRegistry;
  readonly grants: CapabilityGrantRegistry;
}

export interface CompanyExecutionPrincipal {
  readonly kind: "quack-company-execution-principal";
}

export interface CompanyExecutionClaims {
  readonly missionId: string;
  readonly agentInstanceId: string;
  readonly leaseId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

const principalClaims = new WeakMap<object, CompanyExecutionClaims>();

export function resolveCompanyExecutionPrincipal(principal: unknown): CompanyExecutionClaims | undefined {
  if (typeof principal !== "object" || principal === null) return undefined;
  const claims = principalClaims.get(principal);
  if (!claims || Date.parse(claims.expiresAt) <= Date.now()) return undefined;
  return { ...claims };
}

/** Owns live mission-scoped worker leases. Durable knowledge/evidence live elsewhere. */
export class MissionCompanyRuntime {
  private readonly planner: MissionCompanyPlanner;
  private readonly principals = new Map<string, CompanyExecutionPrincipal>();

  constructor(private readonly dependencies: MissionCompanyRuntimeDependencies) {
    this.planner = dependencies.planner ?? new MissionCompanyPlanner();
  }

  plan(input: MissionCompanyPlanningInput): MissionCompanyRecordV1 {
    const existing = this.dependencies.repository.get(input.missionId);
    if (existing && existing.state !== "DORMANT") throw new Error(`Mission company ${input.missionId} is already active.`);
    const plan = this.planner.plan(input);
    const timestamp = now();
    return this.dependencies.repository.save({
      contractVersion: COMPANY_RUNTIME_CONTRACT_VERSION,
      missionId: input.missionId,
      revision: 1,
      plan,
      state: "PLANNED",
      agents: plan.agents.map((member) => snapshot(member, "CREATED", [])),
      evidenceRefs: [],
      knowledgeRefs: [],
      transitions: [{ state: "PLANNED", at: timestamp, reason: "Objective was converted into a bounded temporary company plan." }],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  assemble(missionId: string): MissionCompanyRecordV1 {
    const current = this.requireRecord(missionId);
    if (current.state !== "PLANNED") throw new Error(`Mission company ${missionId} cannot assemble from ${current.state}.`);
    let forming = this.transition(current, "FORMING", "Creating mission-scoped worker and capability leases.");
    this.dependencies.repository.save(forming);
    const spawned: string[] = [];
    const grantIds: string[] = [];
    try {
      const ownerGrants = this.dependencies.grants.queryActiveGrants({ missionId }).filter((grant) => !grant.agentId && !grant.skillId && !grant.parentGrantId);
      if (ownerGrants.length === 0) throw new Error("Company assembly requires explicit active mission authority.");
      const memberGrants = new Map<string, CapabilityGrant[]>();
      const snapshots = new Map<string, CompanyAgentSnapshotV1>();
      const visiting = new Set<string>();
      const assembleMember = (member: MissionCompanyPlanV1["agents"][number]): CompanyAgentSnapshotV1 => {
        const existing = snapshots.get(member.id);
        if (existing) return existing;
        if (visiting.has(member.id)) throw new Error("Company delegation contains a cycle.");
        visiting.add(member.id);
        if (member.parentId) {
          const parent = current.plan.agents.find((candidate) => candidate.id === member.parentId);
          if (!parent) throw new Error("Company delegation references an unknown parent.");
          assembleMember(parent);
        }
        const parentGrants = member.parentId ? memberGrants.get(member.parentId)! : ownerGrants;
        const requestedExpiry = Date.now() + member.budget.runtimeMinutes * 60_000;
        const derived = parentGrants.flatMap((parent) => {
          const capabilities = member.capabilities.filter((capability) => parent.capabilities.includes(capability));
          if (capabilities.length === 0) return [];
          const grant = this.dependencies.grants.deriveGrant(parent.id, {
            missionId,
            agentId: `${missionId}:${member.id}`,
            capabilities,
            expiresAt: new Date(Math.min(requestedExpiry, parent.expiresAt ? Date.parse(parent.expiresAt) : Infinity)).toISOString(),
            approval: { approvedBy: "company-runtime", reason: "Attenuated from existing parent authority; no new authority granted.", approvedAt: now() },
          });
          grantIds.push(grant.id);
          return [grant];
        });
        if (derived.length === 0) throw new Error(`Company agent ${member.id} has no authority within its parent's grants.`);
        memberGrants.set(member.id, derived);
        const instanceId = `${missionId}:${member.id}`;
        const instance = this.dependencies.lifecycle.spawnAgent(member.runtimeRole, instanceId);
        if (!instance) throw new Error(`Runtime role ${member.runtimeRole} is unavailable.`);
        spawned.push(instance.id);
        const leaseId = createId("company-lease");
        const leaseExpiresAt = new Date(Math.min(...derived.map((grant) => Date.parse(grant.expiresAt!)))).toISOString();
        const principal = Object.freeze({ kind: "quack-company-execution-principal" as const });
        principalClaims.set(principal, { missionId, agentInstanceId: instance.id, leaseId, issuedAt: now(), expiresAt: leaseExpiresAt });
        this.principals.set(instance.id, principal);
        const agent = snapshot(member, "READY", derived.map((grant) => grant.id), instance.id, leaseId, leaseExpiresAt);
        snapshots.set(member.id, agent);
        visiting.delete(member.id);
        return agent;
      };
      const agents = current.plan.agents.map(assembleMember);
      forming = { ...forming, agents };
      const ready = this.transition(forming, "READY", "All declared worker leases are ready; no undeclared agent was spawned.");
      return this.dependencies.repository.save(ready);
    } catch (error) {
      for (const id of grantIds) this.dependencies.grants.revokeGrant(id, { revokedBy: "company-runtime", reason: "Assembly rollback." });
      for (const id of spawned.reverse()) {
        this.revokePrincipal(id);
        this.dependencies.lifecycle.shutdownAgent(id);
      }
      const failed = this.makeDormant(forming, "FAILED", "EXECUTION", error instanceof Error ? error.message : "Assembly failed.");
      this.dependencies.repository.save(failed);
      throw error;
    }
  }

  markRunning(missionId: string): MissionCompanyRecordV1 {
    const current = this.requireRecord(missionId);
    if (current.state !== "READY" && current.state !== "WAITING") throw new Error(`Mission company ${missionId} cannot run from ${current.state}.`);
    const record = this.transition({
      ...current,
      agents: current.agents.map((agent) => ({ ...agent, state: agent.state === "READY" ? "RUNNING" : agent.state })),
    }, "RUNNING", "Mission execution started.");
    return this.dependencies.repository.save(record);
  }

  markVerifying(missionId: string, evidenceRefs: readonly string[]): MissionCompanyRecordV1 {
    const current = this.requireRecord(missionId);
    if (current.state !== "RUNNING") throw new Error(`Mission company ${missionId} cannot verify from ${current.state}.`);
    const record = this.transition({
      ...current,
      evidenceRefs: [...new Set([...current.evidenceRefs, ...evidenceRefs])],
      agents: current.agents.map((agent) => ({ ...agent, state: current.plan.agents.find((plan) => plan.id === agent.planId)?.verifier ? "VERIFYING" : "COMPLETED" })),
    }, "VERIFYING", "Executor work ended; independent verification owns the terminal gate.");
    return this.dependencies.repository.save(record);
  }

  recordVerification(missionId: string, input: { readonly verifierInstanceId: string; readonly approved: boolean; readonly evidenceRef: string }): MissionCompanyRecordV1 {
    const current = this.requireRecord(missionId);
    if (current.state !== "VERIFYING") throw new Error(`Mission company ${missionId} is not awaiting verification.`);
    const verifierPlan = current.plan.agents.find((agent) => agent.verifier);
    const verifier = current.agents.find((agent) => agent.planId === verifierPlan?.id);
    if (!verifier?.instanceId || verifier.instanceId !== input.verifierInstanceId) throw new Error("Verification identity is not the mission's independent verifier.");
    if (!input.evidenceRef.trim()) throw new Error("Verification requires a durable evidence reference.");
    const record: MissionCompanyRecordV1 = {
      ...current,
      revision: current.revision + 1,
      verification: { ...input, verifiedAt: now() },
      evidenceRefs: [...new Set([...current.evidenceRefs, input.evidenceRef])],
      updatedAt: now(),
    };
    return this.dependencies.repository.save(record);
  }

  recordUsage(
    missionId: string,
    agentInstanceId: string,
    delta: Partial<CompanyAgentSnapshotV1["usage"]>,
  ): MissionCompanyRecordV1 {
    const current = this.requireRecord(missionId);
    if (current.state === "DORMANT") throw new Error("Dormant agents cannot consume resources.");
    const agentIndex = current.agents.findIndex((agent) => agent.instanceId === agentInstanceId);
    if (agentIndex < 0) throw new Error("Usage identity is not a live member of this mission company.");
    if (Object.values(delta).some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) throw new Error("Usage deltas must be finite and non-negative.");
    const agents = [...current.agents];
    const before = agents[agentIndex];
    const usage = {
      tokens: before.usage.tokens + (delta.tokens ?? 0),
      estimatedCostUsd: before.usage.estimatedCostUsd + (delta.estimatedCostUsd ?? 0),
      runtimeMs: before.usage.runtimeMs + (delta.runtimeMs ?? 0),
      modelCalls: before.usage.modelCalls + (delta.modelCalls ?? 0),
      toolCalls: before.usage.toolCalls + (delta.toolCalls ?? 0),
      retries: before.usage.retries + (delta.retries ?? 0),
    };
    agents[agentIndex] = { ...before, usage };
    const plan = current.plan.agents.find((candidate) => candidate.id === before.planId)!;
    const exceeded = usage.tokens > plan.budget.tokenLimit
      || usage.estimatedCostUsd > plan.budget.costLimitUsd
      || usage.runtimeMs > plan.budget.runtimeMinutes * 60_000
      || usage.modelCalls > plan.budget.modelCallLimit
      || usage.toolCalls > plan.budget.toolCallLimit
      || usage.retries > plan.budget.retryLimit;
    const updated = this.dependencies.repository.save({ ...current, revision: current.revision + 1, agents, updatedAt: now() });
    if (exceeded) return this.finalize(missionId, "FAILED", { reason: `Hard budget exceeded by ${agentInstanceId}.`, failureCategory: "BUDGET" });
    return updated;
  }

  recordTaskExecutions(missionId: string, executions: readonly CompanyTaskExecutionV1[]): MissionCompanyRecordV1 {
    const current = this.requireRecord(missionId);
    if (current.state === "DORMANT") throw new Error("Dormant company task state is immutable.");
    const planIds = new Set(current.plan.tasks.map((task) => task.id));
    if (executions.length !== planIds.size || executions.some((execution) => !planIds.has(execution.taskId))) {
      throw new Error("Task execution snapshot does not match the durable company plan.");
    }
    const previous = new Map(current.taskExecutions?.map((execution) => [execution.taskId, execution.state]));
    for (const execution of executions) {
      if (isTerminalTaskState(previous.get(execution.taskId)) && previous.get(execution.taskId) !== execution.state) {
        throw new Error(`Terminal task ${execution.taskId} cannot transition again.`);
      }
    }
    return this.dependencies.repository.save({
      ...current,
      revision: current.revision + 1,
      taskExecutions: executions.map((execution) => ({ ...execution, result: execution.result ? { ...execution.result, evidenceRefs: [...execution.result.evidenceRefs] } : undefined })),
      updatedAt: now(),
    });
  }

  finalize(
    missionId: string,
    outcome: CompanyRuntimeOutcome,
    options: { readonly evidenceRefs?: readonly string[]; readonly knowledgeRefs?: readonly string[]; readonly reason?: string; readonly failureCategory?: MissionCompanyRecordV1["failureCategory"] } = {},
  ): MissionCompanyRecordV1 {
    const current = this.requireRecord(missionId);
    if (current.state === "DORMANT") return current;
    if (outcome === "COMPLETED") {
      if (current.state !== "VERIFYING") throw new Error("A mission can complete only from VERIFYING.");
      if (!current.verification?.approved) throw new Error("A mission cannot complete without an approved independent verification record.");
      if (!current.evidenceRefs.includes(current.verification.evidenceRef)) throw new Error("Verification evidence is not durably linked to the mission.");
    }
    const snapshots = current.agents.map((agent) => {
      const live = agent.instanceId ? this.dependencies.registry.get(agent.instanceId) : undefined;
      const metrics = live ? JSON.parse(JSON.stringify(live.metrics)) as JsonObject : agent.metrics;
      for (const grantId of agent.grantIds) {
        this.dependencies.grants.revokeGrant(grantId, { revokedBy: "company-runtime", reason: `Mission ${outcome.toLowerCase()}.` });
      }
      if (agent.instanceId) this.dependencies.lifecycle.shutdownAgent(agent.instanceId);
      if (agent.instanceId) this.revokePrincipal(agent.instanceId);
      return { ...agent, state: "DORMANT" as const, metrics, releasedAt: now() };
    });
    const record = this.makeDormant({
      ...current,
      agents: snapshots,
      evidenceRefs: [...new Set([...current.evidenceRefs, ...(options.evidenceRefs ?? [])])],
      knowledgeRefs: [...new Set([...current.knowledgeRefs, ...(options.knowledgeRefs ?? [])])],
    }, outcome, outcome === "COMPLETED" ? undefined : options.failureCategory ?? "EXECUTION", options.reason ?? `Mission ${outcome.toLowerCase()}; compute leases released.`);
    return this.dependencies.repository.save(record);
  }

  reconcileInterrupted(): MissionCompanyRecordV1[] {
    return this.dependencies.repository.list()
      .filter((record) => record.state !== "DORMANT")
      .map((record) => {
        for (const agent of record.agents) {
          for (const grantId of agent.grantIds) this.dependencies.grants.revokeGrant(grantId, { revokedBy: "company-runtime-recovery", reason: "Interrupted mission recovery." });
          if (agent.instanceId) this.dependencies.lifecycle.shutdownAgent(agent.instanceId);
          if (agent.instanceId) this.revokePrincipal(agent.instanceId);
        }
        const recovered = this.makeDormant(record, "FAILED", "INTERRUPTED", "Recovered an interrupted mission; stale compute and grants were released.");
        return this.dependencies.repository.save(recovered);
      });
  }

  get(missionId: string): MissionCompanyRecordV1 | undefined {
    return this.dependencies.repository.get(missionId);
  }

  list(): MissionCompanyRecordV1[] {
    return this.dependencies.repository.list();
  }

  liveAgentCount(): number {
    return this.dependencies.registry.getAll().filter((agent) => this.list().some((record) => record.state !== "DORMANT" && record.agents.some((item) => item.instanceId === agent.id))).length;
  }

  isActiveMission(missionId: string): boolean {
    const record = this.dependencies.repository.get(missionId);
    return record !== undefined && record.state !== "DORMANT";
  }

  private revokePrincipal(agentInstanceId: string): void {
    const principal = this.principals.get(agentInstanceId);
    if (principal) principalClaims.delete(principal);
    this.principals.delete(agentInstanceId);
  }

  principalFor(missionId: string, agentInstanceId: string): CompanyExecutionPrincipal | undefined {
    const record = this.dependencies.repository.get(missionId);
    const agent = record?.agents.find((candidate) => candidate.instanceId === agentInstanceId);
    if (!record || record.state === "DORMANT" || !agent?.leaseId || !agent.leaseExpiresAt) return undefined;
    const principal = this.principals.get(agentInstanceId);
    const claims = resolveCompanyExecutionPrincipal(principal);
    return claims?.missionId === missionId && claims.leaseId === agent.leaseId ? principal : undefined;
  }

  private requireRecord(missionId: string): MissionCompanyRecordV1 {
    const record = this.dependencies.repository.get(missionId);
    if (!record) throw new Error(`Mission company ${missionId} does not exist.`);
    return record;
  }

  private transition(record: MissionCompanyRecordV1, state: MissionCompanyRecordV1["state"], reason: string): MissionCompanyRecordV1 {
    const timestamp = now();
    return { ...record, revision: record.revision + 1, state, updatedAt: timestamp, transitions: [...record.transitions, { state, at: timestamp, reason }] };
  }

  private makeDormant(
    record: MissionCompanyRecordV1,
    outcome: CompanyRuntimeOutcome,
    failureCategory: MissionCompanyRecordV1["failureCategory"],
    reason: string,
  ): MissionCompanyRecordV1 {
    const timestamp = now();
    return {
      ...record,
      revision: record.revision + 1,
      state: "DORMANT",
      outcome,
      failureCategory,
      agents: record.agents.map((agent) => ({ ...agent, state: "DORMANT", releasedAt: agent.releasedAt ?? timestamp })),
      transitions: [...record.transitions, { state: "DORMANT", at: timestamp, reason }],
      updatedAt: timestamp,
      dormantAt: timestamp,
    };
  }
}

function snapshot(
  member: MissionCompanyPlanV1["agents"][number],
  state: CompanyAgentSnapshotV1["state"],
  grantIds: readonly string[],
  instanceId?: string,
  leaseId?: string,
  leaseExpiresAt?: string,
): CompanyAgentSnapshotV1 {
  return {
    planId: member.id,
    instanceId,
    leaseId,
    leaseExpiresAt,
    role: member.role,
    runtimeRole: member.runtimeRole,
    parentId: member.parentId,
    state,
    grantIds,
    usage: { tokens: 0, estimatedCostUsd: 0, runtimeMs: 0, modelCalls: 0, toolCalls: 0, retries: 0 },
  };
}

function isTerminalTaskState(state: CompanyTaskExecutionV1["state"] | undefined): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED";
}
