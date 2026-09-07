import { QuackRuntime, type QuackRuntimeDependencies } from "../runtime/runtime.js";
import { EventBus } from "../events/event-bus.js";
import { InMemoryMemoryStore } from "../memory/memory.js";
import { ProviderRegistry } from "../providers/provider.js";
import { ToolRegistry, type ToolExecutionContext } from "../tools/tool.js";
import { AllowListPermissionPolicy } from "../security/permissions.js";
import { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker } from "../security/capability-broker.js";
import { TaskGraphBuilder } from "../engine/task-graph.js";
import type { TaskGraph } from "../engine/types.js";
import { now, ok, type JsonObject } from "../core/types.js";

export function measurementGraph(): TaskGraph {
  const builder = new TaskGraphBuilder({ description: "Combine two independent measurements" });
  const add = (id: string, input: JsonObject, dependencies: string[] = []) => builder.addNode(id, {
    description: id, dependencies, tools: ["fixture.measure"], toolInvocations: [{ toolId: "fixture.measure", input }],
    timeoutMs: 2000, retryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 },
  });
  add("left", { path: "allowed/left", value: 2, extra: "preserved" });
  add("right", { path: "allowed/right", value: 3 });
  add("join", { path: "allowed/join", left: { $fromNode: "left", path: "output.lastToolOutput.value" },
    right: { $fromNode: "right", path: "output.lastToolOutput.value" } }, ["left", "right"]);
  return builder.build();
}

export function canonicalFixture(options: {
  graph?: TaskGraph;
  omitVerifier?: boolean;
  omitGrant?: boolean;
  execute?: (input: JsonObject, context: ToolExecutionContext) => Promise<JsonObject>;
  overrides?: Partial<QuackRuntimeDependencies>;
} = {}) {
  const graph = options.graph ?? measurementGraph();
  const events = new EventBus();
  const memory = new InMemoryMemoryStore();
  const tools = new ToolRegistry();
  const grants = new InMemoryCapabilityGrantRegistry();
  const policy = new AllowListPermissionPolicy(["workspace.read"]);
  const broker = new PermissionBackedCapabilityBroker(policy, grants);
  const calls: { input: JsonObject; actor: string }[] = [];
  const learning: string[] = [];
  tools.register({ id: "fixture.measure", describe: () => ({ id: "fixture.measure", name: "Measure", description: "Test measurement", permissions: ["workspace.read"] }),
    execute: async (input, context) => {
      calls.push({ input: structuredClone(input) as JsonObject, actor: context.actor });
      const value = input as JsonObject;
      return { output: options.execute ? await options.execute(value, context) : { ...value, value: typeof value.left === "number" ? value.left + Number(value.right) : value.value } };
    },
  });
  const grant = options.omitGrant ? undefined : grants.ensureGrant({ missionId: "measurement", agentId: "observer",
    capabilities: ["permission.workspace.read"], scope: { workspacePaths: ["allowed"], toolIds: ["fixture.measure"] },
    approval: { approvedBy: "fixture", reason: "Read scoped fixture measurements", approvedAt: now() },
  });
  const runtime = new QuackRuntime({ eventBus: events, memory, tools, providers: new ProviderRegistry(), permissions: policy,
    capabilityBroker: broker, missionId: "measurement", agentId: "observer",
    planGraph: async () => ok({ id: graph.id, goal: graph.description, strategy: "Two measurements then combine", taskGraph: graph,
      requiresPermissions: ["workspace.read"], riskEstimate: { level: "low", factors: [], mitigation: [] },
      costEstimate: { estimatedCostUsd: 0, estimatedDurationMs: 0, estimatedTokens: 0, confidence: 0 }, contextSummary: "", createdAt: now() }),
    verifyExecution: options.omitVerifier ? undefined : async (_task, state) => ({
      success: (state.nodeResults.join?.output?.lastToolOutput as JsonObject | undefined)?.value === 5,
      reason: "Combined measurement must equal five.",
    }),
    learning: { recordTaskCompletion: async (task) => { learning.push(task.id); return undefined; } },
    ...options.overrides,
  });
  return { runtime, graph, events, memory, tools, grants, grant, broker, calls, learning };
}
