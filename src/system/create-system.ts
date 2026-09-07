import { createDefaultConfig, type QuackConfig } from "../config/config.js";
import { QUACK_CONTRACT_VERSION, type ExecutionContextV1 } from "../contracts/v1/contracts.js";
import { createId, fail, now, ok } from "../core/types.js";
import { EventBus } from "../events/event-bus.js";
import { ExtensionRegistry } from "../extensions/registry.js";
import { ExtensionPolicyBroker } from "../extensions/policy.js";
import type { AgentProfile, AgentResourceBudget, ContextFragment, ContextProvider } from "../extensions/types.js";
import { InMemoryMemoryStore, JsonFileMemoryStore, type MemoryStore } from "../memory/memory.js";
import { MemoryProviderBinding } from "../memory/provider-binding.js";
import { CanonicalProviderRegistry, CapabilityProviderRouter } from "../providers/kernel.js";
import { GovernedProviderRouter } from "../providers/governed-router.js";
import { ProviderRegistry } from "../providers/provider.js";
import { RuntimeHookBridge } from "../extensions/hook-bridge.js";
import type { GovernedHook } from "../extensions/hooks.js";
import { QuackRuntime } from "../runtime/runtime.js";
import { DelegationRuntime } from "../runtime/delegation.js";
import { RiskAwareApprovalPolicy } from "../security/approval-controller.js";
import { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker, type CapabilityBroker, type CapabilityGrantRegistry } from "../security/capability-broker.js";
import { SkillRegistry } from "../skills/registry.js";
import { ToolRegistry } from "../tools/tool.js";
import { join } from "node:path";
import type { BrainContext } from "../brain/brain.js";
import { validateWorkflow } from "./validation.js";

export interface QuackSystem {
  readonly runtime: QuackRuntime;
  readonly events: EventBus;
  readonly config: QuackConfig;
  readonly extensions: ExtensionRegistry;
  readonly tools: ToolRegistry;
  readonly skills: SkillRegistry;
  readonly profiles: readonly AgentProfile[];
  readonly providers: ProviderRegistry;
  readonly providerKernel: CanonicalProviderRegistry;
  readonly capabilityRouter: CapabilityProviderRouter;
  readonly governedProviderRouter: GovernedProviderRouter;
  /** Wires admitted plugin hooks to canonical runtime events under governed authority. */
  readonly hookBridge: RuntimeHookBridge;
  /**
   * Governed delegation runtime, or undefined when delegation is disabled
   * (`delegationMaxDepth: 0`, the default). When enabled, children run
   * through the canonical `runtime.submitGoal` under attenuated grants
   * derived from the configured parent grant.
   */
  readonly delegation?: DelegationRuntime;
  readonly capabilityBroker: CapabilityBroker;
  readonly capabilityGrants: CapabilityGrantRegistry;
  readonly memory: MemoryStore;
}

const DEFAULT_BUDGET: AgentResourceBudget = {
  maxIterations: 3, maxToolCalls: 24, maxModelCalls: 8,
  timeoutMs: 120_000, maxConcurrency: 3,
};

