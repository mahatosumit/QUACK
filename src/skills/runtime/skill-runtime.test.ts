import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId, type QuackResult, ok, fail } from "../../core/types.js";
import { createQuackSystem } from "../../distributions/swe-system.js";
import { type QuackTool, type ToolExecutionContext, type ToolMetadata, type ToolResult } from "../../tools/tool.js";
import { type SkillRuntimeManifest } from "./index.js";
import { removeTestDirectory } from "../../test-support/isolated-system.js";

function manifest(id: string, overrides: Partial<SkillRuntimeManifest> = {}): SkillRuntimeManifest {
  return {
    id,
    name: "Filesystem Assistant",
    version: "1.0.0",
    description: "Lists files in the workspace through a declarative workflow.",
    author: "QUACK",
    trustLevel: "trusted",
    requiredCapabilities: ["permission.workspace.read"],
    allowedTools: ["core.workspace.list-files"],
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    executionLimits: {
      timeoutMs: 1000,
      maxIterations: 1,
      maxToolCalls: 1,
      maxRetriesPerStep: 0,
    },
    category: "file",
    tags: ["filesystem", "workspace"],
    workflow: {
      steps: [{
        id: "list",
        description: "List workspace files.",
        requiredTools: ["core.workspace.list-files"],
        toolInvocations: [{
          toolId: "core.workspace.list-files",
          input: { path: ".", depth: 1 },
          reason: "Inspect the workspace.",
        }],
      }],
    },
    ...overrides,
  };
}

async function withSystem<T>(
  options: Parameters<typeof createQuackSystem>[0],
  action: (system: ReturnType<typeof createQuackSystem>, workspaceRoot: string, dataDir: string) => Promise<T>,
): Promise<T> {
  const workspaceRoot = join(tmpdir(), createId("quack_skill_runtime_workspace"));
  const dataDir = join(tmpdir(), createId("quack_skill_runtime_state"));
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "hello.txt"), "hello", "utf8");
  let system: ReturnType<typeof createQuackSystem> | undefined;
  try {
    system = createQuackSystem({ workspaceRoot, dataDir, ...options });
    return await action(system, workspaceRoot, dataDir);
  } finally {
    await system?.events.drain();
    await removeTestDirectory(workspaceRoot);
    await removeTestDirectory(dataDir);
  }
}

test("SkillRuntime executes a valid declarative skill through runtime tools", async () => {
  await withSystem({
    missionId: "mission-skill-ok",
    permissions: ["workspace.read", "memory.write", "memory.read"],
    capabilityGrants: [{
      missionId: "mission-skill-ok",
      capabilities: ["permission.workspace.read"],
      approval: {
        approvedBy: "security",
        reason: "skill may inspect workspace",
        approvedAt: "2026-08-07T00:00:00.000Z",
      },
    }],
  }, async (system) => {
    const events: string[] = [];
    system.events.onAny((event) => {
      if (event.type.startsWith("skill.")) events.push(event.type);
    });

    const loaded = await system.skillRuntime.loadSkillManifest(manifest("filesystem-assistant-test"));
    assert.equal(loaded.ok, true);
    const enabled = system.skillRuntime.enableSkill("filesystem-assistant-test");
    assert.equal(enabled.ok, true);

    const result = await system.skillRuntime.executeSkill("filesystem-assistant-test", {
      goal: "list files",
      parameters: {},
    }, {
      missionId: "mission-skill-ok",
      actor: "test-agent",
    });

    assert.equal(result.ok, true);
    assert.ok(events.includes("skill.loaded"));
    assert.ok(events.includes("skill.validated"));
    assert.ok(events.includes("skill.started"));
    assert.ok(events.includes("skill.completed"));
  });
});

test("SkillRuntime rejects an invalid manifest", async () => {
  await withSystem({}, async (system) => {
    const invalid = await system.skillRuntime.loadSkillManifest({
      ...manifest("invalid-skill"),
      allowedTools: [],
      requiredCapabilities: [],
      workflow: { steps: [] },
    });

    assert.equal(invalid.ok, false);
    if (!invalid.ok) {
      assert.equal(invalid.error.code, "skill_runtime.invalid_manifest");
      assert.match(invalid.error.message, /tool allowlist|capability|workflow/);
    }
  });
});

