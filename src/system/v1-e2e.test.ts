import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";
import { type SkillRuntimeManifest } from "../skills/runtime/index.js";
import { createHarnessRegistry, registerQuackNativeHarness } from "../harness/registry.js";
import { createLoopDriver } from "../agent-loop/driver.js";

interface Scenario {
  readonly name: string;
  readonly missionId: string;
  readonly goal: string;
  readonly expectedAgent: string;
  readonly skill: SkillRuntimeManifest;
  readonly requiredSkills: readonly string[];
}

const scenarios: readonly Scenario[] = [
  {
    name: "software development task",
    missionId: "scenario-software",
    goal: "coding analysis for TypeScript implementation",
    expectedAgent: "coding-agent",
    skill: codeSearchSkill("code-analysis"),
    requiredSkills: ["code-analysis"],
  },
  {
    name: "research task",
    missionId: "scenario-research",
    goal: "research local notes and summarize evidence",
    expectedAgent: "research-agent",
    skill: listSkill("research"),
    requiredSkills: ["research"],
  },
  {
    name: "document generation",
    missionId: "scenario-docs",
    goal: "document markdown writeup from workspace files",
    expectedAgent: "documentation-agent",
    skill: listSkill("filesystem-assistant"),
    requiredSkills: ["filesystem-assistant"],
  },
  {
    name: "engineering analysis task",
    missionId: "scenario-engineering",
    goal: "engineering architecture analysis",
    expectedAgent: "engineering-agent",
    skill: codeSearchSkill("code-analysis"),
    requiredSkills: ["code-analysis"],
  },
];

