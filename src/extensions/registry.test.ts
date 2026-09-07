import test from "node:test";
import assert from "node:assert/strict";
import { QUACK_CONTRACT_VERSION, type QuackProviderV1 } from "../contracts/v1/contracts.js";
import { ok } from "../core/types.js";
import { ToolRegistry, type QuackTool } from "../tools/tool.js";
import { CanonicalProviderRegistry } from "../providers/kernel.js";
import { PluginRegistry } from "../plugins/registry.js";
import { ExtensionAdmissionError, ExtensionRegistry } from "./registry.js";
import type { AgentProfile, ExtensionDefinition, ExtensionManifest, PluginContribution } from "./types.js";

const source = { kind: "application", sourceId: "fixture.application" } as const;
const timestamp = "2026-01-01T00:00:00.000Z";

function pack(id: string, contributions: ExtensionDefinition["contributions"] = {}, dependencies: ExtensionManifest["dependencies"] = []): ExtensionDefinition {
  return { manifest: { id, version: "1.0.0", contractVersion: QUACK_CONTRACT_VERSION, dependencies }, contributions };
}

function tool(id = "fixture.observe", execute = async () => ({ output: {} })): QuackTool {
  return { id, describe: () => ({ id, name: "Fixture observation", description: "Synthetic fixture", permissions: [] }), execute };
}

function profile(): AgentProfile {
  return {
    id: "fixture.observer", version: "1.0.0", contractVersion: QUACK_CONTRACT_VERSION,
    name: "Fixture observer", description: "Synthetic non-domain profile", requiredCapabilities: [], requiredPermissions: [],
    mode: "primary", modelPolicy: { privacy: "local-only", allowCloudFallback: false },
    capabilityPolicy: { ceiling: [] }, allowedTools: ["fixture.observe"],
    contextPolicy: { namespaces: ["fixture.public"], maxTokens: 128, maxBytes: 1024, inheritParentContext: false },
    resourceBudget: { maxIterations: 1, maxModelCalls: 0, maxToolCalls: 1, maxConcurrency: 1, timeoutMs: 1000 },
    delegationDepth: 0,
  };
}

function plugin(): PluginContribution {
  return { manifest: { id: "fixture.plugin", version: "1.0.0", name: "Fixture plugin", quackApiVersion: QUACK_CONTRACT_VERSION, type: "tool", entry: "fixture-entry", capabilities: ["fixture.metadata"], permissions: [] } };
}

function expectAdmissionError(fn: () => unknown, code: string): void {
  assert.throws(fn, error => error instanceof ExtensionAdmissionError && error.code === code);
}

