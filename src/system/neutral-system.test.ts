import test from "node:test";
import assert from "node:assert/strict";
import { createQuackSystem } from "./create-system.js";
import { TaskGraphBuilder } from "../engine/task-graph.js";
import { QUACK_CONTRACT_VERSION } from "../contracts/v1/contracts.js";
import { ok, type JsonObject } from "../core/types.js";
import type { ExtensionDefinition } from "../extensions/types.js";
import type { QuackTool } from "../tools/tool.js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import ts from "typescript";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const authority = {
  missionId: "garden.mission",
  capabilityGrants: [{
    missionId: "garden.mission", capabilities: ["permission.memory.read"],
    scope: { toolIds: ["garden.measure"], actions: ["READ" as const] },
    approval: { approvedBy: "test", reason: "Permit only fixture observations.", approvedAt: new Date().toISOString() },
  }],
};
function gardenExtension(calls: JsonObject[]): ExtensionDefinition {
  const tool: QuackTool<JsonObject, JsonObject> = {
    id: "garden.measure",
    describe: () => ({ id: "garden.measure", name: "Measure", description: "Returns a supplied observation.", permissions: ["memory.read"] }),
    validateInput: (input) => { (input as Record<string, unknown>).mutated = true; return ok(input as JsonObject); },
    execute: async (input) => { calls.push(structuredClone(input)); return { output: { value: input.value } }; },
  };
  return {
    manifest: { id: "garden.domain", version: "1.0.0", contractVersion: QUACK_CONTRACT_VERSION },
    contributions: {
      tools: [tool],
      plannerStrategies: [{
        id: "garden.plan", version: "1.0.0",
        plan: () => ok(new TaskGraphBuilder({ description: "Compare three observations." })
          .addNode("left", { description: "First observation", tools: [tool.id], toolInvocations: [{ toolId: tool.id, input: { value: 1 } }] })
          .addNode("right", { description: "Second observation", tools: [tool.id], toolInvocations: [{ toolId: tool.id, input: { value: 2 } }] })
          .addNode("join", { description: "Record comparison", dependencies: ["left", "right"], tools: [tool.id], toolInvocations: [{ toolId: tool.id, input: { value: 3 } }] }).build()),
      }],
      validationProviders: [{
        id: "garden.verify", version: "1.0.0",
        validate: ({ execution, output, evidence }) => ({
          contractVersion: QUACK_CONTRACT_VERSION, id: "garden.check", missionId: execution.missionId, executionId: execution.executionId,
          verifier: "garden.verify", checkedAt: new Date().toISOString(), evidenceIds: evidence.map((record) => record.id), message: "All three observations match the expected values.",
          status: Object.keys(output ?? {}).length === 3 && calls.length === 3
            && calls.every((call) => !("mutated" in call)) && calls[2]?.value === 3 ? "PASSED" : "FAILED",
        }),
      }],
    },
  };
}

test("neutral construction has no domain catalogs, model discovery or ambient state", async () => {
  const system = createQuackSystem();
  assert.deepEqual(system.tools.list(), []);
  assert.deepEqual(system.skills.getAll(), []);
  assert.deepEqual(system.profiles, []);
  assert.deepEqual(system.providers.list(), []);
  assert.deepEqual(system.providerKernel.list(), []);
  assert.equal(system.config.dataDir, undefined);
  assert.deepEqual(system.config.permissions, []);
  const result = await system.runtime.submitGoal("Observe a garden.");
  assert.ok(result.ok);
  assert.equal(result.data.status, "failed");
  await system.runtime.shutdown();
});

test("a non-SWE extension executes its entire graph through the canonical runtime", async () => {
  const calls: JsonObject[] = [];
  const system = createQuackSystem({ ...authority, extensions: [gardenExtension(calls)], plannerId: "garden.plan", validationProviderId: "garden.verify", permissions: ["memory.read"] });
  const completed: unknown[] = [];
  system.events.on("task.completed", (event) => { completed.push(event); });
  const result = await system.runtime.submitGoal("Compare observations.");
  assert.ok(result.ok);
  assert.equal(result.data.status, "completed", String(result.data.error?.message ?? ""));
  assert.deepEqual(calls, [{ value: 1 }, { value: 2 }, { value: 3 }]);
  assert.equal(completed.length, 1);
  assert.equal(system.runtime.getLoopResult(result.data.id)?.iterations[0]?.executionResult.workflowState?.completedNodes.length, 3);
  await system.runtime.shutdown();
});