export function createQuackSystem(overrides: Partial<QuackConfig> = {}): QuackSystem {
  const config = createDefaultConfig(overrides);
  const extensions = new ExtensionRegistry();
  const admitted = extensions.registerBatch(config.extensions, {
    source: { kind: "application", sourceId: "runtime.configuration" },
  });
  const tools = new ToolRegistry();
  const skills = new SkillRegistry();
  const providers = new ProviderRegistry();
  const providerKernel = new CanonicalProviderRegistry();
  const profiles = admitted.flatMap((entry) => [...(entry.contributions.agentProfiles ?? [])]);
  for (const entry of admitted) {
    for (const tool of entry.contributions.tools ?? []) {
      const registered = tools.register(tool);
      if (!registered.ok) throw new Error(registered.error.message);
    }
    for (const skill of entry.contributions.skills ?? []) skills.register(skill, "imported", "inactive", { setDefault: false });
    for (const provider of entry.contributions.modelProviders ?? []) providerKernel.register(provider);
  }
  const planners = admitted.flatMap((entry) => [...(entry.contributions.plannerStrategies ?? [])]);
  const validators = admitted.flatMap((entry) => [...(entry.contributions.validationProviders ?? [])]);
  const contextProviders = admitted.flatMap((entry) => [...(entry.contributions.contextProviders ?? [])]);
  const memoryProviders = admitted.flatMap((entry) => [...(entry.contributions.memoryProviders ?? [])]);
  const policies = admitted.flatMap((entry) => [...(entry.contributions.policyProviders ?? [])]);
  const planner = select(planners, config.plannerId, "planner");
  const validator = select(validators, config.validationProviderId, "validator");
  const selectedMemory = select(memoryProviders, config.memoryProviderId, "memory provider");
  const selectedContexts = config.contextProviderIds.map((id) => select(contextProviders, id, "context provider")!);
  const events = new EventBus();
  const capabilityGrants = new InMemoryCapabilityGrantRegistry();
  for (const grant of config.capabilityGrants ?? []) capabilityGrants.ensureGrant(grant);
  const permissions = new RiskAwareApprovalPolicy(config.permissions, config.approver);
  const capabilityBroker = new ExtensionPolicyBroker(new PermissionBackedCapabilityBroker(permissions, capabilityGrants), policies, profiles, config.approver);
  const defaultMemory = config.dataDir ? new JsonFileMemoryStore(join(config.dataDir, "memory.json")) : new InMemoryMemoryStore();
  const memoryBinding = selectedMemory ? new MemoryProviderBinding({ provider: selectedMemory, capabilityBroker,
    namespace: config.memoryNamespace,
    timeoutMs: config.memoryProviderTimeoutMs, maxItems: config.memoryProviderMaxItems, maxBytes: config.memoryProviderMaxBytes }) : undefined;
  const memory: MemoryStore = memoryBinding ?? defaultMemory;
  const execution = (taskId: string, context: BrainContext): ExecutionContextV1 => ({
    contractVersion: QUACK_CONTRACT_VERSION, missionId: context.missionId ?? config.missionId ?? taskId,
    taskId, executionId: taskId, actor: context.actor, signal: context.signal, deadline: context.deadline,
  });
  const runtime = new QuackRuntime({
    eventBus: events, memory, permissions, capabilityBroker, providers, tools, skills,
    budgetFor: (context) => {
      const profile = context.agentId ? profiles.find((candidate) => candidate.id === context.agentId) : undefined;
      if (context.agentId && !profile) throw new Error("The requested agent profile is not registered.");
      const budget = profile?.resourceBudget ?? DEFAULT_BUDGET;
      return { maxIterations: budget.maxIterations, maxToolCalls: budget.maxToolCalls, maxDurationMs: budget.timeoutMs,
        maxConcurrentNodes: budget.maxConcurrency, maxDelegationDepth: 0, maxAgents: 1, maxConcurrentAgents: 1,
        ...(budget.maxTokens === undefined ? {} : { maxTokens: budget.maxTokens }),
        ...(budget.maxCostUsd === undefined ? {} : { maxCostUsd: budget.maxCostUsd }),
      };
    },
    workspaceRoot: config.workspaceRoot, dataDir: config.dataDir, missionId: config.missionId,
    planGraph: async (task, context) => {
      if (!planner) return fail({ code: "planner.unconfigured", message: "Register and select a planner strategy before submitting a goal.", category: "runtime", recoverable: false });
      const profile = context.agentId ? profiles.find((candidate) => candidate.id === context.agentId) : undefined;
      if (context.agentId && !profile) return fail({ code: "agent.unregistered", message: "The requested agent profile is not registered.", category: "permission", recoverable: false });
      const budget = profile?.resourceBudget ?? DEFAULT_BUDGET;
      const allowedTools = profile?.allowedTools ?? tools.list().map((tool) => tool.id);
      const fragments = await loadContext(selectedContexts, config.contextNamespaces, execution(task.id, context), context.sessionId, profile);
      if (memoryBinding) {
        const maxBytes = profile?.contextPolicy.maxBytes ?? 64 * 1024;
        const maxTokens = profile?.contextPolicy.maxTokens ?? 8192;
        const usedBytes = Buffer.byteLength(JSON.stringify(fragments), "utf8");
        const usedTokens = Math.ceil(JSON.stringify(fragments).length / 4);
        if (usedBytes >= maxBytes || usedTokens >= maxTokens) throw new Error("Context providers exhausted the budget before memory retrieval.");
        fragments.push(...await memoryBinding.loadContext({ execution: execution(task.id, context), sessionId: context.sessionId,
          goal: task.goal, namespace: config.memoryNamespace, maxBytes: maxBytes - usedBytes,
          maxItems: config.memoryProviderMaxItems, maxTokens: maxTokens - usedTokens }));
      }
      const proposed = await planner.plan({
        execution: execution(task.id, context), sessionId: context.sessionId, goal: task.goal, context: fragments,
        catalog: { tools: tools.list().filter((tool) => allowedTools.includes(tool.id)), skills: skills.getAll().map((skill) => skill.manifest), profiles, models: [] },
        constraints: { maxNodes: budget.maxToolCalls, allowedTools, budget },
      });
      if (!proposed.ok) return proposed;
      if (!proposed.data.nodes.length || proposed.data.nodes.length > budget.maxToolCalls
        || proposed.data.nodes.some((node) => node.requiredTools.some((id) => !allowedTools.includes(id)))) {
        return fail({ code: "planner.invalid_graph", message: "The proposed graph exceeds the selected runtime constraints.", category: "validation", recoverable: false });
      }
      return ok({
        id: createId("plan"), goal: task.goal, strategy: planner.id, taskGraph: structuredClone(proposed.data),
        riskEstimate: { level: "high", factors: ["Actions require runtime authorization."], mitigation: [] },
        costEstimate: { estimatedTokens: 0, estimatedCostUsd: 0, estimatedDurationMs: 0, confidence: 0 },
        requiresPermissions: [], contextSummary: "", createdAt: now(),
      });
    },
    verifyExecution: validator ? (task, state, context) => validateWorkflow(validator, execution(task.id, context), task.goal, state, context.recoveryEvidence) : undefined,
  });
  const capabilityRouter = new CapabilityProviderRouter(providerKernel);
  const governedProviderRouter = new GovernedProviderRouter(capabilityRouter, capabilityBroker);
  // Wire admitted plugin hooks to canonical runtime events (ADR 0037). Hooks
  // are governed observers: each dispatch resolves plugin permissions through
  // the capability broker before the handler runs.
  const governedHooks: GovernedHook[] = [];
  for (const entry of admitted) {
    for (const plugin of entry.contributions.plugins ?? []) {
      for (const contribution of plugin.hooks ?? []) {
        governedHooks.push({
          pluginId: plugin.manifest.id,
          pluginVersion: plugin.manifest.version,
          kind: contribution.kind,
          permissions: plugin.manifest.permissions,
          handler: contribution.handler,
        });
      }
    }
  }
  const hookBridge = new RuntimeHookBridge({ eventBus: events, capabilityBroker, hooks: governedHooks });
  // Governed delegation (ADR 0035/0038): disabled unless the composition
  // configures a depth ceiling plus a parent grant (explicit id, or exactly
  // one seeded mission grant). Children always run through the canonical
  // runtime under attenuated derived grants.
  let delegationParentGrantId = config.delegationParentGrantId;
  if (config.delegationMaxDepth > 0 && !delegationParentGrantId && config.missionId) {
    const missionGrants = capabilityGrants.queryActiveGrants({ missionId: config.missionId }).filter(grant => grant.missionId === config.missionId);
    if (missionGrants.length === 1) delegationParentGrantId = missionGrants[0].id;
  }
  const delegation = config.delegationMaxDepth > 0 && delegationParentGrantId
    ? new DelegationRuntime({
      maxDepth: config.delegationMaxDepth,
      parentGrantId: delegationParentGrantId,
      grants: capabilityGrants,
      submit: (goal, actor, options) => runtime.submitGoal(goal, actor, options),
    })
    : undefined;
  return { runtime, events, config, extensions, tools, skills, profiles, providers, providerKernel,
    capabilityRouter, governedProviderRouter, hookBridge, delegation, capabilityBroker, capabilityGrants, memory };
}

