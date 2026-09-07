import { createGovernedGraphRuntime, FixtureEchoTool } from "../test-support/governed-graph-runtime.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type JsonObject } from "../core/types.js";
import { EventBus } from "../events/event-bus.js";
import { type Permission } from "../security/permissions.js";
import { EchoTool, ToolRegistry, type QuackTool, type ToolExecutionContext, type ToolInvocationExecutor, type ToolMetadata, type ToolResult } from "../tools/tool.js";
import { WorkspaceListFilesTool, WorkspaceReadFileTool } from "../tools/workspace-filesystem.js";
import { WorkspaceWriteFileTool } from "../tools/workspace-write.js";
import { SkillExecutor } from "./executor.js";
import { JsonFileSkillRegistryStore } from "./persistence.js";
import { SkillRegistry } from "./registry.js";
import { DurableSkillSandboxRuntime } from "./sandbox-runtime.js";
import { SafeSkillCompiler, parseSkillMarkdown } from "./compiler.js";
import { SkillValidator } from "./validator.js";
import { type SkillInput } from "./types.js";

test("SKILL.md parser extracts well-formed and loose sections with diagnostics", () => {
  const wellFormed = parseSkillMarkdown(`
# Workspace Inspector
## Description
List the visible workspace files.
## Inputs
- path
## Tools
- core.workspace.list-files
## Steps
1. list: use core.workspace.list-files path=. depth=1
## Verification
- files are returned
`, { sourceId: "skills/workspace/SKILL.md" });

  const loose = parseSkillMarkdown(`
Name: Loose Echo
Some prose before any rigid template.
Tools
- core.echo
Steps
- use core.echo message=$goal
`);

  assert.equal(wellFormed.name, "Workspace Inspector");
  assert.equal(wellFormed.suggestedTools[0], "core.workspace.list-files");
  assert.equal(wellFormed.steps[0]?.id, "list");
  assert.equal(wellFormed.provenance.sourceId, "skills/workspace/SKILL.md");
  assert.equal(loose.name, "Loose Echo");
  assert.equal(loose.diagnostics.some((diagnostic) => diagnostic.code === "MISSING_SECTION"), true);
});

test("compiler creates deterministic single-step portable candidate and dry run", async () => {
  const harness = createHarness(["workspace.read"]);
  const compiler = new SafeSkillCompiler(harness.tools);
  const events: string[] = [];
  harness.events.onAny((event) => {
    events.push(event.type);
  });

  const first = await compiler.compileSkillMarkdown(`
# Workspace Inspector
## Description
List workspace files.
## Tools
- core.workspace.list-files
## Steps
1. list: use core.workspace.list-files path=. depth=1 timeout=1000 retries=1
`, {
    skillId: "workspace-inspector",
    version: "0.1.0",
    sourceId: "skills/workspace/SKILL.md",
    events: harness.events,
    allowedPermissions: ["workspace.read"],
  });
  const second = await compiler.compileSkillMarkdown(`
# Workspace Inspector
## Description
List workspace files.
## Tools
- core.workspace.list-files
## Steps
1. list: use core.workspace.list-files path=. depth=1 timeout=1000 retries=1
`, {
    skillId: "workspace-inspector",
    version: "0.1.0",
    allowedPermissions: ["workspace.read"],
  });

  assert.equal(first.outcome, "COMPILED");
  assert.equal(first.definition?.portableExecution?.steps[0]?.toolInvocations[0]?.toolId, "core.workspace.list-files");
  assert.equal(first.dryRun?.risk, "READ_ONLY");
  assert.deepEqual(first.definition?.portableExecution?.steps, second.definition?.portableExecution?.steps);
  assert.ok(first.definition?.portableExecution?.compiledAgainstTools?.[0]?.metadataFingerprint);
  assert.equal(events.includes("skill.compile.started"), true);
  assert.equal(events.includes("skill.compile.tool-resolved"), true);
  assert.equal(events.includes("skill.compile.completed"), true);
  harness.cleanup();
});

