import { createGovernedGraphRuntime, FixtureEchoTool } from "../test-support/governed-graph-runtime.js";
import { createValidatedListingRuntime } from "../test-support/validated-listing-runtime.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type JsonObject } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";
import { type Permission } from "../security/permissions.js";
import { EchoTool, ToolRegistry, validateToolInput, type ToolInvocation, type ToolInvocationExecutionContext, type ToolInvocationOutcome } from "../tools/tool.js";
import { WorkspaceListFilesTool, WorkspaceReadFileTool } from "../tools/workspace-filesystem.js";
import { SkillExecutor } from "./executor.js";
import { JsonFileSkillRegistryStore, skillDefinitionFingerprint, type SkillRegistrySnapshot } from "./persistence.js";
import { SkillRegistry } from "./registry.js";
import { DurableSkillSandboxRuntime, portableSkillArtifactFingerprint } from "./sandbox-runtime.js";
import { type PortableSkillStep, type SkillDefinition, type SkillInput, type SkillStatus } from "./types.js";
import { SkillValidator } from "./validator.js";

test("sandbox validates a bounded portable definition and compiles deterministically", () => {
  const harness = createHarness();
  const definition = portableSkill("workspace-inspector", "1.0.0");
  harness.registry.register(definition, "generated", "active");
  const record = harness.registry.getRecord("workspace-inspector", "1.0.0");

  const first = harness.sandbox.compile(definition, skillInput(harness.workspaceRoot), record);
  const second = harness.sandbox.compile(definition, skillInput(harness.workspaceRoot), record);

  assert.equal(harness.sandbox.validate(definition, record).valid, true);
  assert.deepEqual(first.nodes.map((node) => node.id), second.nodes.map((node) => node.id));
  assert.equal(portableSkillArtifactFingerprint(definition), skillDefinitionFingerprint(definition, {
    kind: "portable",
    instructions: "Inspect workspace files.",
    execution: definition.portableExecution,
  }));
  harness.cleanup();
});

test("sandbox executes real ToolRegistry calls and resolves from-node dataflow", async () => {
  const harness = createHarness();
  writeFileSync(join(harness.workspaceRoot, "target.txt"), "hello", "utf8");
  const definition = portableSkill("reader", "1.0.0", {
    requiresTools: ["core.echo", "core.workspace.read-file"],
    steps: [
      {
        id: "choose",
        description: "Choose file",
        requiredTools: ["core.echo"],
        toolInvocations: [{ toolId: "core.echo", input: { message: "target.txt" } }],
      },
      {
        id: "read",
        description: "Read chosen file",
        dependencies: ["choose"],
        requiredTools: ["core.workspace.read-file"],
        toolInvocations: [{
          toolId: "core.workspace.read-file",
          input: { path: { $fromNode: "choose", path: "output.lastToolOutput.message" } },
        }],
      },
    ],
  });
  harness.registry.register(definition, "generated", "active");

  const result = await harness.executor.execute(definition, skillInput(harness.workspaceRoot));
  const data = result.data as { readonly nodeResults: Record<string, { readonly output?: { readonly lastToolOutput?: { readonly content?: string } } }> };

  assert.equal(result.ok, true);
  assert.equal(data.nodeResults["read"]?.output?.lastToolOutput?.content, "hello");
  harness.cleanup();
});

