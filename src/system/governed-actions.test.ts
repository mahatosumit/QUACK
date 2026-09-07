import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { QuackConfig } from "../distributions/swe-config.js";
import { QUACK_CONTRACT_VERSION, type ActionDescriptorV1, type ActionProviderV1, type ActionRequestV1, type ExecutionContextV1 } from "../contracts/index.js";
import type { JsonObject } from "../core/types.js";
import { QuackNativeHarness } from "../harness/registry.js";
import { createProposal } from "../runtime/mission-lifecycle/action-contract.js";
import { DefaultExecutionHarness } from "../runtime/mission-lifecycle/harness.js";
import type { QuackTool } from "../tools/tool.js";
import { createQuackSystem, type QuackSystem } from "../distributions/swe-system.js";

const missionId = "governed-fixture-mission";
const actor = "governed-fixture-child";
const approval = { approvedBy: "fixture-owner", reason: "Explicit integration fixture authority", approvedAt: new Date().toISOString() };

test("real action runtime denies absent mission authority before asking or executing", async () => {
  let approvals = 0;
  await withSystem({ permissions: ["external.write"], approver: { requestApproval: async () => { approvals++; return true; } } }, async (system) => {
    const provider = new RecordingActionProvider({ requiredPermissions: ["external.write"], sideEffect: "write", riskClass: "EXTERNAL_COMMUNICATION", approval: "ALWAYS" });
    system.actionProviders.register(provider);
    const result = await system.actionRuntime.execute(provider.id, { actionId: provider.actionId, input: { path: "docs/report.txt" } }, executionContext());
    assert.equal(result.status, "DENIED");
    assert.equal(provider.calls.length, 0);
    assert.equal(approvals, 0);
  });
});

test("action input and child scope survive the composition-root broker callback", async () => {
  await withSystem({ permissions: ["workspace.read"] }, async (system) => {
    const provider = new RecordingActionProvider();
    system.actionProviders.register(provider);
    const parent = authorizeChild(system, provider.actionId);
    const input = fixtureInput();
    const allowed = await system.actionRuntime.execute(provider.id, { actionId: provider.actionId, input }, executionContext("allowed"));
    assert.equal(allowed.status, "SUCCEEDED");
    assert.deepEqual(provider.calls, [input]);

    const denied = await system.actionRuntime.execute(provider.id, { actionId: provider.actionId, input: { ...input, path: "other/private.txt" } }, executionContext("outside"));
    assert.equal(denied.status, "DENIED");
    assert.equal(provider.calls.length, 1);
    system.capabilityGrants.revokeGrant(parent.id);
    const revoked = await system.actionRuntime.execute(provider.id, { actionId: provider.actionId, input }, executionContext("revoked"));
    assert.equal(revoked.status, "DENIED");
    assert.equal(provider.calls.length, 1);
  });
});

test("ASK cannot override missing global authority even when a mission grant exists", async () => {
  let approvals = 0;
  await withSystem({ permissions: [], approver: { requestApproval: async () => { approvals++; return true; } } }, async (system) => {
    const provider = new RecordingActionProvider({ requiredPermissions: ["external.write"], sideEffect: "write", riskClass: "EXTERNAL_COMMUNICATION", approval: "ALWAYS" });
    system.actionProviders.register(provider);
    system.capabilityGrants.createGrant({ missionId, capabilities: ["permission.external.write"], approval });
    const denied = await system.actionRuntime.execute(provider.id, { actionId: provider.actionId, input: fixtureInput() }, executionContext());
    assert.equal(denied.status, "DENIED");
    assert.equal(approvals, 0);
    assert.equal(provider.calls.length, 0);
  });
});

test("an external action cannot omit its permission declaration to bypass authority", async () => {
  let approvals = 0;
  await withSystem({ permissions: [], approver: { requestApproval: async () => { approvals++; return true; } } }, async (system) => {
    const provider = new RecordingActionProvider({ requiredPermissions: [], sideEffect: "write", riskClass: "EXTERNAL_COMMUNICATION", approval: "ALWAYS" });
    system.actionProviders.register(provider);
    const denied = await system.actionRuntime.execute(provider.id, { actionId: provider.actionId, input: fixtureInput() }, executionContext());
    assert.equal(denied.status, "DENIED");
    assert.equal(approvals, 0);
    assert.equal(provider.calls.length, 0);
  });
});