test("compiler supports a bounded multi-step DAG with from-node binding", async () => {
  const harness = createHarness(["workspace.read"]);
  writeFileSync(join(harness.workspaceRoot, "target.txt"), "hello", "utf8");
  const compiler = new SafeSkillCompiler(harness.tools);
  const result = await compiler.compileSkillMarkdown(`
# File Reader
## Description
Choose and read a workspace file.
## Tools
- core.echo
- core.workspace.read-file
## Steps
1. choose: use core.echo message="target.txt"
2. read: use core.workspace.read-file path=$fromNode:choose.output.lastToolOutput.message after choose
`, {
    skillId: "file-reader",
    version: "0.1.0",
    allowedPermissions: ["workspace.read"],
  });

  assert.equal(result.outcome, "COMPILED");
  assert.deepEqual(result.portableExecution?.steps.map((step) => step.id), ["choose", "read"]);
  assert.deepEqual(result.portableExecution?.steps[1]?.dependencies, ["choose"]);

  const definition = result.definition!;
  harness.registry.register(definition, "imported", "candidate", {
    portableExecution: definition.portableExecution,
    compilationProvenance: definition.compilationProvenance,
  });
  assert.match((await harness.executor.execute(definition, skillInput(harness.workspaceRoot))).error ?? "", /outside experiment mode/);
  const execution = await harness.executor.execute(definition, skillInput(harness.workspaceRoot), { allowCandidate: true });
  assert.equal(execution.ok, true);
  harness.cleanup();
});

test("compiler rejects unknown ambiguous unsupported and unbounded instructions", async () => {
  const harness = createHarness(["workspace.read"]);
  const compiler = new SafeSkillCompiler(harness.tools);
  const cases = [
    {
      markdown: "# Bad\n## Steps\n1. run: use admin.secret.execute value=x",
      outcome: "REJECTED",
      code: "UNKNOWN_TOOL",
    },
    {
      markdown: "# Ambiguous\n## Tools\n- core.echo\n- core.workspace.list-files\n## Steps\n1. both: use core.echo and core.workspace.list-files",
      outcome: "NEEDS_CLARIFICATION",
      code: "AMBIGUOUS_TOOL",
    },
    {
      markdown: "# JavaScript\n## Steps\n1. js: run arbitrary JavaScript eval(\"1+1\")",
      outcome: "REJECTED",
      code: "UNSUPPORTED_OPERATION",
    },
    {
      markdown: "# Loop\n## Tools\n- core.echo\n## Steps\n1. loop: use core.echo message=$goal retry forever",
      outcome: "REJECTED",
      code: "UNBOUNDED_STEP",
    },
    {
      markdown: "# Cleanup\n## Steps\n1. clean: clean up the workspace",
      outcome: "NEEDS_CLARIFICATION",
      code: "AMBIGUOUS_INSTRUCTION",
    },
  ] as const;

  for (const item of cases) {
    const result = await compiler.compileSkillMarkdown(item.markdown);
    assert.equal(result.outcome, item.outcome, item.code);
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === item.code), true, item.code);
    assert.equal(result.portableExecution, undefined, item.code);
  }
  harness.cleanup();
});