test("sandbox rejects unsupported bindings cycles unknown tools and excessive bounds", () => {
  const harness = createHarness();
  const cases = [
    portableSkill("bad-tool", "1.0.0", {
      requiresTools: ["core.missing"],
      steps: [step("one", "core.missing", {})],
    }),
    {
      ...portableSkill("bad-schema", "1.0.0"),
      portableExecution: {
        ...portableSkill("bad-schema", "1.0.0").portableExecution!,
        schemaVersion: 99 as 1,
      },
    },
    portableSkill("undeclared-invocation", "1.0.0", {
      requiresTools: ["core.echo"],
      steps: [{
        ...step("one", "core.workspace.list-files", { path: "." }),
        requiredTools: ["core.echo"],
      }],
    }),
    portableSkill("bad-binding", "1.0.0", {
      steps: [step("one", "core.echo", { message: { $eval: "nope" } })],
    }),
    portableSkill("bad-cycle", "1.0.0", {
      steps: [
        { ...step("a", "core.echo", { message: "a" }), dependencies: ["b"] },
        { ...step("b", "core.echo", { message: "b" }), dependencies: ["a"] },
      ],
    }),
    portableSkill("too-many", "1.0.0", {
      steps: Array.from({ length: 9 }, (_, index) => step(`step-${index}`, "core.echo", { message: "x" })),
    }),
    portableSkill("too-many-retries", "1.0.0", {
      steps: [{ ...step("one", "core.echo", { message: "x" }), retryPolicy: { maxRetries: 9, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 } }],
    }),
    portableSkill("protected-permission", "1.0.0", {
      requiresTools: ["core.echo"],
      steps: [step("one", "core.echo", { message: "x" })],
    }, ["plugin.install"]),
  ];

  for (const definition of cases) {
    assert.equal(harness.sandbox.validate(definition).valid, false, definition.manifest.id);
  }
  harness.cleanup();
});

test("SkillExecutor enforces portable lifecycle and candidate experiment mode", async () => {
  const harness = createHarness();
  const active = portableSkill("active-skill", "1.0.0");
  const imported = portableSkill("imported-skill", "1.0.0");
  const candidate = portableSkill("candidate-skill", "1.0.0");
  const retired = portableSkill("retired-skill", "1.0.0");
  const quarantined = portableSkill("quarantined-skill", "1.0.0");
  harness.registry.register(active, "generated", "active");
  harness.registry.register(imported, "imported", "active");
  harness.registry.register(candidate, "generated", "candidate");
  harness.registry.register(retired, "generated", "retired");
  harness.registry.register(quarantined, "generated", "quarantined");

  assert.equal((await harness.executor.execute(active, skillInput(harness.workspaceRoot))).ok, true);
  assert.equal((await harness.executor.execute(imported, skillInput(harness.workspaceRoot))).ok, true);
  assert.match((await harness.executor.execute(candidate, skillInput(harness.workspaceRoot))).error ?? "", /outside experiment mode/);
  assert.equal((await harness.executor.execute(candidate, skillInput(harness.workspaceRoot), { allowCandidate: true })).ok, true);
  assert.match((await harness.executor.execute(retired, skillInput(harness.workspaceRoot))).error ?? "", /not executable/);
  assert.match((await harness.executor.execute(quarantined, skillInput(harness.workspaceRoot))).error ?? "", /not executable/);
  harness.cleanup();
});

test("SkillExecutor fails closed instead of invoking a non-portable callable skill", async () => {
  const harness = createHarness();
  let invoked = false;
  const legacy: SkillDefinition = {
    manifest: {
      id: "legacy-callable",
      name: "legacy callable",
      version: "1.0.0",
      description: "Legacy callable test fixture.",
      author: "test",
      category: "analysis",
      tags: ["test"],
      requiresPermissions: [],
      requiresTools: [],
      entry: "legacy:callable",
    },
    execute: async () => {
      invoked = true;
      return { ok: true, durationMs: 0 };
    },
  };

  const result = await harness.executor.execute(legacy, skillInput(harness.workspaceRoot));

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Direct callable skill execution is unsupported/);
  assert.equal(invoked, false);
  harness.cleanup();
});

test("sandbox preserves runtime permission and workspace denial at execution time", async () => {
  const denied = createHarness([]);
  const definition = portableSkill("workspace-inspector", "1.0.0");
  denied.registry.register(definition, "generated", "active");
  assert.match((await denied.executor.execute(definition, skillInput(denied.workspaceRoot))).error ?? "", /not satisfiable|denied/);
  denied.cleanup();

  const allowed = createHarness(["workspace.read"]);
  const escape = portableSkill("escape-reader", "1.0.0", {
    requiresTools: ["core.workspace.read-file"],
    steps: [step("read", "core.workspace.read-file", { path: "..\\outside.txt" })],
  });
  allowed.registry.register(escape, "generated", "active");
  const result = await allowed.executor.execute(escape, skillInput(allowed.workspaceRoot));

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /outside the workspace root/);

  const missingParam = portableSkill("missing-param", "1.0.0", {
    requiresTools: ["core.echo"],
    steps: [step("echo", "core.echo", { message: { $fromParameter: "message" } })],
  });
  allowed.registry.register(missingParam, "generated", "active");
  assert.match((await allowed.executor.execute(missingParam, skillInput(allowed.workspaceRoot))).error ?? "", /Missing portable skill parameter/);
  allowed.cleanup();
});