test("successful extension tools cannot complete a mission without a validator", async () => {
  const calls: JsonObject[] = [];
  const system = createQuackSystem({ ...authority, extensions: [gardenExtension(calls)], plannerId: "garden.plan", permissions: ["memory.read"] });
  const result = await system.runtime.submitGoal("Compare observations.");
  assert.ok(result.ok);
  assert.equal(result.data.status, "failed");
  assert.equal(calls.length, 3);
  await system.runtime.shutdown();
});

test("validation receives current workflow evidence isolated from output and runtime state", async () => {
  const calls: JsonObject[] = [];
  const extension = gardenExtension(calls);
  const original = extension.contributions.validationProviders![0]!;
  let checked = false;
  const system = createQuackSystem({ ...authority, extensions: [{ ...extension, contributions: {
    ...extension.contributions, validationProviders: [{ ...original, validate: async (request) => {
      const record = request.evidence[0]!;
      assert.equal(record.kind, "state");
      assert.equal(record.source, "runtime.workflow");
      assert.equal(record.missionId, request.execution.missionId);
      assert.equal(record.executionId, request.execution.executionId);
      assert.equal(record.taskId, request.execution.taskId);
      const data = record.data as JsonObject;
      assert.equal(data.status, "completed");
      assert.deepEqual(data.nodeResults, request.output);
      assert.equal(Object.keys(data.nodeResults as JsonObject).length, 3);
      const result = await original.validate(request);
      delete (request.output as Record<string, unknown>)[Object.keys(request.output!)[0]!];
      assert.equal(Object.keys(data.nodeResults as JsonObject).length, 3);
      checked = true;
      return result;
    } }],
  } }], plannerId: "garden.plan", validationProviderId: "garden.verify", permissions: ["memory.read"] });
  try {
    const result = await system.runtime.submitGoal("Compare observations.");
    assert.ok(result.ok);
    assert.equal(result.data.status, "completed");
    assert.equal(checked, true);
    assert.equal(Object.keys(result.data.result!.nodeResults as JsonObject).length, 3);
  } finally { await system.runtime.shutdown(); }
});

test("malformed and unbound validation responses cannot complete a mission", async (t) => {
  const invalidRecords: Record<string, (record: Record<string, unknown>) => unknown> = {
    "missing record": () => null,
    "empty evidence": (record) => ({ ...record, evidenceIds: [] }),
    "unknown evidence": (record) => ({ ...record, evidenceIds: ["invented"] }),
    "duplicate evidence": (record) => ({ ...record, evidenceIds: [...record.evidenceIds as string[], ...record.evidenceIds as string[]] }),
    "wrong mission": (record) => ({ ...record, missionId: "another.mission" }),
    "wrong execution": (record) => ({ ...record, executionId: "another.execution" }),
    "wrong verifier": (record) => ({ ...record, verifier: "another.verifier" }),
    "wrong version": (record) => ({ ...record, contractVersion: "2.0.0" }),
    "missing identity": (record) => ({ ...record, id: "" }),
    "invalid timestamp": (record) => ({ ...record, checkedAt: "never" }),
    "missing message": (record) => ({ ...record, message: undefined }),
    "unknown status": (record) => ({ ...record, status: "SUCCESS" }),
    "failed verification": (record) => ({ ...record, status: "FAILED" }),
    "inconclusive verification": (record) => ({ ...record, status: "INCONCLUSIVE" }),
    "mutated supplied evidence": (record) => record,
  };
  for (const [name, corrupt] of Object.entries(invalidRecords)) await t.test(name, async () => {
    const extension = gardenExtension([]);
    const original = extension.contributions.validationProviders![0]!;
    const system = createQuackSystem({ ...authority, extensions: [{ ...extension, contributions: {
      ...extension.contributions, validationProviders: [{ ...original,
        validate: async (request) => {
          if (name === "mutated supplied evidence") (request.evidence[0] as unknown as Record<string, unknown>).id = "invented";
          return corrupt({ ...await original.validate(request) }) as never;
        },
      }],
    } }], plannerId: "garden.plan", validationProviderId: "garden.verify", permissions: ["memory.read"] });
    try {
      const result = await system.runtime.submitGoal("Compare observations.");
      assert.ok(result.ok);
      assert.equal(result.data.status, "failed");
    } finally { await system.runtime.shutdown(); }
  });
});

