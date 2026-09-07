import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { createId, now, type JsonObject } from "../core/types.js";

/** A stage in a reusable workflow definition. */
export interface WorkflowStage {
  id: string;
  agent: string;
  description: string;
  depends_on: string[];
}

/** A reusable workflow definition loaded from a YAML file. */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  stages: WorkflowStage[];
  outputs: string[];
  risk_policy: "low" | "medium" | "high";
  sourcePath?: string;
  loadedAt: string;
}

/** Minimal single-purpose YAML subset parser. Sufficient for QUACK workflows. */
export function parseWorkflowYaml(text: string, sourcePath?: string): WorkflowDefinition {
  const lines = text.split(/\r?\n/);
  let name = "";
  let description = "";
  let riskPolicy: WorkflowDefinition["risk_policy"] = "medium";
  const outputs: string[] = [];
  const stages: WorkflowStage[] = [];
  let i = 0;

  const top = (line: string): { key: string; value: string } | undefined => {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!m) return undefined;
    return { key: m[1], value: (m[2] ?? "").trim() };
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line || line.trim().startsWith("#") || line.trim() === "") { i++; continue; }

    if (line.startsWith("  ")) { i++; continue; }

    const kv = top(line);
    if (!kv) { i++; continue; }

    if (kv.key === "name") name = unquote(kv.value);
    else if (kv.key === "description") description = unquote(kv.value);
    else if (kv.key === "risk_policy") {
      const v = unquote(kv.value).toLowerCase();
      if (v === "low" || v === "medium" || v === "high") riskPolicy = v;
    } else if (kv.key === "outputs") {
      i++;
      while (i < lines.length && lines[i].startsWith("  - ")) {
        outputs.push(unquote(lines[i].trim().replace(/^- /, "").trim()));
        i++;
      }
      continue;
    } else if (kv.key === "stages") {
      i++;
      while (i < lines.length && lines[i].startsWith("  - ")) {
        const stage = parseStage(lines, i);
        if (stage.node) stages.push(stage.node);
        i = stage.next;
      }
      continue;
    }
    i++;
  }

  return {
    id: createId("wfd"),
    name: name || "workflow",
    description,
    stages,
    outputs,
    risk_policy: riskPolicy,
    sourcePath,
    loadedAt: now(),
  };
}

function parseStage(lines: string[], start: number): { node?: WorkflowStage; next: number } {
  const node: Partial<WorkflowStage> = { depends_on: [] };
  let i = start;
  let found = false;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith("  -") && !line.startsWith("    ")) {
      return { node: found ? (node as WorkflowStage) : undefined, next: i };
    }

    if (line.startsWith("  - id:")) {
      if (found) return { node: node as WorkflowStage, next: i };
      found = true;
      node.id = unquote(line.replace("  - id:", "").trim());
      i++;
      while (i < lines.length && lines[i].startsWith("    ")) {
        const field = lines[i].trim();
        const m = field.match(/^([A-Za-z_]+):\s*(.*)$/);
        if (m) {
          const key = m[1];
          const value = (m[2] ?? "").trim();
          if (key === "agent") node.agent = unquote(value);
          else if (key === "description") node.description = unquote(value);
          else if (key === "depends_on") {
            const arr = unquote(value).replace(/[\[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
            node.depends_on = arr;
          }
        }
        i++;
      }
      continue;
    }
    i++;
  }

  return { node: found ? (node as WorkflowStage) : undefined, next: i };
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * WorkflowLoader — loads reusable workflow YAML definitions from a directory
 * (default: ./workflows). Used by the WorkflowEngine to materialize WorkflowPlans.
 */
export class WorkflowLoader {
  constructor(private readonly workflowsDir = "workflows") {}

  async load(name: string): Promise<WorkflowDefinition | undefined> {
    const path = join(this.workflowsDir, `${name}.yaml`);
    try {
      const text = await readFile(path, "utf8");
      return parseWorkflowYaml(text, path);
    } catch {
      return undefined;
    }
  }

  async loadAll(): Promise<WorkflowDefinition[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(this.workflowsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: WorkflowDefinition[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || extname(entry.name) !== ".yaml") continue;
      try {
        const text = await readFile(join(this.workflowsDir, entry.name), "utf8");
        const def = parseWorkflowYaml(text, join(this.workflowsDir, entry.name));
        out.push(def);
      } catch {
        // skip malformed files
      }
    }
    return out;
  }
}