function select<T extends { readonly id: string }>(values: readonly T[], id: string | undefined, kind: string): T | undefined {
  if (id === undefined) return undefined;
  const found = values.find((value) => value.id === id);
  if (!found) throw new Error(`Configured ${kind} '${id}' is not registered.`);
  return found;
}

async function loadContext(providers: readonly ContextProvider[], namespaces: readonly string[], execution: ExecutionContextV1, sessionId: string, profile?: AgentProfile): Promise<ContextFragment[]> {
  const result: ContextFragment[] = [];
  const maxBytes = profile?.contextPolicy.maxBytes ?? 64 * 1024;
  const maxTokens = profile?.contextPolicy.maxTokens ?? 8192;
  let bytes = 0;
  for (const namespace of namespaces) {
    if (profile && !profile.contextPolicy.namespaces.includes(namespace)) throw new Error("Context namespace exceeds the selected profile policy.");
    for (const provider of providers) {
      if (execution.signal?.aborted) throw new Error("Context loading cancelled.");
      const fragments = await provider.load({ execution, sessionId, namespace, purpose: "planning", maxBytes: maxBytes - bytes, maxTokens });
      for (const fragment of fragments) {
        if (fragment.namespace !== namespace) throw new Error("Context provider returned a different namespace.");
        const snapshot = structuredClone(fragment);
        bytes += Buffer.byteLength(JSON.stringify(snapshot), "utf8");
        if (bytes > maxBytes) throw new Error("Context provider exceeded the byte budget.");
        result.push(snapshot);
      }
    }
  }
  return result;
}
