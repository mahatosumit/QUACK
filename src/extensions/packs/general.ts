import { QUACK_CONTRACT_VERSION } from "../../contracts/v1/contracts.js";
import type { SpecialistAgentDefinition } from "../../agents/index.js";
import { skillManifest, unsupportedSkill as stub, namespaceSkillCatalog, type BuiltinSkillFactory } from "../../skills/builtins/registry.js";
import type { AgentProfile, AgentProfilePack, SkillPack } from "../types.js";

/** Explicit catalog of unavailable legacy skill definitions; no execution is installed. */
export function createGeneralSkillCatalog(): ReadonlyMap<string, BuiltinSkillFactory> {
  return new Map([
    ["terminal", () => ({
  manifest: skillManifest({
    id: "terminal",
    name: "Terminal",
    description: "Executes arbitrary terminal commands in a sandboxed shell. Supports command timeout, working directory selection, and output capture.",
    category: "terminal",
    tags: ["shell", "command", "terminal", "exec"],
    requiresPermissions: ["terminal.execute"],
    requiresTools: ["shell"],
    examples: [
      {
        input: "{ goal: \"list files in current directory\", parameters: { command: \"ls -la\", workdir: \"/project\" } }",
        output: "{ ok: true, data: { message: \"terminal executed successfully\" } }",
        description: "Run ls -la in the project directory",
      },
    ],
  }),
  execute: stub("terminal skill executed"),
})],
    ["file-manager", () => ({
  manifest: skillManifest({
    id: "file-manager",
    name: "File Manager",
    description: "Reads, writes, copies, moves, and deletes files and directories. Supports text and binary files, glob patterns, and directory tree operations.",
    category: "file",
    tags: ["file", "filesystem", "io", "read", "write"],
    requiresPermissions: ["workspace.read", "workspace.write"],
    requiresTools: ["filesystem"],
    examples: [
      {
        input: "{ goal: \"read config file\", parameters: { operation: \"read\", path: \"config.json\" } }",
        output: "{ ok: true, data: { content: \"{ ... }\" } }",
        description: "Read a JSON configuration file from the workspace",
      },
    ],
  }),
  execute: stub("file-manager skill executed"),
})],
    ["markdown", () => ({
  manifest: skillManifest({
    id: "markdown",
    name: "Markdown Generator",
    description: "Generates formatted markdown content including tables, code blocks, lists, headings, and cross-references. Supports templates and frontmatter.",
    category: "documentation",
    tags: ["markdown", "md", "format", "content"],
    requiresPermissions: ["workspace.write"],
    requiresTools: ["filesystem"],
    examples: [
      {
        input: "{ goal: \"create README.md\", parameters: { title: \"My Project\", sections: [\"Install\", \"Usage\", \"API\"] } }",
        output: "{ ok: true, data: { path: \"README.md\", size: 2048 } }",
        description: "Generate a project README with standard sections",
      },
    ],
  }),
  execute: stub("markdown skill executed"),
})],
  ]);
}

export function generalSpecialistAgents(): SpecialistAgentDefinition[] {
  return [
    {
      identity: { id: "research-agent", name: "Research Agent", description: "Finds and summarizes research material." },
      skills: ["research"],
      capabilities: ["permission.workspace.read"],
      trustLevel: "builtin",
      modelCapability: "retrieval",
      specialization: ["research", "summarize", "notes", "evidence"],
    },
    {
      identity: { id: "documentation-agent", name: "Documentation Agent", description: "Works on documents and knowledge artifacts." },
      skills: ["filesystem-assistant"],
      capabilities: ["permission.workspace.read", "permission.workspace.write"],
      trustLevel: "builtin",
      modelCapability: "reasoning",
      specialization: ["documentation", "document", "markdown", "writeup"],
    },
  ];
}

export function createGeneralPack(): AgentProfilePack & SkillPack {
  return {
    manifest: { id: "quack.general", version: "1.0.0", contractVersion: QUACK_CONTRACT_VERSION },
    contributions: {
      skills: namespaceSkillCatalog("general", createGeneralSkillCatalog()),
      agentProfiles: generalSpecialistAgents().map(definition => profileFromSpecialist(definition, "general", [
        "core.workspace.list-files", "core.workspace.read-file",
        ...(definition.capabilities.includes("permission.workspace.write") ? ["core.workspace.write-file"] : []),
      ])),
    },
  };
}

/** Adapts explicit legacy selection metadata without starting an agent or granting authority. */
export function profileFromSpecialist(definition: SpecialistAgentDefinition, namespace: string, allowedTools: readonly string[] = []): AgentProfile {
  return {
    contractVersion: QUACK_CONTRACT_VERSION, id: namespace + "." + definition.identity.id, version: "1.0.0",
    name: definition.identity.name, description: definition.identity.description, mode: "primary",
    requiredCapabilities: [], requiredPermissions: definition.capabilities.filter(id => id.startsWith("permission.")).map(id => id.slice("permission.".length)),
    modelPolicy: { privacy: "local-only", allowCloudFallback: false },
    capabilityPolicy: { ceiling: [...definition.capabilities] },
    allowedTools: [...allowedTools],
    contextPolicy: { namespaces: [], maxTokens: 4096, maxBytes: 32768, inheritParentContext: false },
    resourceBudget: { maxIterations: 10, maxToolCalls: 20, maxModelCalls: 10, timeoutMs: 60000, maxConcurrency: 1 },
    delegationDepth: 0,
    metadata: { specialization: [...definition.specialization], ...(definition.modelCapability && { modelCapability: definition.modelCapability }) },
  };
}
