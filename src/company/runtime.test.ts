import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { AgentCommunicationBus, AgentLifecycleManager, AgentMetricsCollector, AgentRegistry, OrganizationalMemory } from "../organization/index.js";
import { buildToolCapabilityRequest, InMemoryCapabilityGrantRegistry, type CapabilityGrantRegistry } from "../security/capability-broker.js";
import { createSqliteStorage } from "../storage/sqlite.js";
import { createQuackSystem } from "../distributions/swe-system.js";
import { QUACK_CONTRACT_VERSION, type ActionDescriptorV1, type ActionProviderV1, type ExecutionContextV1 } from "../contracts/index.js";
import { MissionCompanyPlanner } from "./planner.js";
import { MissionCompanyRuntime, resolveCompanyExecutionPrincipal } from "./runtime.js";
import { CompanyTaskScheduler } from "./scheduler.js";

describe("QUACK Company Runtime Contract v1", () => {
  test("system boot keeps role templates but consumes zero permanent agent compute", () => {
    withTempDirectory((directory) => {
      const system = createQuackSystem({ dataDir: join(directory, "data"), workspaceRoot: directory });
      assert.equal(system.organization.registry.count(), 0);
      assert.equal(system.companyRuntime.liveAgentCount(), 0);
    });
  });

  test("planner assembles the right temporary company for each objective", () => {
    const planner = new MissionCompanyPlanner();
    const research = planner.plan({ missionId: "research", objective: "Research battery degradation literature and datasets" });
    const software = planner.plan({ missionId: "software", objective: "Build a secure API and regression tests" });
    const company = planner.plan({ missionId: "company", objective: "Prepare company product launch finance and marketing" });

    assert.equal(research.companyType, "research");
    assert.ok(["Research Director", "Literature Agent", "Dataset Agent", "Methods Agent", "Independent Verification Agent"]
      .every((role) => research.agents.some((agent) => agent.role === role)));
    assert.equal(software.companyType, "software");
    assert.ok(software.agents.some((agent) => agent.role === "Backend Agent" && agent.workspace === "git-worktree"));
    assert.equal(company.companyType, "company-operations");
    assert.ok(company.agents.some((agent) => agent.role === "Finance Analysis Agent"));

    const independent = software.tasks.filter((task) => task.dependencies.length === 0);
    const verification = software.tasks.find((task) => task.id === "task-verification")!;
    assert.ok(independent.length >= 3);
    assert.deepEqual(verification.dependencies, ["task-synthesis"]);
    assert.notEqual(verification.assignedAgentId, software.tasks.find((task) => task.id === "task-synthesis")?.assignedAgentId);
  });

  test("completion releases every worker and grant while evidence and knowledge persist", () => {
    withTempDirectory((directory) => {
      const databasePath = join(directory, "quack.sqlite");
      const harness = createHarness(databasePath);
      harness.runtime.plan({ missionId: "mission-1", objective: "Build a release-safe runtime" });
      authorizeMission(harness.grants, "mission-1");
      const ready = harness.runtime.assemble("mission-1");
      assert.equal(harness.registry.count(), ready.plan.agents.length);
      assert.equal(harness.runtime.liveAgentCount(), ready.plan.agents.length);
      assert.equal(harness.grants.queryActiveGrants({ missionId: "mission-1" }).filter((grant) => grant.agentId).length, ready.plan.agents.length);

      harness.runtime.markRunning("mission-1");
      assert.throws(() => harness.runtime.finalize("mission-1", "COMPLETED"), /only from VERIFYING/);
      const verifying = harness.runtime.markVerifying("mission-1", ["evidence:test-suite"]);
      const verifier = verifying.agents.find((agent) => verifying.plan.agents.find((plan) => plan.id === agent.planId)?.verifier)!;
      assert.throws(() => harness.runtime.recordVerification("mission-1", {
        verifierInstanceId: "mission-1:backend-agent",
        approved: true,
        evidenceRef: "evidence:forged",
      }), /independent verifier/);
      harness.runtime.recordVerification("mission-1", {
        verifierInstanceId: verifier.instanceId!,
        approved: true,
        evidenceRef: "evidence:verification",
      });
      const dormant = harness.runtime.finalize("mission-1", "COMPLETED", { knowledgeRefs: ["knowledge:release-pattern"] });

      assert.equal(dormant.state, "DORMANT");
      assert.equal(dormant.outcome, "COMPLETED");
      assert.equal(harness.registry.count(), 0);
      assert.equal(harness.runtime.liveAgentCount(), 0);
      assert.equal(harness.grants.queryActiveGrants({ missionId: "mission-1" }).filter((grant) => grant.agentId).length, 0);
      assert.ok(dormant.agents.every((agent) => agent.state === "DORMANT" && agent.releasedAt));

      const restarted = createSqliteStorage(databasePath).missionCompanies.get("mission-1")!;
      assert.deepEqual(restarted.evidenceRefs, ["evidence:test-suite", "evidence:verification"]);
      assert.deepEqual(restarted.knowledgeRefs, ["knowledge:release-pattern"]);
      assert.equal(restarted.state, "DORMANT");
    });
  });

  test("hard budgets fail closed and cannot be increased by a worker", () => {
    withTempDirectory((directory) => {
      const harness = createHarness(join(directory, "quack.sqlite"));
      harness.runtime.plan({ missionId: "mission-budget", objective: "Build bounded software" });
      authorizeMission(harness.grants, "mission-budget");
      const ready = harness.runtime.assemble("mission-budget");
      harness.runtime.markRunning("mission-budget");
      const worker = ready.agents.find((agent) => agent.planId === "backend-agent")!;
      const stopped = harness.runtime.recordUsage("mission-budget", worker.instanceId!, { tokens: 100_001 });
      assert.equal(stopped.state, "DORMANT");
      assert.equal(stopped.outcome, "FAILED");
      assert.equal(stopped.failureCategory, "BUDGET");
      assert.equal(harness.registry.count(), 0);
      assert.throws(() => harness.runtime.recordUsage("mission-budget", worker.instanceId!, { tokens: 1 }), /Dormant agents/);
    });
  });

  test("assembly cannot create authority and delegation retains owner restrictions", () => {
    withTempDirectory((directory) => {
      const harness = createHarness(join(directory, "quack.sqlite"));
      harness.runtime.plan({ missionId: "unapproved", objective: "Build software" });
      assert.throws(() => harness.runtime.assemble("unapproved"), /explicit active mission authority/);
      assert.equal(harness.registry.count(), 0);
      assert.equal(harness.grants.listGrants().length, 0);

      harness.runtime.plan({ missionId: "scoped", objective: "Build software" });
      const owner = harness.grants.createGrant({
        missionId: "scoped",
        capabilities: ["permission.workspace.read", "permission.workspace.write"],
        scope: { workspacePaths: ["docs"], actions: ["READ"], toolIds: ["read-doc"] },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        approval: { approvedBy: "test-owner", reason: "Test scoped authority", approvedAt: new Date().toISOString() },
      });
      const ready = harness.runtime.assemble("scoped");
      const worker = ready.agents.find((agent) => agent.planId === "backend-agent")!;
      const request = buildToolCapabilityRequest({ missionId: "scoped", actor: worker.instanceId!, agentId: worker.instanceId,
        toolId: "read-doc", permission: "workspace.read", input: { path: "docs/readme.md" } });
      assert.equal(harness.grants.missionHasCapability(request).granted, true);
      assert.equal(harness.grants.missionHasCapability({ ...request, resource: { kind: "workspace", path: "src/private.ts" } }).granted, false);
      assert.equal(harness.grants.missionHasCapability({ ...request, toolId: "different-tool" }).granted, false);
      assert.ok(harness.grants.listGrants().filter((grant) => grant.agentId).every((grant) =>
        grant.parentGrantId && grant.expiresAt === owner.expiresAt && !grant.capabilities.includes("permission.workspace.write")));
      harness.grants.revokeGrant(owner.id);
      assert.equal(harness.grants.missionHasCapability(request).granted, false);
      harness.runtime.finalize("scoped", "CANCELLED");
    });
  });

  test("company tools require an unforgeable live execution principal", async () => {
    await withTempDirectoryAsync(async (directory) => {
      const system = createQuackSystem({
        dataDir: join(directory, "data"),
        workspaceRoot: directory,
        permissions: ["workspace.read", "memory.read", "memory.write", "provider.invoke"],
      });
      system.companyRuntime.plan({ missionId: "mission-principal", objective: "Build a bounded software runtime" });
      authorizeMission(system.capabilityGrants, "mission-principal");
      const ready = system.companyRuntime.assemble("mission-principal");
      system.companyRuntime.markRunning("mission-principal");
      const worker = ready.agents.find((agent) => agent.planId === "backend-agent")!;

      const spoofed = await system.runtime.executeTool("core.workspace.list-files", {}, {
        taskId: "task-spoofed",
        missionId: "mission-principal",
        agentId: worker.instanceId,
        actor: worker.instanceId,
      });
      assert.equal(spoofed.ok, false);
      if (!spoofed.ok) assert.equal(spoofed.error.code, "company.identity_denied");

      const fakePrincipal = { kind: "quack-company-execution-principal" as const };
      const forged = await system.runtime.executeTool("core.workspace.list-files", {}, {
        taskId: "task-forged",
        missionId: "mission-principal",
        agentId: worker.instanceId,
        companyPrincipal: fakePrincipal,
      });
      assert.equal(forged.ok, false);

      const principal = system.companyRuntime.principalFor("mission-principal", worker.instanceId!)!;
      const mismatched = await system.runtime.executeTool("core.workspace.list-files", {}, {
        taskId: "task-mismatch",
        missionId: "mission-principal",
        agentId: "mission-principal:test-agent",
        companyPrincipal: principal,
      });
      assert.equal(mismatched.ok, false);

      const allowed = await system.runtime.executeTool("core.workspace.list-files", {}, {
        taskId: "task-valid",
        companyPrincipal: principal,
      });
      assert.equal(allowed.ok, true);
      system.companyRuntime.finalize("mission-principal", "CANCELLED");
      assert.equal(system.companyRuntime.principalFor("mission-principal", worker.instanceId!), undefined);
      assert.equal(resolveCompanyExecutionPrincipal(principal), undefined);
      await system.events.drain();
    });
  });

  test("company actions validate principal before discovery and mission grants before execution", async () => {
    await withTempDirectoryAsync(async (directory) => {
      const system = createQuackSystem({
        dataDir: join(directory, "data"),
        workspaceRoot: directory,
        permissions: ["workspace.read", "memory.read", "provider.invoke"],
      });
      const provider = new CompanyReadActionProvider();
      system.actionProviders.register(provider);
      system.companyRuntime.plan({ missionId: "mission-action", objective: "Build a safe software action" });
      authorizeMission(system.capabilityGrants, "mission-action");
      const ready = system.companyRuntime.assemble("mission-action");
      system.companyRuntime.markRunning("mission-action");
      const worker = ready.agents.find((agent) => agent.planId === "backend-agent")!;
      const baseContext: ExecutionContextV1 = {
        contractVersion: QUACK_CONTRACT_VERSION,
        missionId: "mission-action",
        taskId: "task-action",
        executionId: "execution-action-denied",
        actor: worker.instanceId!,
      };

      const denied = await system.actionRuntime.execute("company-test-read", { actionId: "read", input: { key: "status" } }, baseContext);
      assert.equal(denied.status, "DENIED");
      assert.equal(provider.discoveries, 0);
      assert.equal(provider.executions, 0);

      const principal = system.companyRuntime.principalFor("mission-action", worker.instanceId!)!;
      const spoofedActor = await system.actionRuntime.execute("company-test-read", { actionId: "read", input: { key: "status" } }, {
        ...baseContext,
        executionId: "execution-action-spoofed",
        actor: "mission-action:forged-agent",
        companyPrincipal: principal,
      });
      assert.equal(spoofedActor.status, "DENIED");
      assert.equal(provider.discoveries, 0);
      assert.equal(provider.executions, 0);

      const allowed = await system.actionRuntime.execute("company-test-read", { actionId: "read", input: { key: "status" } }, {
        ...baseContext,
        executionId: "execution-action-allowed",
        companyPrincipal: principal,
      });
      assert.equal(allowed.status, "SUCCEEDED");
      assert.equal(provider.discoveries, 1);
      assert.equal(provider.executions, 1);
      system.companyRuntime.finalize("mission-action", "CANCELLED");
      await system.events.drain();
    });
  });

  test("restart reconciliation fails interrupted work closed and revokes stale leases", () => {
    withTempDirectory((directory) => {
      const harness = createHarness(join(directory, "quack.sqlite"));
      harness.runtime.plan({ missionId: "mission-interrupted", objective: "Research provider recovery" });
      authorizeMission(harness.grants, "mission-interrupted");
      harness.runtime.assemble("mission-interrupted");
      harness.runtime.markRunning("mission-interrupted");

      const recovered = harness.runtime.reconcileInterrupted();
      assert.equal(recovered.length, 1);
      assert.equal(recovered[0].state, "DORMANT");
      assert.equal(recovered[0].outcome, "FAILED");
      assert.equal(recovered[0].failureCategory, "INTERRUPTED");
      assert.equal(harness.registry.count(), 0);
      assert.equal(harness.grants.queryActiveGrants({ missionId: "mission-interrupted" }).filter((grant) => grant.agentId).length, 0);
    });
  });

  test("legacy scheduler cannot execute callbacks, change company state, or complete a mission", async () => {
    await withTempDirectoryAsync(async (directory) => {
      const harness = createHarness(join(directory, "quack.sqlite"));
      const planned = harness.runtime.plan({ missionId: "mission-dag", objective: "Build software with parallel verification" });
      authorizeMission(harness.grants, "mission-dag");
      harness.runtime.assemble("mission-dag");
      harness.runtime.markRunning("mission-dag");
      const scheduler = new CompanyTaskScheduler(harness.runtime);
      let callbackCalls = 0;
      let transitionCalls = 0;

      await assert.rejects(() => scheduler.execute(planned.plan, async () => {
        callbackCalls += 1;
        return { evidenceRefs: ["evidence:forged"] };
      }, { onTransition: () => { transitionCalls += 1; } }), /direct execution is unsupported/);

      assert.equal(callbackCalls, 0);
      assert.equal(transitionCalls, 0);
      assert.equal(harness.runtime.get("mission-dag")?.state, "RUNNING");
      assert.equal(harness.runtime.get("mission-dag")?.taskExecutions, undefined);
      assert.throws(() => harness.runtime.finalize("mission-dag", "COMPLETED"), /VERIFYING/);
      harness.runtime.finalize("mission-dag", "CANCELLED");
    });
  });

  test("legacy scheduler rejects cancellation requests without starting callback work", async () => {
    await withTempDirectoryAsync(async (directory) => {
      const harness = createHarness(join(directory, "quack.sqlite"));
      const planned = harness.runtime.plan({ missionId: "mission-cancel", objective: "Research cancellation behavior" });
      authorizeMission(harness.grants, "mission-cancel");
      harness.runtime.assemble("mission-cancel");
      harness.runtime.markRunning("mission-cancel");
      const scheduler = new CompanyTaskScheduler(harness.runtime);
      const controller = new AbortController();
      controller.abort(new Error("test cancellation"));
      let callbackCalls = 0;
      await assert.rejects(() => scheduler.execute(planned.plan, async () => {
        callbackCalls += 1;
        return { evidenceRefs: [] };
      }, { signal: controller.signal }), /direct execution is unsupported/);
      assert.equal(callbackCalls, 0);
      assert.equal(harness.runtime.get("mission-cancel")?.state, "RUNNING");
      harness.runtime.finalize("mission-cancel", "CANCELLED");
    });
  });
});

