import { createId, now } from "../core/types.js";
import { type AgentInstance, type AgentConfig, type AgentProfile } from "./types.js";

// ── Default Agent Profiles ──────────────────────────────────────

export function executiveBrainProfile(): AgentProfile {
  return {
    role: "executive-brain",
    name: "Executive Brain",
    description: "Executive leadership layer. Owns organizational strategy, goal decomposition, agent oversight, and top-level decision making.",
    capabilities: [
      { id: "org.strategy", name: "Organizational Strategy", version: "1.0", description: "High-level goal decomposition and strategy" },
      { id: "org.oversight", name: "Agent Oversight", version: "1.0", description: "Monitor and coordinate agents" },
      { id: "org.decision", name: "Decision Making", version: "1.0", description: "Resolve conflicts and approve plans" },
    ],
    maxConcurrentTasks: 5,
    defaultPriority: "critical",
    supportedTaskTypes: ["strategy", "oversight", "delegation", "approval"],
    requiredMemory: ["org-state", "agent-profiles"],
    requiredTools: [],
    requiredSkills: [],
    requiresApproval: false,
    autoDelegate: true,
    maxRetries: 3,
    timeoutMs: 60000,
  };
}

export function projectManagerProfile(): AgentProfile {
  return {
    role: "project-manager",
    name: "Project Manager",
    description: "Breaks goals into milestones, creates task graphs, assigns work, monitors progress, detects bottlenecks.",
    capabilities: [
      { id: "pm.planning", name: "Milestone Planning", version: "1.0", description: "Create milestone plans from goals" },
      { id: "pm.task-graph", name: "Task Graph Construction", version: "1.0", description: "Build dependency-aware task graphs" },
      { id: "pm.monitoring", name: "Progress Monitoring", version: "1.0", description: "Track task completion and detect bottlenecks" },
    ],
    maxConcurrentTasks: 10,
    defaultPriority: "high",
    supportedTaskTypes: ["planning", "scheduling", "monitoring", "delegation"],
    requiredMemory: ["task-graphs", "agent-capabilities"],
    requiredTools: [],
    requiredSkills: [],
    requiresApproval: true,
    autoDelegate: true,
    maxRetries: 2,
    timeoutMs: 30000,
  };
}

export function architectProfile(): AgentProfile {
  return {
    role: "architect",
    name: "Architect",
    description: "Owns system structure, module boundaries, interfaces, patterns, dependency management, technical debt.",
    capabilities: [
      { id: "arch.design", name: "System Design", version: "1.0", description: "Design system architecture" },
      { id: "arch.review", name: "Architecture Review", version: "1.0", description: "Review architecture decisions" },
      { id: "arch.debt", name: "Technical Debt Analysis", version: "1.0", description: "Identify and analyze technical debt" },
    ],
    maxConcurrentTasks: 3,
    defaultPriority: "high",
    supportedTaskTypes: ["architecture", "design", "review", "analysis"],
    requiredMemory: ["architecture", "patterns", "adrs"],
    requiredTools: [],
    requiredSkills: ["architecture-review"],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 2,
    timeoutMs: 60000,
  };
}

export function plannerProfile(): AgentProfile {
  return {
    role: "planner",
    name: "Planner",
    description: "Turns goals into ordered, verifiable plans. Updates plans as new information appears.",
    capabilities: [
      { id: "plan.create", name: "Plan Creation", version: "1.0", description: "Create ordered execution plans" },
      { id: "plan.update", name: "Plan Adaptation", version: "1.0", description: "Update plans based on new information" },
      { id: "plan.deps", name: "Dependency Mapping", version: "1.0", description: "Map inter-task dependencies" },
    ],
    maxConcurrentTasks: 5,
    defaultPriority: "high",
    supportedTaskTypes: ["planning", "scheduling", "adaptation"],
    requiredMemory: ["task-graphs", "execution-history"],
    requiredTools: [],
    requiredSkills: [],
    requiresApproval: true,
    autoDelegate: false,
    maxRetries: 2,
    timeoutMs: 30000,
  };
}

export function softwareEngineerProfile(): AgentProfile {
  return {
    role: "software-engineer",
    name: "Software Engineer",
    description: "Implements features, fixes bugs, refactors code, improves performance.",
    capabilities: [
      { id: "eng.implement", name: "Implementation", version: "1.0", description: "Write new code" },
      { id: "eng.refactor", name: "Refactoring", version: "1.0", description: "Restructure existing code" },
      { id: "eng.fix", name: "Bug Fixing", version: "1.0", description: "Diagnose and fix bugs" },
    ],
    maxConcurrentTasks: 3,
    defaultPriority: "medium",
    supportedTaskTypes: ["implementation", "refactoring", "bugfix", "optimization"],
    requiredMemory: ["codebase", "patterns"],
    requiredTools: ["workspace-read", "workspace-write"],
    requiredSkills: ["file-manager", "terminal"],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 3,
    timeoutMs: 120000,
  };
}