test("SkillRuntime denies execution when mission capability is missing", async () => {
  await withSystem({
    missionId: "mission-skill-denied",
    permissions: ["workspace.read"],
  }, async (system) => {
    const events: string[] = [];
    system.events.onAny((event) => {
      if (event.type === "capability.denied" || event.type === "skill.failed") events.push(event.type);
    });

    assert.equal((await system.skillRuntime.loadSkillManifest(manifest("capability-denied-skill"))).ok, true);
    assert.equal(system.skillRuntime.enableSkill("capability-denied-skill").ok, true);

    const result = await system.skillRuntime.executeSkill("capability-denied-skill", {
      goal: "list files",
      parameters: {},
    }, {
      missionId: "mission-skill-denied",
      actor: "test-agent",
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /CapabilityDeniedError/);
    assert.ok(events.includes("capability.denied"));
    assert.ok(events.includes("skill.failed"));
  });
});

test("SkillRuntime handles workflow timeout limits", async () => {
  await withSystem({
    permissions: ["workspace.read"],
  }, async (system) => {
    const slowTool = new SlowReadTool();
    system.tools.register(slowTool);
    const slowManifest = manifest("timeout-skill", {
      name: "Timeout Skill",
      allowedTools: ["test.slow-read"],
      requiredCapabilities: ["permission.workspace.read"],
      executionLimits: {
        timeoutMs: 1,
        maxIterations: 1,
        maxToolCalls: 1,
        maxRetriesPerStep: 0,
      },
      workflow: {
        steps: [{
          id: "slow",
          description: "Call a slow tool.",
          requiredTools: ["test.slow-read"],
          timeoutMs: 1,
          toolInvocations: [{ toolId: "test.slow-read", input: {}, reason: "Exercise timeout handling." }],
        }],
      },
    });

    assert.equal((await system.skillRuntime.loadSkillManifest(slowManifest)).ok, true);
    assert.equal(system.skillRuntime.enableSkill("timeout-skill").ok, true);
    try {
      const result = await system.skillRuntime.executeSkill("timeout-skill", { goal: "wait", parameters: {} });
      assert.equal(result.ok, false);
      // Both timeout abort paths are valid outcomes: the step timer
      // ("Node timed out after Xms.") and the deadline check
      // ("Node execution deadline expired.") fire in a race at timeoutMs: 1.
      assert.match(result.error ?? "", /timed out|deadline expired/i);
    } finally {
      await slowTool.waitForCompletion();
    }
  });
});

test("SkillRuntime rejects disabled skill execution", async () => {
  await withSystem({}, async (system) => {
    assert.equal((await system.skillRuntime.loadSkillManifest(manifest("disabled-skill"))).ok, true);

    const result = await system.skillRuntime.executeSkill("disabled-skill", {
      goal: "list files",
      parameters: {},
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /inactive is not executable/);
  });
});

class SlowReadTool implements QuackTool<Record<string, never>, { readonly delayed: boolean }> {
  readonly id = "test.slow-read";
  private started = false;
  private resolveCompletion: () => void = () => undefined;
  private readonly completion = new Promise<void>((resolve) => { this.resolveCompletion = resolve; });

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Slow Read",
      description: "Test-only slow workspace read tool.",
      permissions: ["workspace.read"],
    };
  }

  validateInput(input: unknown): QuackResult<Record<string, never>> {
    return typeof input === "object" && input !== null && !Array.isArray(input)
      ? ok({})
      : fail({
        code: "tool.invalid_input",
        message: "Slow tool input must be an object.",
        category: "tool",
        recoverable: true,
      });
  }

  async execute(_input: Record<string, never>, _context: ToolExecutionContext): Promise<ToolResult<{ readonly delayed: boolean }>> {
    this.started = true;
    await new Promise((resolve) => setTimeout(resolve, 500));
    this.resolveCompletion();
    return { output: { delayed: true } };
  }

  async waitForCompletion(): Promise<void> {
    if (!this.started) return;
    await this.completion;
  }
}
