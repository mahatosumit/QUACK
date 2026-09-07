import { compileSkillContributions } from "../skills/graph-composition.js";
import { ExecutiveBrain } from "../brain/executive-brain.js";
import { QuackRuntime } from "../runtime/runtime.js";
import { SkillExecutor } from "../skills/executor.js";
import { SkillValidator } from "../skills/validator.js";
import { capabilityIdForPermission } from "../security/capability-broker.js";
import { createId, type JsonObject } from "../core/types.js";
import type { QuackSystem } from "../distributions/swe-system.js";

/** Test fixture using real DAG execution and an explicit expected file assertion. */
export function createValidatedListingRuntime(system: QuackSystem, expectedFile: string): QuackRuntime {
  const missionId = createId("listing_fixture");
  system.capabilityGrants.ensureGrant({ missionId, capabilities: [capabilityIdForPermission("workspace.read")],
    scope: { workspacePaths: ["."], toolIds: ["core.workspace.list-files", "core.workspace.read-file"], actions: ["READ"] },
    approval: { approvedBy: "test-fixture", reason: "Allow fixture workspace listing and read validation only.", approvedAt: new Date().toISOString() },
  });
  const brain = new ExecutiveBrain({ eventBus: system.events, tools: system.tools, providers: system.providers, memory: system.memory }, {
    maxRetries: 0, reflectionThreshold: 1, defaultRoutingPolicy: "balanced", checkpointIntervalMs: 30000,
    schedulerConfig: { maxParallelNodes: 1, defaultTimeoutMs: 2000, queuePollIntervalMs: 5 },
    retryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 },
    verifyExecution: async (_task, state) => {
      const results = Object.values(state.nodeResults);
      const success = results.length > 0 && results.every((result) => result.success) && results[0].success && results[0].toolCalls.includes("core.workspace.list-files")
        && Array.isArray((results[0].output?.lastToolOutput as JsonObject | undefined)?.files)
        && ((results[0].output?.lastToolOutput as JsonObject).files as readonly string[]).some((file) => file.startsWith(`${expectedFile} `));
      return { success, reason: `Check actual workspace listing includes fixture file ${expectedFile}.` };
    },
  });
  let runtime: QuackRuntime;
  const skillExecutor = new SkillExecutor(system.skills, new SkillValidator(), { tools: system.tools, allowedPermissions: system.config.permissions,
    executeGraph: (graph, context) => runtime.executeGraph(graph, "test", { missionId, skillId: context.skillId, deadline: context.deadline }),
    executeTool: async (invocation, context) => {
      const result = await runtime.executeTool(invocation.toolId, invocation.input, { taskId: context.taskId, actor: context.actor, missionId });
      return result.ok ? { toolId: invocation.toolId, success: true, output: result.data } : { toolId: invocation.toolId, success: false, error: result.error.message };
    },
  });
  runtime = new QuackRuntime({
    prepareGraph: async (graph, task, selection) => compileSkillContributions(graph,
      (selection?.selected ?? []).flatMap((selected) => {
        const definition = system.skills.get(selected.skillId, selected.version);
        return definition?.portableExecution ? [{ definition, record: system.skills.getRecord(selected.skillId, selected.version) }] : [];
      }), { goal: task.goal, parameters: {}, context: { workspaceRoot: system.config.workspaceRoot, dataDir: system.config.dataDir, sessionId: task.id } }, system.tools, system.config.permissions),
 brain, eventBus: system.events, memory: system.memory, permissions: system.approvalPolicy,
    capabilityBroker: system.capabilityBroker, providers: system.providers, taskStore: system.storage.tasks, tools: system.tools,
    learning: system.runtimeLearning, skillSelector: system.contextualSkillSelector, skillFitness: system.skillFitness,
    skillExecutor, skills: system.skills, workspaceRoot: system.config.workspaceRoot, dataDir: system.config.dataDir, missionId,
  });
  return runtime;
}
