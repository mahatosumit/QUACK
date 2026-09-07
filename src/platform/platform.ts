import { platform as nodePlatform, arch as nodeArch, tmpdir, homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

/**
 * QUACK platform abstraction (ADR 0040).
 *
 * The core runtime depends on these interfaces, never on `process.platform`,
 * shell conventions, or OS-specific paths scattered inline. Platform support
 * is declared honestly per capability: SUPPORTED, BEST_EFFORT, or
 * UNAVAILABLE. A capability that is UNAVAILABLE must fail closed where it is
 * requested, never silently degrade.
 */

export type PlatformKind = "windows" | "linux" | "macos" | "other";

export type PlatformSupport = "SUPPORTED" | "BEST_EFFORT" | "UNAVAILABLE";

export type ArchitectureKind = "x64" | "arm64" | "other";

export interface PlatformCapabilities {
  readonly coreRuntime: PlatformSupport;
  readonly filesystem: PlatformSupport;
  readonly processExecution: PlatformSupport;
  readonly workerIsolation: PlatformSupport;
  readonly networkPolicy: PlatformSupport;
  readonly sqliteCoordination: PlatformSupport;
  readonly fileLocking: PlatformSupport;
  readonly secretStore: PlatformSupport;
  readonly containerBackend: PlatformSupport;
  readonly osNativeSandbox: PlatformSupport;
}

export interface PlatformAdapter {
  readonly kind: PlatformKind;
  readonly architecture: ArchitectureKind;
  readonly capabilities: PlatformCapabilities;
  /** True when the platform's documented guarantees hold for this capability. */
  supports(capability: keyof PlatformCapabilities): boolean;
  /** Default shell binary used only by explicitly authorized shell execution. */
  readonly shell: { readonly path: string; readonly argvPrefix: readonly string[] } | undefined;
}

export function detectPlatform(explicit?: NodeJS.Platform): PlatformKind {
  const value = explicit ?? nodePlatform;
  if (value === "win32") return "windows";
  if (value === "linux") return "linux";
  if (value === "darwin") return "macos";
  return "other";
}

export function detectArchitecture(explicit?: string): ArchitectureKind {
  const value = explicit ?? nodeArch;
  if (value === "x64") return "x64";
  if (value === "arm64") return "arm64";
  return "other";
}

const WINDOWS_CAPABILITIES: PlatformCapabilities = {
  coreRuntime: "SUPPORTED",
  filesystem: "SUPPORTED",
  processExecution: "SUPPORTED",
  workerIsolation: "SUPPORTED",
  networkPolicy: "SUPPORTED",
  sqliteCoordination: "SUPPORTED",
  fileLocking: "BEST_EFFORT",
  secretStore: "BEST_EFFORT",
  containerBackend: "BEST_EFFORT",
  osNativeSandbox: "BEST_EFFORT",
};

const LINUX_CAPABILITIES: PlatformCapabilities = {
  coreRuntime: "SUPPORTED",
  filesystem: "SUPPORTED",
  processExecution: "SUPPORTED",
  workerIsolation: "SUPPORTED",
  networkPolicy: "SUPPORTED",
  sqliteCoordination: "SUPPORTED",
  fileLocking: "SUPPORTED",
  secretStore: "BEST_EFFORT",
  containerBackend: "SUPPORTED",
  osNativeSandbox: "BEST_EFFORT",
};

const MACOS_CAPABILITIES: PlatformCapabilities = {
  coreRuntime: "SUPPORTED",
  filesystem: "SUPPORTED",
  processExecution: "SUPPORTED",
  workerIsolation: "SUPPORTED",
  networkPolicy: "SUPPORTED",
  sqliteCoordination: "SUPPORTED",
  fileLocking: "SUPPORTED",
  secretStore: "BEST_EFFORT",
  containerBackend: "BEST_EFFORT",
  osNativeSandbox: "BEST_EFFORT",
};

const OTHER_CAPABILITIES: PlatformCapabilities = {
  coreRuntime: "BEST_EFFORT",
  filesystem: "BEST_EFFORT",
  processExecution: "BEST_EFFORT",
  workerIsolation: "BEST_EFFORT",
  networkPolicy: "SUPPORTED",
  sqliteCoordination: "BEST_EFFORT",
  fileLocking: "BEST_EFFORT",
  secretStore: "UNAVAILABLE",
  containerBackend: "UNAVAILABLE",
  osNativeSandbox: "UNAVAILABLE",
};

function shellFor(kind: PlatformKind): PlatformAdapter["shell"] {
  if (kind === "windows") {
    const comspec = process.env["ComSpec"];
    if (comspec && existsSync(comspec)) return { path: comspec, argvPrefix: ["/d", "/s", "/c"] };
    return undefined;
  }
  if (kind === "linux") {
    for (const candidate of ["/bin/bash", "/usr/bin/bash", "/bin/sh"]) {
      if (existsSync(candidate)) return { path: candidate, argvPrefix: ["-c"] };
    }
    return undefined;
  }
  if (kind === "macos") {
    for (const candidate of ["/bin/zsh", "/bin/bash"]) {
      if (existsSync(candidate)) return { path: candidate, argvPrefix: ["-c"] };
    }
    return undefined;
  }
  return undefined;
}

export function createPlatformAdapter(options: { readonly platform?: NodeJS.Platform; readonly architecture?: string } = {}): PlatformAdapter {
  const kind = detectPlatform(options.platform);
  const architecture = detectArchitecture(options.architecture);
  const capabilities = kind === "windows" ? WINDOWS_CAPABILITIES
    : kind === "linux" ? LINUX_CAPABILITIES
    : kind === "macos" ? MACOS_CAPABILITIES
    : OTHER_CAPABILITIES;
  return {
    kind,
    architecture,
    capabilities,
    supports(capability) {
      return this.capabilities[capability] !== "UNAVAILABLE";
    },
    shell: shellFor(kind),
  };
}

/** Cross-platform platform facts the runtime may query without touching `process` directly. */
export const platformFacts = {
  tmpdir: (): string => tmpdir(),
  homedir: (): string => homedir(),
  /** Line ending used by text files the runtime writes. */
  eol: (): "\r\n" | "\n" => (detectPlatform() === "windows" ? "\r\n" : "\n"),
  /** Path separator for the host. Runtime code joins paths via node:path, never by hand. */
  readTextFileIfExists: (path: string): string | undefined => {
    try { return readFileSync(path, "utf8"); } catch { return undefined; }
  },
};
