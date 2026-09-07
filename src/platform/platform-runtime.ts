import { homedir, hostname, tmpdir, uptime, platform, arch, userInfo, release, version } from "node:os";
import { join } from "node:path";
import type {
  PlatformInfo, PlatformCapabilities, PlatformEnvironment,
  PlatformPermissions, PlatformType, ArchType,
} from "./types.js";

export class PlatformRuntime {
  private _info: PlatformInfo | null = null;
  private _initialized = false;

  async initialize(): Promise<PlatformInfo> {
    this._info = this.detectPlatform();
    this._initialized = true;
    return this._info;
  }

  async shutdown(): Promise<void> {
    this._initialized = false;
  }

  getPlatformInfo(): PlatformInfo {
    if (!this._info) this._info = this.detectPlatform();
    return this._info;
  }

  detectPlatform(): PlatformInfo {
    const p = platform() as PlatformType;
    return {
      platform: p,
      arch: arch() as ArchType,
      hostname: hostname(),
      username: this.safeUserName(),
      osVersion: version(),
      kernelVersion: release(),
      uptime: uptime(),
      isWsl: /microsoft/i.test(release()),
      isContainer: null,
      isVirtualMachine: null,
    };
  }

  getCapabilities(): PlatformCapabilities {
    // Report implemented adapters, not capabilities inferred from the OS name.
    return {
      canManageProcesses: false, canManageServices: false,
      canReadRegistry: false, canNotify: false,
      canUseClipboard: false, canUseGlobalShortcuts: false,
      canUseSystemTray: false, canUseNativeDialogs: false,
      canUseFileAssociations: false, canUsePowerManagement: false,
      canUseHardwareMonitoring: false,
      supportsWayland: false, supportsX11: false,
      supportsSystemd: false, supportsDbus: false,
      supportsWinRT: false, supportsPowerShell: false,
      supportsWsl: false, supportsFlatpak: false,
      supportsSnap: false, supportsAppImage: false,
    };
  }

  getEnvironment(): PlatformEnvironment {
    const home = homedir();
    return {
      variables: { platform: platform(), architecture: arch(), nodeVersion: process.versions.node },
      paths: { home, temp: tmpdir(), config: join(home, ".config"), data: join(home, ".local", "share"), cache: join(home, ".cache"), desktop: join(home, "Desktop"), documents: join(home, "Documents"), downloads: join(home, "Downloads") },
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      shell: process.env["SHELL"] ?? process.env["ComSpec"] ?? "unknown",
      terminalEmulators: this.detectTerminals(),
    };
  }

  getPermissions(): PlatformPermissions {
    throw new Error("Platform permission probing is unsupported: runtime policy must determine action authority.");
  }

  private safeUserName(): string {
    try { return userInfo().username; } catch { return "unknown"; }
  }

  private detectTerminals(): string[] {
    const terms: string[] = [];
    if (process.env["TERM_PROGRAM"]) terms.push(process.env["TERM_PROGRAM"]);
    if (process.env["WT_SESSION"]) terms.push("Windows Terminal");
    if (process.env["TERMINAL_EMULATOR"]) terms.push(process.env["TERMINAL_EMULATOR"]);
    return terms;
  }
}