test("validated completed tasks survive a system restart", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "quack-validation-restart-"));
  const config = { ...authority, dataDir, extensions: [gardenExtension([])], plannerId: "garden.plan", validationProviderId: "garden.verify", permissions: ["memory.read" as const] };
  const system = createQuackSystem(config);
  try {
    const result = await system.runtime.submitGoal("Compare observations.");
    assert.ok(result.ok);
    assert.equal(result.data.status, "completed");
    await system.runtime.shutdown();
    const restored = createQuackSystem(config);
    try {
      const task = await restored.runtime.getTask(result.data.id);
      assert.ok(task.ok);
      assert.deepEqual(task.data, result.data);
      assert.equal(Object.keys(task.data.result!.nodeResults as JsonObject).length, 3);
    } finally { await restored.runtime.shutdown(); }
  } finally {
    await system.runtime.shutdown();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("extension registration supplies no capability authority", async () => {
  const calls: JsonObject[] = [];
  const system = createQuackSystem({ extensions: [gardenExtension(calls)], plannerId: "garden.plan", validationProviderId: "garden.verify" });
  const result = await system.runtime.submitGoal("Compare observations.");
  assert.ok(result.ok);
  assert.equal(result.data.status, "failed");
  assert.equal(calls.length, 0);
  await system.runtime.shutdown();
});

test("context contributions stay inside configured namespaces", async () => {
  const calls: JsonObject[] = [];
  const extension = gardenExtension(calls);
  const system = createQuackSystem({
    extensions: [{ ...extension, contributions: { ...extension.contributions, contextProviders: [{
      id: "garden.context", version: "1.0.0",
      load: async (request) => [{ id: "wrong", namespace: request.namespace + ".private", content: {}, classification: "restricted", provenance: { sourceId: "fixture" }, retention: "ephemeral" }],
    }] } }],
    plannerId: "garden.plan", contextProviderIds: ["garden.context"], contextNamespaces: ["garden.public"], permissions: ["memory.read"],
  });
  const result = await system.runtime.submitGoal("Compare observations.");
  assert.ok(result.ok);
  assert.equal(result.data.status, "failed");
  assert.match(String(result.data.error?.message ?? ""), /namespace/);
  assert.equal(calls.length, 0);
  await system.runtime.shutdown();
});

test("neutral public runtime imports and reexports cannot reach domain implementations", () => {
  const entry = resolve("src/index.ts");
  const visited = new Set<string>();
  const visit = (file: string, trail: readonly string[]): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const name = relative(resolve("src"), file).replaceAll("\\", "/");
    assert.doesNotMatch(name, /^(distributions\/|extensions\/packs\/|sea\/|selfmod\/|organization\/|company\/planner|skills\/builtins\/|tools\/(code-search|git-status|terminal)|engine\/planner\.ts|intelligence\/semantic-layer)/, [...trail, name].join(" -> "));
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(node) && (node.importClause?.isTypeOnly || (!node.importClause?.name && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.every((element) => element.isTypeOnly)))) continue;
      if (ts.isExportDeclaration(node) && (node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every((element) => element.isTypeOnly)))) continue;
      const specifier = node.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      const target = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
      if (existsSync(target)) visit(target, [...trail, name]);
    }
  };
  visit(entry, []);
  assert.ok(visited.size > 10);
});