test("admission reuses existing tool and model registries without executing implementations", async () => {
  let calls = 0;
  const neverExecute = async (): Promise<never> => { calls++; throw new Error("Not invoked by admission"); };
  const provider: QuackProviderV1 = {
    metadata: () => ({ contractVersion: QUACK_CONTRACT_VERSION, providerId: "fixture.model", displayName: "Fixture", runtime: "fixture", boundary: "local", credentialEnvironmentVariables: [] }),
    health: neverExecute, discoverModels: neverExecute, capabilities: neverExecute, generate: neverExecute,
  };
  const registry = new ExtensionRegistry();
  const admitted = registry.register(pack("fixture.pack", {
    agentProfiles: [profile()], tools: [tool("fixture.observe", async () => { calls++; return { output: { value: 42 } }; })],
    modelProviders: [provider],
    skills: [{ manifest: { id: "fixture.skill", version: "1.0.0", name: "Fixture", description: "Fixture", author: "Fixture", category: "custom", tags: [], requiresPermissions: [], requiresTools: ["fixture.observe"], entry: "fixture" }, execute: neverExecute }],
    plannerStrategies: [{ id: "fixture.planner", version: "1.0.0", plan: neverExecute }],
    contextProviders: [{ id: "fixture.context", version: "1.0.0", load: neverExecute }],
    memoryProviders: [{ id: "fixture.memory", version: "1.0.0", store: neverExecute, retrieve: neverExecute }],
    validationProviders: [{ id: "fixture.validation", version: "1.0.0", validate: neverExecute }],
    policyProviders: [{ id: "fixture.policy", version: "1.0.0", restrict: neverExecute }],
    plugins: [plugin()],
  }), { source });
  assert.equal(admitted.provenance.length, 10);
  assert.ok(admitted.provenance.every(entry => entry.extensionId === "fixture.pack" && entry.source.sourceId === source.sourceId));
  assert.equal(calls, 0);
  const tools = new ToolRegistry();
  assert.ok(tools.register(admitted.contributions.tools![0]!).ok);
  const models = new CanonicalProviderRegistry();
  models.register(admitted.contributions.modelProviders![0]!);
  const plugins = new PluginRegistry();
  assert.equal(plugins.register(admitted.contributions.plugins![0]!.manifest).status, "inactive");
  assert.equal(calls, 0);
  const resolved = tools.get("fixture.observe");
  assert.ok(resolved.ok);
  if (resolved.ok) assert.deepEqual(await resolved.data.execute({}, { actor: "fixture", taskId: "fixture" }), { output: { value: 42 } });
  assert.equal(calls, 1);
});

test("dependency batches are admitted in deterministic dependency order", () => {
  const registry = new ExtensionRegistry();
  const child = pack("fixture.child", {}, [{ id: "fixture.base", version: "1.0.0" }]);
  const receipt = registry.registerBatch([child, pack("fixture.zeta"), pack("fixture.base")], { source });
  assert.deepEqual(receipt.map(entry => entry.manifest.id), ["fixture.base", "fixture.child", "fixture.zeta"]);
  assert.deepEqual(registry.list(), receipt);
  assert.equal(registry.get("fixture.missing"), undefined);
});

test("invalid batches leave existing admission and collision state unchanged", () => {
  const registry = new ExtensionRegistry();
  registry.register(pack("fixture.existing"), { source });
  const candidate = pack("fixture.candidate", { tools: [tool()] });
  expectAdmissionError(() => registry.registerBatch([candidate, pack("fixture.bad", {}, [{ id: "fixture.missing", version: "1.0.0" }])], { source }), "extension.dependency_missing");
  assert.deepEqual(registry.list().map(entry => entry.manifest.id), ["fixture.existing"]);
  assert.equal(registry.register(candidate, { source }).manifest.id, "fixture.candidate");
});

test("dependency cycles, duplicate dependencies and version mismatches fail atomically", () => {
  const registry = new ExtensionRegistry();
  expectAdmissionError(() => registry.registerBatch([
    pack("fixture.a", {}, [{ id: "fixture.b", version: "1.0.0" }]),
    pack("fixture.b", {}, [{ id: "fixture.a", version: "1.0.0" }]),
  ], { source }), "extension.dependency_cycle");
  expectAdmissionError(() => registry.register(pack("fixture.a", {}, [{ id: "fixture.b", version: "1.0.0" }, { id: "fixture.b", version: "1.0.0" }]), { source }), "extension.dependency_duplicate");
  registry.register(pack("fixture.base"), { source });
  expectAdmissionError(() => registry.register(pack("fixture.child", {}, [{ id: "fixture.base", version: "2.0.0" }]), { source }), "extension.dependency_version");
  assert.equal(registry.list().length, 1);
});

