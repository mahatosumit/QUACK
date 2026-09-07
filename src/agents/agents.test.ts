import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";
import { type SkillRuntimeManifest } from "../skills/runtime/index.js";

async function isolatedSystem(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "quack-agent-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  return createQuackSystem({ workspaceRoot: root, dataDir: join(root, "state") });
}

function codeAnalysisManifest(): SkillRuntimeManifest {
  return {
    id: "code-analysis",
    name: "Code Analysis",
    version: "1.0.0",
    description: "Searches code.",
    author: "QUACK",
    trustLevel: "builtin",
    requiredCapabilities: ["permission.workspace.read"],
    allowedTools: ["core.workspace.code-search"],
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    executionLimits: { timeoutMs: 1000, maxIterations: 1, maxToolCalls: 1, maxRetriesPerStep: 0 },
    category: "analysis",
    tags: ["code"],
    workflow: {
      steps: [{
        id: "search",
        description: "Search code.",
        requiredTools: ["core.workspace.code-search"],
        toolInvocations: [{ toolId: "core.workspace.code-search", input: { query: "AgentRouter" } }],
      }],
    },
  };
}

test("AgentRouter selects the correct specialist for coding missions", async (context) => {
  const system = await isolatedSystem(context);
  const selected = system.workforce.selectAgent({ goal: "implement a TypeScript coding change" });

  assert.equal(selected.ok, true);
  if (selected.ok) assert.equal(selected.data.agent.identity.id, "coding-agent");
});

test("AgentRouter respects required capability filters", async (context) => {
  const system = await isolatedSystem(context);
  const selected = system.workforce.selectAgent({
    goal: "research local notes",
    requiredCapabilities: ["permission.workspace.write"],
  });

  assert.equal(selected.ok, true);
  if (selected.ok) assert.notEqual(selected.data.agent.identity.id, "research-agent");
});

test("AgentRegistry rejects unknown agents", async (context) => {
  const system = await isolatedSystem(context);
  const unknown = system.workforce.registry.get("unknown-agent");

  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.code, "agent.not_found");
});

test("Specialist workforce execution preserves capability enforcement", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_agent_workspace"));
  const dataDir = join(tmpdir(), createId("quack_agent_state"));
  await mkdir(workspaceRoot, { recursive: true });
  try {
    const system = createQuackSystem({
      workspaceRoot,
      dataDir,
      missionId: "mission-agent-denied",
      permissions: ["workspace.read"],
    });
    assert.equal((await system.skillRuntime.loadSkillManifest(codeAnalysisManifest())).ok, true);
    assert.equal(system.skillRuntime.enableSkill("code-analysis").ok, true);

    const result = await system.workforce.executeMission({
      missionId: "mission-agent-denied",
      goal: "coding analysis",
      requiredSkills: ["code-analysis"],
      requiredCapabilities: ["permission.workspace.read"],
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.ok, false);
      assert.match(result.data.error ?? "", /CapabilityDeniedError/);
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});
