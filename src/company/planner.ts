import { now } from "../core/types.js";
import { capabilityIdForPermission } from "../security/capability-broker.js";
import {
  COMPANY_RUNTIME_CONTRACT_VERSION,
  type CompanyAgentBudgetV1,
  type CompanyAgentPlanV1,
  type CompanyGoalAncestryV1,
  type CompanyTaskPlanV1,
  type MissionCompanyPlanV1,
} from "./types.js";

export interface MissionCompanyPlanningInput {
  readonly missionId: string;
  readonly objective: string;
  readonly companyId?: string;
  readonly companyObjective?: string;
  readonly goalId?: string;
  readonly goalObjective?: string;
  readonly projectId?: string;
  readonly projectObjective?: string;
  readonly successCriteria?: readonly string[];
}

const READ = [
  capabilityIdForPermission("workspace.read"),
  capabilityIdForPermission("memory.read"),
  capabilityIdForPermission("provider.invoke"),
] as const;
const RESEARCH = [...READ, capabilityIdForPermission("network.http"), capabilityIdForPermission("memory.write")] as const;
const WRITE = [...READ, capabilityIdForPermission("workspace.write"), capabilityIdForPermission("terminal.execute"), capabilityIdForPermission("git.read")] as const;

const DEFAULT_BUDGET: CompanyAgentBudgetV1 = {
  tokenLimit: 100_000,
  costLimitUsd: 2,
  runtimeMinutes: 60,
  modelCallLimit: 50,
  toolCallLimit: 100,
  retryLimit: 2,
};

export class MissionCompanyPlanner {
  plan(input: MissionCompanyPlanningInput): MissionCompanyPlanV1 {
    const companyType = classifyObjective(input.objective);
    const ancestry = ancestryFor(input);
    const agents = teamFor(companyType, input.objective);
    const tasks = tasksFor(companyType, agents);
    validatePlan(agents, tasks);
    return {
      contractVersion: COMPANY_RUNTIME_CONTRACT_VERSION,
      missionId: input.missionId,
      companyType,
      ancestry,
      agents,
      tasks,
      limits: { maxConcurrentAgents: 4, maxChildrenPerAgent: 3, maxDepth: 2, maxTotalAgents: 12 },
      createdAt: now(),
    };
  }
}

function classifyObjective(objective: string): MissionCompanyPlanV1["companyType"] {
  const normalized = objective.toLowerCase();
  if (/research|literature|dataset|study|evidence|survey/.test(normalized)) return "research";
  if (/company|business|market|marketing|finance|launch|product strategy/.test(normalized)) return "company-operations";
  return "software";
}

function ancestryFor(input: MissionCompanyPlanningInput): CompanyGoalAncestryV1 {
  return {
    company: { id: input.companyId ?? "company-default", objective: input.companyObjective ?? "Operate the owner's company safely." },
    goal: { id: input.goalId ?? `goal-${input.missionId}`, objective: input.goalObjective ?? input.objective },
    project: { id: input.projectId ?? `project-${input.missionId}`, objective: input.projectObjective ?? input.objective },
    mission: { id: input.missionId, objective: input.objective, successCriteria: input.successCriteria ?? ["Required artifacts exist.", "Independent verification passes."] },
  };
}

function agent(
  id: string,
  role: string,
  runtimeRole: CompanyAgentPlanV1["runtimeRole"],
  objective: string,
  capabilities: readonly string[],
  parentId: string | undefined,
  verifier = false,
  workspace: CompanyAgentPlanV1["workspace"] = "shared-read-only",
): CompanyAgentPlanV1 {
  return { id, role, runtimeRole, objective, capabilities, parentId, verifier, workspace, budget: DEFAULT_BUDGET };
}

