/**
 * Unified CLI configuration (Phase 6).
 *
 * Priority (highest wins), and NO process.env spread anywhere:
 *
 *   CLI argument  >  QUACK_* environment variable  >  ~/.quack/config.json  >  default
 *
 * Only explicitly known QUACK_* variables are read, one by one. Values
 * from any lower-priority source never override a higher one.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { quackHomeLayout, type QuackHomeLayout } from "./paths.js";

export interface CliConfig {
  readonly dataDir: string;
  readonly workspaceRoot: string;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  /** Skill roots scanned by discovery (explicit, never whole-filesystem). */
  readonly skillRoots: readonly string[];
  /** Ownership lease duration ms (multi-process recovery). */
  readonly ownershipLeaseMs: number;
  /** Explicit config-file path, when provided via --config. */
  readonly configFile?: string;
}

/** File shape stored at ~/.quack/config/config.json. */
interface ConfigFileShape {
  readonly dataDir?: string;
  readonly workspaceRoot?: string;
  readonly logLevel?: string;
  readonly skillRoots?: readonly string[];
  readonly ownershipLeaseMs?: number;
}

export interface ConfigSources {
  /** From CLI arguments (highest priority). */
  readonly cli?: Partial<Pick<CliConfig, "dataDir" | "workspaceRoot" | "logLevel" | "skillRoots" | "ownershipLeaseMs">>;
  /** Explicit --config file path (wins over the home config file). */
  readonly explicitConfigFile?: string;
}

const KNOWN_LEVELS = ["debug", "info", "warn", "error"] as const;

/**
 * Load the effective CLI config. Reads at most two JSON files: the
 * explicit --config path, else ~/.quack/config/config.json when it
 * exists. Unknown keys in config files are ignored (never executed or
 * interpolated).
 */
export function loadCliConfig(sources: ConfigSources = {}): CliConfig {
  const home = quackHomeLayout();
  const file = readConfigFile(sources.explicitConfigFile ?? defaultConfigFilePath(home));

  const cli = sources.cli ?? {};
  // Priority: CLI arg > env var > config file > default.
  const dataDir = cli.dataDir
    ?? envString("QUACK_DATA_DIR")
    ?? file?.dataDir
    ?? join(home.data);
  const workspaceRoot = cli.workspaceRoot
    ?? envString("QUACK_WORKSPACE_ROOT")
    ?? file?.workspaceRoot
    ?? process.cwd();
  const logLevel = cli.logLevel
    ?? parseLogLevel(envString("QUACK_LOG_LEVEL"))
    ?? parseLogLevel(file?.logLevel)
    ?? "info";
  const skillRoots = cli.skillRoots
    ?? envList("QUACK_SKILL_ROOTS")
    ?? (file?.skillRoots && file.skillRoots.length > 0 ? [...file.skillRoots] : undefined)
    ?? [home.skills];
  const ownershipLeaseMs = cli.ownershipLeaseMs
    ?? envNumber("QUACK_OWNERSHIP_LEASE_MS")
    ?? file?.ownershipLeaseMs
    ?? 30_000;

  return {
    dataDir,
    workspaceRoot,
    logLevel,
    skillRoots,
    ownershipLeaseMs,
    ...(sources.explicitConfigFile ? { configFile: sources.explicitConfigFile } : {}),
  };
}

export function defaultConfigFilePath(home: QuackHomeLayout): string {
  return join(home.config, "config.json");
}

function readConfigFile(path: string): ConfigFileShape | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as ConfigFileShape;
  } catch {
    // A malformed config file must not break the CLI: fall back to defaults.
    return undefined;
  }
}

/** Explicitly-allowlisted env reads only — never process.env spread. */
function envString(name: "QUACK_DATA_DIR" | "QUACK_WORKSPACE_ROOT" | "QUACK_LOG_LEVEL"): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function envList(name: "QUACK_SKILL_ROOTS"): readonly string[] | undefined {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parts = value.split(/[,;]/).map(part => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function envNumber(name: "QUACK_OWNERSHIP_LEASE_MS"): number | undefined {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseLogLevel(value: unknown): CliConfig["logLevel"] | undefined {
  return typeof value === "string" && (KNOWN_LEVELS as readonly string[]).includes(value)
    ? value as CliConfig["logLevel"]
    : undefined;
}