test("compiler enforces permissions input compatibility retry timeout and cycles", async () => {
  const harness = createHarness([]);
  const compiler = new SafeSkillCompiler(harness.tools);

  const permissionConflict = await compiler.compileSkillMarkdown(`
# List
## Tools
- core.workspace.list-files
## Steps
1. list: use core.workspace.list-files path=. depth=1
`, { allowedPermissions: [] });
  const missingInput = await compiler.compileSkillMarkdown(`
# Read
## Tools
- core.workspace.read-file
## Steps
1. read: use core.workspace.read-file
`, { allowedPermissions: ["workspace.read"] });
  const bounds = await compiler.compileSkillMarkdown(`
# Bounds
## Tools
- core.echo
## Steps
1. echo: use core.echo message=$goal timeout=999999 retries=9
`);
  const cycle = await compiler.compileSkillMarkdown(`
# Cycle
## Tools
- core.echo
## Steps
1. a: use core.echo message="a" after b
2. b: use core.echo message="b" after a
`);

  assert.equal(permissionConflict.diagnostics.some((diagnostic) => diagnostic.code === "PERMISSION_DENIED"), true);
  assert.equal(missingInput.diagnostics.some((diagnostic) => diagnostic.code === "MISSING_INPUT"), true);
  assert.equal(bounds.diagnostics.some((diagnostic) => diagnostic.code === "UNBOUNDED_STEP"), true);
  assert.equal(cycle.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_DEPENDENCY"), true);
  assert.equal(permissionConflict.portableExecution, undefined);
  assert.equal(missingInput.portableExecution, undefined);
  assert.equal(bounds.portableExecution, undefined);
  assert.equal(cycle.portableExecution, undefined);
  harness.cleanup();
});

test("runtime safety still rejects traversal from compiled read-file candidate", async () => {
  const harness = createHarness(["workspace.read"]);
  const compiler = new SafeSkillCompiler(harness.tools);
  const result = await compiler.compileSkillMarkdown(`
# Escape Reader
## Tools
- core.workspace.read-file
## Steps
1. read: use core.workspace.read-file path=../../outside.txt
`, {
    skillId: "escape-reader",
    allowedPermissions: ["workspace.read"],
  });

  assert.equal(result.outcome, "COMPILED_WITH_WARNINGS");
  const definition = result.definition!;
  harness.registry.register(definition, "imported", "candidate", {
    portableExecution: definition.portableExecution,
    compilationProvenance: definition.compilationProvenance,
  });
  const execution = await harness.executor.execute(definition, skillInput(harness.workspaceRoot), { allowCandidate: true });
  assert.equal(execution.ok, false);
  assert.match(execution.error ?? "", /outside the workspace root/);
  harness.cleanup();
});

test("compiled candidate persists provenance and exact executable fingerprint across restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "quack-compiler-"));
  try {
    const store = new JsonFileSkillRegistryStore(join(dir, "data", "skills", "registry.json"));
    const first = createHarness(["workspace.read"], dir);
    first.registry.attachStore(store);
    const compiler = new SafeSkillCompiler(first.tools);
    const result = await compiler.compileSkillMarkdown(`
# Workspace Inspector
## Description
List workspace files.
## Tools
- core.workspace.list-files
## Steps
1. list: use core.workspace.list-files path=. depth=1
`, {
      skillId: "workspace-inspector",
      version: "0.1.0",
      sourceId: "skills/workspace/SKILL.md",
      allowedPermissions: ["workspace.read"],
    });
    compiler.registerCandidate(first.registry, result);
    const fingerprint = first.registry.getRecord("workspace-inspector", "0.1.0")?.fingerprint;
    first.cleanup(false);

    const second = createHarness(["workspace.read"], dir);
    const loaded = store.load();
    assert.ok(loaded.snapshot);
    const reconciliation = second.registry.loadSnapshot(loaded.snapshot);
    const restored = second.registry.get("workspace-inspector", "0.1.0");

    assert.deepEqual(reconciliation.issues, []);
    assert.equal(second.registry.getRecord("workspace-inspector", "0.1.0")?.fingerprint, fingerprint);
    assert.equal(restored?.compilationProvenance?.sourceId, "skills/workspace/SKILL.md");
    assert.equal(restored?.compilationProvenance?.compilerVersion, "1.0.0");
    assert.equal(restored?.portableExecution?.compiledAgainstTools?.length, 1);
    second.cleanup(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tool metadata evolution blocks stale compiled plans until recompiled", async () => {
  const original = createHarness([]);
  const compiler = new SafeSkillCompiler(original.tools);
  const result = await compiler.compileSkillMarkdown(`
# Echo
## Tools
- core.echo
## Steps
1. echo: use core.echo message=$goal
`, { skillId: "echo-skill" });
  const definition = result.definition!;
  original.registry.register(definition, "imported", "active", {
    portableExecution: definition.portableExecution,
    compilationProvenance: definition.compilationProvenance,
    setDefault: true,
  });

  const changedTools = new ToolRegistry();
  changedTools.register(new ChangedEchoTool());
  const changedSandbox = new DurableSkillSandboxRuntime({
    tools: changedTools,
    allowedPermissions: [],
    executeTool: async () => ({ toolId: "core.echo", success: true, output: { message: "x" } }),
  });
  const validation = changedSandbox.validate(definition, original.registry.getRecord("echo-skill", "0.1.0"));

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /requires recompile/);
  original.cleanup();
});

test("compiled candidate promotion is explicit before production execution", async () => {
  const harness = createHarness(["workspace.read"]);
  const compiler = new SafeSkillCompiler(harness.tools);
  const promotedEvents: string[] = [];
  harness.events.on("skill.compile.promoted", (event) => {
    promotedEvents.push(`${event.payload["skillId"]}@${event.payload["version"]}`);
  });
  const result = await compiler.compileSkillMarkdown(`
# Echo Goal
## Tools
- core.echo
## Steps
1. echo: use core.echo message=$goal
`, { skillId: "echo-goal", version: "0.1.0" });

  const definition = compiler.registerCandidate(harness.registry, result);
  assert.equal(harness.registry.getRecord("echo-goal", "0.1.0")?.status, "candidate");
  assert.match((await harness.executor.execute(definition, skillInput(harness.workspaceRoot))).error ?? "", /outside experiment mode/);

  await compiler.promoteCompiledCandidate(harness.registry, "echo-goal", "0.1.0", "Evaluation evidence accepted.", harness.events);
  assert.equal(harness.registry.getRecord("echo-goal", "0.1.0")?.status, "active");
  const execution = await harness.executor.execute(definition, skillInput(harness.workspaceRoot));
  assert.equal(execution.ok, true, execution.error);
  assert.deepEqual(promotedEvents, ["echo-goal@0.1.0"]);
  harness.cleanup();
});

function createHarness(allowedPermissions: readonly Permission[] = ["workspace.read", "workspace.write"], workspaceRoot = mkdtempSync(join(tmpdir(), "quack-compiler-"))) {
  const tools = new ToolRegistry();
  tools.register(new FixtureEchoTool());
  tools.register(new WorkspaceListFilesTool({ workspaceRoot }));
  tools.register(new WorkspaceReadFileTool({ workspaceRoot }));
  tools.register(new WorkspaceWriteFileTool({ workspaceRoot }));
  const registry = new SkillRegistry();
  const runtime = createGovernedGraphRuntime(tools, allowedPermissions);
  const executeGraph = (graph: import("../engine/types.js").TaskGraph, context: { skillId: string; deadline: string }) => runtime.executeGraph(graph, "test", { skillId: context.skillId, deadline: context.deadline });
  const executeTool: ToolInvocationExecutor = async (invocation, context) => {
    const tool = tools.get(invocation.toolId);
    if (!tool.ok) return { toolId: invocation.toolId, success: false, error: tool.error.message };
    const validated = tool.data.validateInput ? tool.data.validateInput(invocation.input) : { ok: true as const, data: invocation.input };
    if (!validated.ok) return { toolId: invocation.toolId, success: false, error: validated.error.message };
    try {
      const result = await tool.data.execute(validated.data, context);
      return { toolId: invocation.toolId, success: true, output: result.output as JsonObject };
    } catch (error) {
      return { toolId: invocation.toolId, success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const sandbox = new DurableSkillSandboxRuntime({
    tools,
    executeGraph,
    allowedPermissions,
    executeTool,
  });
  const executor = new SkillExecutor(registry, new SkillValidator(), {
    tools,
    executeGraph,
    allowedPermissions,
    executeTool,
  });
  const events = new EventBus();
  return {
    tools,
    registry,
    sandbox,
    executor,
    events,
    workspaceRoot,
    cleanup: (remove = true) => {
      if (remove) rmSync(workspaceRoot, { recursive: true, force: true });
    },
  };
}

function skillInput(workspaceRoot: string): SkillInput {
  return {
    goal: "inspect target",
    parameters: {},
    context: {
      workspaceRoot,
      dataDir: workspaceRoot,
      sessionId: "session-test",
    },
  };
}

class ChangedEchoTool implements QuackTool<{ readonly message: string }, { readonly message: string }> {
  readonly id = "core.echo";

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Echo v2",
      description: "Returns a modified echo message.",
      permissions: [],
    };
  }

  validateInput(input: unknown) {
    return new EchoTool().validateInput(input);
  }

  async execute(input: { readonly message: string }, _context: ToolExecutionContext): Promise<ToolResult<{ readonly message: string }>> {
    return { output: { message: input.message } };
  }
}