test("duplicate packs and colliding component IDs never replace prior registrations", () => {
  const registry = new ExtensionRegistry();
  const original = registry.register(pack("fixture.first", { tools: [tool()] }), { source });
  expectAdmissionError(() => registry.register(pack("fixture.first"), { source }), "extension.duplicate");
  expectAdmissionError(() => registry.register(pack("fixture.second", { tools: [tool()] }), { source }), "extension.collision");
  expectAdmissionError(() => registry.register(pack("fixture.third", { tools: [tool("host.occupied")] }), { source, occupied: { tools: ["host.occupied"] } }), "extension.collision");
  expectAdmissionError(() => registry.register(pack("fixture.fourth", { tools: [tool("fixture.duplicate"), tool("fixture.duplicate")] }), { source }), "extension.collision");
  assert.equal(registry.get("fixture.first"), original);
  assert.equal(registry.list().length, 1);
});

test("duplicate memory provider IDs fail admission without replacing the original provider", () => {
  const registry = new ExtensionRegistry();
  const original = { id: "fixture.memory", version: "1.0.0",
    store: async () => { throw new Error("not called"); }, retrieve: async () => [] };
  const replacement = { ...original, version: "2.0.0" };
  const admitted = registry.register(pack("fixture.memory-first", { memoryProviders: [original] }), { source });
  expectAdmissionError(() => registry.register(pack("fixture.memory-second", { memoryProviders: [replacement] }), { source }), "extension.collision");
  assert.equal(registry.list().length, 1);
  assert.equal(registry.get("fixture.memory-first"), admitted);
  assert.equal(admitted.contributions.memoryProviders?.[0]?.version, "1.0.0");
});

test("metadata snapshots cannot be changed through caller or receipt mutation", () => {
  const registry = new ExtensionRegistry();
  const originalProfile = profile();
  const descriptor = { id: "fixture.observe", name: "Original", description: "Fixture", permissions: [] };
  const originalTool: QuackTool = { id: "fixture.observe", describe: () => descriptor, execute: async () => ({ output: {} }) };
  const original = pack("fixture.pack", { agentProfiles: [originalProfile], tools: [originalTool] });
  const receipt = registry.register(original, { source });
  descriptor.id = "fixture.changed";
  (originalProfile as { name: string }).name = "Changed";
  assert.equal(receipt.contributions.tools![0]!.describe().id, "fixture.observe");
  assert.equal(receipt.contributions.agentProfiles![0]!.name, "Fixture observer");
  assert.throws(() => { (receipt.manifest as { id: string }).id = "fixture.changed"; }, TypeError);
  assert.throws(() => { (receipt.contributions.agentProfiles![0]!.allowedTools as string[]).push("fixture.changed"); }, TypeError);
  assert.throws(() => { (receipt.provenance[0]!.source as { sourceId: string }).sourceId = "fixture.changed"; }, TypeError);
});

test("invalid versions, unnamespaced IDs and mismatched descriptors fail before publication", () => {
  const registry = new ExtensionRegistry();
  expectAdmissionError(() => registry.register(pack("unnamespaced"), { source }), "extension.invalid_id");
  const invalid = pack("fixture.pack");
  expectAdmissionError(() => registry.register({ ...invalid, manifest: { ...invalid.manifest, version: "^1.0.0" } }, { source }), "extension.invalid_version");
  expectAdmissionError(() => registry.register({ ...invalid, manifest: { ...invalid.manifest, contractVersion: "2.0.0" as typeof QUACK_CONTRACT_VERSION } }, { source }), "extension.contract_version");
  expectAdmissionError(() => registry.register(pack("fixture.pack", { tools: [{ ...tool(), describe: () => ({ ...tool().describe(), id: "fixture.different" }) }] }), { source }), "extension.identity_mismatch");
  assert.equal(registry.list().length, 0);
});

