import test from "node:test";
import assert from "node:assert/strict";
import { DefaultExecutionHarness } from "./harness.js";
import { createProposal } from "./action-contract.js";
import { ActionRuntime, ActionProviderRegistry } from "../../actions/runtime.js";
import { EventBus } from "../../events/event-bus.js";
import { EchoTool, ToolRegistry } from "../../tools/tool.js";
import { ok, type JsonObject } from "../../core/types.js";
import type { CapabilityBroker } from "../../security/capability-broker.js";
import type { ActionDescriptorV1, ActionProviderV1 } from "../../contracts/v1/contracts.js";

const context = { missionId: "mission", runId: "run", iterationId: "iteration", actor: "child" };
const broker: CapabilityBroker = { resolve: async (request) => ({ requestId: request.id, capabilityId: request.capabilityId, granted: true, reason: "fixture authority" }) };
function proposal(capability: string, input: JsonObject = {}) {
  return createProposal({ missionId: "mission", capability, arguments: input, intent: "fixture", riskLevel: "READ_ONLY", sandbox: "IN_PROCESS_TRUSTED", timeoutMs: 1000,
    selectionReason: "fixture", proposedBy: "child", verificationStrategy: { kind: "trust_executed", reason: "fixture operation" } });
}
function descriptor(overrides: Partial<ActionDescriptorV1> = {}): ActionDescriptorV1 {
  return { contractVersion: "1.0.0", id: "fixture.action", providerId: "fixture", name: "Fixture", description: "Fixture action",
    inputSchema: { type: "object" }, riskClass: "READ_ONLY", sideEffect: "read", externalCommunication: false, financialImpact: false,
    authenticationScopes: [], requiredPermissions: ["workspace.read", "network.http"], idempotent: true, supportsDryRun: false, supportsCompensation: false,
    timeoutMs: 1000, dataClassification: "public", networkRequirements: [], approval: "NEVER", ...overrides };
}
function provider(action: ActionDescriptorV1, dispatched: () => void): ActionProviderV1 {
  return { metadata: () => ({ contractVersion: "1.0.0", providerId: "fixture", displayName: "Fixture", transport: "local", boundary: "local" }),
    health: async () => ({ status: "HEALTHY", checkedAt: new Date().toISOString() }), discoverActions: async () => [action],
    execute: async (request, ctx) => { dispatched(); return { executionId: ctx.executionId, providerId: "fixture", actionId: request.actionId, status: "SUCCEEDED", output: { value: "fixture" }, evidenceIds: [] }; },
  };
}

test("legacy tool harness preserves arguments and child identity through runtime callback without claiming verification", async () => {
  const tools = new ToolRegistry(); tools.register({ id: "fixture.echo",
    describe: () => ({ id: "fixture.echo", name: "Fixture", description: "Fixture operation", permissions: ["workspace.read"] }),
    execute: async (input) => ({ output: input }),
  });
  const registry = new ActionProviderRegistry();
  const runtime = new ActionRuntime(registry, { decidePermission: async () => ({ allowed: true, reason: "fixture" }) });
  const calls: unknown[] = [];
  const harness = new DefaultExecutionHarness(runtime, broker, registry, tools, new EventBus(), { defaultTimeoutMs: 1000, requireVerificationForIrreversible: true,
    executeTool: async (toolId, input, access) => { calls.push({ toolId, input, agentId: access.agentId, missionId: access.missionId }); return ok(input); },
  });
  const input = { message: "exact  argument", nested: { value: false } };
  const result = await harness.execute(proposal("fixture.echo", input), context);
  assert.deepEqual(calls, [{ toolId: "fixture.echo", input, agentId: "child", missionId: "mission" }]);
  assert.equal(result.outcome.actionResult.status, "SUCCEEDED");
  assert.equal(result.verification.status, "INCONCLUSIVE");
  await assert.rejects(() => harness.cancel("missing"), /No active/);
});

test("legacy harness delegates provider execution to ActionRuntime policy", async () => {
  let calls = 0;
  const registry = new ActionProviderRegistry(); registry.register(provider(descriptor(), () => calls++));
  const runtime = new ActionRuntime(registry, { decidePermission: async () => ({ allowed: false, reason: "Policy denies fixture" }) });
  const harness = new DefaultExecutionHarness(runtime, broker, registry, new ToolRegistry(), new EventBus());
  const result = await harness.execute(proposal("fixture.action", { path: "inside.txt", url: "https://example.com/" }), context);
  assert.equal(result.outcome.actionResult.status, "DENIED");
  assert.equal(calls, 0);
});

test("legacy harness checks all permissions with exact child and resource identity", async () => {
  let calls = 0;
  const requests: unknown[] = [];
  const registry = new ActionProviderRegistry(); registry.register(provider(descriptor(), () => calls++));
  const deniedBroker: CapabilityBroker = { resolve: async (request) => {
    requests.push({ permission: request.permission, agentId: request.agentId, resource: request.resource });
    return { requestId: request.id, capabilityId: request.capabilityId, granted: request.permission !== "network.http", reason: "fixture" };
  } };
  const runtime = new ActionRuntime(registry, { decidePermission: async () => ({ allowed: true, reason: "fixture" }) });
  const harness = new DefaultExecutionHarness(runtime, deniedBroker, registry, new ToolRegistry(), new EventBus());
  const result = await harness.execute(proposal("fixture.action", { path: "inside.txt", url: "https://example.com/" }), context);
  assert.equal(result.outcome.actionResult.status, "DENIED");
  assert.equal(calls, 0);
  assert.deepEqual(requests, [
    { permission: "workspace.read", agentId: "child", resource: { kind: "workspace", path: "inside.txt", host: "example.com" } },
    { permission: "network.http", agentId: "child", resource: { kind: "network", path: "inside.txt", host: "example.com" } },
  ]);
});

test("descriptor risk cannot be downgraded by a read-only proposal without a verification runner", async () => {
  let calls = 0;
  const registry = new ActionProviderRegistry(); registry.register(provider(descriptor({ riskClass: "DESTRUCTIVE", sideEffect: "write" }), () => calls++));
  const runtime = new ActionRuntime(registry, { decidePermission: async () => ({ allowed: true, reason: "fixture" }) });
  const harness = new DefaultExecutionHarness(runtime, broker, registry, new ToolRegistry(), new EventBus());
  const result = await harness.execute(proposal("fixture.action"), context);
  assert.equal(result.outcome.actionResult.status, "FAILED");
  assert.match(String(result.outcome.actionResult.output?.error), /verification runner/);
  assert.equal(calls, 0);
});
