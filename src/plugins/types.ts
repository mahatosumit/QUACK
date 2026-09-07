import { type PluginManifest } from "./manifest.js";
import { type Permission } from "../security/permissions.js";

export type PluginStatus = "active" | "inactive" | "error" | "loading";

export interface PluginRecord {
  readonly manifest: PluginManifest;
  readonly status: PluginStatus;
  readonly loadedAt: string;
}
