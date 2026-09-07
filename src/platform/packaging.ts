import { now, type IsoTimestamp } from "../core/types.js";
import type { PackageManifest, PackageFormat, UpdateManifest, UpdateChannel, PlatformType, ArchType } from "./types.js";

export class PackageManager {
  private packages: Map<string, PackageManifest> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  createPackage(version: string, format: PackageFormat = "zip", platform: PlatformType = "win32", arch: ArchType = "x64", options?: Partial<PackageManifest>): PackageManifest {
    const pkg: PackageManifest = {
      version,
      format,
      platform,
      arch,
      sizeMB: options?.sizeMB ?? 0,
      checksum: options?.checksum ?? "",
      signature: options?.signature ?? "",
      builtAt: now(),
      dependencies: options?.dependencies ?? [],
      minOSVersion: options?.minOSVersion ?? "10.0",
      recommended: options?.recommended ?? true,
    };
    const id = `${version}-${platform}-${arch}`;
    this.packages.set(id, pkg);
    return pkg;
  }

  getPackage(id: string): PackageManifest | undefined {
    return this.packages.get(id);
  }

  findPackage(version: string, platform?: PlatformType, arch?: ArchType): PackageManifest | undefined {
    for (const pkg of this.packages.values()) {
      if (pkg.version === version) {
        if (platform && pkg.platform !== platform) continue;
        if (arch && pkg.arch !== arch) continue;
        return pkg;
      }
    }
    return undefined;
  }

  listPackages(platform?: PlatformType): PackageManifest[] {
    const all = Array.from(this.packages.values());
    return platform ? all.filter((p) => p.platform === platform) : all;
  }

  deletePackage(id: string): boolean {
    return this.packages.delete(id);
  }

  getDependencyTree(version: string): { manifest: PackageManifest; dependencies: PackageManifest[] } | null {
    const pkg = this.findPackage(version);
    if (!pkg) return null;
    const deps: PackageManifest[] = [];
    for (const dep of pkg.dependencies) {
      const found = this.findPackage(dep);
      if (found) deps.push(found);
    }
    return { manifest: pkg, dependencies: deps };
  }

  getStats(): { total: number; recommended: number } {
    const all = Array.from(this.packages.values());
    return {
      total: all.length,
      recommended: all.filter((p) => p.recommended).length,
    };
  }
}

export class UpdateSystem {
  private updates: Map<string, UpdateManifest> = new Map();
  private currentVersion = "0.1.0";
  private updateHistory: { from: string; to: string; channel: UpdateChannel; installedAt: IsoTimestamp }[] = [];

  async checkForUpdates(currentVersion?: string, channel: UpdateChannel = "stable"): Promise<UpdateManifest[]> {
    if (currentVersion) this.currentVersion = currentVersion;
    return Array.from(this.updates.values())
      .filter((u) => u.channel === channel && semverCompare(u.latestVersion, this.currentVersion) > 0)
      .sort((a, b) => semverCompare(b.latestVersion, a.latestVersion));
  }

  registerUpdate(manifest: Omit<UpdateManifest, "currentVersion"> & { currentVersion?: string }): string {
    const id = createId();
    const update: UpdateManifest = {
      currentVersion: manifest.currentVersion ?? this.currentVersion,
      ...manifest,
    };
    this.updates.set(id, update);
    return id;
  }

  async applyUpdate(updateId: string): Promise<boolean> {
    throw new Error("Update applyUpdate is unsupported: no verified installer is configured.");
  }

  getCurrentVersion(): string {
    return this.currentVersion;
  }

  getUpdateHistory(): { from: string; to: string; channel: UpdateChannel; installedAt: IsoTimestamp }[] {
    return this.updateHistory;
  }

  getPendingUpdates(): UpdateManifest[] {
    return Array.from(this.updates.values())
      .filter((u) => !this.updateHistory.some((h) => h.to === u.latestVersion));
  }

  rollback(targetVersion: string): boolean {
    throw new Error("Update rollback is unsupported: no verified installer is configured.");
  }
}

const semverRegex = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/;

function semverCompare(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((s) => parseInt(s, 10) || 0);
  const pb = b.split(/[.\-+]/).map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function createId(): string {
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