test("permission approval cannot dispatch an action after its mission authority was revoked", async () => {
  let revokeAuthority = () => {};
  let approvals = 0;
  await withSystem({ permissions: ["external.write"], approver: { requestApproval: async () => { approvals++; revokeAuthority(); return true; } } }, async (system) => {
    const provider = new RecordingActionProvider({ requiredPermissions: ["external.write"], sideEffect: "write", riskClass: "EXTERNAL_COMMUNICATION", approval: "NEVER" });
    system.actionProviders.register(provider);
    const grant = system.capabilityGrants.createGrant({ missionId, capabilities: ["permission.external.write"], approval });
    revokeAuthority = () => { system.capabilityGrants.revokeGrant(grant.id); };
    const result = await system.actionRuntime.execute(provider.id, { actionId: provider.actionId, input: fixtureInput() }, executionContext());
    assert.equal(approvals, 1);
    assert.equal(result.status, "DENIED");
    assert.equal(provider.calls.length, 0);
  });
});

test("descriptor approval cannot dispatch an action after its parent grant was revoked", async () => {
  let revokeAuthority = () => {};
  let approvals = 0;
  await withSystem({ permissions: ["workspace.read"], approver: { requestApproval: async () => { approvals++; revokeAuthority(); return true; } } }, async (system) => {
    const provider = new RecordingActionProvider({ approval: "ALWAYS" });
    system.actionProviders.register(provider);
    const parent = authorizeChild(system, provider.actionId);
    revokeAuthority = () => { system.capabilityGrants.revokeGrant(parent.id); };
    const result = await system.actionRuntime.execute(provider.id, { actionId: provider.actionId, input: fixtureInput() }, executionContext());
    assert.equal(approvals, 1);
    assert.equal(result.status, "DENIED");
    assert.equal(provider.calls.length, 0);
  });
});

test("native harness uses real runtime authority and preserves the child identity and arguments", async () => {
  await withSystem({ permissions: ["workspace.read"] }, async (system) => {
    const tool = new RecordingTool();
    assert.equal(system.tools.register(tool).ok, true);
    const config = { harnessId: "QUACK_NATIVE" };
    const harness = new QuackNativeHarness(system, config);
    await harness.start(config);
    const context = { missionId, runId: "native", iterationId: "iteration", actor, workspaceRoot: system.config.workspaceRoot,
      dataDir: system.config.dataDir, capabilities: ["permission.workspace.read"], trustClass: "SUBAGENT" as const };
    const input = { goal: "Execute the declared fixture read", toolInvocations: [{ toolId: tool.id, input: fixtureInput() }] };
    try {
      assert.equal((await harness.send(input, context)).success, false);
      assert.equal(tool.calls.length, 0);
      authorizeChild(system, tool.id);
      assert.equal((await harness.send(input, { ...context, runId: "allowed" })).success, true);
      assert.deepEqual(tool.calls, [fixtureInput()]);
      const outside = { ...input, toolInvocations: [{ toolId: tool.id, input: { ...fixtureInput(), path: "other/private.txt" } }] };
      assert.equal((await harness.send(outside, { ...context, runId: "outside" })).success, false);
      assert.equal(tool.calls.length, 1);
    } finally { await harness.dispose(); }
  });
});