function teamFor(type: MissionCompanyPlanV1["companyType"], objective: string): readonly CompanyAgentPlanV1[] {
  if (type === "research") return [
    agent("research-director", "Research Director", "project-manager", `Direct: ${objective}`, READ, undefined),
    agent("evidence-lead", "Evidence Lead", "planner", "Coordinate source and dataset evidence.", READ, "research-director"),
    agent("literature-agent", "Literature Agent", "research-engineer", "Find and assess primary sources.", RESEARCH, "evidence-lead"),
    agent("dataset-agent", "Dataset Agent", "knowledge-engineer", "Assess relevant data and provenance.", RESEARCH, "evidence-lead"),
    agent("methods-agent", "Methods Agent", "architect", "Evaluate methods and contradictions.", READ, "research-director"),
    agent("verification-agent", "Independent Verification Agent", "reviewer", "Verify claims, citations, and requirements.", READ, "research-director", true),
  ];
  if (type === "company-operations") return [
    agent("company-operator", "Company Operator", "project-manager", `Coordinate: ${objective}`, READ, undefined),
    agent("product-agent", "Product Agent", "planner", "Analyze product outcomes and priorities.", READ, "company-operator"),
    agent("operations-lead", "Operations Analysis Lead", "architect", "Coordinate research, marketing, and finance analysis.", READ, "company-operator"),
    agent("research-agent", "Research Agent", "research-engineer", "Collect decision-grade market evidence.", RESEARCH, "operations-lead"),
    agent("marketing-agent", "Marketing Agent", "documentation-engineer", "Develop evidence-grounded positioning and deliverables.", READ, "operations-lead"),
    agent("finance-analysis-agent", "Finance Analysis Agent", "performance-engineer", "Analyze costs, budgets, and scenarios.", READ, "operations-lead"),
    agent("verification-agent", "Independent Verification Agent", "reviewer", "Verify evidence and decision criteria.", READ, "company-operator", true),
  ];
  return [
    agent("technical-lead", "Technical Lead", "project-manager", `Coordinate: ${objective}`, READ, undefined),
    agent("architecture-agent", "Architecture Agent", "architect", "Define boundaries and implementation constraints.", READ, "technical-lead"),
    agent("implementation-lead", "Implementation Lead", "planner", "Coordinate isolated implementation work.", READ, "technical-lead"),
    agent("backend-agent", "Backend Agent", "software-engineer", "Implement backend/runtime changes.", WRITE, "implementation-lead", false, "git-worktree"),
    agent("frontend-agent", "Frontend Agent", "ui-ux-engineer", "Implement accessible user-facing changes when required.", WRITE, "implementation-lead", false, "git-worktree"),
    agent("test-agent", "Test Agent", "tester", "Create and execute deterministic tests.", WRITE, "implementation-lead", false, "git-worktree"),
    agent("security-verification-agent", "Security and Verification Agent", "security-engineer", "Independently verify security and requirements.", READ, "technical-lead", true),
  ];
}

function tasksFor(type: MissionCompanyPlanV1["companyType"], agents: readonly CompanyAgentPlanV1[]): readonly CompanyTaskPlanV1[] {
  const verifier = agents.find((item) => item.verifier)!;
  const workers = agents.filter((item) => item.parentId && !item.verifier);
  const independent = workers.map((member, index) => ({
    id: `task-${index + 1}`,
    title: member.objective,
    assignedAgentId: member.id,
    dependencies: [] as readonly string[],
    resources: member.workspace === "git-worktree" ? [`worktree:${member.id}`] : [],
    verificationType: (type === "research" ? "RESEARCH" : type === "software" ? "CODE" : "DATA") as CompanyTaskPlanV1["verificationType"],
  }));
  const synthesis: CompanyTaskPlanV1 = {
    id: "task-synthesis",
    title: "Synthesize worker results into the mission artifact.",
    assignedAgentId: agents[0].id,
    dependencies: independent.map((task) => task.id),
    resources: [],
    verificationType: type === "research" ? "RESEARCH" : type === "software" ? "CODE" : "DATA",
  };
  return [...independent, synthesis, {
    id: "task-verification",
    title: "Independently verify the artifact against success criteria.",
    assignedAgentId: verifier.id,
    dependencies: [synthesis.id],
    resources: [],
    verificationType: type === "software" ? "SECURITY" : type === "research" ? "RESEARCH" : "DATA",
  }];
}

function validatePlan(agents: readonly CompanyAgentPlanV1[], tasks: readonly CompanyTaskPlanV1[]): void {
  if (agents.length === 0 || agents.length > 12) throw new Error("Mission company must contain between 1 and 12 agents.");
  if (agents.filter((item) => item.verifier).length !== 1) throw new Error("Mission company requires exactly one independent verifier.");
  const ids = new Set(agents.map((item) => item.id));
  const childCounts = new Map<string, number>();
  for (const member of agents) {
    if (member.parentId && !ids.has(member.parentId)) throw new Error(`Unknown parent ${member.parentId}.`);
    if (member.parentId) childCounts.set(member.parentId, (childCounts.get(member.parentId) ?? 0) + 1);
    if (member.verifier && tasks.some((task) => task.assignedAgentId === member.id && task.id !== "task-verification")) {
      throw new Error("Verifier cannot execute production tasks.");
    }
  }
  if ([...childCounts.values()].some((count) => count > 3)) throw new Error("Mission company exceeds the maximum children per agent.");
  for (const member of agents) {
    let depth = 0;
    let cursor = member.parentId;
    const visited = new Set<string>([member.id]);
    while (cursor) {
      if (visited.has(cursor)) throw new Error("Mission company contains recursive delegation.");
      visited.add(cursor);
      depth += 1;
      if (depth > 2) throw new Error("Mission company exceeds maximum delegation depth.");
      cursor = agents.find((candidate) => candidate.id === cursor)?.parentId;
    }
  }
  const taskIds = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    if (!ids.has(task.assignedAgentId)) throw new Error(`Unknown task agent ${task.assignedAgentId}.`);
    if (task.dependencies.includes(task.id) || task.dependencies.some((id) => !taskIds.has(id))) throw new Error(`Invalid dependencies for ${task.id}.`);
  }
}