export function debuggerProfile(): AgentProfile {
  return {
    role: "debugger",
    name: "Debugger",
    description: "Investigates failures using logs, tests, runtime state, and source inspection.",
    capabilities: [
      { id: "debug.investigate", name: "Failure Investigation", version: "1.0", description: "Root cause analysis" },
      { id: "debug.fix", name: "Fix Proposal", version: "1.0", description: "Propose minimal fixes" },
    ],
    maxConcurrentTasks: 3,
    defaultPriority: "high",
    supportedTaskTypes: ["debugging", "investigation", "root-cause"],
    requiredMemory: ["errors", "failures", "logs"],
    requiredTools: ["workspace-read", "terminal"],
    requiredSkills: ["terminal"],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 3,
    timeoutMs: 120000,
  };
}

export function reviewerProfile(): AgentProfile {
  return {
    role: "reviewer",
    name: "Reviewer",
    description: "Reviews code for architecture, readability, correctness, maintainability, testing, documentation, security, performance.",
    capabilities: [
      { id: "review.code", name: "Code Review", version: "1.0", description: "Review code quality" },
      { id: "review.security", name: "Security Review", version: "1.0", description: "Review security posture" },
      { id: "review.perf", name: "Performance Review", version: "1.0", description: "Review performance implications" },
    ],
    maxConcurrentTasks: 5,
    defaultPriority: "medium",
    supportedTaskTypes: ["review", "audit", "inspection"],
    requiredMemory: ["codebase", "standards"],
    requiredTools: ["workspace-read"],
    requiredSkills: ["security-review", "architecture-review"],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 2,
    timeoutMs: 60000,
  };
}

export function testerProfile(): AgentProfile {
  return {
    role: "tester",
    name: "Tester",
    description: "Creates, runs, and analyzes tests. Generates coverage reports. Suggests missing coverage.",
    capabilities: [
      { id: "test.create", name: "Test Creation", version: "1.0", description: "Write unit/integration tests" },
      { id: "test.run", name: "Test Execution", version: "1.0", description: "Run test suites" },
      { id: "test.analyze", name: "Test Analysis", version: "1.0", description: "Analyze failures and coverage" },
    ],
    maxConcurrentTasks: 4,
    defaultPriority: "medium",
    supportedTaskTypes: ["testing", "coverage", "analysis"],
    requiredMemory: ["test-results", "coverage-data"],
    requiredTools: ["terminal", "workspace-read"],
    requiredSkills: ["testing"],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 2,
    timeoutMs: 120000,
  };
}

export function documentationEngineerProfile(): AgentProfile {
  return {
    role: "documentation-engineer",
    name: "Documentation Engineer",
    description: "Maintains API docs, architecture docs, roadmap, ADRs, developer guide, user guide, release notes, examples, tutorials.",
    capabilities: [
      { id: "docs.api", name: "API Documentation", version: "1.0", description: "Generate API docs from code" },
      { id: "docs.guide", name: "Guide Writing", version: "1.0", description: "Write developer and user guides" },
      { id: "docs.adr", name: "ADR Management", version: "1.0", description: "Create and maintain ADRs" },
    ],
    maxConcurrentTasks: 3,
    defaultPriority: "low",
    supportedTaskTypes: ["documentation", "writing", "adr"],
    requiredMemory: ["codebase", "architecture"],
    requiredTools: ["workspace-read", "workspace-write"],
    requiredSkills: ["documentation", "markdown"],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 2,
    timeoutMs: 60000,
  };
}

export function researchEngineerProfile(): AgentProfile {
  return {
    role: "research-engineer",
    name: "Research Engineer",
    description: "Researches new AI techniques, monitors open-source projects, tracks ecosystem changes, evaluates tools.",
    capabilities: [
      { id: "research.tech", name: "Technology Research", version: "1.0", description: "Research new technologies" },
      { id: "research.compare", name: "Comparison", version: "1.0", description: "Compare tools and approaches" },
      { id: "research.rec", name: "Recommendation", version: "1.0", description: "Recommend improvements" },
    ],
    maxConcurrentTasks: 2,
    defaultPriority: "low",
    supportedTaskTypes: ["research", "analysis", "comparison"],
    requiredMemory: ["research", "ecosystem"],
    requiredTools: [],
    requiredSkills: [],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 1,
    timeoutMs: 120000,
  };
}