for (const scenario of scenarios) {
  test(`QUACK OS v1 e2e scenario: ${scenario.name}`, async () => {
    const workspaceRoot = join(tmpdir(), createId("quack_v1_workspace"));
    const dataDir = join(tmpdir(), createId("quack_v1_state"));
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(workspaceRoot, "notes.md"), "architecture research documentation", "utf8");
    await writeFile(join(workspaceRoot, "app.ts"), "export const value = 'architecture';", "utf8");
    try {
          const system = await createQuackSystem({
            workspaceRoot,
            dataDir,
            missionId: scenario.missionId,
            permissions: ["workspace.read", "memory.read", "memory.write"],
            capabilityGrants: [{
              missionId: scenario.missionId,
              capabilities: ["permission.workspace.read"],
              approval: { approvedBy: "security", reason: "e2e scenario read", approvedAt: "2026-08-07T00:00:00.000Z" },
            }],
          });
          const events: string[] = [];
          system.events.onAny((event) => {
            events.push(event.type);
          });

      assert.equal((await system.skillRuntime.loadSkillManifest(scenario.skill)).ok, true);
      assert.equal(system.skillRuntime.enableSkill(scenario.skill.id).ok, true);

      const selected = system.workforce.selectAgent({
        missionId: scenario.missionId,
        goal: scenario.goal,
        requiredSkills: scenario.requiredSkills,
        requiredCapabilities: ["permission.workspace.read"],
      });
      assert.equal(selected.ok, true);
      if (!selected.ok) return;
      assert.equal(selected.data.agent.identity.id, scenario.expectedAgent);
      assert.ok(selected.data.agent.skills.includes(scenario.skill.id));

      const detach = system.harness.traceRecorder.attach();
            const execution = await system.workforce.executeMission({
              missionId: scenario.missionId,
              goal: scenario.goal,
              requiredSkills: scenario.requiredSkills,
              requiredCapabilities: ["permission.workspace.read"],
            });
            assert.equal(execution.ok, true);
            if (!execution.ok) return;
            assert.equal(execution.data.ok, true);

            // Use new Harness v2 + LoopDriver
            const harnessRegistry = createHarnessRegistry(system.events);
            registerQuackNativeHarness(harnessRegistry, system);
            const harnessEntry = harnessRegistry.get("QUACK_NATIVE");
            if (!harnessEntry) throw new Error("QUACK_NATIVE not registered");
            const harness = await harnessEntry.factory({ harnessId: "QUACK_NATIVE" });
            await harness.start({ harnessId: "QUACK_NATIVE" });

            const loopDriver = createLoopDriver(
              harness,
              system.capabilityBroker,
              system.events,
              system.storage.memory,
              system.memoryManager,
              {
                maxIterations: 20,
                maxDurationMs: 5 * 60 * 1000,
                maxTokens: 200_000,
                maxCostUsd: 5.0,
                maxRetries: 3,
                maxConsecutiveFailures: 3,
                maxNoProgressIterations: 5,
                maxDelegationDepth: 3,
                maxAgents: 6,
                maxConcurrentAgents: 4,
              },
              {
                enableProgressDetection: true,
                enableDoomLoopDetection: true,
                enableEventWakeups: true,
                heartbeatIntervalMs: 10_000,
                progressWindowSize: 5,
                doomLoopFingerprintWindow: 10,
              }
            );

            const loopResult = await loopDriver.start({
              missionId: scenario.missionId,
              goal: "inspect workspace",
            });
            const memory = await system.memoryManager.store({
              type: "mission.short_term",
              source: "e2e",
              confidence: 0.9,
              accessPolicy: {
                visibility: "mission",
                allowedMissionIds: [scenario.missionId],
                requiredCapabilities: ["permission.memory.read"],
              },
              relatedMission: scenario.missionId,
              content: `${scenario.name} completed`,
            }, {
              actor: "e2e",
              missionId: scenario.missionId,
              capabilities: ["permission.memory.read"],
            });
            assert.equal(memory.ok, true);

            const trace = await system.harness.traceRecorder.createTrace({
              missionInput: { missionId: scenario.missionId, goal: scenario.goal, actor: selected.data.agent.identity.id },
              loopResult: loopResult as any,
            });
            detach();
            const evaluation = await system.harness.evaluator.evaluateMission(trace);

            assert.ok(events.includes("capability.allowed"));
            assert.ok(events.includes("tool.completed"));
            assert.ok(events.includes("skill.completed"));
            // Loop should run (not stay IDLE/OBSERVING)
            assert.ok(loopResult.state !== "IDLE" && loopResult.state !== "OBSERVING", `Loop should have run, got state: ${loopResult.state}`);
            assert.ok(loopResult.iterations.length > 0, "Should have at least one iteration");
            assert.ok(trace !== undefined, "Trace should be created");
            assert.ok(evaluation !== undefined, "Evaluation should be created");
            const stored = await system.memoryManager.retrieve({ missionId: scenario.missionId, text: "completed" }, {
              actor: "e2e",
              missionId: scenario.missionId,
              capabilities: ["permission.memory.read"],
            });
            assert.ok(stored.some((item) => item.source === "e2e"));
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(dataDir, { recursive: true, force: true });
    }
  });
}

function listSkill(id: string): SkillRuntimeManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: "List workspace files.",
    author: "QUACK",
    trustLevel: "builtin",
    requiredCapabilities: ["permission.workspace.read"],
    allowedTools: ["core.workspace.list-files"],
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    executionLimits: { timeoutMs: 1000, maxIterations: 1, maxToolCalls: 1, maxRetriesPerStep: 0 },
    category: id === "research" ? "research" : "documentation",
    tags: [id],
    workflow: {
      steps: [{
        id: "list",
        description: "List workspace.",
        requiredTools: ["core.workspace.list-files"],
        toolInvocations: [{ toolId: "core.workspace.list-files", input: { path: ".", depth: 2 } }],
      }],
    },
  };
}

function codeSearchSkill(id: string): SkillRuntimeManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: "Search workspace code.",
    author: "QUACK",
    trustLevel: "builtin",
    requiredCapabilities: ["permission.workspace.read"],
    allowedTools: ["core.workspace.code-search"],
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    executionLimits: { timeoutMs: 1000, maxIterations: 1, maxToolCalls: 1, maxRetriesPerStep: 0 },
    category: "analysis",
    tags: ["code", "analysis"],
    workflow: {
      steps: [{
        id: "search",
        description: "Search code.",
        requiredTools: ["core.workspace.code-search"],
        toolInvocations: [{ toolId: "core.workspace.code-search", input: { pattern: "architecture" } }],
      }],
    },
  };
}