test("persisted executable generated skill survives restart and reconstructs sandbox executor", async () => {
  const dir = tempDir();
  try {
    const store = new JsonFileSkillRegistryStore(join(dir, "data", "skills", "registry.json"));
    const first = createHarness(["workspace.read"], dir);
    first.registry.attachStore(store, { persistCurrent: true });
    const definition = portableSkill("workspace-inspector", "1.0.0");
    first.registry.register(definition, "generated", "active", {
      portableInstructions: "Inspect workspace files.",
      portableExecution: definition.portableExecution,
      setDefault: true,
    });
    first.cleanup(false);

    const second = createHarness(["workspace.read"], dir);
    const load = store.load();
    assert.ok(load.snapshot);
    const reconciliation = second.registry.loadSnapshot(load.snapshot);
    const restored = second.registry.get("workspace-inspector", "1.0.0")!;
    const result = await second.executor.execute(restored, skillInput(second.workspaceRoot));

    assert.deepEqual(reconciliation.issues, []);
    assert.equal(second.registry.getRecord("workspace-inspector", "1.0.0")?.fingerprint, portableSkillArtifactFingerprint(restored));
    assert.equal(restored.portableExecution?.schemaVersion, 1);
    assert.equal(result.ok, true);
    assert.deepEqual((result.data as { readonly executedToolIds: readonly string[] }).executedToolIds, ["core.workspace.list-files"]);
    second.cleanup(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered persisted portable execution is rejected by fingerprint reconciliation", () => {
  const harness = createHarness();
  const definition = portableSkill("workspace-inspector", "1.0.0");
  harness.registry.register(definition, "generated", "active", {
    portableInstructions: "Inspect workspace files.",
    portableExecution: definition.portableExecution,
  });
  const snapshot = harness.registry.snapshot();
  const tampered = JSON.parse(JSON.stringify(snapshot)) as SkillRegistrySnapshot;
  const version = tampered.logicalSkills[0].versions[0];
  (version.definition!.execution!.steps[0].toolInvocations[0].input as { path: string }).path = "..";

  const restarted = createHarness();
  const result = restarted.registry.loadSnapshot(tampered);

  assert.equal(result.issues.some((issue) => issue.message.includes("fingerprint conflict")), true);
  assert.equal(restarted.registry.getRecord("workspace-inspector", "1.0.0"), undefined);
  harness.cleanup();
  restarted.cleanup();
});

test("validated runtime fixture executes restored portable skill and records evidence attribution", async () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "probe.txt"), "probe", "utf8");
    const first = createQuackSystem({ workspaceRoot: dir, dataDir: join(dir, ".quack"), permissions: ["workspace.read"] });
    const definition = portableSkill("workspace-inspector", "1.0.0", {
      description: "Inspect workspace files for workspace inspector goals.",
      tags: ["workspace", "inspector", "files"],
    });
    first.skills.register(definition, "generated", "active", {
      portableInstructions: "Inspect workspace files.",
      portableExecution: definition.portableExecution,
      setDefault: true,
    });

    const second = createQuackSystem({ workspaceRoot: dir, dataDir: join(dir, ".quack"), permissions: ["workspace.read"] });
    const runtime = createValidatedListingRuntime(second, "probe.txt");
    const task = await runtime.submitGoal("inspect workspace inspector files", "test");
    const experiences = await second.learningExperiences.list();

    assert.equal(task.ok, true);
    assert.equal(task.ok && task.data.status, "completed");
    const nodeResults = task.ok ? task.data.result?.["nodeResults"] as Record<string, { success: boolean; toolCalls: readonly string[] }> : {};
    const portable = Object.entries(nodeResults ?? {}).filter(([id]) => id.startsWith("skill:workspace-inspector@1.0.0:"));
    assert.equal(portable.length, 1);
    assert.equal(portable[0]?.[1].success, true);
    assert.deepEqual(portable[0]?.[1].toolCalls, ["core.workspace.list-files"]);
    assert.equal(experiences.some((experience) =>
      experience.execution.selectedSkills.some((skill) => skill.skillId === "workspace-inspector" && skill.version === "1.0.0")
    ), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createHarness(allowedPermissions: readonly Permission[] = ["workspace.read"], workspaceRoot = tempDir()) {
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, "package.json"), "{\"name\":\"sandbox\"}\n", "utf8");
  const tools = new ToolRegistry();
  tools.register(new FixtureEchoTool());
  tools.register(new WorkspaceListFilesTool({ workspaceRoot }));
  tools.register(new WorkspaceReadFileTool({ workspaceRoot }));
  const registry = new SkillRegistry();
  const runtime = createGovernedGraphRuntime(tools, allowedPermissions);
  const executeGraph = (graph: import("../engine/types.js").TaskGraph, context: { skillId: string; deadline: string }) => runtime.executeGraph(graph, "test", { skillId: context.skillId, deadline: context.deadline });
  const sandbox = new DurableSkillSandboxRuntime({
    tools,
    executeGraph,
    allowedPermissions,
    executeTool: (invocation, context) => executeTool(tools, allowedPermissions, invocation, context),
  });
  const executor = new SkillExecutor(registry, new SkillValidator(), {
    tools,
    executeGraph,
    allowedPermissions,
    executeTool: (invocation, context) => executeTool(tools, allowedPermissions, invocation, context),
  });
  return {
    workspaceRoot,
    tools,
    registry,
    sandbox,
    executor,
    cleanup: (remove = true) => {
      if (remove) rmSync(workspaceRoot, { recursive: true, force: true });
    },
  };
}

