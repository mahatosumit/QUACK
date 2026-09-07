import { type PluginManifest } from "./manifest.js";
import { type Permission } from "../security/permissions.js";

/** Declaration checks only; this legacy class does not isolate or execute plugin code. */
export class PluginSandbox {
  validatePermissions(
    manifest: PluginManifest,
    requested: readonly Permission[]
  ): readonly string[] {
    const violations: string[] = [];

    for (const perm of requested) {
      if (!manifest.permissions.includes(perm)) {
        violations.push(
          `Permission "${perm}" is not declared in manifest for plugin "${manifest.id}"`
        );
      }
    }

    return violations;
  }

  capabilities(manifest: PluginManifest): string {
    return manifest.capabilities.join(", ");
  }
}