test("hooks are admitted declaratively and malformed hooks or grant-like contributions fail closed", () => {
  const registry = new ExtensionRegistry();
  let hookCalls = 0;
  // Admission accepts well-formed hooks without executing them (ADR 0034):
  // the handler must never run at admission time.
  const admitted = registry.register(pack("fixture.hooks", { plugins: [{ ...plugin(), hooks: [{ kind: "tool", handler: () => { hookCalls++; } }] }] }), { source });
  assert.equal(hookCalls, 0, "admission must not execute hook handlers");
  const admittedHooks = (admitted.contributions.plugins?.[0] as unknown as { hooks: readonly unknown[] }).hooks;
  assert.equal(admittedHooks.length, 1);
  expectAdmissionError(() => registry.register(pack("fixture.bad-kind", { plugins: [{ ...plugin(), hooks: [{ kind: "invalid-kind", handler: () => undefined } as never] }] }), { source }), "extension.invalid");
  expectAdmissionError(() => registry.register(pack("fixture.bad-handler", { plugins: [{ ...plugin(), hooks: [{ kind: "tool", handler: "not-a-function" as never }] }] }), { source }), "extension.invalid");
  expectAdmissionError(() => registry.register(pack("fixture.grants", { grants: [] } as unknown as ExtensionDefinition["contributions"]), { source }), "extension.unsupported_contribution");
  assert.equal(hookCalls, 0);
  assert.equal(registry.list().length, 1);
});

test("invalid profile budgets and malformed methods fail before publication", () => {
  const registry = new ExtensionRegistry();
  const invalidProfile = { ...profile(), delegationDepth: -1 };
  expectAdmissionError(() => registry.register(pack("fixture.pack", { agentProfiles: [invalidProfile] }), { source }), "extension.invalid");
  expectAdmissionError(() => registry.register(pack("fixture.pack", { contextProviders: [{ id: "fixture.context", version: "1.0.0", load: null as never }] }), { source }), "extension.invalid");
  assert.equal(registry.list().length, 0);
});

test("component metadata cannot reenter admission", () => {
  const registry = new ExtensionRegistry();
  const adversarial = { ...tool(), describe: () => { registry.register(pack("fixture.nested"), { source }); return tool().describe(); } };
  expectAdmissionError(() => registry.register(pack("fixture.outer", { tools: [adversarial] }), { source }), "extension.reentrant");
  assert.deepEqual(registry.list(), []);
  assert.equal(registry.register(pack("fixture.valid"), { source }).manifest.id, "fixture.valid");
});

test("nonserializable metadata and incomplete plugin manifests are rejected", () => {
  const registry = new ExtensionRegistry();
  const invalid = { ...profile(), metadata: { opaque: new Map() } } as unknown as AgentProfile;
  expectAdmissionError(() => registry.register(pack("fixture.pack", { agentProfiles: [invalid] }), { source }), "extension.invalid");
  expectAdmissionError(() => registry.register(pack("fixture.pack", { plugins: [{ manifest: { ...plugin().manifest, entry: "" } }] }), { source }), "extension.invalid");
  assert.deepEqual(registry.list(), []);
});

test("registered validators keep the existing verification record contract", async () => {
  const registry = new ExtensionRegistry();
  const receipt = registry.register(pack("fixture.pack", { validationProviders: [{
    id: "fixture.verifier", version: "1.0.0",
    validate: request => ({ contractVersion: QUACK_CONTRACT_VERSION, id: "fixture.verification", missionId: request.execution.missionId, executionId: request.execution.executionId, verifier: "fixture.verifier", status: "INCONCLUSIVE", checkedAt: timestamp, evidenceIds: [], message: "Fixture has no evidence." }),
  }], plannerStrategies: [{ id: "fixture.planner", version: "1.0.0", plan: () => ok({ id: "fixture.graph", description: "Fixture", nodes: [], edges: [], createdAt: timestamp, updatedAt: timestamp, metadata: {} }) }] }), { source });
  const result = await receipt.contributions.validationProviders![0]!.validate({ execution: { contractVersion: QUACK_CONTRACT_VERSION, missionId: "fixture.mission", taskId: "fixture.task", executionId: "fixture.execution", actor: "fixture" }, successCriteria: ["Observed output"], evidence: [] });
  assert.equal(result.status, "INCONCLUSIVE");
});
