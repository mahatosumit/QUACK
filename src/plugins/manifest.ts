import { type Permission } from "../security/permissions.js";

export type PluginType =
  | "tool"
  | "agent"
  | "provider"
  | "memory"
  | "knowledge-graph"
  | "workflow"
  | "prompt-pack"
  | "ui"
  | "importer"
  | "exporter";

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly quackApiVersion: string;
  readonly type: PluginType;
  readonly entry: string;
  readonly description?: string;
  readonly capabilities: readonly string[];
  readonly permissions: readonly Permission[];
  readonly author?: string;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly configurationSchema?: string;
  readonly platforms?: readonly string[];
}

export function validatePluginManifest(manifest: PluginManifest): readonly string[] {
  const errors: string[] = [];
  if (!manifest.id.trim()) errors.push("Plugin id is required.");
  if (!manifest.name.trim()) errors.push("Plugin name is required.");
  if (!manifest.version.trim()) errors.push("Plugin version is required.");
  if (!manifest.quackApiVersion.trim()) errors.push("Plugin API version is required.");
  if (!manifest.entry.trim()) errors.push("Plugin entry is required.");
  if (manifest.capabilities.length === 0) errors.push("At least one capability is required.");
  return errors;
}