async function executeTool(
  tools: ToolRegistry,
  allowedPermissions: readonly Permission[],
  invocation: ToolInvocation,
  context: ToolInvocationExecutionContext,
): Promise<ToolInvocationOutcome> {
  const tool = tools.get(invocation.toolId);
  if (!tool.ok) return { toolId: invocation.toolId, success: false, error: tool.error.message };
  for (const permission of tool.data.describe().permissions) {
    if (!allowedPermissions.includes(permission)) {
      return { toolId: invocation.toolId, success: false, error: `Permission ${permission} denied.` };
    }
  }
  const input = validateToolInput(tool.data, invocation.input);
  if (!input.ok) return { toolId: invocation.toolId, success: false, error: input.error.message };
  try {
    const result = await tool.data.execute(input.data, context);
    return { toolId: invocation.toolId, success: true, output: result.output as JsonObject };
  } catch (error) {
    return { toolId: invocation.toolId, success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function portableSkill(
  id: string,
  version: string,
  options: {
    readonly description?: string;
    readonly tags?: readonly string[];
    readonly requiresTools?: readonly string[];
    readonly steps?: readonly PortableSkillStep[];
  } = {},
  permissions: readonly Permission[] = ["workspace.read"],
): SkillDefinition {
  const requiresTools = options.requiresTools ?? ["core.workspace.list-files"];
  return {
    manifest: {
      id,
      name: id.replaceAll("-", " "),
      version,
      description: options.description ?? `${id} inspects workspace files.`,
      author: "test",
      category: "analysis",
      tags: options.tags ?? ["workspace", "inspect", "files"],
      requiresPermissions: permissions,
      requiresTools,
      entry: `portable:${id}@${version}`,
    },
    portableExecution: {
      schemaVersion: 1,
      steps: options.steps ?? [step("list", "core.workspace.list-files", { path: ".", depth: 1 })],
      limits: { maxSteps: 4, maxToolCalls: 4, maxRetriesPerStep: 0, timeoutMs: 2_000 },
    },
    execute: async () => ({ ok: false, error: "native body must not execute", durationMs: 0 }),
  };
}

function step(id: string, toolId: string, input: Record<string, unknown>): PortableSkillStep {
  return {
    id,
    description: `Run ${toolId}`,
    requiredTools: [toolId],
    toolInvocations: [{ toolId, input }],
    retryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 },
  };
}

function skillInput(workspaceRoot: string): SkillInput {
  return {
    goal: "workspace inspector files",
    parameters: {},
    context: {
      workspaceRoot,
      dataDir: join(workspaceRoot, ".quack"),
      sessionId: "test-session",
    },
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "quack-skill-sandbox-"));
}
