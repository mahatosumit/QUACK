import { createId, now, type JsonObject } from "../core/types.js";
import { type ModelRuntime } from "../models/runtime.js";
import { type ToolInvocation } from "../tools/tool.js";
import { type Plan, type RiskEstimate, type CostEstimate, type TaskNode, type TaskGraph, type RetryPolicy, type RiskLevel, type TaskNodePriority } from "./types.js";

export interface PlannerConfig {
  readonly defaultRetryPolicy: RetryPolicy;
  readonly defaultTimeoutMs: number;
  readonly maxNodesPerGraph: number;
  readonly modelRuntime?: Pick<ModelRuntime, "selectModel">;
}

export interface GoalDecomposition {
  readonly goal: string;
  readonly subgoals: readonly string[];
  readonly requiredSkills: readonly string[];
  readonly expectedTools: readonly string[];
}

export class Planner {
  constructor(private readonly config: PlannerConfig) {}

  createPlan(goal: string, contextSummary: string): Plan {
    const graph = this.buildGraph(goal);
    const risk = this.estimateRisk(graph);
    const cost = this.estimateCost(graph);
    const permissions = this.identifyRequiredPermissions(graph);

    return {
      id: createId("plan"),
      goal,
      strategy: this.determineStrategy(goal, risk.level),
      taskGraph: graph,
      riskEstimate: risk,
      costEstimate: cost,
      requiresPermissions: permissions,
      contextSummary,
      createdAt: now(),
    };
  }

  decomposeGoal(goal: string): GoalDecomposition {
    const lower = goal.toLowerCase();
    const subgoals = goal
      .split(/\b(?:and then|then|and|also|additionally)\b/i)
      .map((part) => part.trim())
      .filter(Boolean);
    const normalizedSubgoals = subgoals.length > 0 ? subgoals : [goal];
    const requiredSkills = new Set<string>();
    const expectedTools = new Set<string>();

    if (/\b(code|coding|typescript|bug|implement|fix|refactor)\b/.test(lower)) {
      requiredSkills.add("code-analysis");
      expectedTools.add("core.workspace.code-search");
      expectedTools.add("core.workspace.read-file");
    }
    if (/\b(research|notes|evidence|summarize)\b/.test(lower)) {
      requiredSkills.add("research");
      expectedTools.add("core.workspace.list-files");
    }
    if (/\b(document|docs?|markdown|writeup)\b/.test(lower)) {
      requiredSkills.add("filesystem-assistant");
      expectedTools.add("core.workspace.read-file");
      expectedTools.add("core.workspace.write-file");
    }
    if (expectedTools.size === 0) expectedTools.add("core.workspace.list-files");

    return {
      goal,
      subgoals: normalizedSubgoals,
      requiredSkills: [...requiredSkills],
      expectedTools: [...expectedTools],
    };
  }

  createTaskGraph(goal: string): TaskGraph {
    return this.buildGraph(goal);
  }

  executionOrder(graph: TaskGraph): string[] {
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const ordered: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      if (visiting.has(nodeId)) throw new Error(`Task graph contains a dependency cycle at ${nodeId}.`);
      visiting.add(nodeId);
      for (const dependency of byId.get(nodeId)?.dependencies ?? []) visit(dependency);
      visiting.delete(nodeId);
      visited.add(nodeId);
      ordered.push(nodeId);
    };

