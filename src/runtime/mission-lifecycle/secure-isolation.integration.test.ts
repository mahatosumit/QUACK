import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../../events/event-bus.js";
import { AllowListPermissionPolicy } from "../../security/permissions.js";
import { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker } from "../../security/capability-broker.js";
import { ToolRegistry, EchoTool } from "../../tools/tool.js";
import { ActionProviderRegistry, ActionRuntime } from "../../actions/runtime.js";
import { InMemoryActionExecutionLedger } from "../../actions/ledger.js";
import { DefaultExecutionHarness } from "./harness.js";
import { createProposal, type ActionProposal } from "./action-contract.js";
import { IsolationBackendRegistry } from "../../isolation/backend-resolver.js";
import { ProcessIsolationBackend } from "../../isolation/process-backend.js";
import { IsolationSupervisor } from "../../isolation/supervisor.js";
import { ProbeRunner } from "../../isolation/probe-runner.js";
import { WorkloadAdapterRegistry } from "../../isolation/workload-adapter.js";
import { InMemoryExecutionEvidenceStore } from "../../isolation/execution-evidence.js";
import type { Permission } from "../../security/permissions.js";
import type { CapabilityBroker, CapabilityRequest } from "../../security/capability-broker.js";
import type { JsonObject } from "../../core/types.js";

/**
 * P13 (ADR 0047) harness integration: the FULL governed chain for an
 * adapter-backed capability —
 *
 *   authorized proposal → broker authorization → registered workload
 *   adapter → backend negotiation → supervisor → REAL process-isolated
 *   execution → containment → probe verification → evidence + journal
 *   classification.
 *
 * This proves the P13 architectural test end to end:
 * AUTHORIZED ACTION → REAL ISOLATED ENVIRONMENT → CONTROLLED EXECUTION →
 * TRUSTED EVIDENCE → VERIFIED RESULT.
 */

class GovernedEchoTool extends EchoTool {
  describe(): import("../../tools/tool.js").ToolMetadata {
    return { id: this.id, name: "Governed Echo", description: "Echo under a governed permission.", permissions: ["workspace.read"] };
  }
}

/**
 * Descriptor-only fixture provider for fixture.transform: the capability is
 * DISCOVERABLE (parser + capability resolution require a registered
 * descriptor), but its execute path is never reached — the registered
 * workload adapter routes execution through the isolation supervisor.
 * This mirrors production: an action descriptor declares the capability;
 * the deployer-registered adapter decides WHERE it executes.
 */
function transformDescriptorProvider() {
  const descriptor = {
    contractVersion: "1.0.0", id: "fixture.transform", providerId: "fixture",
    name: "Transform", description: "fixture transform",
    inputSchema: { type: "object" }, riskClass: "READ_ONLY", sideEffect: "read",
    externalCommunication: false, financialImpact: false, authenticationScopes: [],
    requiredPermissions: ["workspace.read"], idempotent: true, supportsDryRun: false,
    supportsCompensation: false, timeoutMs: 10_000, dataClassification: "public",
    networkRequirements: [], approval: "NEVER",
  };
  const provider = {
    metadata: () => ({ contractVersion: "1.0.0", providerId: "fixture", displayName: "Fixture", transport: "local", boundary: "local" }),
    health: async () => ({ status: "HEALTHY", checkedAt: new Date().toISOString() }),
    discoverActions: async () => [descriptor],
    execute: async () => { throw new Error("host path must never execute: the adapter routes isolation-first"); },
  };
  return provider;
}

function proposal(capability: string, args: JsonObject, verificationStrategy?: ActionProposal["verificationStrategy"]): ActionProposal {
  return createProposal({
    missionId: "m-int",
    capability,
    arguments: args,
    intent: "integration fixture",
    riskLevel: "READ_ONLY",
    sandbox: "IN_PROCESS_TRUSTED",
    idempotencyKey: "int-key-1",
    timeoutMs: 10_000,
    ...(verificationStrategy ? { verificationStrategy } : {}),
    selectionReason: "fixture",
    proposedBy: "test",
  });
}

