import test from "node:test";
import assert from "node:assert/strict";
import { fail } from "../../core/types.js";
import { QUACK_CONTRACT_VERSION } from "../../contracts/v1/contracts.js";
import { createWorkforce, type SpecialistAgentDefinition } from "../../agents/index.js";
import { type ModelRuntime } from "../../models/runtime.js";
import { SkillLoader } from "../../skills/loader.js";
import { createBuiltinSkillCatalog } from "../../skills/builtins/index.js";
import { ExtensionRegistry } from "../registry.js";
import { createGeneralPack } from "./general.js";
import { createSwePack, createSweToolPack, createSwePlannerStrategy, defaultSpecialistAgents } from "./swe.js";

const source = { kind: "builtin", sourceId: "quack.distribution" } as const;
const skillRuntime = { executeSkill: async () => ({ ok: false, error: "No fixture executor", durationMs: 0 }) };

test("importing explicit packs does not populate neutral loaders or workforce", () => {
  assert.deepEqual(new SkillLoader().loadBuiltins(), []);
  assert.deepEqual(createWorkforce(skillRuntime).registry.list(), []);
  assert.equal(createWorkforce(skillRuntime).selectAgent({ goal: "coding research documentation" }).ok, false);
  createSwePack();
  createGeneralPack();
  assert.deepEqual(new SkillLoader().loadBuiltins(), []);
  assert.deepEqual(createWorkforce(skillRuntime).registry.list(), []);
});

test("explicit namespaced packs admit without creating providers or authority", async () => {
  const registry = new ExtensionRegistry();
  const admitted = registry.registerBatch([createSwePack(), createGeneralPack()], { source });
  assert.equal(admitted.length, 2);
  const skills = admitted.flatMap(extension => extension.contributions.skills ?? []);
  assert.equal(skills.length, 10);
  assert.ok(skills.every(skill => /^(swe|general)\./.test(skill.manifest.id)));
  assert.equal(admitted.flatMap(extension => extension.contributions.agentProfiles ?? []).length, 4);
  assert.ok(admitted.every(extension => extension.contributions.modelProviders === undefined));
  for (const skill of skills) {
    const result = await skill.execute({ goal: "fixture", parameters: {}, context: { workspaceRoot: ".", dataDir: ".", sessionId: "fixture" } });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /unsupported/);
  }
});

test("legacy distribution catalogs require explicit selection", () => {
  assert.equal(new SkillLoader(createBuiltinSkillCatalog()).loadBuiltins().length, 10);
  const workforce = createWorkforce(skillRuntime, undefined, { definitions: defaultSpecialistAgents() });
  assert.equal(workforce.registry.list().length, 4);
  const selected = workforce.selectAgent({ goal: "coding TypeScript implementation" });
  assert.ok(selected.ok);
  if (selected.ok) assert.equal(selected.data.agent.identity.id, "coding-agent");
});

test("specialist model routing uses declared capability rather than identity", () => {
  const seen: unknown[] = [];
  const modelRuntime: Pick<ModelRuntime, "selectModel"> = {
    selectModel: request => {
      seen.push(request?.capability);
      return fail({ code: "fixture.no_model", message: "Fixture has no model", category: "provider", recoverable: true });
    },
  };
  const definition: SpecialistAgentDefinition = {
    identity: { id: "coding-agent", name: "Fixture", description: "Fixture" },
    skills: [], capabilities: [], trustLevel: "experimental", specialization: ["fixture"], modelCapability: "retrieval",
  };
  const workforce = createWorkforce(skillRuntime, modelRuntime, { definitions: [definition] });
  assert.ok(workforce.selectAgent({ goal: "fixture" }).ok);
  assert.deepEqual(seen, ["retrieval"]);
  const { modelCapability, ...withoutHint } = definition;
  createWorkforce(skillRuntime, modelRuntime, { definitions: [withoutHint] }).selectAgent({ goal: "fixture" });
  assert.deepEqual(seen, ["retrieval"]);
});

test("skill loader snapshots its explicit catalog and checks factory identity", () => {
  const catalog = new Map(createBuiltinSkillCatalog());
  const loader = new SkillLoader(catalog);
  catalog.clear();
  assert.equal(loader.loadBuiltins().length, 10);
  const factory = createBuiltinSkillCatalog().get("git")!;
  assert.throws(() => new SkillLoader(new Map([["different", factory]])).loadBuiltins(), /identity/);
});

test("SWE tool pack adapts existing tools and planner without executing actions", async () => {
  const registry = new ExtensionRegistry();
  const receipt = registry.register(createSweToolPack({ workspaceRoot: "." }), { source });
  assert.deepEqual(receipt.contributions.tools!.map(tool => tool.id).sort(), [
    "core.git.status", "core.terminal.execute", "core.workspace.code-search", "core.workspace.list-files",
    "core.workspace.read-file", "core.workspace.write-file",
  ]);
  assert.throws(() => createSweToolPack({ workspaceRoot: "" }), /explicit workspace/);
  const plan = await createSwePlannerStrategy().plan({
    execution: { contractVersion: QUACK_CONTRACT_VERSION, missionId: "fixture.mission", taskId: "fixture.task", executionId: "fixture.execution", actor: "fixture" },
    sessionId: "fixture.session", goal: "list workspace files", context: [],
    catalog: { tools: receipt.contributions.tools!.map(tool => tool.describe()), skills: [], profiles: [], models: [] },
    constraints: { maxNodes: 10, allowedTools: ["core.workspace.list-files"], budget: { maxIterations: 1, maxToolCalls: 1, maxModelCalls: 0, timeoutMs: 1000, maxConcurrency: 1 } },
  });
  assert.ok(plan.ok);
  if (plan.ok) assert.equal(plan.data.nodes[0]?.toolInvocations?.[0]?.toolId, "core.workspace.list-files");
});