export function securityEngineerProfile(): AgentProfile {
  return {
    role: "security-engineer",
    name: "Security Engineer",
    description: "Reviews permissions, secrets, sandboxing, dependencies, generated code, supply-chain risks, unsafe tool execution.",
    capabilities: [
      { id: "sec.audit", name: "Security Audit", version: "1.0", description: "Audit code for vulnerabilities" },
      { id: "sec.supply-chain", name: "Supply Chain Review", version: "1.0", description: "Review dependency security" },
      { id: "sec.permissions", name: "Permissions Review", version: "1.0", description: "Review permission policies" },
    ],
    maxConcurrentTasks: 2,
    defaultPriority: "critical",
    supportedTaskTypes: ["security", "audit", "review"],
    requiredMemory: ["vulnerabilities", "cves"],
    requiredTools: ["workspace-read"],
    requiredSkills: ["security-review"],
    requiresApproval: true,
    autoDelegate: false,
    maxRetries: 2,
    timeoutMs: 60000,
  };
}

export function performanceEngineerProfile(): AgentProfile {
  return {
    role: "performance-engineer",
    name: "Performance Engineer",
    description: "Measures and improves latency, memory use, startup time, indexing speed, tool execution, and provider routing.",
    capabilities: [
      { id: "perf.benchmark", name: "Benchmarking", version: "1.0", description: "Run performance benchmarks" },
      { id: "perf.optimize", name: "Optimization", version: "1.0", description: "Optimize slow code paths" },
      { id: "perf.profile", name: "Profiling", version: "1.0", description: "Profile resource usage" },
    ],
    maxConcurrentTasks: 2,
    defaultPriority: "medium",
    supportedTaskTypes: ["performance", "benchmarking", "optimization"],
    requiredMemory: ["benchmarks", "profiles"],
    requiredTools: ["terminal", "workspace-read"],
    requiredSkills: [],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 2,
    timeoutMs: 120000,
  };
}

export function devopsEngineerProfile(): AgentProfile {
  return {
    role: "devops-engineer",
    name: "DevOps Engineer",
    description: "Owns builds, packaging, release workflows, deployment, CI, observability, and update systems.",
    capabilities: [
      { id: "devops.ci", name: "CI/CD", version: "1.0", description: "Manage CI/CD pipelines" },
      { id: "devops.deploy", name: "Deployment", version: "1.0", description: "Manage deployments" },
      { id: "devops.monitor", name: "Monitoring", version: "1.0", description: "Set up observability" },
    ],
    maxConcurrentTasks: 3,
    defaultPriority: "high",
    supportedTaskTypes: ["devops", "deployment", "ci", "monitoring"],
    requiredMemory: ["infrastructure"],
    requiredTools: ["terminal"],
    requiredSkills: ["terminal"],
    requiresApproval: true,
    autoDelegate: false,
    maxRetries: 3,
    timeoutMs: 120000,
  };
}

export function releaseEngineerProfile(): AgentProfile {
  return {
    role: "release-engineer",
    name: "Release Engineer",
    description: "Manages versioning, changelogs, release notes, artifact publishing, and release coordination.",
    capabilities: [
      { id: "rel.version", name: "Version Management", version: "1.0", description: "Manage semantic versioning" },
      { id: "rel.changelog", name: "Changelog", version: "1.0", description: "Generate changelogs" },
      { id: "rel.publish", name: "Publishing", version: "1.0", description: "Publish releases" },
    ],
    maxConcurrentTasks: 2,
    defaultPriority: "medium",
    supportedTaskTypes: ["release", "versioning", "publishing"],
    requiredMemory: ["versions", "changelogs"],
    requiredTools: ["workspace-read", "workspace-write"],
    requiredSkills: [],
    requiresApproval: true,
    autoDelegate: false,
    maxRetries: 2,
    timeoutMs: 60000,
  };
}

export function uiUxEngineerProfile(): AgentProfile {
  return {
    role: "ui-ux-engineer",
    name: "UI/UX Engineer",
    description: "Designs and implements user interfaces, ensures accessibility, maintains design systems.",
    capabilities: [
      { id: "ui.design", name: "UI Design", version: "1.0", description: "Design user interfaces" },
      { id: "ui.accessibility", name: "Accessibility", version: "1.0", description: "Ensure accessibility compliance" },
    ],
    maxConcurrentTasks: 2,
    defaultPriority: "medium",
    supportedTaskTypes: ["ui", "design", "accessibility"],
    requiredMemory: ["design-system"],
    requiredTools: ["workspace-read", "workspace-write"],
    requiredSkills: [],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 2,
    timeoutMs: 60000,
  };
}