async function integrationFixture() {
  const events = new EventBus();
  const grants = new InMemoryCapabilityGrantRegistry();
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]), grants);
  const tools = new ToolRegistry();
  tools.register(new GovernedEchoTool());
  const actionProviders = new ActionProviderRegistry();
  actionProviders.register(transformDescriptorProvider() as never);
  const actionRuntime = new ActionRuntime(actionProviders, {
    ledger: new InMemoryActionExecutionLedger(),
    validateExecutionContext: () => ({ allowed: true, reason: "test" }),
    decidePermission: async () => ({ allowed: true, reason: "test policy" }),
  });

  // P13 isolation surface: process backend + supervisor + adapter registry.
  const root = await mkdtemp(join(tmpdir(), "quack-int-"));
  const sourceDir = join(root, "trusted-modules");
  await mkdir(sourceDir, { recursive: true });
  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const evidenceStore = new InMemoryExecutionEvidenceStore();
  const supervisor = new IsolationSupervisor({
    registry, events, actor: "test", workspaceRoot: root, evidenceStore,
  });
  const adapters = new WorkloadAdapterRegistry();
  adapters.register({
    capability: "fixture.transform",
    entry: "transform.cjs",
    requiredLevel: "WORKER_PROCESS",
    sourceDirectory: sourceDir,
    description: "fixture transform workload",
    validateArguments: (args) => typeof args["input"] === "string" && (args["input"] as string).length <= 128
      ? { ok: true }
      : { ok: false, reason: "input must be a bounded string" },
  });
  const probeRunner = new ProbeRunner({ workspaceRoot: root, events, actor: "test" });

  await writeFile(join(sourceDir, "transform.cjs"), `
    exports.run = async (io) => {
      const text = String(io.args.input ?? "");
      return { transformed: text.toUpperCase(), isolated: process.pid !== undefined, envSealed: io.environment.ISOLATED === "yes" };
    };
  `);

  const harness = new DefaultExecutionHarness(actionRuntime, broker, actionProviders, tools, events, {
    defaultTimeoutMs: 10_000,
    requireVerificationForIrreversible: true,
    executeTool: async (toolId, input) => {
      const tool = tools.get(toolId);
      if (!tool.ok) return tool as never;
      const result = await tool.data.execute(input as never, { taskId: "t", actor: "test" });
      return { ok: true, data: result.output as JsonObject };
    },
    isolation: { supervisor, adapters, probeRunner },
  });

  return {
    events, harness, supervisor, adapters, evidenceStore, sourceDir, root,
    provision: (missionId: string) => grants.ensureGrant({
      missionId,
      capabilities: ["permission.workspace.read"],
      approval: { approvedBy: "test-standing-consent", reason: "Test fixture grant.", approvedAt: new Date().toISOString() },
    }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("P13.INT-1 full chain: authorized adapter-backed capability executes in a REAL isolated process and verifies", async t => {
  const fx = await integrationFixture();
  t.after(fx.cleanup);
  fx.provision("m-int");

  const result = await fx.harness.execute(
    proposal("fixture.transform", { input: "hello quack" }, {
      kind: "probe_external_state",
      capability: "fixture.transform",
      arguments: { input: "hello quack" },
      expected: {
        description: "transform succeeded",
        successProbes: [
          { kind: "output_field", path: "transformed", equals: "HELLO QUACK" },
          { kind: "status_equals", value: "SUCCEEDED" },
        ],
      },
    }),
    { missionId: "m-int", runId: "run-1", iterationId: "it-1", actor: "test", stepIndex: 0 },
  );

  // 1. Execution happened in the REAL isolated process backend.
  assert.equal(result.outcome.actionResult.status, "SUCCEEDED");
  assert.equal(result.outcome.actionResult.providerId, "isolation:os-process");
  assert.equal((result.outcome.actionResult.output as JsonObject)["transformed"], "HELLO QUACK");

  // 2. TRUSTED verification PASSED — derived from runtime evidence, not claims.
  assert.equal(result.verification.status, "PASSED");

  // 3. Identity-bound evidence recorded with VERIFIED state.
  const evidence = await fx.evidenceStore.load(result.outcome.executionId);
  assert.ok(evidence, "evidence recorded");
  assert.equal(evidence!.identity.capability, "fixture.transform");
  assert.equal(evidence!.identity.backendId, "os-process");
  assert.equal(evidence!.verification.state, "VERIFIED");
  assert.equal(evidence!.facts.exitState, "SUCCEEDED");
  assert.ok(evidence!.facts.outputDigest, "output digest bound");
});

test("P13.INT-2 verification failure: wrong probe expectation yields FAILED verification (never self-verified)", async t => {
  const fx = await integrationFixture();
  t.after(fx.cleanup);
  fx.provision("m-int");

  const result = await fx.harness.execute(
    proposal("fixture.transform", { input: "abc" }, {
      kind: "probe_external_state",
      capability: "fixture.transform",
      arguments: { input: "abc" },
      expected: {
        description: "deliberately wrong expectation",
        successProbes: [{ kind: "output_field", path: "transformed", equals: "NOT THE REAL VALUE" }],
      },
    }),
    { missionId: "m-int", runId: "run-2", iterationId: "it-2", actor: "test", stepIndex: 1 },
  );

  assert.equal(result.outcome.actionResult.status, "SUCCEEDED", "the workload itself succeeded");
  assert.equal(result.verification.status, "FAILED", "verification FAILED against runtime truth");
  const evidence = await fx.evidenceStore.load(result.outcome.executionId);
  assert.equal(evidence!.verification.state, "FAILED");
});

test("P13.INT-3 no-adapter capabilities keep the honest host path (no silent move in either direction)", async t => {
  const fx = await integrationFixture();
  t.after(fx.cleanup);
  fx.provision("m-int");

  const result = await fx.harness.execute(
    proposal("core.echo", { message: "host path" }),
    { missionId: "m-int", runId: "run-3", iterationId: "it-3", actor: "test" },
  );
  assert.equal(result.outcome.actionResult.status, "SUCCEEDED");
  assert.equal(result.outcome.actionResult.providerId, "core.tools", "host path — not isolation");
  assert.equal(result.policy!.isolation.state, "POLICY_RESTRICTED", "honest isolation state on the host path");
});

test("P13.INT-4 adapter argument validation failure denies before any isolated launch", async t => {
  const fx = await integrationFixture();
  t.after(fx.cleanup);
  fx.provision("m-int");

  // P13 review findings 1+2 (hardened gate): adapter REJECTED arguments
  // DENY at the harness downgrade gate — model-controlled arguments can
  // never select the execution environment. No isolated launch, no host
  // fallback, no evidence record.
  const result = await fx.harness.execute(
    proposal("fixture.transform", { input: 12345 }), // wrong type: adapter rejects
    { missionId: "m-int", runId: "run-4", iterationId: "it-4", actor: "test", stepIndex: 3 },
  );
  assert.equal(result.outcome.actionResult.status, "DENIED", "adapter-rejected arguments deny — never fall to the host path");
  assert.match(String(result.outcome.actionResult.output?.["reason"] ?? ""), /fails closed|rejected/i);
  const evidence = await fx.evidenceStore.load(result.outcome.executionId);
  assert.equal(evidence, undefined, "no isolated execution was ever launched");
});

test("P13.INT-5 hostile arguments are DATA in the isolated workload (no shell/module/command path)", async t => {
  const fx = await integrationFixture();
  t.after(fx.cleanup);
  fx.provision("m-int");

  const hostile = "; rm -rf /; require('node:child_process').exec('boom'); __proto__.polluted = true; ../../escape";
  const result = await fx.harness.execute(
    proposal("fixture.transform", { input: hostile.slice(0, 128) }, {
      kind: "probe_external_state",
      capability: "fixture.transform",
      arguments: {},
      expected: { description: "hostile data stays data", successProbes: [{ kind: "no_error" }] },
    }),
    { missionId: "m-int", runId: "run-5", iterationId: "it-5", actor: "test", stepIndex: 4 },
  );
  assert.equal(result.outcome.actionResult.status, "SUCCEEDED");
  // The hostile string was TRANSFORMED AS TEXT — it never became commands.
  assert.equal((result.outcome.actionResult.output as JsonObject)["transformed"], hostile.slice(0, 128).toUpperCase());
  assert.equal(result.verification.status, "PASSED");
});

test("P13.INT-6 broker denial blocks isolated execution too (broker remains the single authority)", async t => {
  const events = new EventBus();
  const grants = new InMemoryCapabilityGrantRegistry();
  // NO permission allowlist: the broker denies workspace.read.
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy([]), grants);
  const tools = new ToolRegistry();
  const actionProviders = new ActionProviderRegistry();
  actionProviders.register(transformDescriptorProvider() as never);
  const actionRuntime = new ActionRuntime(actionProviders, { decidePermission: async () => ({ allowed: true, reason: "f" }) });
  const root = await mkdtemp(join(tmpdir(), "quack-int6-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const registry = new IsolationBackendRegistry();
  registry.register(new ProcessIsolationBackend());
  const supervisor = new IsolationSupervisor({
    registry, events, actor: "test", workspaceRoot: root,
    evidenceStore: new InMemoryExecutionEvidenceStore(),
  });
  const adapters = new WorkloadAdapterRegistry();
  adapters.register({
    capability: "fixture.transform", entry: "t.cjs", requiredLevel: "WORKER_PROCESS",
    sourceDirectory: root, description: "d", validateArguments: () => ({ ok: true }),
  });

  const harness = new DefaultExecutionHarness(actionRuntime, broker, actionProviders, tools, events, {
    defaultTimeoutMs: 10_000, requireVerificationForIrreversible: true,
    isolation: { supervisor, adapters },
  });

  const result = await harness.execute(
    proposal("fixture.transform", { input: "x" }),
    { missionId: "m-int6", runId: "run-6", iterationId: "it-6", actor: "test" },
  );
  assert.equal(result.outcome.actionResult.status, "DENIED", "broker denial precedes any isolated execution");
});

test("P13.INT-7 isolated execution survives loop classification: journal state maps honestly", async () => {
  const { classifyExecutionState } = await import("./execution-policy.js");
  // SUCCEEDED + PASSED runtime verification → EXECUTION_VERIFIED
  assert.equal(classifyExecutionState({ status: "SUCCEEDED", verificationStatus: "PASSED" }), "EXECUTION_VERIFIED");
  // SUCCEEDED + FAILED verification stays EXECUTION_COMPLETED under P12
  // semantics (the action ran; the mission-level verification verdict is
  // carried separately) — the loop consumes verification.status honestly.
  assert.equal(classifyExecutionState({ status: "SUCCEEDED", verificationStatus: "FAILED" }), "EXECUTION_COMPLETED");
  // Timed-out isolated execution → AMBIGUOUS journal settlement
  assert.equal(classifyExecutionState({ status: "SUCCEEDED", timedOut: true }), "EXECUTION_TIMED_OUT");
});
