import { QUACK_CONTRACT_VERSION } from "../../contracts/v1/contracts.js";
import { ok } from "../../core/types.js";
import { Planner } from "../../engine/planner.js";
import { WorkspaceListFilesTool, WorkspaceReadFileTool } from "../../tools/workspace-filesystem.js";
import { WorkspaceWriteFileTool } from "../../tools/workspace-write.js";
import { CodeSearchTool } from "../../tools/code-search.js";
import { TerminalTool } from "../../tools/terminal.js";
import { GitStatusTool } from "../../tools/git-status.js";
import type { SpecialistAgentDefinition } from "../../agents/index.js";
import { skillManifest, unsupportedSkill as stub, namespaceSkillCatalog, type BuiltinSkillFactory } from "../../skills/builtins/registry.js";
import type { AgentProfilePack, SkillPack, ToolPack, PlannerStrategy } from "../types.js";
import { generalSpecialistAgents, profileFromSpecialist } from "./general.js";

/** Explicit catalog of unavailable legacy skill definitions; no execution is installed. */
export function createSweSkillCatalog(): ReadonlyMap<string, BuiltinSkillFactory> {
  return new Map([
    ["git", () => ({
  manifest: skillManifest({
    id: "git",
    name: "Git",
    description: "Executes git commands (commit, push, pull, branch, merge, log, diff, status) via the terminal tool. Supports all standard git operations.",
    category: "source-control",
    tags: ["git", "vcs", "version-control", "source-control"],
    requiresPermissions: ["git.read", "git.write", "terminal.execute"],
    requiresTools: ["git", "shell"],
    examples: [
      {
        input: "{ goal: \"commit all changes with message 'fix login bug'\", parameters: { command: \"commit\", message: \"fix login bug\", all: true } }",
        output: "{ ok: true, data: { message: \"git executed successfully\" } }",
        description: "Stage all files and commit with a message",
      },
    ],
  }),
  execute: stub("git skill executed"),
})],
    ["testing", () => ({
  manifest: skillManifest({
    id: "testing",
    name: "Testing",
    description: "Discovers, runs, and analyzes test suites. Supports unit tests, integration tests, coverage reports, and failure diagnosis with suggested fixes.",
    category: "testing",
    tags: ["test", "testing", "unit-test", "coverage", "qa"],
    requiresPermissions: ["workspace.read", "terminal.execute"],
    requiresTools: ["shell", "filesystem"],
    examples: [
      {
        input: "{ goal: \"run all unit tests and show failures\", parameters: { framework: \"jest\", pattern: \"src/**/*.test.ts\" } }",
        output: "{ ok: true, data: { passed: 42, failed: 0, coverage: 87.5 } }",
        description: "Run Jest unit tests across all source files",
      },
    ],
  }),
  execute: stub("testing skill executed"),
})],
    ["documentation", () => ({
  manifest: skillManifest({
    id: "documentation",
    name: "Documentation Generator",
    description: "Generates project documentation from source code comments and structure. Produces markdown, HTML, or API reference output.",
    category: "documentation",
    tags: ["docs", "documentation", "api-docs", "generator"],
    requiresPermissions: ["workspace.read", "workspace.write"],
    requiresTools: ["filesystem"],
    examples: [
      {
        input: "{ goal: \"generate API docs for src/\", parameters: { format: \"markdown\", outputDir: \"docs/api\" } }",
        output: "{ ok: true, data: { files: 12, location: \"docs/api\" } }",
        description: "Generate markdown API documentation from the src directory",
      },
    ],
  }),
  execute: stub("documentation skill executed"),
})],
    ["security-review", () => ({
  manifest: skillManifest({
    id: "security-review",
    name: "Security Review",
    description: "Scans code for security vulnerabilities, hardcoded secrets, injection risks, and dependency CVEs. Produces severity-ranked reports.",
    category: "security",
    tags: ["security", "audit", "vulnerability", "cve", "secrets"],
    requiresPermissions: ["workspace.read", "filesystem.read.external"],
    requiresTools: ["filesystem", "shell"],
    examples: [
      {
        input: "{ goal: \"scan for exposed secrets\", parameters: { scanType: \"secrets\", paths: [\"src\", \".env.example\"] } }",
        output: "{ ok: true, data: { findings: 0, risk: \"low\" } }",
        description: "Scan project for hardcoded secrets and credentials",
      },
    ],
  }),
  execute: stub("security-review skill executed"),
})],
    ["architecture-review", () => ({
  manifest: skillManifest({
    id: "architecture-review",
    name: "Architecture Review",
    description: "Analyzes project structure, module boundaries, dependency graphs, and design patterns. Detects circular dependencies and layer violations.",
    category: "architecture",
    tags: ["architecture", "design", "structure", "dependency-graph"],
    requiresPermissions: ["workspace.read"],
    requiresTools: ["filesystem"],
    examples: [
      {
        input: "{ goal: \"check for circular dependencies\", parameters: { rootDir: \"src\", ignorePaths: [\"node_modules\"] } }",
        output: "{ ok: true, data: { circularDeps: 0, moduleCount: 24 } }",
        description: "Analyze the project for circular module dependencies",
      },
    ],
  }),
  execute: stub("architecture-review skill executed"),
})],
    ["workspace-index", () => ({
  manifest: skillManifest({
    id: "workspace-index",
    name: "Workspace Index",
    description: "Indexes the entire workspace by scanning files, extracting symbols, building a searchable knowledge graph of the codebase.",
    category: "indexing",
    tags: ["index", "search", "symbols", "knowledge-graph"],
    requiresPermissions: ["workspace.read", "workspace.write"],
    requiresTools: ["filesystem"],
    examples: [
      {
        input: "{ goal: \"re-index workspace\", parameters: { refresh: true, filePatterns: [\"**/*.ts\"] } }",
        output: "{ ok: true, data: { files: 156, symbols: 3402, durationMs: 1234 } }",
        description: "Re-index all TypeScript files in the workspace",
      },
    ],
  }),
  execute: stub("workspace-index skill executed"),
})],
    ["dependency-analysis", () => ({
  manifest: skillManifest({
    id: "dependency-analysis",
    name: "Dependency Analysis",
    description: "Analyzes project dependencies for version conflicts, outdated packages, license compliance, and transitive dependency bloat.",
    category: "analysis",
    tags: ["dependencies", "analysis", "npm", "licenses", "versions"],
    requiresPermissions: ["workspace.read"],
    requiresTools: ["filesystem"],
    examples: [
      {
        input: "{ goal: \"find outdated dependencies\", parameters: { depth: 2, ignoreDev: false } }",
        output: "{ ok: true, data: { outdated: 3, vulnerabilities: 1, licenses: { mit: 24, apache: 3 } } }",
        description: "Scan all dependencies for outdated packages and license information",
      },
    ],
  }),
  execute: stub("dependency-analysis skill executed"),
})],
  ]);
}