export function pluginEngineerProfile(): AgentProfile {
  return {
    role: "plugin-engineer",
    name: "Plugin Engineer",
    description: "Develops and maintains plugins, ensures plugin compatibility, manages plugin marketplace.",
    capabilities: [
      { id: "plugin.dev", name: "Plugin Development", version: "1.0", description: "Build new plugins" },
      { id: "plugin.compat", name: "Plugin Compatibility", version: "1.0", description: "Ensure API compatibility" },
    ],
    maxConcurrentTasks: 2,
    defaultPriority: "medium",
    supportedTaskTypes: ["plugin", "extension", "integration"],
    requiredMemory: ["plugin-api"],
    requiredTools: ["workspace-read", "workspace-write"],
    requiredSkills: [],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 2,
    timeoutMs: 60000,
  };
}

export function memoryCuratorProfile(): AgentProfile {
  return {
    role: "memory-curator",
    name: "Memory Curator",
    description: "Manages session memory, prunes stale entries, consolidates related knowledge, enforces memory limits.",
    capabilities: [
      { id: "mem.prune", name: "Memory Pruning", version: "1.0", description: "Remove stale memory entries" },
      { id: "mem.consolidate", name: "Memory Consolidation", version: "1.0", description: "Merge related knowledge" },
    ],
    maxConcurrentTasks: 1,
    defaultPriority: "low",
    supportedTaskTypes: ["memory", "maintenance", "cleanup"],
    requiredMemory: ["memory-index"],
    requiredTools: [],
    requiredSkills: [],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 1,
    timeoutMs: 30000,
  };
}

export function knowledgeEngineerProfile(): AgentProfile {
  return {
    role: "knowledge-engineer",
    name: "Knowledge Engineer",
    description: "Maintains Knowledge Graph, entity relationships, architectural memory, lessons learned, design patterns.",
    capabilities: [
      { id: "kg.build", name: "Knowledge Graph Construction", version: "1.0", description: "Build and maintain knowledge graph" },
      { id: "kg.query", name: "Knowledge Query", version: "1.0", description: "Query knowledge graph for insights" },
      { id: "kg.learn", name: "Organizational Learning", version: "1.0", description: "Extract lessons from history" },
    ],
    maxConcurrentTasks: 1,
    defaultPriority: "low",
    supportedTaskTypes: ["knowledge", "learning", "analysis"],
    requiredMemory: ["knowledge-graph", "patterns"],
    requiredTools: [],
    requiredSkills: [],
    requiresApproval: false,
    autoDelegate: false,
    maxRetries: 1,
    timeoutMs: 60000,
  };
}

// ── Profile Factory ─────────────────────────────────────────────

const profileFactories: Record<string, () => AgentProfile> = {
  "executive-brain": executiveBrainProfile,
  "project-manager": projectManagerProfile,
  architect: architectProfile,
  planner: plannerProfile,
  "software-engineer": softwareEngineerProfile,
  debugger: debuggerProfile,
  reviewer: reviewerProfile,
  tester: testerProfile,
  "documentation-engineer": documentationEngineerProfile,
  "research-engineer": researchEngineerProfile,
  "security-engineer": securityEngineerProfile,
  "performance-engineer": performanceEngineerProfile,
  "devops-engineer": devopsEngineerProfile,
  "release-engineer": releaseEngineerProfile,
  "ui-ux-engineer": uiUxEngineerProfile,
  "plugin-engineer": pluginEngineerProfile,
  "memory-curator": memoryCuratorProfile,
  "knowledge-engineer": knowledgeEngineerProfile,
};

export function getProfile(role: string): AgentProfile | undefined {
  const factory = profileFactories[role];
  return factory?.();
}

export function getAllProfiles(): AgentProfile[] {
  return Object.values(profileFactories).map((f) => f());
}

export function defaultAgentConfig(role: string): AgentConfig | undefined {
  const profile = getProfile(role);
  if (!profile) return undefined;
  return {
    profile,
    priority: profile.defaultPriority,
    enabled: true,
    maxMemoryEntries: 1000,
    maxHistoryLength: 500,
    autoRecover: true,
    logLevel: "info",
  };
}
