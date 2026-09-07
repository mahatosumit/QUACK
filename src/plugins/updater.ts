import { type PluginManifest } from "./manifest.js";

export interface UpdateCheckResult {
  readonly available: boolean;
  readonly latestVersion: string | null;
  readonly message: string;
}

export class PluginUpdater {
  async checkForUpdates(current: PluginManifest): Promise<UpdateCheckResult> {
    return {
      available: false,
      latestVersion: current.version,
      message: "No updates available",
    };
  }

  async update(id: string): Promise<boolean> {
    return false;
  }
}