export function sweSpecialistAgents(): SpecialistAgentDefinition[] {
  return [
    {
      identity: { id: "coding-agent", name: "Coding Agent", description: "Implements and reviews code changes." },
      skills: ["code-analysis"],
      capabilities: ["permission.workspace.read", "permission.workspace.write"],
      trustLevel: "builtin",
      modelCapability: "coding",
      specialization: ["coding", "typescript", "repository", "bug", "implementation"],
    },
    {
      identity: { id: "engineering-agent", name: "Engineering Agent", description: "Performs system and architecture analysis." },
      skills: ["code-analysis"],
      capabilities: ["permission.workspace.read"],
      trustLevel: "builtin",
      modelCapability: "reasoning",
      specialization: ["engineering", "architecture", "analysis", "design"],
    },
  ];
}

/** Explicit compatibility catalog, retaining the original distribution IDs. */
export function defaultSpecialistAgents(): SpecialistAgentDefinition[] {
  const swe = sweSpecialistAgents();
  const general = generalSpecialistAgents();
  return [swe[0]!, general[0]!, swe[1]!, general[1]!];
}

export function createSwePack(): AgentProfilePack & SkillPack {
  return {
    manifest: { id: "quack.swe", version: "1.0.0", contractVersion: QUACK_CONTRACT_VERSION },
    contributions: {
      skills: namespaceSkillCatalog("swe", createSweSkillCatalog()),
      agentProfiles: sweSpecialistAgents().map(definition => profileFromSpecialist(definition, "swe", [
        "core.workspace.list-files", "core.workspace.read-file", "core.workspace.code-search",
        ...(definition.capabilities.includes("permission.workspace.write") ? ["core.workspace.write-file"] : []),
      ])),
      plannerStrategies: [createSwePlannerStrategy()],
    },
  };
}

/** Existing local tools, registered explicitly. The caller still needs runtime capability grants. */
export function createSweToolPack(options: { readonly workspaceRoot: string }): ToolPack {
  if (!options.workspaceRoot.trim()) throw new Error("SWE tool pack requires an explicit workspace root.");
  return {
    manifest: { id: "quack.swe-tools", version: "1.0.0", contractVersion: QUACK_CONTRACT_VERSION },
    contributions: { tools: [
      new WorkspaceListFilesTool(options), new WorkspaceReadFileTool(options), new WorkspaceWriteFileTool(options),
      new CodeSearchTool(options.workspaceRoot), new TerminalTool(options), new GitStatusTool(options),
    ] },
  };
}

/** Adapter over the existing SWE planner. Graph validation and execution remain runtime-owned. */
export function createSwePlannerStrategy(): PlannerStrategy {
  return {
    id: "swe.planner", version: "1.0.0",
    plan: context => {
      const planner = new Planner({
        defaultRetryPolicy: { maxRetries: 1, backoff: "fixed", baseDelayMs: 100, maxDelayMs: 1000 },
        defaultTimeoutMs: context.constraints.budget.timeoutMs,
        maxNodesPerGraph: context.constraints.maxNodes,
      });
      return ok(planner.createTaskGraph(context.goal));
    },
  };
}
