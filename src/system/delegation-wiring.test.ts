import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuackSystem } from "./create-system.js";
import { TaskGraphBuilder } from "../engine/task-graph.js";
import { QUACK_CONTRACT_VERSION } from "../contracts/v1/contracts.js";
import type { ExtensionDefinition } from "../extensions/types.js";
import type { QuackConfig } from "../config/config.js";

function graphFixture(toolId: string) {
  return new TaskGraphBuilder({ description: "Child measurement mission" }).addNode("child-node", {
    description: "Run the child tool", tools: [toolId],
    toolInvocations: [{ toolId, input: { path: "allowed/child", value: 1 } }],
  }).build();
}

function fanOutExtension(graph: ReturnType<typeof graphFixture>): ExtensionDefinition {
  return {
    manifest: { id: "fixture.fanoutpack", version: "1.0.0", contractVersion: QUACK_CONTRACT_VERSION },
    contributions: {
      agentProfiles: [{
        id: "fixture.child-agent", version: "1.0.0", contractVersion: QUACK_CONTRACT_VERSION,
        name: "Child agent", description: "Delegated child profile", requiredCapabilities: [], requiredPermissions: [],
        mode: "subagent", modelPolicy: { privacy: "local-only", allowCloudFallback: false },
        capabilityPolicy: { ceiling: ["permission.workspace.read"] },
        allowedTools: ["fixture.childtool"],
        contextPolicy: { namespaces: [], maxTokens: 512, maxBytes: 4096, inheritParentContext: false },
        resourceBudget: { maxIterations: 1, maxToolCalls: 2, maxModelCalls: 0, timeoutMs: 10_000, maxConcurrency: 1 },
        delegationDepth: 0,
      }],
      plannerStrategies: [{ id: "fixture.planner", version: "1.0.0", plan: async () => ({ ok: true, data: graph }) }],
      tools: [{
        id: "fixture.childtool",
        describe: () => ({ id: "fixture.childtool", name: "Child Tool", description: "Child measurement", permissions: ["workspace.read"] }),
        execute: async (input) => ({ output: { ...input } }),
      }],
      validationProviders: [{
        id: "fixture.validator", version: "1.0.0",
        validate: async (request) => ({
          contractVersion: QUACK_CONTRACT_VERSION, id: `verification-${request.execution.executionId}`,
          missionId: request.execution.missionId, executionId: request.execution.executionId,
          verifier: "fixture.validator", status: "PASSED" as const,
          checkedAt: new Date().toISOString(), evidenceIds: request.evidence.map(item => item.id), message: "Child validated.",
        }),
      }],
    },
  };
}

test("createQuackSystem wires governed delegation when a parent grant and depth are configured", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-delegationwire-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  // Default: delegation disabled.
  const disabled = createQuackSystem({ dataDir: join(dir, "state-a"), workspaceRoot: dir } as Partial<QuackConfig>);
  assert.equal(disabled.delegation, undefined);

  // Enabled: the single seeded mission grant becomes the parent grant; the
  // child runs through the canonical runtime under an attenuated derived
  // grant and must present a verified receipt.
  const graph = graphFixture("fixture.childtool");
  const system = createQuackSystem({
    dataDir: join(dir, "state-b"),
    workspaceRoot: dir,
    missionId: "delegation-mission",
    extensions: [fanOutExtension(graph)],
    plannerId: "fixture.planner",
    validationProviderId: "fixture.validator",
    permissions: ["workspace.read"],
    delegationMaxDepth: 2,
    capabilityGrants: [{
      missionId: "delegation-mission",
      capabilities: ["permission.workspace.read"],
      approval: { approvedBy: "fixture", reason: "Parent authority", approvedAt: new Date().toISOString() },
    }],
  } as Partial<QuackConfig>);
  t.after(() => system.hookBridge.stop());
  assert.ok(system.delegation, "delegation must be wired with a seeded parent grant + depth");

  const delegated = await system.delegation.delegate({
    missionId: "delegation-mission",
    parentExecutionId: "parent-execution-1",
    goal: "Child measurement mission",
    actor: "observer",
    agentId: "fixture.child-agent",
    capabilities: ["permission.workspace.read"],
    reason: "Live wiring test",
    approvedBy: "parent",
  });

  assert.ok(delegated.ok, JSON.stringify(delegated));
  if (!delegated.ok) return;
  assert.equal(delegated.data.state, "COMPLETED", delegated.data.error ?? "");
  assert.ok(delegated.data.childReceipt, "live delegation must produce a verified child receipt");
  assert.equal((delegated.data.childReceipt as Record<string, unknown>)["verificationStatus"], "PASSED");
  assert.ok(delegated.data.childTaskId);

  // The derived child grant is revoked after completion.
  assert.equal(system.capabilityGrants.queryActiveGrants({ missionId: "delegation-mission" })
    .some(grant => grant.agentId === "child-agent"), false);

  // Depth ceiling still applies on the live composition.
  const tooDeep = await system.delegation.delegate({
    missionId: "delegation-mission",
    parentExecutionId: "level-3-fake",
    goal: "Too deep child",
    actor: "observer",
    agentId: "fixture.deep-agent",
    capabilities: ["permission.workspace.read"],
    reason: "Depth exhaustion",
    approvedBy: "parent",
  });
  assert.ok(tooDeep.ok, "depth 1 must be allowed under maxDepth 2");
});