test("mission harness callback preserves declared arguments and cannot widen a child grant", async () => {
  await withSystem({ permissions: ["workspace.read"] }, async (system) => {
    const tool = new RecordingTool();
    assert.equal(system.tools.register(tool).ok, true);
    const harness = new DefaultExecutionHarness(system.actionRuntime, system.capabilityBroker, system.actionProviders, system.tools, system.events, {
      defaultTimeoutMs: 1_000, requireVerificationForIrreversible: true,
      executeTool: (toolId, input, options) => system.runtime.executeTool(toolId, input, options),
    });
    authorizeChild(system, tool.id);
    const proposal = (input: JsonObject) => createProposal({ missionId, capability: tool.id, arguments: input, intent: "Read the scoped fixture", riskLevel: "READ_ONLY",
      sandbox: "IN_PROCESS_TRUSTED", timeoutMs: 1_000, selectionReason: "Integration fixture", proposedBy: actor });
    const context = { missionId, runId: "run", iterationId: "iteration", actor };
    const allowed = await harness.execute(proposal(fixtureInput()), context);
    assert.equal(allowed.outcome.actionResult.status, "SUCCEEDED");
    assert.deepEqual(tool.calls, [fixtureInput()]);
    const outside = await harness.execute(proposal({ ...fixtureInput(), path: "other/private.txt" }), context);
    assert.equal(outside.outcome.actionResult.status, "DENIED");
    assert.equal(tool.calls.length, 1);
  });
});

function fixtureInput(): JsonObject {
  return { path: "docs/a space/report.txt", enabled: false, count: 0, nested: { values: [1, "two"], optional: null } };
}

function executionContext(executionId = "execution"): ExecutionContextV1 {
  return { contractVersion: QUACK_CONTRACT_VERSION, missionId, taskId: "task", executionId, actor };
}

function authorizeChild(system: QuackSystem, toolId: string) {
  const parent = system.capabilityGrants.createGrant({ missionId, capabilities: ["permission.workspace.read"],
    scope: { workspacePaths: ["."], actions: ["READ"], toolIds: [toolId] }, expiresAt: new Date(Date.now() + 60_000).toISOString(), approval });
  system.capabilityGrants.deriveGrant(parent.id, { missionId, agentId: actor, capabilities: parent.capabilities,
    scope: { ...parent.scope, workspacePaths: ["docs"] }, approval });
  return parent;
}

class RecordingTool implements QuackTool {
  readonly id = "fixture.governed-read";
  readonly calls: JsonObject[] = [];
  describe() { return { id: this.id, name: "Fixture read", description: "Records governed input", permissions: ["workspace.read"] as const }; }
  async execute(input: object) { this.calls.push(structuredClone(input) as JsonObject); return { output: { accepted: true } }; }
}

class RecordingActionProvider implements ActionProviderV1 {
  readonly id = "fixture-governed-provider";
  readonly actionId = "fixture.governed-action";
  readonly calls: JsonObject[] = [];
  constructor(private readonly overrides: Partial<ActionDescriptorV1> = {}) {}
  metadata() { return { contractVersion: QUACK_CONTRACT_VERSION, providerId: this.id, displayName: "Governed fixture", transport: "local", boundary: "local" } as const; }
  async health() { return { status: "HEALTHY", checkedAt: new Date().toISOString() } as const; }
  async discoverActions(): Promise<readonly ActionDescriptorV1[]> {
    return [{ contractVersion: QUACK_CONTRACT_VERSION, id: this.actionId, providerId: this.id, name: "Fixture action", description: "Records governed action input",
      inputSchema: { type: "object", properties: { path: { type: "string" }, enabled: { type: "boolean" }, count: { type: "number" }, nested: { type: "object" } }, required: ["path"], additionalProperties: false },
      riskClass: "READ_ONLY", sideEffect: "read", externalCommunication: false, financialImpact: false, authenticationScopes: [], requiredPermissions: ["workspace.read"],
      idempotent: true, supportsDryRun: true, supportsCompensation: false, timeoutMs: 1_000, dataClassification: "internal", networkRequirements: [], approval: "NEVER", ...this.overrides }];
  }
  async execute(request: ActionRequestV1, context: ExecutionContextV1) {
    this.calls.push(structuredClone(request.input));
    return { executionId: context.executionId, providerId: this.id, actionId: request.actionId, status: "SUCCEEDED", output: { accepted: true }, evidenceIds: [] } as const;
  }
}

async function withSystem(config: Partial<QuackConfig>, run: (system: QuackSystem) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "quack-governed-actions-"));
  const system = createQuackSystem({ ...config, workspaceRoot: root, dataDir: join(root, "data"), improvement: { enabled: false, autoEvaluate: false } });
  try { await run(system); }
  finally { await system.events.drain(); await rm(root, { recursive: true, force: true }); }
}
