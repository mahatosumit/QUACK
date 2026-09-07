import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type PluginManifest } from "./manifest.js";

/** JavaScript plugins execute with full host authority. This loader does not provide isolation. */
export class PluginLoader {
  constructor(private readonly options: { readonly trust?: "trusted-host" } = {}) {}

  async loadFromPath(path: string): Promise<PluginManifest> {
    this.requireTrustedHost();
    const resolved = resolve(path);

    if (!existsSync(resolved)) {
      throw new Error(`Plugin not found at path: ${resolved}`);
    }

    const mod = await import(pathToFileURL(resolved).href);

    if (!mod.manifest) {
      throw new Error(`Plugin at ${resolved} does not export a manifest`);
    }

    return mod.manifest as PluginManifest;
  }

  async loadFromPackage(name: string): Promise<PluginManifest> {
    this.requireTrustedHost();
    const resolved = resolve("node_modules", name);

    if (!existsSync(resolved)) {
      throw new Error(`Package not found: ${name}`);
    }

    try {
      const mod = await import(name);
      return mod.manifest as PluginManifest;
    } catch {
      const pkgPath = resolve(resolved, "package.json");
      const pkg = await import(pathToFileURL(pkgPath).href, { with: { type: "json" } });
      const main = (pkg as { default: { main?: string } }).default.main ?? "index.js";
      const entryPath = resolve(resolved, main);
      const entryMod = await import(pathToFileURL(entryPath).href);
      return entryMod.manifest as PluginManifest;
    }
  }

  private requireTrustedHost(): void {
    if (this.options.trust !== "trusted-host") throw new Error("JavaScript plugin loading requires explicit trusted-host configuration; plugin code is not sandboxed.");
  }
}