    for (const node of graph.nodes) visit(node.id);
    return ordered;
  }

  validateDependencies(graph: TaskGraph): { readonly valid: boolean; readonly errors: readonly string[] } {
    const ids = new Set(graph.nodes.map((node) => node.id));
    const errors: string[] = [];
    for (const node of graph.nodes) {
      for (const dependency of node.dependencies) {
        if (!ids.has(dependency)) errors.push(`Node ${node.id} depends on missing node ${dependency}.`);
      }
    }
    try {
      this.executionOrder(graph);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    return { valid: errors.length === 0, errors };
  }

  buildGraph(goal: string): TaskGraph {
    const nodes: TaskNode[] = [];
    const edges: { from: string; to: string }[] = [];
    const lower = goal.toLowerCase();
    const decomposition = this.decomposeGoal(goal);

    if (this.isWorkspaceListingGoal(lower)) {
      return this.buildWorkspaceListingGraph(goal);
    }

    // Analyze phase: list workspace files (bounded, read-only, safe static input).
    const analyzeId = createId("node");
    nodes.push(this.makeNode(analyzeId, `Analyze: ${goal}`, {
      dependencies: [],
      priority: "high",
      tools: ["core.workspace.list-files"],
      toolInvocations: [{
        toolId: "core.workspace.list-files",
        input: { path: ".", depth: 2 },
        reason: "Gather a bounded file listing from the configured workspace root.",
      }],
      description: `Analyze the goal "${goal}" and gather initial context.`,
    }));

    // Context gathering phase: search for goal-relevant text (plain-string pattern).
    const contextId = createId("node");
    nodes.push(this.makeNode(contextId, "Gather context", {
      dependencies: [analyzeId],
      priority: "high",
      tools: ["core.workspace.code-search"],
      toolInvocations: [{
        toolId: "core.workspace.code-search",
        input: { pattern: this.searchPatternFor(goal), maxResults: 50 },
        reason: "Search the workspace for text related to the goal.",
      }],
      description: "Search for relevant code, symbols, and documentation.",
    }));

    // Planning phase (no tools — reasoning step)
    const planId = createId("node");
    nodes.push(this.makeNode(planId, "Develop execution plan", {
      dependencies: [contextId],
      priority: "critical",
      tools: [],
      description: "Develop detailed execution plan based on context.",
    }));

    // Main execution phase — decompose based on complexity indicators.
    // Tools with context-dependent inputs (read/write/terminal) are NOT
    // declared here: a static planner cannot derive their inputs, and the
    // workflow engine fails nodes that declare tools without invocations.
    // These steps run as reasoning steps; deeper execution requires an
    // LLM-backed planner or an explicit precompiled graph.
    const hasMultipleParts = ["and", "then", "also", "additionally", "refactor", "implement", "create", "build", "add", "fix", "update"].some((w) => lower.includes(w));
    const executionDeps: string[] = [];

    const mainId = createId("node");
    nodes.push(this.makeNode(mainId, `Execute: ${goal}`, {
      dependencies: [planId],
      priority: "high",
      tools: [],
      timeoutMs: Math.max(this.config.defaultTimeoutMs, 120_000),
      description: `Carry out the primary task: ${goal}.`,
    }));
    executionDeps.push(mainId);

    if (hasMultipleParts) {
      const secondaryId = createId("node");
      nodes.push(this.makeNode(secondaryId, "Execute secondary tasks", {
        dependencies: [mainId],
        priority: "medium",
        tools: [],
        description: "Complete additional tasks identified during planning.",
      }));
      executionDeps.push(secondaryId);
    }

    // Validation phase (reasoning step)
    const validateId = createId("node");
    nodes.push(this.makeNode(validateId, "Validate changes", {
      dependencies: executionDeps,
      priority: "critical",
      tools: [],
      description: "Run typecheck, lint, and build to validate changes.",
      timeoutMs: 60_000,
    }));

    // Test phase (reasoning step)
    const testId = createId("node");
    nodes.push(this.makeNode(testId, "Run tests", {
      dependencies: [validateId],
      priority: "high",
      tools: [],
      description: "Execute test suite and verify all tests pass.",
      timeoutMs: 120_000,
    }));

    // Final verification (reasoning step)
    const verifyId = createId("node");
    nodes.push(this.makeNode(verifyId, "Final verification", {
      dependencies: [testId],
      priority: "high",
      tools: [],
      description: "Review changes, check git status, and produce summary.",
    }));

    return {
      id: createId("graph"),
      description: `Task graph for: ${goal}`,
      nodes,
      edges: this.buildEdges(nodes),
      createdAt: now(),
      updatedAt: now(),
      metadata: {
        goal,
        subgoals: decomposition.subgoals,
        requiredSkills: decomposition.requiredSkills,
        expectedTools: decomposition.expectedTools,
        executionOrder: nodes.map((node) => node.id),
        selectedModel: this.selectModelMetadata(goal),
      },
    };
  }

  private makeNode(id: string, title: string, opts: {
    dependencies: string[];
    priority: TaskNodePriority;
    tools: string[];
    toolInvocations?: readonly ToolInvocation[];
    description: string;
    timeoutMs?: number;
  }): TaskNode {
    return {
      id,
      description: opts.description,
      dependencies: opts.dependencies,
      priority: opts.priority,
      estimatedCost: this.calcCost(opts.priority, opts.tools.length),
      estimatedDurationMs: this.calcDuration(opts.priority, opts.tools.length),
      requiredTools: opts.tools,
      toolInvocations: opts.toolInvocations ? [...opts.toolInvocations] : undefined,
      timeoutMs: opts.timeoutMs ?? this.config.defaultTimeoutMs,
      retryPolicy: this.config.defaultRetryPolicy,
      status: "pending",
      retryCount: 0,
    };
  }

  private buildEdges(nodes: readonly TaskNode[]): { from: string; to: string }[] {
    const edges: { from: string; to: string }[] = [];
    for (const node of nodes) {
      for (const dep of node.dependencies) {
        edges.push({ from: dep, to: node.id });
      }
    }
    return edges;
  }

  private isWorkspaceListingGoal(goal: string): boolean {
    return /\b(list|show|inspect)\b/.test(goal) && /\b(workspace|files?|repo|repository)\b/.test(goal);
  }

  /**
   * Plain-string search pattern derived from the goal: strip planning verbs,
   * keep the first few meaningful words, and cap the length. Used as the
   * default code-search input; regex is never enabled for it.
   */
  private searchPatternFor(goal: string): string {
    const meaningful = goal
      .replace(/\b(please|analyze|implement|create|build|fix|update|improve|refactor|the|a|an|and|then|also|additionally)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const pattern = meaningful.split(" ").slice(0, 4).join(" ");
    return (pattern || goal).slice(0, 80);
  }

  private buildWorkspaceListingGraph(goal: string): TaskGraph {
    const nodeId = createId("node");
    const nodes = [
      this.makeNode(nodeId, `List workspace files: ${goal}`, {
        dependencies: [],
        priority: "high",
        tools: ["core.workspace.list-files"],
        toolInvocations: [
          {
            toolId: "core.workspace.list-files",
            input: { path: ".", depth: 2 },
            reason: "Gather a bounded file listing from the configured workspace root.",
          },
        ],
        description: `List workspace files for goal "${goal}".`,
      }),
    ];

    return {
      id: createId("graph"),
      description: `Task graph for: ${goal}`,
      nodes,
      edges: [],
      createdAt: now(),
      updatedAt: now(),
      metadata: {
        goal,
        subgoals: [goal],
        requiredSkills: [],
        expectedTools: ["core.workspace.list-files"],
        executionOrder: [nodeId],
        selectedModel: this.selectModelMetadata(goal),
      },
    };
  }

  estimateRisk(graph: TaskGraph): RiskEstimate {
    const factors: string[] = [];
    const mitigations: string[] = [];
    const nodeCount = graph.nodes.length;
    const hasCritical = graph.nodes.some((n) => n.priority === "critical");
    const maxDepth = this.graphDepth(graph);

    if (nodeCount > 10) {
      factors.push("Large number of nodes");
      mitigations.push("Consider splitting into sub-workflows");
    }
    if (hasCritical) {
      factors.push("Contains critical-priority nodes");
      mitigations.push("Ensure checkpointing before critical nodes");
    }
    if (maxDepth > 5) {
      factors.push("Deep dependency chain");
      mitigations.push("Add intermediate checkpoints");
    }

    let level: RiskLevel = "low";
    if (factors.length >= 3) level = "critical";
    else if (factors.length >= 2) level = "high";
    else if (factors.length >= 1) level = "medium";

    return { level, factors, mitigation: mitigations };
  }

  estimateCost(graph: TaskGraph): CostEstimate {
    const totalEstimate = graph.nodes.reduce((s, n) => s + n.estimatedCost, 0);
    const totalDuration = graph.nodes.reduce((s, n) => s + n.estimatedDurationMs, 0);
    return {
      estimatedTokens: Math.round(totalEstimate * 1000),
      estimatedCostUsd: totalEstimate * 0.002,
      estimatedDurationMs: totalDuration,
      confidence: 0.7,
    };
  }

  private graphDepth(graph: TaskGraph): number {
    const depths = new Map<string, number>();
    const resolve = (nodeId: string): number => {
      if (depths.has(nodeId)) return depths.get(nodeId)!;
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (!node || node.dependencies.length === 0) {
        depths.set(nodeId, 1);
        return 1;
      }
      const depth = 1 + Math.max(...node.dependencies.map(resolve));
      depths.set(nodeId, depth);
      return depth;
    };
    return Math.max(...graph.nodes.map((n) => resolve(n.id)), 0);
  }

  private calcCost(priority: TaskNodePriority, toolCount: number): number {
    const base = { critical: 5, high: 3, medium: 1, low: 0.5 }[priority];
    return base + toolCount * 0.2;
  }

  private calcDuration(priority: TaskNodePriority, toolCount: number): number {
    const base = { critical: 60_000, high: 30_000, medium: 15_000, low: 5_000 }[priority];
    return base + toolCount * 5_000;
  }

  private determineStrategy(goal: string, risk: RiskLevel): string {
    if (risk === "critical") return "Defensive execution with maximum checkpointing and validation.";
    if (risk === "high") return "Standard execution with checkpointing after each phase.";
    if (risk === "medium") return "Efficient execution with post-completion validation.";
    return "Direct execution with minimal overhead.";
  }

  private identifyRequiredPermissions(graph: TaskGraph): string[] {
    const permissions = new Set<string>();
    for (const node of graph.nodes) {
      for (const toolId of node.requiredTools) {
        if (toolId.includes("workspace") || toolId.includes("write")) permissions.add("workspace.read");
        if (toolId.includes("terminal")) permissions.add("terminal.execute");
        if (toolId.includes("git")) permissions.add("git.read");
      }
    }
    return [...permissions];
  }

  private selectModelMetadata(goal: string): JsonObject | null {
    if (!this.config.modelRuntime) return null;
    const lower = goal.toLowerCase();
    const capability = /\b(code|coding|typescript|bug|implement|fix|refactor)\b/.test(lower)
      ? "coding"
      : /\b(research|notes|evidence)\b/.test(lower)
        ? "retrieval"
        : "reasoning";
    const selected = this.config.modelRuntime.selectModel({ goal, capability });
    return selected.ok
      ? { id: selected.data.id, provider: selected.data.provider, model: selected.data.name, capability }
      : { error: selected.error.message, capability };
  }
}
