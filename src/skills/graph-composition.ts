import type { TaskGraph, TaskNode } from "../engine/types.js";
import type { PreparedTaskGraph } from "../runtime/runtime.js";
import type { Permission } from "../security/permissions.js";
import type { ToolRegistry } from "../tools/tool.js";
import { DurableSkillSandboxRuntime } from "./sandbox-runtime.js";
import type { SkillDefinition, SkillInput, SkillRecord } from "./types.js";
import type { JsonObject, JsonValue } from "../core/types.js";

/** Compile selected skills before execution; scope bindings stay outside the serialized graph. */
export function compileSkillContributions(
  graph: TaskGraph,
  contributions: readonly { readonly definition: SkillDefinition; readonly record?: SkillRecord }[],
  input: SkillInput,
  tools: ToolRegistry,
  allowedPermissions: readonly Permission[],
): PreparedTaskGraph {
  const compiler = new DurableSkillSandboxRuntime({ tools, allowedPermissions });
  const compiled = contributions.map(({ definition, record }) => ({ definition, graph: compiler.compile(definition, input, record) }));
  const nodes: TaskNode[] = structuredClone([...graph.nodes]);
  const nodeSkillIds = new Map<string, string>();
  for (const contribution of compiled) {
    const dependedOn = new Set(nodes.flatMap((node) => [...node.dependencies]));
    const prerequisites = nodes.filter((node) => !dependedOn.has(node.id)).map((node) => node.id);
    const prefix = `skill:${contribution.definition.manifest.id}@${contribution.definition.manifest.version}:`;
    for (const node of contribution.graph.nodes) {
      const id = prefix + node.id;
      if (nodes.some((existing) => existing.id === id)) throw new Error(`Duplicate compiled skill node ${id}.`);
      nodes.push({ ...structuredClone(node), id, dependencies: node.dependencies.length ? node.dependencies.map((dependency) => prefix + dependency) : prerequisites,
        toolInvocations: node.toolInvocations?.map((invocation) => ({ ...invocation, input: remapBindings(invocation.input, prefix) as JsonObject })),
      });
      nodeSkillIds.set(id, contribution.definition.manifest.id);
    }
  }
  return { graph: { ...structuredClone(graph), nodes, edges: nodes.flatMap((node) => node.dependencies.map((from) => ({ from, to: node.id }))) }, nodeSkillIds };
}

function remapBindings(value: JsonValue, prefix: string): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => remapBindings(entry, prefix));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, key === "$fromNode" && typeof entry === "string" ? prefix + entry : remapBindings(entry, prefix)]));
  return value;
}
