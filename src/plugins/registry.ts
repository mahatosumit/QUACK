import { type PluginManifest, validatePluginManifest } from "./manifest.js";
import { type PluginRecord, type PluginStatus } from "./types.js";

export class PluginRegistry {
  private readonly plugins: Map<string, PluginRecord> = new Map();

  register(manifest: PluginManifest, entry?: string): PluginRecord {
    const resolvedManifest = entry !== undefined
      ? { ...manifest, entry }
      : manifest;

    const errors = validatePluginManifest(resolvedManifest);
    if (errors.length > 0) {
      throw new Error(`Invalid plugin manifest: ${errors.join("; ")}`);
    }

    const record: PluginRecord = {
      manifest: resolvedManifest,
      status: "inactive",
      loadedAt: new Date().toISOString(),
    };

    this.plugins.set(resolvedManifest.id, record);
    return record;
  }

  get(id: string): PluginRecord | undefined {
    return this.plugins.get(id);
  }

  getAll(): readonly PluginRecord[] {
    return Array.from(this.plugins.values());
  }

  findByType(type: string): readonly PluginRecord[] {
    return Array.from(this.plugins.values()).filter(
      (record) => record.manifest.type === type
    );
  }

  remove(id: string): boolean {
    return this.plugins.delete(id);
  }

  updateStatus(id: string, status: PluginStatus): boolean {
    const record = this.plugins.get(id);
    if (!record) return false;
    this.plugins.set(id, { ...record, status });
    return true;
  }

  count(): number {
    return this.plugins.size;
  }
}