function authorizeMission(grants: CapabilityGrantRegistry, missionId: string): void {
  grants.createGrant({
    missionId,
    capabilities: ["permission.workspace.read", "permission.workspace.write", "permission.memory.read", "permission.memory.write", "permission.provider.invoke"],
    approval: { approvedBy: "test-owner", reason: "Explicit authority for company runtime fixture", approvedAt: new Date().toISOString() },
  });
}

function createHarness(databasePath: string) {
  const storage = createSqliteStorage(databasePath);
  const registry = new AgentRegistry();
  const lifecycle = new AgentLifecycleManager(
    registry,
    new AgentCommunicationBus(),
    new OrganizationalMemory(),
    new AgentMetricsCollector(),
  );
  const grants = new InMemoryCapabilityGrantRegistry();
  return {
    registry,
    grants,
    runtime: new MissionCompanyRuntime({ repository: storage.missionCompanies, lifecycle, registry, grants }),
  };
}

function withTempDirectory(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "quack-company-runtime-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function withTempDirectoryAsync(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "quack-company-runtime-"));
  try {
    await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

class CompanyReadActionProvider implements ActionProviderV1 {
  discoveries = 0;
  executions = 0;

  metadata() {
    return { contractVersion: QUACK_CONTRACT_VERSION, providerId: "company-test-read", displayName: "Company Test Read", transport: "local", boundary: "local" } as const;
  }

  async health() { return { status: "HEALTHY", checkedAt: new Date().toISOString() } as const; }

  async discoverActions(): Promise<readonly ActionDescriptorV1[]> {
    this.discoveries += 1;
    return [{
      contractVersion: QUACK_CONTRACT_VERSION,
      id: "read",
      providerId: "company-test-read",
      name: "Read",
      description: "Read a value",
      inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false },
      riskClass: "READ_ONLY",
      sideEffect: "read",
      externalCommunication: false,
      financialImpact: false,
      authenticationScopes: [],
      requiredPermissions: ["workspace.read"],
      idempotent: true,
      supportsDryRun: true,
      supportsCompensation: false,
      timeoutMs: 1_000,
      dataClassification: "internal",
      networkRequirements: [],
      approval: "NEVER",
    }];
  }

  async execute(request: { readonly actionId: string }, context: ExecutionContextV1) {
    this.executions += 1;
    return { executionId: context.executionId, providerId: "company-test-read", actionId: request.actionId, status: "SUCCEEDED", output: { ok: true }, evidenceIds: [] } as const;
  }
}
